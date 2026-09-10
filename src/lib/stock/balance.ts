/**
 * Le solde d'un stock, et ce qu'il vaut vraiment.
 *
 * ## Un solde n'est jamais « le stock réel »
 *
 * C'est le total des mouvements enregistrés. Un bidon entamé sans saisie reste
 * compté ; un achat oublié manque. Parcelys ne prétend donc jamais dire ce
 * qu'il y a dans le local — il dit ce que les saisies impliquent, et signale
 * tout ce qui laisse penser que les deux divergent.
 *
 * C'est exactement l'esprit de la règle générale du projet : afficher la
 * source, ne rien inventer. Un stock affiché comme une vérité serait une
 * information fabriquée.
 *
 * ## Pourquoi une somme, et pas un compteur
 *
 * Un champ « quantité restante » mis à jour à chaque écriture finit toujours
 * par mentir : une écriture ratée, une reprise de sauvegarde, un import, et le
 * chiffre ne correspond plus à rien — sans que rien ne le signale. La somme des
 * mouvements est exacte par construction, et se recalcule à volonté.
 */

import { convertirQuantite, expliquerConversion, normaliserUnite } from './units';

/** Un mouvement, réduit à ce qu'il faut pour calculer. */
export type MouvementCalcul = {
  /** Signée : positive à l'entrée, négative à la sortie. */
  quantity: number;
  unit: string;
  lotId?: string | null;
};

export type SoldeStock = {
  /** Solde dans l'unité de gestion de l'article. */
  quantite: number;
  unite: string;
  /**
   * Mouvements qui n'ont pas pu être ramenés à l'unité de l'article — et qui
   * ne sont donc **pas** comptés dans `quantite`.
   *
   * Ils ne sont ni ignorés ni convertis de force : ils sont listés, avec la
   * raison. Un solde amputé sans le dire vaudrait moins que pas de solde.
   */
  ecartes: Array<{ quantite: number; unite: string; raison: string }>;
  /** Le solde porte-t-il sur la totalité des mouvements ? */
  complet: boolean;
};

export function calculerSolde(
  mouvements: MouvementCalcul[],
  uniteArticle: string,
): SoldeStock {
  let quantite = 0;
  const ecartes: SoldeStock['ecartes'] = [];

  for (const m of mouvements) {
    if (normaliserUnite(m.unit) === normaliserUnite(uniteArticle)) {
      quantite += m.quantity;
      continue;
    }

    const converti = convertirQuantite(m.quantity, m.unit, uniteArticle);
    if (converti === null) {
      ecartes.push({
        quantite: m.quantity,
        unite: m.unit,
        raison: expliquerConversion(m.unit, uniteArticle),
      });
      continue;
    }
    quantite += converti;
  }

  return {
    // Trois décimales : c'est la précision de la colonne, et arrondir plus tôt
    // ferait apparaître des « 0,0000000001 L » après quelques conversions.
    quantite: Math.round(quantite * 1000) / 1000,
    unite: uniteArticle,
    ecartes,
    complet: ecartes.length === 0,
  };
}

/** Solde par lot, pour savoir lequel est entamé et lequel est vide. */
export function calculerSoldesParLot(
  mouvements: MouvementCalcul[],
  uniteArticle: string,
): Map<string, SoldeStock> {
  const parLot = new Map<string, MouvementCalcul[]>();

  for (const m of mouvements) {
    if (!m.lotId) continue;
    const liste = parLot.get(m.lotId) ?? [];
    liste.push(m);
    parLot.set(m.lotId, liste);
  }

  const soldes = new Map<string, SoldeStock>();
  for (const [lotId, liste] of parLot) {
    soldes.set(lotId, calculerSolde(liste, uniteArticle));
  }
  return soldes;
}

// ---------------------------------------------------------------------------
// Signe des mouvements
// ---------------------------------------------------------------------------

export type NatureMouvement =
  | 'ENTREE'
  | 'SORTIE'
  | 'AJUSTEMENT'
  | 'RETOUR'
  | 'DESTRUCTION';

/**
 * Sens imposé par la nature du mouvement.
 *
 * `null` pour l'ajustement d'inventaire : c'est le seul cas où l'écart peut
 * aller dans les deux sens, et le forcer dans un sens obligerait à inventer un
 * second champ pour dire lequel.
 */
export function sensAttendu(nature: NatureMouvement): 1 | -1 | null {
  switch (nature) {
    case 'ENTREE':
      return 1;
    case 'SORTIE':
    case 'RETOUR':
    case 'DESTRUCTION':
      return -1;
    case 'AJUSTEMENT':
      return null;
  }
}

/**
 * Ramène une quantité saisie au signe qu'impose sa nature.
 *
 * L'interface fait saisir « 20 litres sortis », pas « −20 ». La conversion se
 * fait ici, une seule fois, pour que le signe stocké soit toujours cohérent
 * avec la nature — sans quoi le solde, qui n'est qu'une somme, serait faux.
 */
export function quantiteSignee(nature: NatureMouvement, saisie: number): number {
  const sens = sensAttendu(nature);
  if (sens === null) return saisie;
  return sens * Math.abs(saisie);
}

// ---------------------------------------------------------------------------
// Ce qui mérite d'être signalé
// ---------------------------------------------------------------------------

export type AlerteStock = {
  code: 'solde-negatif' | 'sous-seuil' | 'lot-perime' | 'lot-bientot-perime' | 'unites-melangees';
  niveau: 'information' | 'attention' | 'anomalie';
  message: string;
};

export function alertesStock(input: {
  solde: SoldeStock;
  seuil: number | null;
  lots: Array<{ id: string; lotNumber: string | null; expiresOn: Date | null }>;
  soldesParLot: Map<string, SoldeStock>;
  aujourdHui?: Date;
}): AlerteStock[] {
  const alertes: AlerteStock[] = [];
  const maintenant = input.aujourdHui ?? new Date();

  if (input.solde.quantite < 0) {
    // Un solde négatif ne veut pas dire « il manque du produit » : il veut dire
    // que les sorties enregistrées dépassent les entrées enregistrées. Presque
    // toujours un achat non saisi. Le dire ainsi évite de faire chercher un vol.
    alertes.push({
      code: 'solde-negatif',
      niveau: 'anomalie',
      message:
        `Solde négatif (${input.solde.quantite} ${input.solde.unite}) : les sorties ` +
        'enregistrées dépassent les entrées. Il manque probablement la saisie d’un achat.',
    });
  }

  if (!input.solde.complet) {
    alertes.push({
      code: 'unites-melangees',
      niveau: 'attention',
      message:
        `${input.solde.ecartes.length} mouvement(s) dans une unité non convertible ` +
        'ne sont pas comptés dans ce solde.',
    });
  }

  if (
    input.seuil !== null &&
    input.solde.quantite >= 0 &&
    input.solde.quantite < input.seuil
  ) {
    alertes.push({
      code: 'sous-seuil',
      niveau: 'information',
      message:
        `Sous le seuil que vous avez fixé (${input.seuil} ${input.solde.unite}).`,
    });
  }

  for (const lot of input.lots) {
    if (!lot.expiresOn) continue;
    // Un lot vide n'a pas à être signalé comme périmé : il n'y a plus rien.
    const reste = input.soldesParLot.get(lot.id)?.quantite ?? 0;
    if (reste <= 0) continue;

    const jours = Math.floor(
      (lot.expiresOn.getTime() - maintenant.getTime()) / 86_400_000,
    );
    const nom = lot.lotNumber ? `Lot ${lot.lotNumber}` : 'Un lot';

    if (jours < 0) {
      alertes.push({
        code: 'lot-perime',
        niveau: 'attention',
        message:
          `${nom} a dépassé sa date limite d’utilisation (${lot.expiresOn.toLocaleDateString('fr-FR')}) ` +
          `et il en reste ${reste} ${input.solde.unite}. ` +
          'La décision d’emploi ou d’élimination vous appartient : Parcelys signale, il ne tranche pas.',
      });
    } else if (jours <= 90) {
      alertes.push({
        code: 'lot-bientot-perime',
        niveau: 'information',
        message:
          `${nom} arrive à sa date limite dans ${jours} jour(s), ` +
          `avec ${reste} ${input.solde.unite} restants.`,
      });
    }
  }

  return alertes;
}
