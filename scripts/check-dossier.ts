/**
 * Vérification du dossier de contrôle et du verrouillage.
 *
 * Ce que ce script protège :
 *
 *  · **le dossier ne se dit jamais complet** — il rassemble ce que Parcelys
 *    sait assembler, et le dit ;
 *  · **un document verrouillé ne bouge plus**, même quand les données
 *    changent. C'est toute la raison d'être du verrou, et cela ne se prouve
 *    qu'en modifiant les données après coup ;
 *  · **rien n'est écrasé** : une nouvelle version s'ajoute.
 *
 *     npm run check:dossier
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import {
  assemblerDossier,
  documentsVerrouilles,
  verrouillerDocument,
} from '@/lib/regulatory/control-file';
import { cahierEpandage } from '@/lib/regulatory/organic-nitrogen';

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
  if (!farm) { console.error('Aucune exploitation. Lancez le seed.'); process.exit(1); }
  const parcel = await prisma.parcel.findFirst({
    where: { farmId: farm.id, deletedAt: null },
    select: { id: true, areaHa: true },
  });
  if (!parcel) { console.error('Aucune parcelle.'); process.exit(1); }
  const annee = new Date().getFullYear();
  console.info(`Exploitation : ${farm.name} · campagne ${annee}`);

  await prisma.campaignDocument.deleteMany({ where: { farmId: farm.id, notes: 'VERIF' } });
  await prisma.fertilizerApplication.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });
  await prisma.document.deleteMany({ where: { farmId: farm.id, description: 'VERIF' } });

  // --- Le dossier ne se dit jamais complet ---------------------------------
  const dossier = await assemblerDossier({ farmId: farm.id, campaignYear: annee });
  attendu(dossier.pieces.length > 0, `le dossier rassemble ${dossier.pieces.length} pièces`);
  attendu(
    !/complet|conforme/i.test(dossier.avertissement) ||
      /ne prétend pas|ne signifie pas/i.test(dossier.avertissement),
    'l’avertissement ne promet ni conformité ni exhaustivité',
  );
  attendu(
    dossier.avertissement.includes('ne prétend pas'),
    'il dit explicitement qu’il n’est pas la liste des pièces exigibles',
  );
  attendu(
    dossier.referentiels.length > 0,
    'les référentiels employés sont listés avec leur version',
  );

  // --- Un justificatif périmé est signalé, un renouvelé ne l'est pas -------
  const perime = await prisma.document.create({
    data: {
      farmId: farm.id, fileName: 'certiphyto-2020.pdf',
      storageKey: `verif-${Date.now()}-a`, mimeType: 'application/pdf', sizeBytes: 1,
      category: 'CERTIPHYTO', description: 'VERIF',
      validUntil: new Date(`${annee - 2}-01-01`),
    },
  });
  let d = await assemblerDossier({ farmId: farm.id, campaignYear: annee });
  let certiphyto = d.pieces.find((p) => p.code === 'certiphyto');
  attendu(certiphyto?.statut === 'perimee', `certificat expiré → ${certiphyto?.statut}`);

  const valide = await prisma.document.create({
    data: {
      farmId: farm.id, fileName: 'certiphyto-2026.pdf',
      storageKey: `verif-${Date.now()}-b`, mimeType: 'application/pdf', sizeBytes: 1,
      category: 'CERTIPHYTO', description: 'VERIF', reference: 'CI-123456',
      validUntil: new Date(`${annee + 3}-01-01`),
    },
  });
  d = await assemblerDossier({ farmId: farm.id, campaignYear: annee });
  certiphyto = d.pieces.find((p) => p.code === 'certiphyto');
  attendu(
    certiphyto?.statut === 'presente',
    'un renouvellement rend la pièce présente — l’ancienne n’est plus signalée',
  );
  attendu(
    certiphyto?.documents.some((x) => x.reference === 'CI-123456') === true,
    'le numéro du certificat est repris',
  );

  // --- Verrouillage : la copie ne bouge plus -------------------------------
  const avant = await cahierEpandage({ farmId: farm.id, campaignYear: annee });
  const v1 = await verrouillerDocument({
    farmId: farm.id, campaignYear: annee, kind: 'CAHIER_EPANDAGE',
    contenu: avant, rowCount: avant.lignes.length, notes: 'VERIF',
  });
  attendu(v1.ok && v1.version === 1, 'premier verrouillage en version 1');

  // Re-verrouiller sans rien changer ne doit pas empiler une version.
  const v1bis = await verrouillerDocument({
    farmId: farm.id, campaignYear: annee, kind: 'CAHIER_EPANDAGE',
    contenu: avant, rowCount: avant.lignes.length, notes: 'VERIF',
  });
  attendu(
    v1bis.ok && v1bis.inchange && v1bis.version === 1,
    'un contenu identique ne crée pas de doublon',
  );

  // On change les données APRÈS le verrou : c'est le vrai test.
  await prisma.fertilizerApplication.create({
    data: {
      parcelId: parcel.id, appliedOn: new Date(`${annee - 1}-10-10`),
      inputType: 'ORGANIC', productLabel: 'VERIF Ajout après verrouillage',
      dose: 10, doseUnit: 't/ha', treatedAreaHa: Number(parcel.areaHa),
      totalQuantity: 10 * Number(parcel.areaHa), totalUnit: 't',
      nSupplied: 45, notes: 'VERIF',
    },
  });

  const apres = await cahierEpandage({ farmId: farm.id, campaignYear: annee });
  attendu(
    apres.lignes.length === avant.lignes.length + 1,
    'les données vivantes ont bien changé',
  );

  const fige = await prisma.campaignDocument.findFirstOrThrow({
    where: { farmId: farm.id, kind: 'CAHIER_EPANDAGE', version: 1 },
    select: { content: true, checksum: true },
  });
  const contenuFige = fige.content as unknown as { lignes: unknown[] };
  attendu(
    contenuFige.lignes.length === avant.lignes.length,
    `la copie verrouillée n’a pas bougé : ${contenuFige.lignes.length} lignes (vivant : ${apres.lignes.length})`,
  );

  // Un nouveau verrou crée une version 2, sans toucher la première.
  const v2 = await verrouillerDocument({
    farmId: farm.id, campaignYear: annee, kind: 'CAHIER_EPANDAGE',
    contenu: apres, rowCount: apres.lignes.length,
    gaps: `${apres.lignesIncompletes} ligne(s) incomplète(s)`, notes: 'VERIF',
  });
  attendu(v2.ok && v2.version === 2 && !v2.inchange, 'un contenu différent crée la version 2');

  const versions = await documentsVerrouilles({ farmId: farm.id, campaignYear: annee });
  const cahiers = versions.filter((x) => x.kind === 'CAHIER_EPANDAGE');
  attendu(cahiers.length === 2, `les deux versions coexistent (${cahiers.length})`);
  attendu(
    cahiers[0]?.version === 2 && cahiers[1]?.version === 1,
    'la plus récente est en tête, l’ancienne reste consultable',
  );
  attendu(
    cahiers[0]?.checksum !== cahiers[1]?.checksum,
    'les empreintes diffèrent : le changement est prouvable',
  );
  attendu(
    (cahiers[0]?.gaps ?? '').includes('incomplète'),
    'les lacunes du moment sont conservées avec le document',
  );

  // Nettoyage
  await prisma.campaignDocument.deleteMany({ where: { farmId: farm.id, notes: 'VERIF' } });
  await prisma.fertilizerApplication.deleteMany({ where: { parcelId: parcel.id, notes: 'VERIF' } });
  await prisma.document.deleteMany({ where: { id: { in: [perime.id, valide.id] } } });

  console.info(process.exitCode ? '\n✗ des vérifications ont échoué' : '\n✓ tout est vérifié sur une vraie base');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
