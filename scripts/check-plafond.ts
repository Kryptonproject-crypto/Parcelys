/**
 * Vérification du plafond d'azote organique et du cahier d'épandage.
 *
 * Ce que ce script protège : **que 170 ne sorte jamais de nulle part**. Sans
 * règle importée, Parcelys doit afficher la quantité épandue et dire qu'il n'a
 * rien à quoi la comparer. Avec une règle saisie, il doit l'opposer *avec sa
 * source*. Un test unitaire ne peut pas le prouver : il faut une vraie base,
 * sans règle puis avec.
 *
 *     npm run check:plafond
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import { cahierEpandage, plafondAzoteOrganique } from '@/lib/regulatory/organic-nitrogen';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { beginImport, finishImport } from '@/lib/regulatory/referentials';

function attendu(condition: boolean, quoi: string) {
  console.info(`${condition ? '✓' : '✗'} ${quoi}`);
  if (!condition) process.exitCode = 1;
}

async function main() {
  const farm = await prisma.farm.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });
  if (!farm) { console.error('Aucune exploitation. Lancez le seed.'); process.exit(1); }
  const parcel = await prisma.parcel.findFirst({
    where: { farmId: farm.id, deletedAt: null },
    select: { id: true, name: true, areaHa: true },
  });
  if (!parcel) { console.error('Aucune parcelle.'); process.exit(1); }
  const annee = new Date().getFullYear();
  const surface = Number(parcel.areaHa);
  console.info(`Exploitation : ${farm.name} · parcelle ${parcel.name} (${surface} ha) · campagne ${annee}`);

  await prisma.fertilizerApplication.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });
  await prisma.regulatoryRule.deleteMany({ where: { code: 'plafond-azote-organique', label: 'VERIF' } });

  // Un apport organique à 200 kg N/ha.
  //
  // `nSupplied` est une **dose à l'hectare**, pas un total : c'est ce que
  // `computeNutrients` produit, et sa documentation le dit. Écrire ici un total
  // reproduirait exactement le défaut que ce script a servi à trouver.
  await prisma.fertilizerApplication.create({
    data: {
      parcelId: parcel.id, appliedOn: new Date(`${annee - 1}-09-20`),
      inputType: 'ORGANIC', productLabel: 'VERIF Fumier bovin',
      dose: 30, doseUnit: 't/ha', treatedAreaHa: surface,
      totalQuantity: 30 * surface, totalUnit: 't',
      nSupplied: 200, operator: 'Kevin', notes: 'VERIF',
    },
  });

  // --- Sans règle : la quantité, jamais un verdict -------------------------
  let p = await plafondAzoteOrganique({ farmId: farm.id, campaignYear: annee });
  attendu(p.apports >= 1, 'l’apport organique est pris en compte');

  // Contre-calcul indépendant du service : l'exploitation de démonstration
  // porte déjà des apports organiques, et le ratio est celui de l'ensemble.
  // On refait la division à la main plutôt que de supposer un chiffre.
  const lignes = await prisma.fertilizerApplication.findMany({
    where: {
      parcel: { farmId: farm.id, deletedAt: null },
      inputType: 'ORGANIC',
      appliedOn: {
        gte: new Date(Date.UTC(annee - 1, 7, 1)),
        lte: new Date(Date.UTC(annee, 6, 31, 23, 59, 59)),
      },
    },
    select: { nSupplied: true, parcelId: true, treatedAreaHa: true },
  });
  // Kilos réellement épandus = dose (kg N/ha) × surface traitée.
  const azoteAttendu = lignes.reduce(
    (t, l) => t + Number(l.nSupplied ?? 0) * Number(l.treatedAreaHa),
    0,
  );
  const parcellesAttendues = await prisma.parcel.findMany({
    where: { id: { in: [...new Set(lignes.map((l) => l.parcelId))] } },
    select: { areaHa: true },
  });
  const surfaceAttendue = parcellesAttendues.reduce((t, x) => t + Number(x.areaHa), 0);
  const ratioAttendu = azoteAttendu / surfaceAttendue;

  attendu(
    Math.abs((p.parHectare ?? 0) - ratioAttendu) < 0.02,
    `ratio recalculé à la main : ${p.parHectare} ≈ ${ratioAttendu.toFixed(2)} kg N/ha`,
  );
  attendu(
    Math.abs(p.azoteOrganiqueKg - azoteAttendu) < 1,
    `azote total : ${p.azoteOrganiqueKg} kg — dose × surface, jamais la dose seule`,
  );
  attendu(
    Math.abs(p.surfaceHa - surfaceAttendue) < 0.01,
    'la surface compte chaque parcelle une fois, même avec plusieurs apports',
  );
  attendu(p.plafond === null, 'aucun plafond n’est inventé tant qu’aucune règle n’est saisie');
  attendu(p.verdict === 'INDETERMINE', `verdict sans règle : ${p.verdict} (attendu INDETERMINE)`);
  attendu(
    (p.manque ?? '').includes('170') && (p.manque ?? '').includes('n’est pas écrit dans le'),
    'le message explique pourquoi 170 n’est pas codé en dur',
  );

  let rapport = await buildComplianceReport({ farmId: farm.id, campaignYear: annee });
  const sansRegle = rapport.findings.filter((f) => f.code.startsWith('nitrates.plafond'));
  attendu(
    sansRegle.length > 0 && sansRegle.every((f) => f.level !== 'ANOMALIE' && f.level !== 'OK'),
    'sans règle, le rapport ne conclut ni au dépassement ni au respect',
  );

  // --- Avec une règle saisie, source obligatoire ---------------------------
  const { referentiel, journal } = await beginImport({
    code: 'programme-actions-nitrates',
    domain: 'NITRATES',
    name: 'Programme d’actions nitrates',
    territory: 'FR',
    version: 'VERIF-1',
    sourceLabel: 'Arrêté de vérification — fixture',
    appliesFrom: new Date(`${annee - 3}-01-01`),
  });
  await prisma.regulatoryRule.create({
    data: {
      referentialId: referentiel.id, domain: 'NITRATES',
      code: 'plafond-azote-organique', label: 'VERIF', territory: 'FR',
      // Seuil placé sous le ratio réel : on éprouve la branche « dépassement »
      // sans dépendre du contenu du jeu de démonstration.
      value: { kgHa: Number((ratioAttendu / 2).toFixed(2)) }, unit: 'kg N/ha',
      appliesFrom: new Date(`${annee - 3}-01-01`),
      sourceRef: 'Arrêté du 19/12/2011, art. 2 (fixture)',
    },
  });
  await finishImport({ referentialId: referentiel.id, importId: journal.id, recordCount: 1, warnings: [] });

  p = await plafondAzoteOrganique({ farmId: farm.id, campaignYear: annee });
  attendu(
    p.plafond?.valeurKgHa !== undefined && p.plafond.valeurKgHa > 0,
    `plafond lu depuis la règle : ${p.plafond?.valeurKgHa} (jamais une constante du code)`,
  );
  attendu(
    (p.plafond?.sourceRef ?? '').includes('Arrêté'),
    'le plafond porte sa référence de texte',
  );
  attendu(
    p.verdict === 'ANOMALIE',
    `${p.parHectare} > ${p.plafond?.valeurKgHa} → ${p.verdict} (attendu ANOMALIE)`,
  );

  rapport = await buildComplianceReport({ farmId: farm.id, campaignYear: annee });
  const anomalie = rapport.findings.find((f) => f.code === 'nitrates.plafond-organique-depasse');
  attendu(Boolean(anomalie), 'le dépassement figure dans le rapport de conformité');
  attendu(
    anomalie?.sourceLabel !== undefined && anomalie?.referentialVersion !== undefined,
    'l’anomalie nomme sa source et sa version — jamais un chiffre seul',
  );

  // --- L'autre sens : sous le plafond ------------------------------------
  await prisma.regulatoryRule.updateMany({
    where: { label: 'VERIF' },
    data: { value: { kgHa: Number((ratioAttendu * 2).toFixed(2)) } },
  });
  p = await plafondAzoteOrganique({ farmId: farm.id, campaignYear: annee });
  attendu(
    p.verdict === 'OK',
    `${p.parHectare} < ${p.plafond?.valeurKgHa} → ${p.verdict} (attendu OK)`,
  );

  // On repasse en dépassement pour la suite.
  await prisma.regulatoryRule.updateMany({
    where: { label: 'VERIF' },
    data: { value: { kgHa: Number((ratioAttendu / 2).toFixed(2)) } },
  });

  // --- Un apport sans teneur en azote bloque la conclusion -----------------
  await prisma.fertilizerApplication.create({
    data: {
      parcelId: parcel.id, appliedOn: new Date(`${annee - 1}-10-05`),
      inputType: 'ORGANIC', productLabel: 'VERIF Lisier sans analyse',
      dose: 20, doseUnit: 'm3/ha', treatedAreaHa: surface,
      totalQuantity: 20 * surface, totalUnit: 'm3',
      nSupplied: null, notes: 'VERIF',
    },
  });
  p = await plafondAzoteOrganique({ farmId: farm.id, campaignYear: annee });
  attendu(
    p.verdict === 'VERIFICATION',
    `un apport sans teneur empêche de conclure : ${p.verdict} (attendu VERIFICATION)`,
  );
  attendu(
    (p.manque ?? '').includes('incomplet'),
    'et le total est annoncé comme incomplet, pas opposé au plafond',
  );

  // --- Cahier d'épandage ---------------------------------------------------
  const cahier = await cahierEpandage({ farmId: farm.id, campaignYear: annee });
  attendu(cahier.lignes.length >= 2, `le cahier reprend les apports (${cahier.lignes.length} lignes)`);
  attendu(
    cahier.lignes.every((l) => l.parcelName.length > 0),
    'chaque ligne porte sa parcelle',
  );
  const incomplete = cahier.lignes.find((l) => l.productLabel.includes('Lisier'));
  attendu(
    (incomplete?.lacunes.length ?? 0) > 0,
    'une ligne incomplète est conservée avec ses lacunes, pas écartée',
  );
  attendu(cahier.lignesIncompletes >= 1, 'le cahier annonce combien de lignes sont incomplètes');

  // Nettoyage
  await prisma.fertilizerApplication.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });
  await prisma.regulatoryRule.deleteMany({ where: { label: 'VERIF' } });
  await prisma.regulatoryReferential.deleteMany({ where: { version: 'VERIF-1' } });

  console.info(process.exitCode ? '\n✗ des vérifications ont échoué' : '\n✓ tout est vérifié sur une vraie base');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
