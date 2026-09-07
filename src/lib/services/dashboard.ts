import 'server-only';
import { prisma } from '@/lib/prisma';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { buildHistory, type HistoryEvent } from '@/lib/services/history';
import { fetchWeather } from '@/lib/weather';

export type DashboardStats = {
  parcelCount: number;
  totalAreaHa: number;
  cropCount: number;
  interventionCount: number;
  fertilizationCount: number;
  phytoCount: number;
  operationCount: number;
  currentCrops: Array<{ cropName: string; areaHa: number; parcelCount: number }>;
};

/** Nature du point à traiter ; la page choisit l'icône correspondante. */
export type TodoKind = 'crop' | 'phyto' | 'registry' | 'ephy' | 'weather';

export type TodoItem = {
  id: string;
  kind: TodoKind;
  label: string;
  link: string;
  severity: 'info' | 'warning';
};

export type DashboardData = {
  campaignYear: number;
  stats: DashboardStats;
  recentActivity: HistoryEvent[];
  todo: TodoItem[];
  lastFertilizations: Array<{
    id: string; parcelName: string; productLabel: string; appliedOn: string;
    dose: string; doseUnit: string;
  }>;
  lastPhyto: Array<{
    id: string; parcelName: string; productName: string; appliedOn: string;
    dose: string; doseUnit: string;
  }>;
};

/**
 * Agrégats du tableau de bord pour une exploitation.
 * `farmId` provient toujours d'un contrôle d'appartenance (requireFarmAccess).
 */
export async function getDashboardData(
  farmId: string,
  campaignYear = currentCampaignYear(),
): Promise<DashboardData> {
  const parcels = await prisma.parcel.findMany({
    where: { farmId, deletedAt: null },
    select: { id: true, name: true, areaHa: true, centroidLat: true, centroidLng: true },
  });
  const parcelIds = parcels.map((p) => p.id);

  const totalAreaHa = parcels.reduce((sum, p) => sum + Number(p.areaHa), 0);

  const yearStart = new Date(Date.UTC(campaignYear - 1, 7, 1));
  const yearEnd = new Date(Date.UTC(campaignYear, 6, 31, 23, 59, 59));

  const [cropYears, fertilizationCount, phytoCount, operationCount] = await Promise.all([
    parcelIds.length
      ? prisma.cropYear.findMany({
          where: { parcelId: { in: parcelIds }, campaignYear },
          include: {
            crop: { select: { name: true } },
            parcel: { select: { id: true, areaHa: true } },
          },
        })
      : Promise.resolve([]),
    parcelIds.length
      ? prisma.fertilizerApplication.count({
          where: { parcelId: { in: parcelIds }, appliedOn: { gte: yearStart, lte: yearEnd } },
        })
      : Promise.resolve(0),
    parcelIds.length
      ? prisma.phytosanitaryApplication.count({
          where: { parcelId: { in: parcelIds }, appliedOn: { gte: yearStart, lte: yearEnd } },
        })
      : Promise.resolve(0),
    parcelIds.length
      ? prisma.agriculturalOperation.count({
          where: { parcelId: { in: parcelIds }, performedOn: { gte: yearStart, lte: yearEnd } },
        })
      : Promise.resolve(0),
  ]);

  // Répartition des surfaces par culture de la campagne.
  const cropMap = new Map<string, { areaHa: number; parcelCount: number }>();
  for (const cy of cropYears) {
    const entry = cropMap.get(cy.crop.name) ?? { areaHa: 0, parcelCount: 0 };
    entry.areaHa += Number(cy.parcel.areaHa);
    entry.parcelCount += 1;
    cropMap.set(cy.crop.name, entry);
  }
  const currentCrops = [...cropMap.entries()]
    .map(([cropName, v]) => ({ cropName, ...v }))
    .sort((a, b) => b.areaHa - a.areaHa);

  const recentActivity = await buildHistory({ parcelIds, limit: 12 });

  const [lastFert, lastPhyto] = await Promise.all([
    parcelIds.length
      ? prisma.fertilizerApplication.findMany({
          where: { parcelId: { in: parcelIds } },
          include: { parcel: { select: { name: true } } },
          orderBy: { appliedOn: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),
    parcelIds.length
      ? prisma.phytosanitaryApplication.findMany({
          where: { parcelId: { in: parcelIds } },
          include: { parcel: { select: { name: true } } },
          orderBy: { appliedOn: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  const todo = await buildTodoList({
    farmId,
    parcels,
    parcelIds,
    campaignYear,
    cropYearParcelIds: new Set(cropYears.map((cy) => cy.parcel.id)),
  });

  return {
    campaignYear,
    stats: {
      parcelCount: parcels.length,
      totalAreaHa,
      cropCount: cropMap.size,
      interventionCount: fertilizationCount + phytoCount + operationCount,
      fertilizationCount,
      phytoCount,
      operationCount,
      currentCrops,
    },
    recentActivity,
    todo,
    lastFertilizations: lastFert.map((f) => ({
      id: f.id,
      parcelName: f.parcel.name,
      productLabel: f.productLabel,
      appliedOn: f.appliedOn.toISOString(),
      dose: f.dose.toString(),
      doseUnit: f.doseUnit,
    })),
    lastPhyto: lastPhyto.map((p) => ({
      id: p.id,
      parcelName: p.parcel.name,
      productName: p.productName,
      appliedOn: p.appliedOn.toISOString(),
      dose: p.dose.toString(),
      doseUnit: p.doseUnit,
    })),
  };
}

/** Zone « À faire » : anomalies détectées dans les données réelles. */
async function buildTodoList(params: {
  farmId: string;
  parcels: Array<{ id: string; centroidLat: number | null; centroidLng: number | null }>;
  parcelIds: string[];
  campaignYear: number;
  cropYearParcelIds: Set<string>;
}): Promise<TodoItem[]> {
  const todo: TodoItem[] = [];

  const withoutCrop = params.parcels.filter((p) => !params.cropYearParcelIds.has(p.id));
  if (withoutCrop.length > 0) {
    todo.push({
      id: 'no-crop',
      kind: 'crop',
      label: `${withoutCrop.length} parcelle${withoutCrop.length > 1 ? 's' : ''} sans culture renseignée pour la campagne ${params.campaignYear}`,
      link: '/parcelles?filtre=sans-culture',
      severity: 'warning',
    });
  }

  if (params.parcelIds.length > 0) {
    // Traitements dont la traçabilité réglementaire est incomplète.
    const incompletePhyto = await prisma.phytosanitaryApplication.count({
      where: {
        parcelId: { in: params.parcelIds },
        OR: [{ amm: null }, { targetLabel: null }, { operator: null }],
      },
    });
    if (incompletePhyto > 0) {
      todo.push({
        id: 'incomplete-phyto',
        kind: 'phyto',
        label: `${incompletePhyto} traitement${incompletePhyto > 1 ? 's' : ''} à compléter (AMM, cible ou opérateur manquant)`,
        link: '/phytosanitaire?filtre=incomplet',
        severity: 'warning',
      });
    }

    const missingWeather = await prisma.phytosanitaryApplication.count({
      where: { parcelId: { in: params.parcelIds }, weatherSummary: null },
    });
    if (missingWeather > 0) {
      todo.push({
        id: 'registry-weather',
        kind: 'registry',
        label: `Registre phytosanitaire incomplet : ${missingWeather} intervention${missingWeather > 1 ? 's' : ''} sans conditions météo`,
        link: '/registres',
        severity: 'info',
      });
    }
  }

  // Vérification de la fraîcheur du référentiel E-Phy.
  const [lastSync, productCount] = await Promise.all([
    prisma.ephySyncRun.findFirst({
      where: { status: 'SUCCESS' },
      orderBy: { finishedAt: 'desc' },
    }),
    prisma.phytosanitaryProduct.count(),
  ]);

  if (productCount === 0) {
    todo.push({
      id: 'ephy-missing',
      kind: 'ephy',
      label: 'Référentiel E-Phy non synchronisé : la recherche de produits est indisponible',
      link: '/phytosanitaire',
      severity: 'warning',
    });
  } else if (lastSync?.finishedAt) {
    const ageDays = (Date.now() - lastSync.finishedAt.getTime()) / 86_400_000;
    if (ageDays > 45) {
      todo.push({
        id: 'ephy-stale',
        kind: 'ephy',
        label: `Référentiel E-Phy synchronisé il y a ${Math.round(ageDays)} jours — une mise à jour est recommandée`,
        link: '/phytosanitaire',
        severity: 'info',
      });
    }
  }

  // Alerte météo réelle sur les prochaines 24 h.
  const reference =
    params.parcels.find((p) => p.centroidLat !== null && p.centroidLng !== null) ?? null;
  const farm = await prisma.farm.findUnique({
    where: { id: params.farmId },
    select: { latitude: true, longitude: true, weatherProvider: true },
  });

  const lat = farm?.latitude ?? reference?.centroidLat ?? null;
  const lng = farm?.longitude ?? reference?.centroidLng ?? null;

  if (lat !== null && lng !== null) {
    try {
      const weather = await fetchWeather(lat, lng, farm?.weatherProvider);
      const tomorrow = weather.daily[1];
      if (tomorrow && (tomorrow.precipitationMm ?? 0) >= 2) {
        todo.push({
          id: 'weather-rain',
          kind: 'weather',
          label: `Pluie prévue demain : ${tomorrow.precipitationMm?.toFixed(1)} mm`,
          link: '/meteo',
          severity: 'info',
        });
      }
    } catch {
      // Service météo indisponible : on n'affiche simplement pas d'alerte.
    }
  }

  return todo;
}
