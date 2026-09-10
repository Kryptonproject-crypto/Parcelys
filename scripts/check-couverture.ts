/**
 * Vérification de la couverture des sols, de l'irrigation et des rotations,
 * contre une vraie base.
 *
 * Ce que ce script protège avant tout : **qu'aucune règle régionale ne soit
 * inventée**. Sans programme d'actions importé, Parcelys doit répondre « non
 * vérifiable » — jamais « conforme ». Un test unitaire ne peut pas le prouver :
 * il faut une base sans référentiel, une parcelle en zone vulnérable, et lire
 * ce que le rapport de conformité dit vraiment.
 *
 *     npm run check:couverture
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import { constatsCouverture, couvertureExploitation } from '@/lib/regulatory/soil-cover';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { irrigationRealisee } from '@/lib/regulatory/nitrogen';
import { successionsExploitation } from '@/lib/services/rotation';

function attendu(condition: boolean, quoi: string) {
  console.info(`${condition ? '✓' : '✗'} ${quoi}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  // Une exploitation qui a des parcelles, pas simplement la première venue.
  //
  // Les contrôles au navigateur créent des exploitations d'essai sans parcelle
  // (dispatch d'expert, suppression). Prendre « la première » tombait sur
  // l'une d'elles dès le second passage, et le script s'arrêtait sur « Aucune
  // parcelle » — un message vrai, mais qui accusait la base plutôt que le
  // choix.
  const farm = await prisma.farm.findFirst({
    where: { deletedAt: null, parcels: { some: { deletedAt: null } } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!farm) { console.error('Aucune exploitation.'); process.exit(1); }
  const parcel = await prisma.parcel.findFirst({
    where: { farmId: farm.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!parcel) { console.error('Aucune parcelle.'); process.exit(1); }
  const annee = new Date().getFullYear();
  console.info(`Exploitation : ${farm.name} · parcelle ${parcel.name} · campagne ${annee}`);

  await prisma.soilCover.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });
  await prisma.agriculturalOperation.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });

  // --- Couvert cohérent ----------------------------------------------------
  const couvert = await prisma.soilCover.create({
    data: {
      parcelId: parcel.id, kind: 'CIPAN', species: 'Moutarde blanche, phacélie',
      sownOn: new Date(`${annee - 1}-08-25`),
      emergedOn: new Date(`${annee - 1}-09-02`),
      destroyedOn: new Date(`${annee - 1}-11-20`),
      destructionMethod: 'MECANIQUE', notes: 'VERIF',
    },
  });

  const etat = await couvertureExploitation({ farmId: farm.id, campaignYear: annee });
  const p = etat.find((x) => x.parcelId === parcel.id)!;
  const vu = p.couverts.find((c) => c.id === couvert.id);
  attendu(Boolean(vu), 'le couvert est rattaché à la bonne campagne');
  attendu(vu?.dureeJours === 87, `durée semis→destruction calculée (${vu?.dureeJours} jours)`);
  attendu(vu?.incoherences.length === 0, 'aucune incohérence sur des dates correctes');

  // --- Ce qui compte le plus : ne rien inventer ---------------------------
  attendu(
    p.referentiel.disponible === false,
    'le programme d’actions régional n’est pas importé sur cette base',
  );
  attendu(
    (p.referentiel.manque ?? '').includes('période de couverture'),
    'Parcelys dit précisément ce qu’il ne peut pas vérifier',
  );

  const constats = await constatsCouverture({ farmId: farm.id, campaignYear: annee });
  const inventees = constats.filter(
    (c) =>
      /obligatoire (avant|après|du)|doit être (semé|détruit)|conforme/i.test(c.detail) &&
      c.level !== 'INDETERMINE',
  );
  attendu(inventees.length === 0, 'aucun constat n’affirme une règle de période');

  const rapport = await buildComplianceReport({ farmId: farm.id, campaignYear: annee });
  const couvertureDansRapport = rapport.findings.filter((f) => f.domain === 'COUVERTURE');
  attendu(
    couvertureDansRapport.length > 0,
    'la couverture apparaît dans le rapport de conformité',
  );
  attendu(
    couvertureDansRapport.every((f) => f.level !== 'OK'),
    'aucun constat de couverture ne se prononce favorablement sans référentiel',
  );
  attendu(
    p.zoneVulnerable === 'indetermine',
    `sans zonage importé, la zone vulnérable est indéterminée — pas « hors zone » (obtenu : ${p.zoneVulnerable})`,
  );
  attendu(
    !/conforme/i.test(rapport.summary) || /Aucune anomalie détectée/i.test(rapport.summary),
    `la synthèse ne prononce pas de conformité : « ${rapport.summary} »`,
  );

  // --- Incohérence de dates ------------------------------------------------
  const faux = await prisma.soilCover.create({
    data: {
      parcelId: parcel.id, kind: 'CIPAN',
      sownOn: new Date(`${annee - 1}-09-10`),
      destroyedOn: new Date(`${annee - 1}-08-30`),
      notes: 'VERIF',
    },
  });
  const constats2 = await constatsCouverture({ farmId: farm.id, campaignYear: annee });
  const anomalie = constats2.find((c) => c.code === 'couverture.dates-incoherentes');
  attendu(anomalie?.level === 'ANOMALIE', 'une destruction avant le semis est une anomalie');
  await prisma.soilCover.delete({ where: { id: faux.id } });

  // --- Irrigation ----------------------------------------------------------
  const sansAnalyse = await prisma.agriculturalOperation.create({
    data: {
      // Juin de l'année de récolte : la campagne court d'août à juillet, donc
      // une irrigation de juin 2026 appartient bien à la campagne 2026.
      parcelId: parcel.id, performedOn: new Date(`${annee}-06-15`),
      type: 'IRRIGATION', irrigationMm: 30, notes: 'VERIF',
    },
  });
  let irr = await irrigationRealisee({ parcelId: parcel.id, campaignYear: annee });
  attendu(irr.events === 1, 'l’irrigation est comptée comme un événement');
  attendu(irr.volumeM3Ha === 300, `30 mm = 300 m³/ha (obtenu ${irr.volumeM3Ha})`);
  attendu(
    irr.nKgHa === null && (irr.missing ?? '').includes('analyse'),
    'sans analyse d’eau, l’azote n’est pas chiffré — et la raison est dite',
  );

  await prisma.agriculturalOperation.update({
    where: { id: sansAnalyse.id },
    data: { waterNitrateMgL: 40 },
  });
  irr = await irrigationRealisee({ parcelId: parcel.id, campaignYear: annee });
  // 40 mg/L × 300 m³/ha = 12 000 g de nitrate = 12 kg NO3 → 12 × 14/62 = 2,71 kg N
  attendu(
    irr.nKgHa !== null && Math.abs(irr.nKgHa - 2.71) < 0.02,
    `azote de l’eau : 40 mg/L × 300 m³/ha = ${irr.nKgHa} kg N/ha (attendu ≈ 2,71)`,
  );

  // --- Rotations -----------------------------------------------------------
  const successions = await successionsExploitation({ farmId: farm.id, jusqua: annee });
  const rotation = successions.find((s) => s.parcelId === parcel.id);
  attendu(Boolean(rotation), 'la succession de la parcelle est lue');
  attendu(
    rotation !== undefined && rotation.campagnes.every((c) => typeof c.cropName === 'string'),
    'chaque campagne porte le nom de sa culture',
  );

  // Nettoyage
  await prisma.soilCover.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });
  await prisma.agriculturalOperation.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });

  console.info(process.exitCode ? '\n✗ des vérifications ont échoué' : '\n✓ tout est vérifié sur une vraie base');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
