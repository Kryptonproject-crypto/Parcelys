import 'server-only';
import { prisma } from '@/lib/prisma';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import {
  DOSE_UNITS,
  OPERATION_LABELS,
  PARCEL_TYPES,
  currentCampaignYear,
} from '@/lib/constants/agronomy';
import type { FarmContext } from '@/lib/auth/rbac';

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
    role: ctx.role,
    parcels: geojson.features.map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      internalNumber: feature.properties.internalNumber,
      commune: feature.properties.commune,
      areaHa: feature.properties.areaHa,
      status: feature.properties.status,
      cropName: feature.properties.crop,
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
      doseUnits: [...DOSE_UNITS],
      parcelTypes: [...PARCEL_TYPES],
      operationTypes: Object.entries(OPERATION_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
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
      updatedAt: parcel.updatedAt.toISOString(),
    })),
    deletedParcelIds: deleted.map((parcel) => parcel.id),
  };
}
