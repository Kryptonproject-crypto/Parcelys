/**
 * Vérification des stocks contre une vraie base.
 *
 * Les tests unitaires de `tests/stock.test.ts` prouvent que le calcul du solde
 * est juste. Ils ne prouvent pas que la base, les jointures et le cloisonnement
 * entre exploitations le sont — et c'est là que se logent les erreurs qui
 * comptent. Ce script exerce le chemin complet : achat → lot → traitement →
 * parcelle, plus les refus qui protègent le solde.
 *
 * Il crée ses propres données (préfixées « VERIF ») et les efface, y compris le
 * produit et l'exploitation voisine dont il a besoin. Sans eux, la partie la
 * plus importante — rattachement et traçabilité — ne s'exécuterait pas, et
 * l'absence de « ✗ » passerait pour une réussite.
 *
 *     npm run check:stocks
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import {
  enregistrerMouvement,
  etatStocks,
  rattacherUtilisation,
  tracabiliteLot,
  utilisationsNonRattachees,
} from '@/lib/services/stock';

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
  const parcel = await prisma.parcel.findFirst({ where: { farmId: farm.id, deletedAt: null }, select: { id: true, name: true } });
  if (!parcel) { console.error('Aucune parcelle.'); process.exit(1); }
  // On ne dépend pas de la présence du catalogue E-Phy : sans produit, la
  // partie la plus importante de cette vérification (rattachement, traçabilité)
  // ne s'exécuterait pas, et l'absence de « ✗ » passerait pour une réussite.
  const produit =
    (await prisma.phytosanitaryProduct.findFirst({ select: { id: true, name: true, amm: true } })) ??
    (await prisma.phytosanitaryProduct.create({
      data: {
        amm: 'VERIF-0000000', name: 'VERIF Produit fictif',
        normalizedName: 'verif produit fictif', status: 'AUTORISE',
        sourceVersion: 'fixture de vérification',
      },
      select: { id: true, name: true, amm: true },
    }));
  console.info(`Exploitation : ${farm.name} · parcelle ${parcel.name} · produit ${produit?.name ?? 'aucun'}`);

  // Nettoyage d'un passage précédent
  await prisma.stockItem.deleteMany({ where: { farmId: farm.id, name: { startsWith: 'VERIF ' } } });

  const article = await prisma.stockItem.create({
    data: {
      farmId: farm.id, category: 'PHYTOSANITAIRE', name: 'VERIF Produit test',
      unit: 'L', alertThreshold: 5, phytoProductId: produit?.id ?? null,
    },
  });

  const lot = await prisma.stockLot.create({
    data: { itemId: article.id, lotNumber: 'LOT-2026-001', supplier: 'Coop test',
            purchasedOn: new Date('2026-03-01'), expiresOn: new Date('2027-03-01') },
  });

  // --- Entrée de 20 L
  const e = await enregistrerMouvement(farm.id, {
    itemId: article.id, lotId: lot.id, kind: 'ENTREE',
    occurredOn: new Date('2026-03-01'), quantity: 20, unit: 'L',
  });
  attendu(e.ok, 'entrée de 20 L acceptée');

  // --- Sortie saisie en positif : le signe doit être corrigé
  await enregistrerMouvement(farm.id, {
    itemId: article.id, lotId: lot.id, kind: 'SORTIE',
    occurredOn: new Date('2026-04-10'), quantity: 4.5, unit: 'L',
  });

  // --- Sortie en mL : convertie
  await enregistrerMouvement(farm.id, {
    itemId: article.id, lotId: lot.id, kind: 'SORTIE',
    occurredOn: new Date('2026-04-20'), quantity: 500, unit: 'mL',
  });

  let etat = await etatStocks(farm.id);
  let a = etat.find((x) => x.id === article.id)!;
  attendu(a.solde.quantite === 15, `solde 20 − 4,5 − 0,5 = 15 (obtenu ${a.solde.quantite})`);
  attendu(a.lots[0]?.reste.quantite === 15, 'solde du lot identique');

  // --- Le refus des kilos sur un article en litres
  const refus = await enregistrerMouvement(farm.id, {
    itemId: article.id, kind: 'SORTIE', occurredOn: new Date(), quantity: 2, unit: 'kg',
  });
  attendu(!refus.ok && refus.raison.includes('densité'), 'kg refusé sur un article en L, avec le motif');

  // --- Le refus d'un lot d'un autre article
  const autre = await prisma.stockItem.create({
    data: { farmId: farm.id, category: 'ENGRAIS', name: 'VERIF Engrais test', unit: 'kg' },
  });
  const mauvaisLot = await enregistrerMouvement(farm.id, {
    itemId: autre.id, lotId: lot.id, kind: 'ENTREE', occurredOn: new Date(), quantity: 100, unit: 'kg',
  });
  attendu(!mauvaisLot.ok, 'lot d’un autre article refusé');

  // --- Cloisonnement : une autre exploitation ne doit pas y toucher
  const autreFarm =
    (await prisma.farm.findFirst({ where: { id: { not: farm.id }, deletedAt: null }, select: { id: true } })) ??
    (await prisma.farm.create({ data: { name: 'VERIF Exploitation voisine' }, select: { id: true } }));
  if (autreFarm) {
    const intrus = await enregistrerMouvement(autreFarm.id, {
      itemId: article.id, kind: 'SORTIE', occurredOn: new Date(), quantity: 1, unit: 'L',
    });
    attendu(!intrus.ok, 'une autre exploitation ne peut pas mouvementer cet article');
    attendu((await tracabiliteLot(autreFarm.id, lot.id)) === null, 'ni lire la traçabilité de son lot');
  } else {
    console.info('  (une seule exploitation en base — cloisonnement non éprouvé ici)');
  }

  // --- Utilisation non rattachée : un vrai traitement, sans mouvement
  if (produit) {
    const traitement = await prisma.phytosanitaryApplication.create({
      data: {
        parcelId: parcel.id, appliedOn: new Date('2026-05-05'), productId: produit.id,
        productName: produit.name, amm: produit.amm, dose: 1.5, doseUnit: 'L/ha',
        treatedAreaHa: 2, quantityUsed: 3, quantityUnit: 'L',
      },
    });

    const orphelines = await utilisationsNonRattachees(farm.id);
    attendu(
      orphelines.some((o) => o.applicationId === traitement.id),
      'le traitement non rattaché est signalé, pas absorbé en silence',
    );

    // Solde inchangé tant que rien n'est rattaché : c'est le point.
    etat = await etatStocks(farm.id);
    a = etat.find((x) => x.id === article.id)!;
    attendu(a.solde.quantite === 15, 'le solde ne bouge pas tant que rien n’est rattaché');

    const r = await rattacherUtilisation(farm.id, {
      kind: 'phyto', applicationId: traitement.id, itemId: article.id, lotId: lot.id,
    });
    attendu(r.ok, 'rattachement accepté');

    etat = await etatStocks(farm.id);
    a = etat.find((x) => x.id === article.id)!;
    attendu(a.solde.quantite === 12, `solde après rattachement : 15 − 3 = 12 (obtenu ${a.solde.quantite})`);

    const apres = await utilisationsNonRattachees(farm.id);
    attendu(!apres.some((o) => o.applicationId === traitement.id), 'il ne figure plus parmi les non rattachées');

    const trace = await tracabiliteLot(farm.id, lot.id);
    const emploi = trace?.emplois.find((x) => x.parcelName === parcel.name);
    attendu(Boolean(emploi), `traçabilité : le lot remonte jusqu’à la parcelle ${parcel.name}`);
    attendu(trace?.reste.quantite === 12, 'reste du lot cohérent avec le solde');

    // Seuil d'alerte : on descend sous 5 L
    await enregistrerMouvement(farm.id, {
      itemId: article.id, lotId: lot.id, kind: 'SORTIE',
      occurredOn: new Date('2026-06-01'), quantity: 8, unit: 'L',
    });
    etat = await etatStocks(farm.id);
    a = etat.find((x) => x.id === article.id)!;
    attendu(a.solde.quantite === 4, `solde 12 − 8 = 4 (obtenu ${a.solde.quantite})`);
    attendu(a.alertes.some((al) => al.code === 'sous-seuil'), 'alerte de seuil déclenchée');

    await prisma.phytosanitaryApplication.delete({ where: { id: traitement.id } });
  }

  // Nettoyage
  await prisma.stockItem.deleteMany({ where: { farmId: farm.id, name: { startsWith: 'VERIF ' } } });
  await prisma.phytosanitaryProduct.deleteMany({ where: { amm: 'VERIF-0000000' } });
  await prisma.farm.deleteMany({ where: { name: 'VERIF Exploitation voisine' } });
  console.info(process.exitCode ? '\n✗ des vérifications ont échoué' : '\n✓ tout est vérifié sur une vraie base');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
