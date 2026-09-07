import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDatabase } from './helpers/db';
import { importEphyData } from '../src/lib/ephy/import';
import { getEphySourceInfo, searchProducts, getProductDetail } from '../src/lib/ephy/search';

/**
 * Import du référentiel E-Phy.
 *
 * Les fichiers utilisés ici sont des ÉCHANTILLONS DE TEST reproduisant la
 * structure de l'export officiel (séparateur `;`, encodage Windows-1252,
 * intitulés de colonnes réels). Leur contenu est fictif et sert uniquement à
 * vérifier le parseur : aucune donnée réglementaire réelle n'est codée en dur
 * dans l'application, qui n'affiche que ce qui a été importé.
 */

/** Encode en Windows-1252, comme les fichiers publiés. */
function toWindows1252(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return Buffer.from(bytes);
}

const PRODUCTS_CSV = [
  "numero AMM;nom produit;seconds noms commerciaux;titulaire;type commercial;Etat d'autorisation;Substances actives;fonctions;formulations;mentions autorisees;restrictions usage libelle;Date de retrait du produit",
  '9900001;PRODUIT TEST ALPHA;ALPHA PRO;SOCIÉTÉ ESSAI SAS;Produit de référence;AUTORISE;substance-essai-a | substance-essai-b;Herbicide;SL;emploi autorisé dans les jardins;Ne pas appliquer près des points d’eau;',
  '9900002;PRODUIT TEST BÊTA;;LABORATOIRE ESSAI;Produit de référence;RETIRE;substance-essai-c;Fongicide;WG;;;15/03/2024',
  '9900003;PRODUIT TEST GAMMA;;SOCIÉTÉ ESSAI SAS;Second nom commercial;AUTORISE;substance-essai-a;Insecticide;EC;;;',
].join('\r\n');

const USAGES_CSV = [
  'numero AMM;identifiant usage;identifiant usage lib court;etat usage;dose retenue;dose retenue unite;delai avant recolte jour;nombre max d’application;condition emploi;ZNT aquatique m;date decision',
  '9900001;1;Blé*Trt Part.Aer.*Adventices;Autorisé;2,5;L/ha;60;1;Appliquer avant le stade épi 1 cm;5;12/01/2023',
  '9900001;2;Orge*Trt Part.Aer.*Adventices;Autorisé;2;L/ha;60;1;;5;12/01/2023',
  '9900002;3;Vigne*Trt Part.Aer.*Mildiou;Retiré;1,2;kg/ha;21;3;;20;05/06/2021',
].join('\r\n');

const SUBSTANCES_CSV = [
  'Nom substance active;Numero CAS;Etat d’approbation',
  'substance-essai-a;0000-00-1;Approuvée',
  'substance-essai-b;0000-00-2;Approuvée',
  'substance-essai-c;0000-00-3;Non approuvée',
].join('\r\n');

describe('Référentiel E-Phy', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('signale explicitement l’absence de synchronisation', async () => {
    const source = await getEphySourceInfo();
    expect(source.configured).toBe(false);
    expect(source.productsInBase).toBe(0);
    expect(source.lastSyncAt).toBeNull();

    // Aucune recherche ne renvoie de résultat inventé.
    const result = await searchProducts({ query: 'roundup' });
    expect(result.results).toHaveLength(0);
    expect(result.source.configured).toBe(false);
  });

  it('importe produits, substances et usages depuis les CSV officiels', async () => {
    const report = await importEphyData(
      {
        products: toWindows1252(PRODUCTS_CSV),
        usages: toWindows1252(USAGES_CSV),
        substances: toWindows1252(SUBSTANCES_CSV),
      },
      { sourceLabel: 'échantillon de test', version: '2026-01' },
    );

    expect(report.productCount).toBe(3);
    expect(report.usageCount).toBe(3);
    expect(report.substanceCount).toBe(3);

    const product = await prisma.phytosanitaryProduct.findUniqueOrThrow({
      where: { amm: '9900001' },
      include: { substances: { include: { substance: true } }, usages: true },
    });

    expect(product.name).toBe('PRODUIT TEST ALPHA');
    expect(product.holder).toBe('SOCIÉTÉ ESSAI SAS');
    expect(product.status).toBe('AUTORISE');
    expect(product.formulation).toBe('SL');
    expect(product.secondNames).toBe('ALPHA PRO');
    expect(product.substances).toHaveLength(2);
    expect(product.usages).toHaveLength(2);
  });

  it('restitue les usages sans reformulation (culture, cible, dose, conditions)', async () => {
    await importEphyData(
      { products: toWindows1252(PRODUCTS_CSV), usages: toWindows1252(USAGES_CSV) },
      { sourceLabel: 'échantillon de test' },
    );

    const usage = await prisma.phytoUsage.findFirstOrThrow({
      where: { ephyUsageId: '1' },
    });

    expect(usage.cropLabel).toBe('Blé');
    expect(usage.targetLabel).toBe('Adventices');
    // La dose est conservée telle quelle, virgule décimale comprise.
    expect(usage.doseValue).toBe('2,5');
    expect(usage.doseUnit).toBe('L/ha');
    expect(usage.preHarvestDelay).toBe('60');
    expect(usage.zntAquaticM).toBe('5');
    expect(usage.conditions).toBe('Appliquer avant le stade épi 1 cm');
    expect(usage.decisionDate?.toISOString().slice(0, 10)).toBe('2023-01-12');
  });

  it('conserve la date de retrait des produits retirés', async () => {
    await importEphyData(
      { products: toWindows1252(PRODUCTS_CSV) },
      { sourceLabel: 'échantillon de test' },
    );

    const withdrawn = await prisma.phytosanitaryProduct.findUniqueOrThrow({
      where: { amm: '9900002' },
    });
    expect(withdrawn.status).toBe('RETIRE');
    expect(withdrawn.withdrawnAt?.toISOString().slice(0, 10)).toBe('2024-03-15');
  });

  it('laisse vides les champs absents du fichier plutôt que de les deviner', async () => {
    const minimalCsv = ['numero AMM;nom produit', '9900010;PRODUIT MINIMAL'].join('\r\n');

    const report = await importEphyData(
      { products: toWindows1252(minimalCsv) },
      { sourceLabel: 'échantillon minimal' },
    );

    expect(report.productCount).toBe(1);
    expect(report.warnings.some((w) => w.includes('non renseignés'))).toBe(true);

    const product = await prisma.phytosanitaryProduct.findUniqueOrThrow({
      where: { amm: '9900010' },
    });
    expect(product.holder).toBeNull();
    expect(product.status).toBeNull();
    expect(product.formulation).toBeNull();
  });

  it('est idempotent : deux imports ne créent pas de doublon', async () => {
    const source = {
      products: toWindows1252(PRODUCTS_CSV),
      usages: toWindows1252(USAGES_CSV),
      substances: toWindows1252(SUBSTANCES_CSV),
    };

    await importEphyData(source, { sourceLabel: 'premier import' });
    await importEphyData(source, { sourceLabel: 'second import' });

    expect(await prisma.phytosanitaryProduct.count()).toBe(3);
    expect(await prisma.phytoUsage.count()).toBe(3);
    expect(await prisma.productSubstance.count()).toBe(4);
  });

  it('échoue proprement si les colonnes obligatoires manquent', async () => {
    const badCsv = ['colonne A;colonne B', 'valeur 1;valeur 2'].join('\r\n');

    await expect(
      importEphyData({ products: toWindows1252(badCsv) }, { sourceLabel: 'fichier invalide' }),
    ).rejects.toThrow(/Colonnes obligatoires introuvables/);

    const run = await prisma.ephySyncRun.findFirstOrThrow({
      orderBy: { startedAt: 'desc' },
    });
    expect(run.status).toBe('FAILED');
    expect(run.errorMessage).toContain('Colonnes obligatoires');
  });

  it('enregistre la provenance et la date de synchronisation', async () => {
    await importEphyData(
      { products: toWindows1252(PRODUCTS_CSV) },
      {
        sourceLabel: 'E-Phy (ANSES) — data.gouv.fr',
        sourceUrl: 'https://exemple.test/ephy.zip',
        version: '2026-01',
      },
    );

    const source = await getEphySourceInfo();
    expect(source.configured).toBe(true);
    expect(source.productsInBase).toBe(3);
    expect(source.lastSyncAt).not.toBeNull();
    expect(source.label).toContain('sources officielles');

    const run = await prisma.ephySyncRun.findFirstOrThrow({
      orderBy: { startedAt: 'desc' },
    });
    expect(run.status).toBe('SUCCESS');
    expect(run.sourceUrl).toBe('https://exemple.test/ephy.zip');
    expect(run.version).toBe('2026-01');
  });

  it('recherche par nom commercial, second nom et numéro d’AMM', async () => {
    await importEphyData(
      {
        products: toWindows1252(PRODUCTS_CSV),
        substances: toWindows1252(SUBSTANCES_CSV),
      },
      { sourceLabel: 'échantillon de test' },
    );

    const byName = await searchProducts({ query: 'ALPHA' });
    expect(byName.results.map((r) => r.amm)).toContain('9900001');

    // Recherche insensible aux accents.
    const byAccent = await searchProducts({ query: 'beta' });
    expect(byAccent.results.map((r) => r.amm)).toContain('9900002');

    const byAmm = await searchProducts({ query: '9900003' });
    expect(byAmm.results).toHaveLength(1);
    expect(byAmm.results[0]?.name).toBe('PRODUIT TEST GAMMA');

    const unknown = await searchProducts({ query: 'nexistepas' });
    expect(unknown.results).toHaveLength(0);
  });

  it('filtre les produits retirés à la demande', async () => {
    await importEphyData(
      { products: toWindows1252(PRODUCTS_CSV) },
      { sourceLabel: 'échantillon de test' },
    );

    const all = await searchProducts({ query: 'PRODUIT TEST' });
    expect(all.results).toHaveLength(3);

    const authorized = await searchProducts({
      query: 'PRODUIT TEST',
      onlyAuthorized: true,
    });
    expect(authorized.results).toHaveLength(2);
    expect(authorized.results.every((r) => r.status === 'AUTORISE')).toBe(true);
  });

  it('renvoie une fiche produit complète avec sa provenance', async () => {
    await importEphyData(
      {
        products: toWindows1252(PRODUCTS_CSV),
        usages: toWindows1252(USAGES_CSV),
        substances: toWindows1252(SUBSTANCES_CSV),
      },
      { sourceLabel: 'échantillon de test' },
    );

    const detail = await getProductDetail('9900001');
    expect(detail).not.toBeNull();
    expect(detail?.product.name).toBe('PRODUIT TEST ALPHA');
    expect(detail?.product.usages).toHaveLength(2);
    expect(detail?.source.lastSyncAt).not.toBeNull();

    expect(await getProductDetail('0000000')).toBeNull();
  });
});
