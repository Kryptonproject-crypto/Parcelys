import 'server-only';
import { prisma } from '@/lib/prisma';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import {
  COVER_DESTRUCTION_METHODS,
  DOSE_UNITS,
  OPERATION_LABELS,
  PARCEL_TYPES,
  SOIL_COVER_KINDS,
  currentCampaignYear,
} from '@/lib/constants/agronomy';
import { calculerSolde } from '@/lib/stock/balance';
import { listRecommendations } from '@/lib/services/advisory';
import { getEphySourceInfo, getProductUsages } from '@/lib/ephy/search';
import type { FarmContext } from '@/lib/auth/rbac';

/**
 * Un produit du catalogue officiel, embarqué pour l'usage hors ligne.
 *
 * La forme reprend exactement celle que rend `/api/phytosanitary/products/:id/
 * usages` : l'application applique le même contrôle de dose sur les deux, sans
 * savoir d'où vient la fiche. Deux formes différentes finiraient par deux
 * contrôles différents.
 */
export type OfflineCatalogueEntry = {
  amm: string;
  productId: string;
  name: string;
  holder: string | null;
  formulation: string | null;
  productType: string | null;
  /** Substances actives, telles qu'E-Phy les nomme. */
  substances: string[];
  status: string | null;
  authorized: boolean;
  withdrawnAt: string | null;
  usages: Awaited<ReturnType<typeof getProductUsages>> extends infer R
    ? R extends { usages: infer U }
      ? U
      : never
    : never;
  crops: string[];
  drainedSoilRestrictions: Array<{
    category: string;
    label: string;
    severity: 'interdit' | 'a-verifier';
  }>;
};

/**
 * Instantané destiné au cache de l'application mobile.
 *
 * L'application de terrain doit fonctionner sans réseau : tout ce qu'elle
 * affiche ou propose dans une liste déroulante doit avoir été téléchargé avant.
 * D'où ce point d'entrée unique, appelé à la connexion puis rafraîchi
 * périodiquement, plutôt qu'une dizaine d'appels dispersés.
 *
 * Il ne contient aucune donnée réglementaire inventée : les produits proposés
 * hors ligne sont ceux que l'exploitation a réellement déjà utilisés, avec leur
 * AMM d'origine. La recherche dans le catalogue officiel E-Phy reste en ligne.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI LES USAGES OFFICIELS PARTENT AUSSI
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * L'instantané ne portait de ces produits que le nom, l'AMM et la dernière dose
 * saisie. Le contrôle de dose, lui, avait besoin d'un appel réseau au moment du
 * choix du produit. Sans réseau, l'exploitant pouvait donc saisir un traitement,
 * mais **sans le moindre contrôle réglementaire** : ni dose maximale, ni culture
 * autorisée, ni ZNT, ni délai avant récolte. C'est-à-dire exactement au moment
 * où il en a le plus besoin — au champ, le pulvérisateur en route.
 *
 * Embarquer le catalogue entier reste hors de question : 15 000 produits et
 * leurs usages ne tiennent pas dans un téléphone, et les télécharger sur une
 * liaison de campagne serait interminable. Mais les produits que l'exploitation
 * emploie sont **connus et peu nombreux** — quelques dizaines. Leurs usages
 * officiels sont donc joints, à l'identique de ce que rendrait la route en
 * ligne : ce n'est pas une liste devinée, c'est le catalogue officiel restreint
 * à ce dont cette exploitation se sert.
 *
 * Un produit jamais employé reste introuvable hors ligne, et l'application le
 * dit plutôt que de laisser croire à un catalogue complet.
 */

export type MobileSnapshot = Awaited<ReturnType<typeof buildMobileSnapshot>>;

export async function buildMobileSnapshot(ctx: FarmContext) {
  const year = currentCampaignYear();
  const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000);

  const [farm, geojson, crops, fertilizers, organicInputs, recentPhyto] =
    await Promise.all([
      prisma.farm.findUniqueOrThrow({
        where: { id: ctx.farmId },
        select: {
          id: true,
          name: true,
          city: true,
          department: true,
          latitude: true,
          longitude: true,
        },
      }),
      getFarmParcelsGeoJSON(ctx.farmId, year),
      prisma.crop.findMany({
        where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
        select: { id: true, code: true, name: true, category: true },
        orderBy: { name: 'asc' },
      }),
      prisma.fertilizer.findMany({
        where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
        select: { id: true, name: true, nPercent: true, pPercent: true, kPercent: true },
        orderBy: { name: 'asc' },
      }),
      prisma.organicInput.findMany({
        where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
        select: { id: true, name: true, nContent: true, pContent: true, kContent: true },
        orderBy: { name: 'asc' },
      }),
      // Produits phytosanitaires déjà employés sur l'exploitation : c'est le
      // seul référentiel honnête à embarquer hors ligne, puisqu'il provient de
      // saisies passées et non d'une liste devinée.
      prisma.phytosanitaryApplication.findMany({
        where: { parcel: { farmId: ctx.farmId }, appliedOn: { gte: twelveMonthsAgo } },
        select: {
          productName: true,
          amm: true,
          activeSubstances: true,
          doseUnit: true,
          dose: true,
        },
        orderBy: { appliedOn: 'desc' },
        take: 200,
      }),
    ]);

  // Un produit peut avoir été appliqué vingt fois : on ne garde que la saisie
  // la plus récente de chacun, qui sert de valeur par défaut au formulaire.
  const products = new Map<
    string,
    { productName: string; amm: string | null; activeSubstances: string | null; lastDose: number; doseUnit: string }
  >();
  for (const application of recentPhyto) {
    const key = application.amm ?? application.productName.toLowerCase();
    if (products.has(key)) continue;
    products.set(key, {
      productName: application.productName,
      amm: application.amm,
      activeSubstances: application.activeSubstances,
      lastDose: Number(application.dose),
      doseUnit: application.doseUnit,
    });
  }

  // Usages officiels des produits employés, pour que le contrôle de dose
  // fonctionne sans réseau.
  //
  // Une requête par produit, séquentielle et bornée : ces requêtes tirent
  // chacune jusqu'à 800 usages, et les lancer toutes de front sur le Raspberry
  // Pi qui fait tourner l'instance mettrait la base à genoux au moment précis
  // où quelqu'un se connecte.
  //
  // Le plafond de 60 produits n'est pas une limite technique mais un garde-fou :
  // une exploitation qui en emploierait davantage sur douze mois verrait
  // l'instantané enfler, et c'est la synchronisation au champ qui en pâtirait.
  // Les produits sont pris dans l'ordre d'utilisation la plus récente — les
  // plus susceptibles de resservir.
  const PLAFOND_CATALOGUE = 60;
  const aveclAmm = [...products.values()].filter(
    (p): p is typeof p & { amm: string } => Boolean(p.amm),
  );
  const catalogueHorsLigne: OfflineCatalogueEntry[] = [];
  let catalogueTronque = 0;

  for (const produit of aveclAmm.slice(0, PLAFOND_CATALOGUE)) {
    const detail = await getProductUsages(produit.amm);
    // Un produit absent du catalogue n'est pas une anomalie : le catalogue
    // E-Phy peut ne pas être importé sur cette instance, ou l'AMM avoir été
    // saisie à la main. On ne fabrique rien pour combler.
    if (!detail) continue;
    catalogueHorsLigne.push({
      amm: detail.product.amm,
      productId: detail.product.id,
      name: detail.product.name,
      holder: null,
      formulation: null,
      productType: null,
      substances: [],
      status: detail.product.status,
      authorized: detail.product.authorized,
      withdrawnAt: detail.product.withdrawnAt,
      usages: detail.usages,
      crops: detail.crops,
      drainedSoilRestrictions: detail.drainedSoilRestrictions,
    });
  }
  if (aveclAmm.length > PLAFOND_CATALOGUE) {
    catalogueTronque = aveclAmm.length - PLAFOND_CATALOGUE;
  }

  // Titulaire, formulation et substances : une seule requête pour l'ensemble.
  //
  // `getProductUsages` ne les rend pas — elle sert la fiche d'usages du site,
  // qui les affiche déjà ailleurs. Les demander produit par produit ferait
  // soixante requêtes de plus pour trois colonnes ; les ajouter au contrat de
  // cette fonction changerait une réponse d'API pour un besoin qui n'est pas
  // le sien.
  if (catalogueHorsLigne.length > 0) {
    const complements = await prisma.phytosanitaryProduct.findMany({
      where: { amm: { in: catalogueHorsLigne.map((e) => e.amm) } },
      select: {
        amm: true,
        holder: true,
        formulation: true,
        productType: true,
        substances: { select: { substance: { select: { name: true } } } },
      },
    });
    const parAmm = new Map(complements.map((c) => [c.amm, c]));
    for (const entree of catalogueHorsLigne) {
      const complement = parAmm.get(entree.amm);
      if (!complement) continue;
      entree.holder = complement.holder;
      entree.formulation = complement.formulation;
      entree.productType = complement.productType;
      entree.substances = complement.substances.map((s) => s.substance.name);
    }
  }

  // La provenance voyage avec les données : au champ comme au bureau, un
  // contrôle de dose doit pouvoir dire de quelle édition du catalogue il sort.
  const sourceEphy = await getEphySourceInfo();

  // Préconisations utiles au champ : celles en attente de décision et celles
  // acceptées mais pas encore réalisées, des deux côtés. Un expert emporte
  // aussi ses brouillons, qu'il est le seul à voir.
  const recommendations = await listRecommendations({
    farmId: ctx.farmId,
    ...(ctx.accessKind === 'advisory'
      ? { authorId: ctx.user.id }
      : { visibleToFarmOnly: true }),
    status:
      ctx.accessKind === 'advisory'
        ? ['DRAFT', 'PROPOSED', 'ACCEPTED']
        : ['PROPOSED', 'ACCEPTED'],
  });

  const lotsPhyto = await lotsPhytoDisponibles(ctx.farmId);

  return {
    syncedAt: new Date().toISOString(),
    campaignYear: year,
    farm: {
      id: farm.id,
      name: farm.name,
      city: farm.city,
      department: farm.department,
      latitude: farm.latitude,
      longitude: farm.longitude,
    },
    /** Exploitant ou expert : décide de ce que l'application propose. */
    accountType: ctx.user.accountType,
    /** Portefeuille : plusieurs exploitations pour un expert, une pour l'exploitant. */
    farms: ctx.memberships.map((membership) => ({
      id: membership.farmId,
      name: membership.farmName,
      role: membership.role,
      advisory: membership.kind === 'advisory',
    })),
    role: ctx.role,
    /** `true` quand l'accès vient d'une mission de conseil : lecture seule. */
    advisory: ctx.accessKind === 'advisory',
    recommendations,
    parcels: geojson.features.map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      internalNumber: feature.properties.internalNumber,
      commune: feature.properties.commune,
      areaHa: feature.properties.areaHa,
      status: feature.properties.status,
      cropName: feature.properties.crop,
      drainedSoil: feature.properties.drainedSoil,
      geometry: feature.geometry,
    })),
    referential: {
      crops: crops.map((crop) => ({
        id: crop.id,
        code: crop.code,
        name: crop.name,
        category: crop.category,
      })),
      fertilizers: fertilizers.map((fertilizer) => ({
        id: fertilizer.id,
        name: fertilizer.name,
        n: fertilizer.nPercent === null ? null : Number(fertilizer.nPercent),
        p: fertilizer.pPercent === null ? null : Number(fertilizer.pPercent),
        k: fertilizer.kPercent === null ? null : Number(fertilizer.kPercent),
      })),
      organicInputs: organicInputs.map((input) => ({
        id: input.id,
        name: input.name,
        n: input.nContent === null ? null : Number(input.nContent),
        p: input.pContent === null ? null : Number(input.pContent),
        k: input.kContent === null ? null : Number(input.kContent),
      })),
      recentPhytoProducts: [...products.values()],
      /**
       * Usages officiels des produits employés : dose retenue, culture, DAR,
       * ZNT, nombre maximal d'applications, conditions d'emploi.
       *
       * C'est ce qui permet au contrôle de dose de fonctionner sans réseau.
       * La liste ne prétend jamais être le catalogue : elle porte sa
       * provenance et le nombre de produits qu'elle a dû laisser de côté.
       */
      phytoCatalogue: catalogueHorsLigne,
      phytoCatalogueSource: {
        label: sourceEphy.label,
        lastSyncAt: sourceEphy.lastSyncAt,
        configured: sourceEphy.configured,
        /** Produits employés mais non embarqués, faute de place. */
        omitted: catalogueTronque,
      },
      doseUnits: [...DOSE_UNITS],
      parcelTypes: [...PARCEL_TYPES],
      operationTypes: Object.entries(OPERATION_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      soilCoverKinds: SOIL_COVER_KINDS,
      coverDestructionMethods: COVER_DESTRUCTION_METHODS,
      /**
       * Lots phytosanitaires encore en stock.
       *
       * C'est au champ, le bidon en main, qu'on connaît le numéro de lot — pas
       * au bureau une semaine plus tard. Sans cette liste dans l'instantané, la
       * traçabilité « quel lot sur quelle parcelle » resterait un vœu : c'est
       * exactement la question qu'un contrôle pose.
       *
       * Seuls les lots d'articles rattachés à un produit du catalogue sont
       * envoyés, et seulement s'il en reste : proposer un lot vide ferait
       * saisir une sortie impossible.
       */
      phytoLots: lotsPhyto,
    },
  };
}

/**
 * Changements survenus depuis la dernière synchronisation.
 *
 * Le téléphone n'a pas besoin de retélécharger tout l'instantané à chaque
 * relève : seules les parcelles modifiées, et la liste de celles qui ont
 * disparu, l'intéressent.
 */
export async function getChangesSince(ctx: FarmContext, since: Date) {
  const year = currentCampaignYear();

  const [changed, deleted] = await Promise.all([
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: null, updatedAt: { gt: since } },
      select: {
        id: true,
        name: true,
        internalNumber: true,
        commune: true,
        areaHa: true,
        status: true,
        centroidLat: true,
        centroidLng: true,
        drainedSoil: true,
        updatedAt: true,
        cropYears: {
          where: { campaignYear: year },
          select: { crop: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    }),
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: { gt: since } },
      select: { id: true },
      take: 500,
    }),
  ]);

  return {
    syncedAt: new Date().toISOString(),
    since: since.toISOString(),
    parcels: changed.map((parcel) => ({
      id: parcel.id,
      name: parcel.name,
      internalNumber: parcel.internalNumber,
      commune: parcel.commune,
      areaHa: Number(parcel.areaHa),
      status: parcel.status,
      centroid:
        parcel.centroidLat !== null && parcel.centroidLng !== null
          ? { lat: parcel.centroidLat, lng: parcel.centroidLng }
          : null,
      cropName: parcel.cropYears[0]?.crop.name ?? null,
      drainedSoil: parcel.drainedSoil,
      updatedAt: parcel.updatedAt.toISOString(),
    })),
    deletedParcelIds: deleted.map((parcel) => parcel.id),
  };
}

/**
 * Lots phytosanitaires dont il reste quelque chose.
 *
 * Le solde est recalculé ici comme partout ailleurs : la somme des mouvements,
 * jamais un compteur. Un lot vide est écarté — le proposer ferait saisir une
 * sortie impossible, et le refus arriverait au retour du réseau, quand la
 * parcelle est loin.
 */
async function lotsPhytoDisponibles(farmId: string): Promise<
  Array<{
    id: string;
    itemId: string;
    itemName: string;
    lotNumber: string | null;
    amm: string | null;
    unit: string;
    reste: number;
    expiresOn: string | null;
  }>
> {
  const articles = await prisma.stockItem.findMany({
    where: { farmId, archivedAt: null, category: 'PHYTOSANITAIRE' },
    select: {
      id: true,
      name: true,
      unit: true,
      phytoProduct: { select: { amm: true } },
      lots: {
        where: { closedAt: null },
        select: { id: true, lotNumber: true, expiresOn: true },
      },
      movements: { select: { quantity: true, unit: true, lotId: true } },
    },
  });

  const lots: Awaited<ReturnType<typeof lotsPhytoDisponibles>> = [];

  for (const article of articles) {
    for (const lot of article.lots) {
      const solde = calculerSolde(
        article.movements
          .filter((m) => m.lotId === lot.id)
          .map((m) => ({ quantity: Number(m.quantity), unit: m.unit })),
        article.unit,
      );
      if (solde.quantite <= 0) continue;

      lots.push({
        id: lot.id,
        itemId: article.id,
        itemName: article.name,
        lotNumber: lot.lotNumber,
        amm: article.phytoProduct?.amm ?? null,
        unit: article.unit,
        reste: solde.quantite,
        expiresOn: lot.expiresOn ? lot.expiresOn.toISOString() : null,
      });
    }
  }

  return lots.sort((a, b) => a.itemName.localeCompare(b.itemName));
}
