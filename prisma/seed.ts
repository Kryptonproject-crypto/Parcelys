/**
 * Jeu de données de développement.
 *
 * Deux parties bien distinctes :
 *
 *  1. Le RÉFÉRENTIEL GLOBAL (cultures, engrais minéraux, produits organiques),
 *     rattaché à aucune exploitation (`farmId = null`) : ce sont des données
 *     agronomiques d'usage courant, utilisables en production.
 *
 *  2. Une EXPLOITATION DE DÉMONSTRATION entièrement fictive, marquée
 *     `isDemo = true` sur l'utilisateur, l'exploitation et chaque parcelle.
 *     Elle n'est créée qu'en dehors de la production, et l'interface affiche un
 *     bandeau d'avertissement dès qu'une exploitation porte ce marqueur.
 *
 * Aucune donnée phytosanitaire réglementaire n'est produite ici : les
 * traitements de démonstration référencent des produits en saisie libre, sans
 * numéro d'AMM inventé. Le catalogue E-Phy s'importe séparément
 * (`npm run ephy:sync`).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_CROPS,
  DEFAULT_FERTILIZERS,
  DEFAULT_ORGANIC_INPUTS,
  currentCampaignYear,
} from '../src/lib/constants/agronomy';

const prisma = new PrismaClient();

const DEMO_EMAIL = process.env.DEMO_SEED_EMAIL ?? 'demo@parcelys.local';
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? 'Demo1234!';

/** Polygones fictifs situés en Beauce, au nord-est d'Orléans. */
type ParcelSeed = {
  name: string;
  internalNumber: string;
  commune: string;
  lieuDit: string;
  parcelType: string;
  ring: Array<[number, number]>;
  crop: string;
  variety: string;
};

function rectangle(
  lng: number,
  lat: number,
  widthDeg: number,
  heightDeg: number,
): Array<[number, number]> {
  return [
    [lng, lat],
    [lng + widthDeg, lat],
    [lng + widthDeg, lat + heightDeg],
    [lng, lat + heightDeg],
    [lng, lat],
  ];
}

const DEMO_PARCELS: ParcelSeed[] = [
  {
    name: 'Le Grand Champ',
    internalNumber: 'P-001',
    commune: 'Artenay',
    lieuDit: 'Les Terres Blanches',
    parcelType: 'Terre labourable',
    ring: rectangle(1.878, 48.083, 0.0125, 0.0072),
    crop: 'BLE_TENDRE',
    variety: 'Rubisko',
  },
  {
    name: 'La Pièce du Moulin',
    internalNumber: 'P-002',
    commune: 'Artenay',
    lieuDit: 'Le Moulin',
    parcelType: 'Terre labourable',
    ring: rectangle(1.893, 48.083, 0.0095, 0.0058),
    crop: 'COLZA',
    variety: 'Architect',
  },
  {
    name: 'Les Sables',
    internalNumber: 'P-003',
    commune: 'Chevilly',
    lieuDit: 'Les Sables',
    parcelType: 'Terre labourable',
    ring: rectangle(1.878, 48.093, 0.0148, 0.0064),
    crop: 'MAIS_GRAIN',
    variety: 'DKC4590',
  },
  {
    name: 'Le Clos Bas',
    internalNumber: 'P-004',
    commune: 'Chevilly',
    lieuDit: 'Le Clos',
    parcelType: 'Prairie permanente',
    ring: rectangle(1.896, 48.093, 0.0072, 0.0043),
    crop: 'PRAIRIE_PERMANENTE',
    variety: '',
  },
  {
    name: 'Les Vingt Arpents',
    internalNumber: 'P-005',
    commune: 'Artenay',
    lieuDit: 'Les Arpents',
    parcelType: 'Terre labourable',
    ring: rectangle(1.862, 48.073, 0.0118, 0.0069),
    crop: 'ORGE_HIVER',
    variety: 'Étincel',
  },
  {
    name: 'La Croix Rouge',
    internalNumber: 'P-006',
    commune: 'Artenay',
    lieuDit: 'La Croix',
    parcelType: 'Terre labourable',
    ring: rectangle(1.878, 48.073, 0.0086, 0.0052),
    crop: 'TOURNESOL',
    variety: 'ES Genesis',
  },
];

async function seedReferential(): Promise<void> {
  console.info('→ Référentiel global (cultures, engrais, produits organiques)');

  // `@@unique([farmId, code])` ne s'applique pas aux lignes globales (farmId
  // NULL n'est jamais égal à lui-même en SQL) : l'unicité du référentiel global
  // est garantie par un index partiel (migration 20260907093000) et on cible ici
  // la ligne existante explicitement.
  for (const crop of DEFAULT_CROPS) {
    const existing = await prisma.crop.findFirst({
      where: { farmId: null, code: crop.code },
      select: { id: true },
    });
    const data = { name: crop.name, category: crop.category };
    if (existing) {
      await prisma.crop.update({ where: { id: existing.id }, data });
    } else {
      await prisma.crop.create({ data: { code: crop.code, ...data } });
    }
  }

  for (const fertilizer of DEFAULT_FERTILIZERS) {
    const existing = await prisma.fertilizer.findFirst({
      where: { farmId: null, name: fertilizer.name },
      select: { id: true },
    });
    const data = {
      name: fertilizer.name,
      category: fertilizer.category,
      nPercent: fertilizer.nPercent ? new Prisma.Decimal(fertilizer.nPercent) : null,
      pPercent: fertilizer.pPercent ? new Prisma.Decimal(fertilizer.pPercent) : null,
      kPercent: fertilizer.kPercent ? new Prisma.Decimal(fertilizer.kPercent) : null,
      defaultUnit: fertilizer.defaultUnit,
    };
    if (existing) {
      await prisma.fertilizer.update({ where: { id: existing.id }, data });
    } else {
      await prisma.fertilizer.create({ data });
    }
  }

  for (const input of DEFAULT_ORGANIC_INPUTS) {
    const existing = await prisma.organicInput.findFirst({
      where: { farmId: null, name: input.name },
      select: { id: true },
    });
    const data = {
      name: input.name,
      category: input.category,
      defaultUnit: input.defaultUnit,
    };
    if (existing) {
      await prisma.organicInput.update({ where: { id: existing.id }, data });
    } else {
      await prisma.organicInput.create({ data });
    }
  }

  const [crops, fertilizers, organics] = await Promise.all([
    prisma.crop.count({ where: { farmId: null } }),
    prisma.fertilizer.count({ where: { farmId: null } }),
    prisma.organicInput.count({ where: { farmId: null } }),
  ]);
  console.info(
    `  ${crops} cultures, ${fertilizers} engrais minéraux, ${organics} produits organiques`,
  );
}

async function seedDemoFarm(): Promise<void> {
  console.info('→ Exploitation de démonstration (données fictives)');

  const emailNormalized = DEMO_EMAIL.toLowerCase();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Recréation propre : on supprime la démo précédente pour un état déterministe.
  const previous = await prisma.user.findUnique({
    where: { emailNormalized },
    include: { memberships: true },
  });
  if (previous) {
    await prisma.farm.deleteMany({
      where: { id: { in: previous.memberships.map((m) => m.farmId) }, isDemo: true },
    });
    await prisma.user.delete({ where: { id: previous.id } });
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      emailNormalized,
      passwordHash,
      firstName: 'Camille',
      lastName: 'Durand',
      phone: '02 38 00 00 00',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      acceptedPrivacyAt: new Date(),
      isDemo: true,
      // Le compte de démonstration administre aussi l'instance : sans lui,
      // une base fraîchement semée n'aurait personne pour délivrer les codes
      // d'invitation, et l'inscription étant fermée, plus aucun compte ne
      // pourrait être créé.
      isPlatformAdmin: true,
    },
  });

  const farm = await prisma.farm.create({
    data: {
      name: 'EARL de la Beauce (démonstration)',
      siret: '00000000000000',
      addressLine: '12 route de la Plaine',
      postalCode: '45410',
      city: 'Artenay',
      department: 'Loiret',
      latitude: 48.0836,
      longitude: 1.8836,
      isDemo: true,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
  });

  const cropsByCode = new Map(
    (await prisma.crop.findMany({ where: { farmId: null } })).map((c) => [c.code, c]),
  );
  const fertilizersByName = new Map(
    (await prisma.fertilizer.findMany({ where: { farmId: null } })).map((f) => [f.name, f]),
  );
  const organicsByName = new Map(
    (await prisma.organicInput.findMany({ where: { farmId: null } })).map((o) => [o.name, o]),
  );

  const year = currentCampaignYear();
  let totalArea = 0;

  /** Date située `monthsAgo` mois avant aujourd'hui — les données de
   *  démonstration doivent être dans le passé pour alimenter les graphiques
   *  des douze derniers mois. */
  const monthsAgo = (months: number, day = 15): Date => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day));
  };

  for (const [index, seed] of DEMO_PARCELS.entries()) {
    const parcel = await prisma.parcel.create({
      data: {
        farmId: farm.id,
        name: seed.name,
        internalNumber: seed.internalNumber,
        commune: seed.commune,
        lieuDit: seed.lieuDit,
        parcelType: seed.parcelType,
        status: 'ACTIVE',
        isDemo: true,
        notes: 'Parcelle de démonstration — données fictives.',
      },
    });

    // Géométrie et superficie calculées par PostGIS, comme en usage réel.
    const geojson = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [[seed.ring]],
    });

    const metrics = await prisma.$queryRaw<
      Array<{ area_m2: number; perimeter_m: number; lat: number; lng: number }>
    >`
      WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom)
      SELECT ST_Area(geom::geography) AS area_m2,
             ST_Perimeter(geom::geography) AS perimeter_m,
             ST_Y(ST_PointOnSurface(geom)) AS lat,
             ST_X(ST_PointOnSurface(geom)) AS lng
      FROM g
    `;

    const row = metrics[0];
    if (!row) throw new Error(`Géométrie invalide pour ${seed.name}`);

    const areaHa = Number(row.area_m2) / 10_000;
    totalArea += areaHa;

    await prisma.$executeRaw`
      INSERT INTO parcel_geometries
        (id, parcel_id, geom, area_ha, perimeter_m, source, is_current, created_at)
      VALUES (
        gen_random_uuid()::text,
        ${parcel.id},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
        ${areaHa}::numeric,
        ${Number(row.perimeter_m)}::numeric,
        'seed',
        true,
        now()
      )
    `;

    await prisma.parcel.update({
      where: { id: parcel.id },
      data: {
        areaHa: new Prisma.Decimal(areaHa.toFixed(4)),
        centroidLat: Number(row.lat),
        centroidLng: Number(row.lng),
      },
    });

    const crop = cropsByCode.get(seed.crop);
    if (!crop) continue;

    const cropYear = await prisma.cropYear.create({
      data: {
        parcelId: parcel.id,
        cropId: crop.id,
        campaignYear: year,
        variety: seed.variety || null,
        sowingDate: monthsAgo(11, 12),
        expectedHarvestDate: monthsAgo(-2, 20),
      },
    });

    // Campagne précédente, pour illustrer l'historique pluriannuel.
    const previousCrop = cropsByCode.get(seed.crop === 'BLE_TENDRE' ? 'COLZA' : 'BLE_TENDRE');
    if (previousCrop && previousCrop.id !== crop.id) {
      await prisma.cropYear.create({
        data: {
          parcelId: parcel.id,
          cropId: previousCrop.id,
          campaignYear: year - 1,
          sowingDate: monthsAgo(23, 5),
          actualHarvestDate: monthsAgo(14, 18),
          yieldValue: new Prisma.Decimal(seed.crop === 'BLE_TENDRE' ? 38 : 76),
          yieldUnit: 'q/ha',
        },
      });
    }

    // Apports : un organique à l'automne, un minéral en sortie d'hiver.
    const fumier = organicsByName.get('Fumier bovin');
    if (fumier && seed.parcelType === 'Terre labourable') {
      const dose = 25;
      await prisma.fertilizerApplication.create({
        data: {
          parcelId: parcel.id,
          cropYearId: cropYear.id,
          appliedOn: monthsAgo(9 - (index % 3), 20),
          inputType: 'ORGANIC',
          organicInputId: fumier.id,
          productLabel: fumier.name,
          dose: new Prisma.Decimal(dose),
          doseUnit: 't/ha',
          treatedAreaHa: new Prisma.Decimal(areaHa.toFixed(4)),
          totalQuantity: new Prisma.Decimal((dose * areaHa).toFixed(3)),
          totalUnit: 't',
          // Teneurs issues d'une « analyse » fictive, propres à l'exploitation démo.
          nSupplied: new Prisma.Decimal(dose * 4.5),
          pSupplied: new Prisma.Decimal(dose * 2.5),
          kSupplied: new Prisma.Decimal(dose * 6),
          supplier: 'Élevage voisin (démonstration)',
          operator: 'Camille Durand',
          createdById: user.id,
        },
      });
    }

    const ammonitrate = fertilizersByName.get('Ammonitrate 33,5 %');
    if (ammonitrate) {
      const dose = 180;
      const nPercent = Number(ammonitrate.nPercent ?? 0);
      await prisma.fertilizerApplication.create({
        data: {
          parcelId: parcel.id,
          cropYearId: cropYear.id,
          appliedOn: monthsAgo(index % 2, 25),
          inputType: 'MINERAL',
          fertilizerId: ammonitrate.id,
          productLabel: ammonitrate.name,
          dose: new Prisma.Decimal(dose),
          doseUnit: 'kg/ha',
          treatedAreaHa: new Prisma.Decimal(areaHa.toFixed(4)),
          totalQuantity: new Prisma.Decimal((dose * areaHa).toFixed(3)),
          totalUnit: 'kg',
          nSupplied: new Prisma.Decimal(((dose * nPercent) / 100).toFixed(2)),
          supplier: 'Coopérative (démonstration)',
          batchNumber: 'LOT-DEMO-2024',
          operator: 'Camille Durand',
          createdById: user.id,
        },
      });
    }

    // Traitement phytosanitaire : saisie libre, sans AMM ni substance inventés.
    await prisma.phytosanitaryApplication.create({
      data: {
        parcelId: parcel.id,
        cropYearId: cropYear.id,
        appliedOn: monthsAgo(index % 3, 15),
        productName: 'Produit de démonstration (à remplacer par une recherche E-Phy)',
        amm: null,
        activeSubstances: null,
        targetLabel: 'Adventices',
        dose: new Prisma.Decimal(1.5),
        doseUnit: 'L/ha',
        sprayVolumeLHa: new Prisma.Decimal(150),
        treatedAreaHa: new Prisma.Decimal(areaHa.toFixed(4)),
        quantityUsed: new Prisma.Decimal((1.5 * areaHa).toFixed(3)),
        quantityUnit: 'L',
        weatherTempC: new Prisma.Decimal(12.5),
        weatherWindKmh: new Prisma.Decimal(8),
        weatherHumidity: new Prisma.Decimal(72),
        weatherSummary: 'Ciel couvert (relevé fictif de démonstration)',
        weatherSource: 'seed',
        operator: 'Camille Durand',
        notes:
          'Intervention fictive. Le nom du produit et le numéro d’AMM doivent provenir ' +
          'du catalogue officiel E-Phy après synchronisation.',
        createdById: user.id,
      },
    });

    // Travaux.
    await prisma.agriculturalOperation.createMany({
      data: [
        {
          parcelId: parcel.id,
          performedOn: monthsAgo(11 - (index % 3), 5),
          type: 'DECHAUMAGE' as const,
          equipment: 'Déchaumeur à disques 4 m',
          operator: 'Camille Durand',
          durationHours: new Prisma.Decimal(1.5),
          createdById: user.id,
        },
        {
          parcelId: parcel.id,
          performedOn: monthsAgo(1 + (index % 5), 12),
          type: 'SEMIS' as const,
          equipment: 'Semoir combiné 3 m',
          operator: 'Camille Durand',
          durationHours: new Prisma.Decimal(2.25),
          createdById: user.id,
        },
      ],
    });
  }

  await prisma.notification.create({
    data: {
      userId: user.id,
      farmId: farm.id,
      type: 'EPHY_SYNC',
      title: 'Référentiel E-Phy à synchroniser',
      body:
        'Aucun produit phytopharmaceutique n’est encore importé. Renseignez EPHY_DATA_URL ' +
        'puis lancez « npm run ephy:sync » pour activer la recherche de produits.',
      link: '/phytosanitaire',
    },
  });

  console.info(
    `  ${DEMO_PARCELS.length} parcelles, ${totalArea.toFixed(2)} ha au total (superficies calculées par PostGIS)`,
  );
  console.info(`  Compte de démonstration : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.info(
    '  Ce compte est administrateur de l’instance : /administration pour inviter d’autres utilisateurs.',
  );
}

async function main(): Promise<void> {
  await seedReferential();

  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO !== 'true') {
    console.info(
      '→ Exploitation de démonstration ignorée (NODE_ENV=production). ' +
        'Forcez-la avec SEED_DEMO=true si vous montez un environnement de démonstration.',
    );
    return;
  }

  await seedDemoFarm();
  console.info('\n✓ Seed terminé.');
}

main()
  .catch((error) => {
    console.error('✗ Seed échoué :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
