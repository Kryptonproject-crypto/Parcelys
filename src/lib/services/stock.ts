import 'server-only';
import { Prisma, type StockCategory, type StockMovementKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  alertesStock,
  calculerSolde,
  calculerSoldesParLot,
  quantiteSignee,
  type AlerteStock,
  type SoldeStock,
} from '@/lib/stock/balance';
import {
  convertirQuantite,
  expliquerConversion,
  normaliserUnite,
  uniteConnue,
} from '@/lib/stock/units';

/**
 * Stocks et lots.
 *
 * ## Ce que ça sert à répondre
 *
 * Lors d'un contrôle, la question n'est pas « combien vous reste-t-il ». Elle
 * est : **quel lot a été appliqué sur quelle parcelle, et d'où venait-il**. Un
 * registre qui note « Karaté Zéon, 0,075 L/ha » sans numéro de lot ne répond
 * pas. C'est ce chaînage — achat → lot → traitement → parcelle — que ce module
 * rend possible.
 *
 * ## Pourquoi le stock ne se décrémente pas tout seul
 *
 * Il serait facile de retirer automatiquement du stock à chaque traitement
 * saisi. Ce serait une erreur. Un exploitant qui ne tient pas de stock verrait
 * apparaître des articles fantômes et des soldes négatifs sur tout ce qu'il
 * enregistre — un bruit permanent qui rendrait l'écran inutilisable et
 * masquerait les vrais écarts.
 *
 * Le rattachement est donc **choisi** : au moment de la saisie, ou plus tard
 * depuis l'écran des stocks. Et pour que ce choix ne devienne pas un trou
 * silencieux, `utilisationsNonRattachees()` liste les traitements qui ont
 * consommé un produit suivi en stock sans qu'aucun lot ne leur soit rattaché.
 * L'écart est visible, pas absorbé.
 */

export type EtatArticle = {
  id: string;
  category: StockCategory;
  name: string;
  unit: string;
  alertThreshold: number | null;
  archivedAt: Date | null;
  /** Rattachement au référentiel, quand il existe. */
  phytoProductId: string | null;
  amm: string | null;
  fertilizerId: string | null;
  organicInputId: string | null;

  solde: SoldeStock;
  lots: Array<{
    id: string;
    lotNumber: string | null;
    supplier: string | null;
    purchasedOn: Date | null;
    expiresOn: Date | null;
    reste: SoldeStock;
  }>;
  alertes: AlerteStock[];
  dernierMouvementLe: Date | null;
  nombreMouvements: number;
};

/**
 * L'état complet des stocks d'une exploitation.
 *
 * Tout est calculé à la lecture. Sur les volumes en jeu — quelques centaines
 * d'articles, quelques milliers de mouvements — c'est instantané, et cela
 * supprime toute possibilité de dérive entre un compteur et la réalité des
 * écritures.
 */
export async function etatStocks(
  farmId: string,
  options: { inclureArchives?: boolean; aujourdHui?: Date } = {},
): Promise<EtatArticle[]> {
  const articles = await prisma.stockItem.findMany({
    where: {
      farmId,
      ...(options.inclureArchives ? {} : { archivedAt: null }),
    },
    include: {
      lots: { orderBy: [{ purchasedOn: 'desc' }, { createdAt: 'desc' }] },
      movements: { orderBy: { occurredOn: 'desc' } },
      phytoProduct: { select: { amm: true } },
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return articles.map((article) => {
    const mouvements = article.movements.map((m) => ({
      quantity: Number(m.quantity),
      unit: m.unit,
      lotId: m.lotId,
    }));

    const solde = calculerSolde(mouvements, article.unit);
    const soldesParLot = calculerSoldesParLot(mouvements, article.unit);
    const seuil =
      article.alertThreshold === null ? null : Number(article.alertThreshold);

    return {
      id: article.id,
      category: article.category,
      name: article.name,
      unit: article.unit,
      alertThreshold: seuil,
      archivedAt: article.archivedAt,
      phytoProductId: article.phytoProductId,
      amm: article.phytoProduct?.amm ?? null,
      fertilizerId: article.fertilizerId,
      organicInputId: article.organicInputId,
      solde,
      lots: article.lots.map((lot) => ({
        id: lot.id,
        lotNumber: lot.lotNumber,
        supplier: lot.supplier,
        purchasedOn: lot.purchasedOn,
        expiresOn: lot.expiresOn,
        reste:
          soldesParLot.get(lot.id) ??
          { quantite: 0, unite: article.unit, ecartes: [], complet: true },
      })),
      alertes: alertesStock({
        solde,
        seuil,
        lots: article.lots,
        soldesParLot,
        ...(options.aujourdHui ? { aujourdHui: options.aujourdHui } : {}),
      }),
      dernierMouvementLe: article.movements[0]?.occurredOn ?? null,
      nombreMouvements: article.movements.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Écrire un mouvement
// ---------------------------------------------------------------------------

export type RefusMouvement = { ok: false; raison: string };
export type SuccesMouvement = { ok: true; id: string; quantiteSignee: number };

export type EntreeMouvement = {
  itemId: string;
  lotId?: string | null;
  kind: StockMovementKind;
  occurredOn: Date;
  /** Quantité telle que saisie, toujours positive sauf pour un ajustement. */
  quantity: number;
  unit: string;
  phytoApplicationId?: string | null;
  fertilizerApplicationId?: string | null;
  operationId?: string | null;
  reason?: string | null;
  createdById?: string | null;
};

/**
 * Enregistre un mouvement, après avoir vérifié ce qui doit l'être.
 *
 * Les refus portent sur ce qui rendrait le solde faux ou trompeur — une unité
 * inconvertible, un lot d'un autre article, une quantité nulle. Ils ne portent
 * **jamais** sur ce qui relève de la décision de l'exploitant : sortir plus que
 * le solde est autorisé, parce que c'est le plus souvent un achat non saisi, et
 * refuser produirait un registre incomplet — exactement ce qu'on cherche à
 * éviter. L'écran le signale, il ne l'empêche pas.
 */
export async function enregistrerMouvement(
  farmId: string,
  entree: EntreeMouvement,
): Promise<SuccesMouvement | RefusMouvement> {
  const article = await prisma.stockItem.findFirst({
    where: { id: entree.itemId, farmId },
    select: { id: true, unit: true, name: true },
  });
  if (!article) {
    return { ok: false, raison: 'Article de stock introuvable pour cette exploitation.' };
  }

  if (!Number.isFinite(entree.quantity) || entree.quantity === 0) {
    return { ok: false, raison: 'La quantité doit être un nombre différent de zéro.' };
  }

  if (!uniteConnue(entree.unit)) {
    return {
      ok: false,
      raison: `Unité « ${entree.unit} » inconnue de Parcelys.`,
    };
  }

  // On vérifie la convertibilité **à l'écriture** plutôt que de la découvrir au
  // calcul du solde : mieux vaut refuser une ligne que rendre un solde
  // partiel, qu'il faudra ensuite expliquer.
  if (convertirQuantite(1, entree.unit, article.unit) === null) {
    return { ok: false, raison: expliquerConversion(entree.unit, article.unit) };
  }

  if (entree.lotId) {
    const lot = await prisma.stockLot.findFirst({
      where: { id: entree.lotId, itemId: article.id },
      select: { id: true },
    });
    if (!lot) {
      return {
        ok: false,
        raison: `Ce lot n’appartient pas à l’article « ${article.name} ».`,
      };
    }
  }

  const signee = quantiteSignee(entree.kind, entree.quantity);

  const mouvement = await prisma.stockMovement.create({
    data: {
      itemId: article.id,
      lotId: entree.lotId ?? null,
      kind: entree.kind,
      occurredOn: entree.occurredOn,
      quantity: new Prisma.Decimal(signee.toFixed(3)),
      unit: entree.unit,
      phytoApplicationId: entree.phytoApplicationId ?? null,
      fertilizerApplicationId: entree.fertilizerApplicationId ?? null,
      operationId: entree.operationId ?? null,
      reason: entree.reason ?? null,
      createdById: entree.createdById ?? null,
    },
    select: { id: true },
  });

  return { ok: true, id: mouvement.id, quantiteSignee: signee };
}

// ---------------------------------------------------------------------------
// Ce que le stock ne voit pas
// ---------------------------------------------------------------------------

export type UtilisationNonRattachee = {
  kind: 'phyto' | 'fertilisation';
  applicationId: string;
  appliedOn: Date;
  parcelName: string;
  productLabel: string;
  quantite: number;
  unite: string;
  /** L'article de stock qui aurait dû être mouvementé. */
  itemId: string;
  itemName: string;
};

/**
 * Les utilisations d'un produit suivi en stock, sans mouvement rattaché.
 *
 * C'est la contrepartie du choix de ne pas décrémenter automatiquement. Sans
 * cette liste, un exploitant pourrait tenir un stock et traiter pendant six
 * mois sans qu'aucun des deux ne se parle — et croire son solde à jour.
 *
 * Ce n'est pas une anomalie réglementaire : c'est un écart de saisie, et il est
 * présenté comme tel, avec le moyen de le combler en un geste.
 */
export async function utilisationsNonRattachees(
  farmId: string,
  options: { depuis?: Date; limite?: number } = {},
): Promise<UtilisationNonRattachee[]> {
  const articles = await prisma.stockItem.findMany({
    where: {
      farmId,
      archivedAt: null,
      OR: [
        { phytoProductId: { not: null } },
        { fertilizerId: { not: null } },
        { organicInputId: { not: null } },
      ],
    },
    select: {
      id: true,
      name: true,
      unit: true,
      phytoProductId: true,
      fertilizerId: true,
      organicInputId: true,
    },
  });
  if (articles.length === 0) return [];

  const depuis = options.depuis ?? null;
  const limite = options.limite ?? 100;

  const parProduitPhyto = new Map(
    articles.filter((a) => a.phytoProductId).map((a) => [a.phytoProductId as string, a]),
  );
  const parEngrais = new Map(
    articles.filter((a) => a.fertilizerId).map((a) => [a.fertilizerId as string, a]),
  );
  const parOrganique = new Map(
    articles.filter((a) => a.organicInputId).map((a) => [a.organicInputId as string, a]),
  );

  const resultats: UtilisationNonRattachee[] = [];

  if (parProduitPhyto.size > 0) {
    const traitements = await prisma.phytosanitaryApplication.findMany({
      where: {
        productId: { in: [...parProduitPhyto.keys()] },
        parcel: { farmId },
        stockMovements: { none: {} },
        ...(depuis ? { appliedOn: { gte: depuis } } : {}),
      },
      select: {
        id: true,
        appliedOn: true,
        productId: true,
        productName: true,
        quantityUsed: true,
        quantityUnit: true,
        parcel: { select: { name: true } },
      },
      orderBy: { appliedOn: 'desc' },
      take: limite,
    });

    for (const t of traitements) {
      const article = t.productId ? parProduitPhyto.get(t.productId) : undefined;
      if (!article) continue;
      resultats.push({
        kind: 'phyto',
        applicationId: t.id,
        appliedOn: t.appliedOn,
        parcelName: t.parcel.name,
        productLabel: t.productName,
        quantite: Number(t.quantityUsed),
        unite: t.quantityUnit,
        itemId: article.id,
        itemName: article.name,
      });
    }
  }

  if (parEngrais.size > 0 || parOrganique.size > 0) {
    const apports = await prisma.fertilizerApplication.findMany({
      where: {
        parcel: { farmId },
        stockMovements: { none: {} },
        OR: [
          { fertilizerId: { in: [...parEngrais.keys()] } },
          { organicInputId: { in: [...parOrganique.keys()] } },
        ],
        ...(depuis ? { appliedOn: { gte: depuis } } : {}),
      },
      select: {
        id: true,
        appliedOn: true,
        fertilizerId: true,
        organicInputId: true,
        productLabel: true,
        totalQuantity: true,
        totalUnit: true,
        parcel: { select: { name: true } },
      },
      orderBy: { appliedOn: 'desc' },
      take: limite,
    });

    for (const a of apports) {
      const article =
        (a.fertilizerId ? parEngrais.get(a.fertilizerId) : undefined) ??
        (a.organicInputId ? parOrganique.get(a.organicInputId) : undefined);
      if (!article) continue;
      resultats.push({
        kind: 'fertilisation',
        applicationId: a.id,
        appliedOn: a.appliedOn,
        parcelName: a.parcel.name,
        productLabel: a.productLabel,
        quantite: Number(a.totalQuantity),
        unite: a.totalUnit,
        itemId: article.id,
        itemName: article.name,
      });
    }
  }

  return resultats
    .sort((a, b) => b.appliedOn.getTime() - a.appliedOn.getTime())
    .slice(0, limite);
}

/**
 * Rattache une utilisation existante à un lot, en créant la sortie
 * correspondante.
 *
 * Reprend la quantité déjà enregistrée sur le traitement : la ressaisir
 * ouvrirait la porte à un écart entre le registre phytosanitaire et le stock,
 * alors qu'ils décrivent le même geste.
 */
export async function rattacherUtilisation(
  farmId: string,
  params: {
    kind: 'phyto' | 'fertilisation';
    applicationId: string;
    itemId: string;
    lotId: string | null;
    createdById?: string | null;
  },
): Promise<SuccesMouvement | RefusMouvement> {
  if (params.kind === 'phyto') {
    const t = await prisma.phytosanitaryApplication.findFirst({
      where: { id: params.applicationId, parcel: { farmId } },
      select: { id: true, appliedOn: true, quantityUsed: true, quantityUnit: true },
    });
    if (!t) return { ok: false, raison: 'Traitement introuvable.' };

    return enregistrerMouvement(farmId, {
      itemId: params.itemId,
      lotId: params.lotId,
      kind: 'SORTIE',
      occurredOn: t.appliedOn,
      quantity: Number(t.quantityUsed),
      unit: t.quantityUnit,
      phytoApplicationId: t.id,
      reason: 'Rattachement d’un traitement enregistré',
      createdById: params.createdById ?? null,
    });
  }

  const a = await prisma.fertilizerApplication.findFirst({
    where: { id: params.applicationId, parcel: { farmId } },
    select: { id: true, appliedOn: true, totalQuantity: true, totalUnit: true },
  });
  if (!a) return { ok: false, raison: 'Apport introuvable.' };

  return enregistrerMouvement(farmId, {
    itemId: params.itemId,
    lotId: params.lotId,
    kind: 'SORTIE',
    occurredOn: a.appliedOn,
    quantity: Number(a.totalQuantity),
    unit: a.totalUnit,
    fertilizerApplicationId: a.id,
    reason: 'Rattachement d’un apport enregistré',
    createdById: params.createdById ?? null,
  });
}

/**
 * Traçabilité d'un lot : où est-il parti ?
 *
 * C'est la réponse directe à la question d'un contrôle. On remonte du lot vers
 * les parcelles, avec les dates.
 */
export async function tracabiliteLot(
  farmId: string,
  lotId: string,
): Promise<{
  lot: {
    id: string;
    lotNumber: string | null;
    supplier: string | null;
    purchasedOn: Date | null;
    expiresOn: Date | null;
    itemName: string;
    unit: string;
  };
  reste: SoldeStock;
  emplois: Array<{
    date: Date;
    quantite: number;
    unite: string;
    nature: StockMovementKind;
    parcelName: string | null;
    culture: string | null;
    motif: string | null;
  }>;
} | null> {
  const lot = await prisma.stockLot.findFirst({
    where: { id: lotId, item: { farmId } },
    include: {
      item: { select: { name: true, unit: true } },
      movements: {
        orderBy: { occurredOn: 'asc' },
        include: {
          phytoApplication: {
            select: { cropLabel: true, parcel: { select: { name: true } } },
          },
          fertilizerApplication: {
            select: { parcel: { select: { name: true } } },
          },
          operation: { select: { parcel: { select: { name: true } } } },
        },
      },
    },
  });
  if (!lot) return null;

  const reste = calculerSolde(
    lot.movements.map((m) => ({ quantity: Number(m.quantity), unit: m.unit })),
    lot.item.unit,
  );

  return {
    lot: {
      id: lot.id,
      lotNumber: lot.lotNumber,
      supplier: lot.supplier,
      purchasedOn: lot.purchasedOn,
      expiresOn: lot.expiresOn,
      itemName: lot.item.name,
      unit: lot.item.unit,
    },
    reste,
    emplois: lot.movements.map((m) => ({
      date: m.occurredOn,
      quantite: Number(m.quantity),
      unite: m.unit,
      nature: m.kind,
      parcelName:
        m.phytoApplication?.parcel.name ??
        m.fertilizerApplication?.parcel.name ??
        m.operation?.parcel.name ??
        null,
      culture: m.phytoApplication?.cropLabel ?? null,
      motif: m.reason,
    })),
  };
}

// ---------------------------------------------------------------------------
// Importer en stock ce que l'exploitation emploie déjà
// ---------------------------------------------------------------------------

/**
 * Un produit employé dans des saisies, mais qui n'est suivi par aucun article
 * de stock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE LISTE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `utilisationsNonRattachees()` répond à « vous suivez ce produit en stock, et
 * vous l'avez employé sans rien décompter ». Elle part donc des articles
 * existants, et ne voit rien de ce qui n'en a pas.
 *
 * Or c'est exactement le point de départ d'une exploitation : les traitements
 * et les apports sont saisis depuis des mois, chacun nommant son produit, et le
 * local phyto n'est suivi nulle part. Ouvrir l'écran des stocks demandait alors
 * de ressaisir à la main des produits que Parcelys connaît déjà — avec le
 * risque de les nommer autrement, donc de ne plus pouvoir les rapprocher.
 *
 * Cette liste est le pont : ce que vous employez, prêt à être suivi.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * L'UNITÉ N'EST JAMAIS DEVINÉE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * L'unité proposée est celle que **les saisies portent déjà** : `quantityUnit`
 * pour un traitement, `totalUnit` pour un apport. Ce sont des quantités
 * absolues — surtout pas `doseUnit`, qui est une dose **par hectare** : un
 * stock en « kg/ha » n'a aucun sens.
 *
 * Quand les saisies ne s'accordent pas — le même produit noté tantôt en litres,
 * tantôt en kilos —, `unite` vaut `null` et `unitesRencontrees` les énumère.
 * Choisir la plus fréquente reviendrait à trancher une question de densité que
 * Parcelys ne sait pas trancher (`src/lib/stock/units.ts`), et le solde serait
 * faux sans que personne ne l'ait décidé. C'est donc à l'exploitant de dire.
 */
export type ProduitImportable = {
  source: 'phyto' | 'engrais' | 'organique';
  /** Identifiant au référentiel : produit E-Phy, engrais, ou produit organique. */
  refId: string;
  label: string;
  /** Numéro d'AMM, pour un produit phytosanitaire au catalogue. */
  amm: string | null;
  categorie: StockCategory;
  /** L'unité des saisies, quand elles s'accordent toutes. Sinon `null`. */
  unite: string | null;
  /** Les unités rencontrées et leur nombre d'occurrences, la plus fréquente d'abord. */
  unitesRencontrees: Array<{ unite: string; occurrences: number }>;
  nombreUtilisations: number;
  premiereUtilisationLe: Date;
  derniereUtilisationLe: Date;
};

/** Regroupe les saisies d'un même produit et en tire une proposition d'article. */
type Accumulateur = {
  source: ProduitImportable['source'];
  refId: string;
  label: string;
  amm: string | null;
  categorie: StockCategory;
  unites: Map<string, { affichage: string; occurrences: number }>;
  nombre: number;
  premiere: Date;
  derniere: Date;
};

function retenir(
  acc: Map<string, Accumulateur>,
  cle: string,
  base: Omit<Accumulateur, 'unites' | 'nombre' | 'premiere' | 'derniere'>,
  saisie: { unite: string; le: Date },
): void {
  const existant = acc.get(cle);
  const courant =
    existant ??
    ({ ...base, unites: new Map(), nombre: 0, premiere: saisie.le, derniere: saisie.le });

  courant.nombre += 1;
  if (saisie.le < courant.premiere) courant.premiere = saisie.le;
  if (saisie.le > courant.derniere) courant.derniere = saisie.le;

  // Regroupées sur la forme normalisée : « L » et « l » sont la même unité, et
  // les compter séparément ferait croire à un désaccord qui n'existe pas.
  const normale = normaliserUnite(saisie.unite);
  const vue = courant.unites.get(normale);
  if (vue) vue.occurrences += 1;
  else courant.unites.set(normale, { affichage: saisie.unite.trim(), occurrences: 1 });

  acc.set(cle, courant);
}

function finaliser(acc: Map<string, Accumulateur>): ProduitImportable[] {
  return [...acc.values()]
    .map((a) => {
      const unites = [...a.unites.values()]
        .map((u) => ({ unite: u.affichage, occurrences: u.occurrences }))
        .sort((x, y) => y.occurrences - x.occurrences);

      return {
        source: a.source,
        refId: a.refId,
        label: a.label,
        amm: a.amm,
        categorie: a.categorie,
        // Une seule unité rencontrée : on la propose. Plusieurs : on ne tranche
        // pas (voir l'en-tête de `ProduitImportable`).
        unite: unites.length === 1 ? (unites[0]?.unite ?? null) : null,
        unitesRencontrees: unites,
        nombreUtilisations: a.nombre,
        premiereUtilisationLe: a.premiere,
        derniereUtilisationLe: a.derniere,
      };
    })
    .sort(
      (x, y) =>
        y.nombreUtilisations - x.nombreUtilisations ||
        x.label.localeCompare(y.label, 'fr'),
    );
}

/**
 * Les produits employés par l'exploitation et qu'aucun article de stock ne suit.
 *
 * Seuls les produits **rattachés au référentiel** sont proposés : un traitement
 * saisi en texte libre n'a pas d'identifiant, donc rien à rapprocher. Il reste
 * saisissable à la main, comme avant.
 */
export async function produitsImportables(
  farmId: string,
  options: { depuis?: Date } = {},
): Promise<ProduitImportable[]> {
  const depuis = options.depuis ?? null;

  const [dejaSuivis, traitements, apports] = await Promise.all([
    prisma.stockItem.findMany({
      where: { farmId },
      select: { phytoProductId: true, fertilizerId: true, organicInputId: true },
    }),
    prisma.phytosanitaryApplication.findMany({
      where: {
        parcel: { farmId },
        productId: { not: null },
        ...(depuis ? { appliedOn: { gte: depuis } } : {}),
      },
      select: {
        appliedOn: true,
        productId: true,
        productName: true,
        amm: true,
        quantityUnit: true,
        product: { select: { name: true, amm: true } },
      },
    }),
    prisma.fertilizerApplication.findMany({
      where: {
        parcel: { farmId },
        OR: [{ fertilizerId: { not: null } }, { organicInputId: { not: null } }],
        ...(depuis ? { appliedOn: { gte: depuis } } : {}),
      },
      select: {
        appliedOn: true,
        fertilizerId: true,
        organicInputId: true,
        productLabel: true,
        totalUnit: true,
        fertilizer: { select: { name: true } },
        organicInput: { select: { name: true } },
      },
    }),
  ]);

  /*
   * Les articles archivés comptent comme « déjà suivis ».
   *
   * La contrainte d'unicité porte sur `(farmId, category, name)` sans tenir
   * compte de `archivedAt` : reproposer un produit archivé mènerait droit à une
   * violation de contrainte au moment de la création. Mieux vaut ne pas le
   * proposer que proposer un bouton qui échoue.
   */
  const suivis = new Set<string>();
  for (const s of dejaSuivis) {
    if (s.phytoProductId) suivis.add(`phyto:${s.phytoProductId}`);
    if (s.fertilizerId) suivis.add(`engrais:${s.fertilizerId}`);
    if (s.organicInputId) suivis.add(`organique:${s.organicInputId}`);
  }

  const acc = new Map<string, Accumulateur>();

  for (const t of traitements) {
    if (!t.productId) continue;
    const cle = `phyto:${t.productId}`;
    if (suivis.has(cle)) continue;
    retenir(
      acc,
      cle,
      {
        source: 'phyto',
        refId: t.productId,
        // Le nom du catalogue prime sur celui recopié dans la saisie : c'est
        // lui qui fera foi dans le registre.
        label: t.product?.name ?? t.productName,
        amm: t.product?.amm ?? t.amm,
        categorie: 'PHYTOSANITAIRE',
      },
      { unite: t.quantityUnit, le: t.appliedOn },
    );
  }

  for (const a of apports) {
    const organique = a.organicInputId !== null;
    const refId = organique ? a.organicInputId : a.fertilizerId;
    if (!refId) continue;

    const cle = `${organique ? 'organique' : 'engrais'}:${refId}`;
    if (suivis.has(cle)) continue;

    retenir(
      acc,
      cle,
      {
        source: organique ? 'organique' : 'engrais',
        refId,
        label: (organique ? a.organicInput?.name : a.fertilizer?.name) ?? a.productLabel,
        amm: null,
        // Un produit organique — fumier, lisier — est un amendement, pas un
        // engrais minéral. Les ranger ensemble mélangerait deux logiques
        // réglementaires distinctes sur l'écran.
        categorie: organique ? 'AMENDEMENT' : 'ENGRAIS',
      },
      { unite: a.totalUnit, le: a.appliedOn },
    );
  }

  return finaliser(acc);
}
