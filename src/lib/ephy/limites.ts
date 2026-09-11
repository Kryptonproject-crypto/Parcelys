/**
 * Les limites d'usage du catalogue E-Phy, et ce qu'on peut en dire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI MANQUAIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * L'import E-Phy enregistre, pour chaque usage, le nombre maximal
 * d'applications, l'intervalle minimal entre deux, le délai avant récolte et
 * les trois ZNT. Le contrôle à la saisie les transportait jusqu'à
 * `UsageForDose`… et n'en regardait aucun : seules la dose, l'autorisation du
 * produit et les conditions de sol drainé étaient vérifiées.
 *
 * Autrement dit, quatre informations réglementaires étaient importées,
 * stockées, transportées — et jamais opposées à la saisie. Un troisième passage
 * là où le catalogue en autorise deux ne provoquait aucun avertissement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE FAIT, ET CE QU'IL REFUSE DE FAIRE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il est **pur** : aucune base, aucune date implicite. Les antécédents et la
 * date de récolte lui sont fournis. C'est ce qui permet de l'éprouver sur des
 * cas précis sans monter un jeu de données.
 *
 * Il ne décide rien qu'il ne puisse justifier :
 *
 *   · une valeur que le catalogue n'écrit pas en clair (« 2 à 3 », « selon
 *     usage », vide) n'est **pas** devinée. Elle est signalée comme
 *     inexploitable, ou tue ;
 *   · aucun avertissement n'est produit quand la donnée manque. Le silence du
 *     catalogue n'est pas une autorisation, mais ce n'est pas non plus une
 *     infraction — et annoncer l'un ou l'autre serait inventer ;
 *   · chaque phrase dit **la valeur saisie, la valeur du catalogue, la règle et
 *     la correction**. Un avertissement qu'on ne peut pas vérifier soi-même ne
 *     sert qu'à inquiéter.
 *
 * Ces contrôles **avertissent**, comme les autres : l'étiquette du produit fait
 * foi, le catalogue ignore les dérogations, et refuser d'enregistrer un
 * traitement réellement effectué produirait un registre faux.
 */

/**
 * Un entier tel que le catalogue l'écrit, ou `null`.
 *
 * E-Phy remplit ces colonnes en texte libre. On y rencontre « 2 », « 2.0 »,
 * mais aussi « 2 à 3 », « selon la culture », « - » et des cases vides. Seule
 * une valeur qui est **exactement** un nombre est retenue : « 2 à 3 » pourrait
 * vouloir dire deux ou trois, et choisir pour l'exploitant reviendrait à
 * inventer une limite réglementaire.
 */
export function entierDuCatalogue(brut: string | null | undefined): number | null {
  if (brut === null || brut === undefined) return null;
  const propre = brut.trim().replace(',', '.');
  if (propre === '') return null;
  if (!/^\d+(\.0+)?$/.test(propre)) return null;
  const valeur = Number(propre);
  return Number.isFinite(valeur) && valeur >= 0 ? Math.round(valeur) : null;
}

/** Le catalogue dit quelque chose, mais pas un nombre exploitable. */
export function valeurNonExploitable(brut: string | null | undefined): boolean {
  if (brut === null || brut === undefined) return false;
  const propre = brut.trim();
  if (propre === '' || propre === '-') return false;
  return entierDuCatalogue(propre) === null;
}

/** Un jour, sans l'heure : deux traitements du même jour sont à zéro jour d'écart. */
function auJour(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000,
  );
}

/** Écart en jours entiers entre deux dates, positif si `fin` est postérieure. */
export function ecartEnJours(debut: Date, fin: Date): number {
  return auJour(fin) - auJour(debut);
}

// ---------------------------------------------------------------------------
// Nombre maximal d'applications
// ---------------------------------------------------------------------------

/**
 * Le traitement saisi dépasse-t-il le nombre d'applications autorisé ?
 *
 * `anterieuresDansLaCampagne` compte les applications **déjà enregistrées** du
 * même produit, sur la même parcelle, dans la même campagne — le traitement en
 * cours de saisie non compris.
 *
 * Sur quoi porte le décompte, et pourquoi c'est dit à l'exploitant : E-Phy
 * publie ce nombre « par usage », sans préciser dans le fichier la période de
 * référence. L'usage courant est le cycle cultural. Parcelys compte donc par
 * campagne et par parcelle, et **écrit cette base dans l'avertissement** :
 * l'exploitant peut ainsi juger si elle correspond à son cas, au lieu de subir
 * un chiffre dont il ignore d'où il sort.
 */
export function verifierNombreApplications(params: {
  produit: string;
  maxApplications: string | null;
  anterieuresDansLaCampagne: number;
  campagne: number;
}): string | null {
  const max = entierDuCatalogue(params.maxApplications);

  if (max === null) {
    if (valeurNonExploitable(params.maxApplications)) {
      return (
        `Nombre maximal d’applications de ${params.produit} : le catalogue E-Phy ` +
        `indique « ${params.maxApplications!.trim()} », que Parcelys ne sait pas ` +
        'interpréter comme un nombre. Reportez-vous à l’étiquette du produit.'
      );
    }
    return null;
  }

  const total = params.anterieuresDansLaCampagne + 1;
  if (total <= max) return null;

  return (
    `Nombre maximal d’applications dépassé : ce traitement serait le ${total}ᵉ ` +
    `de ${params.produit} sur cette parcelle pour la campagne ${params.campagne}, ` +
    `alors que le catalogue E-Phy en autorise ${max} pour cet usage. ` +
    'Vérifiez la date, la parcelle ou le produit saisi ; si un passage précédent ' +
    'a été enregistré par erreur, corrigez-le dans le registre.'
  );
}

// ---------------------------------------------------------------------------
// Intervalle minimal entre deux applications
// ---------------------------------------------------------------------------

/**
 * Le délai depuis le passage précédent respecte-t-il l'intervalle minimal ?
 *
 * `precedente` est la date du dernier traitement **antérieur** avec le même
 * produit sur la même parcelle. Un traitement postérieur n'entre pas en compte :
 * c'est celui-là qu'il faudrait alors vérifier, pas celui qu'on saisit.
 */
export function verifierIntervalle(params: {
  produit: string;
  minIntervalDays: string | null;
  appliqueLe: Date;
  precedente: Date | null;
}): string | null {
  const min = entierDuCatalogue(params.minIntervalDays);

  if (min === null) {
    if (valeurNonExploitable(params.minIntervalDays)) {
      return (
        `Intervalle minimal entre applications de ${params.produit} : le catalogue ` +
        `E-Phy indique « ${params.minIntervalDays!.trim()} », que Parcelys ne sait ` +
        'pas interpréter en jours. Reportez-vous à l’étiquette du produit.'
      );
    }
    return null;
  }

  if (!params.precedente) return null;

  const ecart = ecartEnJours(params.precedente, params.appliqueLe);
  if (ecart < 0 || ecart >= min) return null;

  return (
    `Intervalle entre applications non respecté : ${ecart} jour${ecart > 1 ? 's' : ''} ` +
    `depuis le passage précédent de ${params.produit} sur cette parcelle ` +
    `(${params.precedente.toLocaleDateString('fr-FR')}), alors que le catalogue ` +
    `E-Phy impose au moins ${min} jours. ` +
    `Le prochain passage autorisé serait le ` +
    `${new Date(params.precedente.getTime() + min * 86_400_000).toLocaleDateString('fr-FR')}.`
  );
}

// ---------------------------------------------------------------------------
// Délai avant récolte
// ---------------------------------------------------------------------------

/**
 * Le délai avant récolte est-il tenable compte tenu de la récolte prévue ?
 *
 * Deux situations, et deux phrases différentes :
 *
 *   · la récolte est **déjà enregistrée** et tombe avant la fin du délai : le
 *     délai n'a pas été respecté, c'est un constat ;
 *   · la récolte est seulement **prévue** : c'est un avertissement sur une
 *     date qui peut encore bouger, et la phrase le dit.
 *
 * Sans date de récolte connue, rien n'est dit. Supposer une date de récolte
 * pour pouvoir avertir reviendrait à fabriquer l'infraction.
 */
export function verifierDelaiAvantRecolte(params: {
  produit: string;
  preHarvestDelay: string | null;
  appliqueLe: Date;
  recolte: { date: Date; reelle: boolean } | null;
}): string | null {
  const delai = entierDuCatalogue(params.preHarvestDelay);
  if (delai === null || !params.recolte) return null;

  const ecart = ecartEnJours(params.appliqueLe, params.recolte.date);
  if (ecart < 0 || ecart >= delai) return null;

  const auPlusTot = new Date(params.appliqueLe.getTime() + delai * 86_400_000);
  const quand = params.recolte.reelle ? 'a eu lieu' : 'est prévue';

  return (
    `Délai avant récolte non respecté : ${delai} jours sont exigés par le catalogue ` +
    `E-Phy après application de ${params.produit}, et la récolte ${quand} le ` +
    `${params.recolte.date.toLocaleDateString('fr-FR')}, soit ${ecart} jour` +
    `${ecart > 1 ? 's' : ''} après ce traitement. ` +
    `La récolte ne peut intervenir qu’à partir du ${auPlusTot.toLocaleDateString('fr-FR')}.`
  );
}

// ---------------------------------------------------------------------------
// Zones non traitées
// ---------------------------------------------------------------------------

/**
 * Les ZNT de l'usage retenu, telles que le catalogue les publie.
 *
 * C'est un **rappel**, pas un contrôle : Parcelys ne mesure pas la distance
 * entre la parcelle et le point d'eau le plus proche. Il faudrait pour cela un
 * référentiel hydrographique importé et à jour, et la position exacte du
 * pulvérisateur — pas le contour de la parcelle.
 *
 * Le rappel vaut tout de même mieux que le silence : ces distances figurent sur
 * l'étiquette, elles sont opposables, et beaucoup ne les ont pas en tête au
 * moment de sortir le pulvérisateur.
 */
export function rappelZnt(params: {
  produit: string;
  zntAquaticM: string | null;
  zntArthropodM: string | null;
  zntPlantM: string | null;
}): string | null {
  const parties: string[] = [];
  const ajouter = (libelle: string, brut: string | null) => {
    const valeur = (brut ?? '').trim();
    if (valeur === '' || valeur === '-') return;
    parties.push(`${libelle} ${valeur} m`);
  };

  ajouter('milieu aquatique', params.zntAquaticM);
  ajouter('arthropodes non cibles', params.zntArthropodM);
  ajouter('plantes non cibles', params.zntPlantM);

  if (parties.length === 0) return null;

  return (
    `Zones non traitées à respecter pour ${params.produit} : ${parties.join(', ')}. ` +
    'Parcelys ne mesure pas ces distances sur le terrain — vérifiez-les avant le passage.'
  );
}

// ---------------------------------------------------------------------------
// Conditions d'emploi : délai de rentrée, pollinisateurs, riverains
// ---------------------------------------------------------------------------

/**
 * Familles de conditions d'emploi remontées à la saisie.
 *
 * L'ANSES range les conditions d'emploi par catégorie, en texte libre. Trois
 * familles pèsent au moment d'appliquer, et n'étaient pas remontées :
 *
 *   · **délai de rentrée** — combien de temps le champ reste interdit d'accès ;
 *   · **abeilles et pollinisateurs** — la mention « abeilles » et les
 *     restrictions de floraison ;
 *   · **riverains et zones fréquentées** — les distances de sécurité.
 *
 * Le repérage porte sur la **catégorie** publiée par l'ANSES et, à défaut, sur
 * quelques mots du libellé. Il est volontairement large : une condition rangée
 * dans la mauvaise famille reste affichée, avec son texte intégral. Manquer une
 * condition serait grave ; en afficher une de trop ne l'est pas.
 *
 * Le texte n'est **jamais reformulé**. C'est la phrase de l'ANSES qui s'affiche,
 * mot pour mot : la reformuler serait la réécrire, et c'est elle qui est
 * opposable.
 */
export type FamilleCondition = 'rentree' | 'pollinisateurs' | 'riverains';

const MOTS: Record<FamilleCondition, RegExp> = {
  rentree: /d[ée]lai\s+de\s+rentr[ée]e|\brentr[ée]e\b/i,
  pollinisateurs: /abeille|pollinisateur|butineur|floraison|apicole/i,
  riverains: /riverain|zone[s]?\s+fr[ée]quent[ée]e|r[ée]sident/i,
};

export function familleDeLaCondition(
  categorie: string,
  libelle: string,
): FamilleCondition | null {
  for (const famille of ['rentree', 'pollinisateurs', 'riverains'] as const) {
    if (MOTS[famille].test(categorie) || MOTS[famille].test(libelle)) return famille;
  }
  return null;
}

const INTITULE: Record<FamilleCondition, string> = {
  rentree: 'Délai de rentrée',
  pollinisateurs: 'Pollinisateurs',
  riverains: 'Riverains',
};

/**
 * Une phrase par famille rencontrée, le texte de l'ANSES entre guillemets.
 *
 * Une seule condition par famille : ces fichiers en contiennent parfois une
 * dizaine par produit, et noyer l'exploitant sous dix phrases revient à ce
 * qu'il n'en lise aucune. La plus longue est retenue — c'est en général la plus
 * complète, celle qui porte la valeur chiffrée plutôt que le renvoi.
 */
export function rappelsConditions(
  conditions: Array<{ category: string; label: string }>,
  produit: string,
): string[] {
  const parFamille = new Map<FamilleCondition, string>();

  for (const condition of conditions) {
    const famille = familleDeLaCondition(condition.category, condition.label);
    if (!famille) continue;
    const actuelle = parFamille.get(famille);
    if (!actuelle || condition.label.length > actuelle.length) {
      parFamille.set(famille, condition.label);
    }
  }

  return [...parFamille].map(
    ([famille, label]) => `${INTITULE[famille]} — ${produit} : « ${label.trim()} »`,
  );
}
