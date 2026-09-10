import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDatabase } from './helpers/db';
import { importEphyData } from '../src/lib/ephy/import';
import { getProductUsages } from '../src/lib/ephy/search';
import { looksLikeUsageLabel } from '../src/lib/ephy/schema';
import {
  checkDose,
  convertDose,
  parseCatalogDose,
  usagesForCrop,
  type UsageForDose,
} from '../src/lib/ephy/dose';
import {
  conditionConcernsDrainedSoil,
  drainedSoilSeverity,
} from '../src/lib/ephy/conditions';

/**
 * Doses autorisées, ZNT et sols drainés.
 *
 * Les en-têtes utilisés ici sont ceux de l'édition officielle du 8 septembre
 * 2026, **recopiés à l'identique** — y compris la faute de frappe « tade
 * cultural max (BBCH) » du fichier `produits_usages_utf8.csv`, qui est celle de
 * l'ANSES et non la nôtre. Le contenu des lignes est fictif.
 *
 * Ce que ces tests protègent : rien ne doit jamais être déduit d'une donnée
 * absente. Une ZNT non publiée n'est pas une ZNT nulle ; une dose en kg/ha ne se
 * compare pas à une saisie en L/ha ; un usage absent du catalogue n'est pas un
 * usage autorisé.
 */

function toUtf8(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

const PRODUITS = [
  'type produit;numero AMM;nom produit;seconds noms commerciaux;titulaire;type commercial;gamme usage;mentions autorisees;restrictions usage;restrictions usage libelle;Substances actives;fonctions;formulations;Etat d’autorisation;Date de retrait du produit;Date de première autorisation;Numéro AMM du produit de référence;Nom du produit de référence;',
  'PPP;9910001;ESSAI HERBI;;LABO ESSAI;Produit de référence;Professionnel;;;;substance-essai-a (Essai A) 400.0 g/L;Herbicide;Concentré émulsionnable;AUTORISE;;01/02/2010;;;',
  'PPP;9910002;ESSAI FONGI;;LABO ESSAI;Produit de référence;Professionnel;;;;substance-essai-b (Essai B) 250.0 g/L;Fongicide;Suspension concentrée;RETIRE;15/03/2024;01/02/2005;;;',
].join('\r\n');

/**
 * En-têtes de `usages_des_produits_autorises_utf8.csv`, à l'identique.
 *
 * Et surtout : les valeurs dans l'ordre où le fichier officiel les met, qui
 * n'est pas celui qu'annoncent les intitulés. La colonne « identifiant usage
 * lib court » porte le **code** (`15105913`) et « identifiant usage » porte le
 * **libellé** (`Orge*Désherbage`). Un échantillon qui suivrait sagement les
 * en-têtes validerait un import qui, sur le vrai fichier, nommerait toutes les
 * cultures `00610005`.
 */
const USAGES_AUTORISES = [
  "type produit;numero AMM;nom produit;seconds noms commerciaux;titulaire;type commercial;gamme usage;mentions autorisees;Substances actives;fonctions;formulations;identifiant usage lib court;identifiant usage; date decision;stade cultural min (BBCH);stade cultural max (BBCH);etat usage;dose retenue;dose retenue unite;delai avant recolte jour;delai avant recolte bbch;nombre max d'application;date fin distribution;date fin utilisation;condition emploi;ZNT aquatique (en m);ZNT arthropodes non cibles (en m);ZNT plantes non cibles (en m);mentions autorisees;",
  'PPP;9910001;ESSAI HERBI;;LABO ESSAI;Produit de référence;Professionnel;;substance-essai-a;Herbicide;EC;01002019;Blé*Trt Part.Aer.*Adventices;03/10/2018;11;89;Autorisé;2.0;L/ha;60;;1;;;Ne pas appliquer sur sol drainé;20.0;5.0;5.0;;',
  'PPP;9910001;ESSAI HERBI;;LABO ESSAI;Produit de référence;Professionnel;;substance-essai-a;Herbicide;EC;01002020;Blé*Trt Part.Aer.*Graminées;03/10/2018;11;89;Autorisé;2.5;L/ha;60;;1;;;;20.0;;;;',
  'PPP;9910001;ESSAI HERBI;;LABO ESSAI;Produit de référence;Professionnel;;substance-essai-a;Herbicide;EC;01002021;Orge*Trt Part.Aer.*Adventices;03/10/2018;11;89;Retrait;3.0;L/ha;60;;1;;;;20.0;;;;',
  'PPP;9910001;ESSAI HERBI;;LABO ESSAI;Produit de référence;Professionnel;;substance-essai-a;Herbicide;EC;01002022;Vigne*Trt Part.Aer.*Mildiou;03/10/2018;11;89;Autorisé;1.2;kg/ha;21;;3;;;;50.0;;;;',
].join('\r\n');

/**
 * En-têtes de `produits_usages_utf8.csv`.
 *
 * Deux différences qui comptent : pas de colonne « identifiant usage lib
 * court » — c'est « identifiant usage » qui porte le libellé — et la coquille
 * « tade cultural max ».
 */
const PRODUITS_USAGES = [
  "numero AMM;nom produit;identifiant usage; date decision;stade cultural min (BBCH);tade cultural max (BBCH);etat usage;dose retenue;dose retenue unite;delai avant recolte jour;delai avant recolte bbch;nombre max d'application;date fin distribution;date fin utilisation;condition emploi;ZNT aquatique (en m);ZNT arthropodes non cibles (en m);ZNT plantes non cibles (en m);mentions autorisees;intervalle minimum entre applications (jour);",
  '9910001;ESSAI HERBI;Blé*Trt Part.Aer.*Adventices;03/10/2018;11;89;Autorisé;2.0;L/ha;60;;1;;;;20.0;5.0;5.0;;7;',
].join('\r\n');

const CONDITIONS = [
  'type produit;numero AMM;nom produit;catégorie de condition d’emploi;condition d’emploi libelle;',
  "PPP;9910001;ESSAI HERBI;Environnement faune;Condition: - SPe 2 : Pour protéger les organismes aquatiques, ne pas appliquer sur sol artificiellement drainé.;",
  "PPP;9910001;ESSAI HERBI;Protection de l'opérateur;Condition: Porter des gants lors de la manipulation.;",
  'PPP;9910002;ESSAI FONGI;Environnement milieu;Condition: Ne pas appliquer en période de drainage sans dispositif végétalisé.;',
].join('\r\n');

describe('Doses autorisées, ZNT et sols drainés', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Import : lire les vrais fichiers
  // -------------------------------------------------------------------------

  it('importe dose, DAR, applications et les trois ZNT du fichier officiel', async () => {
    await importEphyData(
      { products: toUtf8(PRODUITS), usages: toUtf8(USAGES_AUTORISES) },
      { sourceLabel: 'échantillon de test' },
    );

    const usage = await prisma.phytoUsage.findFirstOrThrow({
      where: { ephyUsageId: '01002019' },
    });

    expect(usage.cropLabel).toBe('Blé');
    expect(usage.targetLabel).toBe('Adventices');
    expect(usage.cropNormalized).toBe('ble');
    expect(usage.doseValue).toBe('2.0');
    expect(usage.doseUnit).toBe('L/ha');
    expect(usage.preHarvestDelay).toBe('60');
    expect(usage.maxApplications).toBe('1');
    expect(usage.bbchMin).toBe('11');
    expect(usage.bbchMax).toBe('89');
    // Les trois ZNT, distinctes — c'est la colonne aquatique qui vaut 20.
    expect(usage.zntAquaticM).toBe('20.0');
    expect(usage.zntArthropodM).toBe('5.0');
    expect(usage.zntPlantM).toBe('5.0');
    expect(usage.conditions).toBe('Ne pas appliquer sur sol drainé');
  });

  /**
   * Les intitulés mentent, dans les deux fichiers et pas de la même façon.
   *
   * Ce test est né d'un import réel : les 19 609 usages avaient bien été
   * importés, mais toutes les cultures s'appelaient `00610005`. Le code était
   * passé pour le libellé parce qu'on avait cru l'en-tête.
   */
  it('trouve la colonne du libellé d’usage d’après son contenu, pas d’après son intitulé', async () => {
    // Fichier « usages des produits autorisés » : le libellé est sous
    // « identifiant usage », le code sous « identifiant usage lib court ».
    await importEphyData(
      { products: toUtf8(PRODUITS), usages: toUtf8(USAGES_AUTORISES) },
      { sourceLabel: 'échantillon de test' },
    );

    const depuisAutorises = await prisma.phytoUsage.findFirstOrThrow({
      where: { doseValue: '2.0' },
    });
    expect(depuisAutorises.cropLabel).toBe('Blé');
    expect(depuisAutorises.ephyUsageId).toBe('01002019');

    // Fichier « produits usages » : une seule colonne, qui porte le libellé.
    await resetDatabase();
    const rapport = await importEphyData(
      { products: toUtf8(PRODUITS), usages: toUtf8(PRODUITS_USAGES) },
      { sourceLabel: 'échantillon de test' },
    );
    expect(rapport.usageCount).toBe(1);

    const depuisProduitsUsages = await prisma.phytoUsage.findFirstOrThrow({});
    expect(depuisProduitsUsages.cropLabel).toBe('Blé');
    expect(depuisProduitsUsages.targetLabel).toBe('Adventices');
    // Une seule colonne candidate, retenue comme libellé : pas de code à ranger.
    expect(depuisProduitsUsages.ephyUsageId).toBeNull();
    // Colonne propre à ce fichier, dont l'en-tête officiel est fautif.
    expect(depuisProduitsUsages.minIntervalDays).toBe('7');
    expect(depuisProduitsUsages.bbchMax).toBe('89');
  });

  it('reconnaît un libellé d’usage à sa forme culture*traitement*cible', () => {
    expect(looksLikeUsageLabel(['Blé*Trt Part.Aer.*Adventices'])).toBe(true);
    expect(looksLikeUsageLabel(['Orge*Désherbage', 'Seigle*Désherbage'])).toBe(true);
    expect(looksLikeUsageLabel(['01002019', '15105913'])).toBe(false);
    expect(looksLikeUsageLabel([])).toBe(false);
    expect(looksLikeUsageLabel([undefined, '', '  '])).toBe(false);
  });

  it('importe les conditions d’emploi et repère celles qui visent les sols drainés', async () => {
    const rapport = await importEphyData(
      { products: toUtf8(PRODUITS), conditions: toUtf8(CONDITIONS) },
      { sourceLabel: 'échantillon de test' },
    );

    expect(rapport.conditionCount).toBe(3);

    const drainees = await prisma.phytoCondition.findMany({
      where: { concernsDrainedSoil: true },
    });
    expect(drainees).toHaveLength(2);

    const gants = await prisma.phytoCondition.findFirstOrThrow({
      where: { category: "Protection de l'opérateur" },
    });
    expect(gants.concernsDrainedSoil).toBe(false);
    // Le libellé est repris mot pour mot, préfixe « Condition: » compris.
    expect(gants.label).toContain('Porter des gants');
  });

  it('sépare l’interdiction franche de la condition à vérifier', () => {
    expect(
      conditionConcernsDrainedSoil('ne pas appliquer sur sol artificiellement drainé'),
    ).toBe(true);
    expect(conditionConcernsDrainedSoil('Porter des gants')).toBe(false);

    expect(drainedSoilSeverity('Ne pas appliquer ce produit sur sols drainés.')).toBe(
      'interdit',
    );
    expect(
      drainedSoilSeverity('Application possible hors période de drainage.'),
    ).toBe('a-verifier');
  });

  // -------------------------------------------------------------------------
  // Conversion et lecture des doses
  // -------------------------------------------------------------------------

  it('convertit à l’intérieur d’une famille d’unités, jamais entre deux', () => {
    expect(convertDose(1, 'L/ha', 'mL/ha')).toBe(1000);
    expect(convertDose(2500, 'g/ha', 'kg/ha')).toBe(2.5);
    expect(convertDose(1, 'l/ha', 'L/ha')).toBe(1);

    // Masse contre volume : la densité du produit n'est pas publiée.
    expect(convertDose(1, 'kg/ha', 'L/ha')).toBeNull();
    // Dose de bouillie contre dose à l'hectare : volume appliqué inconnu.
    expect(convertDose(1, 'L/hL', 'L/ha')).toBeNull();
    expect(convertDose(1, 'diffuseurs/ha', 'L/ha')).toBeNull();
  });

  it('refuse les doses non numériques du catalogue au lieu de les forcer', () => {
    expect(parseCatalogDose('2.5')).toBe(2.5);
    expect(parseCatalogDose('0,75')).toBe(0.75);
    expect(parseCatalogDose("voir conditions d'emploi")).toBeNull();
    expect(parseCatalogDose('SANS DOSE')).toBeNull();
    expect(parseCatalogDose('..')).toBeNull();
    expect(parseCatalogDose('')).toBeNull();
    expect(parseCatalogDose(null)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Rapprochement culture ↔ usage
  // -------------------------------------------------------------------------

  const usage = (over: Partial<UsageForDose>): UsageForDose => ({
    id: over.id ?? 'u',
    cropLabel: 'Blé',
    targetLabel: 'Adventices',
    usageLabel: 'Blé*Trt Part.Aer.*Adventices',
    doseValue: '2.0',
    doseUnit: 'L/ha',
    status: 'Autorisé',
    preHarvestDelay: '60',
    maxApplications: '1',
    minIntervalDays: null,
    zntAquaticM: '20.0',
    zntArthropodM: null,
    zntPlantM: null,
    conditions: null,
    ...over,
  });

  it('rapproche les cultures par inclusion, sans rapprocher ce qui diffère', () => {
    const usages = [usage({ id: 'a' }), usage({ id: 'b', cropLabel: 'Orge' })];

    expect(usagesForCrop(usages, 'Blé').map((u) => u.id)).toEqual(['a']);
    // Le catalogue dit « Blé », l'assolement « Blé tendre d'hiver ».
    expect(usagesForCrop(usages, "Blé tendre d'hiver").map((u) => u.id)).toEqual(['a']);
    // Insensible aux accents et à la casse.
    expect(usagesForCrop(usages, 'BLE').map((u) => u.id)).toEqual(['a']);
    // Deux céréales ne se valent pas.
    expect(usagesForCrop(usages, 'Colza')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Verdict de dose
  // -------------------------------------------------------------------------

  it('signale le dépassement de la dose retenue', () => {
    const verdict = checkDose({
      usages: [usage({})],
      crop: 'Blé',
      dose: 3,
      doseUnit: 'L/ha',
    });

    expect(verdict.verdict).toBe('depassement');
    expect(verdict.ratio).toBeCloseTo(1.5);
    expect(verdict.message).toContain('Surdosage');
    expect(verdict.message).toContain('50 %');
  });

  it('accepte la dose retenue elle-même, et les arrondis d’unité', () => {
    expect(
      checkDose({ usages: [usage({})], crop: 'Blé', dose: 2, doseUnit: 'L/ha' }).verdict,
    ).toBe('conforme');

    // 2 L/ha saisis en 2000 mL/ha : même dose, autre préfixe.
    expect(
      checkDose({ usages: [usage({})], crop: 'Blé', dose: 2000, doseUnit: 'mL/ha' })
        .verdict,
    ).toBe('conforme');
  });

  /**
   * Une même culture porte plusieurs usages selon la cible, à doses
   * différentes. Retenir la plus faible produirait une fausse alerte à chaque
   * traitement de l'autre cible — et une fausse alerte finit par faire ignorer
   * les vraies.
   */
  it('retient la dose la plus élevée quand plusieurs cibles coexistent', () => {
    const usages = [
      usage({ id: 'a', doseValue: '2.0', targetLabel: 'Adventices' }),
      usage({ id: 'b', doseValue: '2.5', targetLabel: 'Graminées' }),
    ];

    const verdict = checkDose({ usages, crop: 'Blé', dose: 2.4, doseUnit: 'L/ha' });
    expect(verdict.verdict).toBe('conforme');
    expect(verdict.usage?.id).toBe('b');
    expect(verdict.authorized).toEqual({ value: 2.5, unit: 'L/ha' });
  });

  it('ignore les usages retirés comme référence de dose', () => {
    const usages = [usage({ id: 'a', status: 'Retrait', doseValue: '5.0' })];
    const verdict = checkDose({ usages, crop: 'Blé', dose: 3, doseUnit: 'L/ha' });
    expect(verdict.verdict).toBe('usage-inconnu');
  });

  it('ne suppose rien quand la culture n’est pas au catalogue', () => {
    const verdict = checkDose({
      usages: [usage({})],
      crop: 'Colza',
      dose: 3,
      doseUnit: 'L/ha',
    });
    expect(verdict.verdict).toBe('usage-inconnu');
    expect(verdict.message).toContain('n’est pas un usage autorisé');
  });

  it('refuse de comparer une masse à un volume', () => {
    const usages = [usage({ doseValue: '1.2', doseUnit: 'kg/ha' })];
    const verdict = checkDose({ usages, crop: 'Blé', dose: 3, doseUnit: 'L/ha' });

    expect(verdict.verdict).toBe('unites-incomparables');
    expect(verdict.ratio).toBeNull();
    expect(verdict.message).toContain('densité');
  });

  it('n’oppose aucune dose à une saisie libre hors catalogue', () => {
    const verdict = checkDose({
      usages: null,
      crop: 'Blé',
      dose: 3,
      doseUnit: 'L/ha',
    });
    expect(verdict.verdict).toBe('hors-catalogue');
  });

  it('réclame la culture avant de se prononcer', () => {
    const verdict = checkDose({
      usages: [usage({})],
      crop: null,
      dose: 3,
      doseUnit: 'L/ha',
    });
    expect(verdict.verdict).toBe('usage-inconnu');
    expect(verdict.message).toContain('Indiquez la culture');
  });

  it('signale une dose du catalogue inexploitable sans la deviner', () => {
    const usages = [usage({ doseValue: "voir conditions d'emploi" })];
    const verdict = checkDose({ usages, crop: 'Blé', dose: 3, doseUnit: 'L/ha' });
    expect(verdict.verdict).toBe('dose-non-exploitable');
    expect(verdict.authorized).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Ce que l'API sert au formulaire
  // -------------------------------------------------------------------------

  it('sert les usages en vigueur, les cultures et les restrictions de drainage', async () => {
    await importEphyData(
      {
        products: toUtf8(PRODUITS),
        usages: toUtf8(USAGES_AUTORISES),
        conditions: toUtf8(CONDITIONS),
      },
      { sourceLabel: 'échantillon de test' },
    );

    const reponse = await getProductUsages('9910001');
    expect(reponse).not.toBeNull();
    if (!reponse) return;

    expect(reponse.product.authorized).toBe(true);
    // L'usage « Orge » est en retrait : il ne figure pas parmi les usages servis.
    expect(reponse.usages).toHaveLength(3);
    expect(reponse.crops).toEqual(['Blé', 'Vigne']);

    expect(reponse.drainedSoilRestrictions).toHaveLength(1);
    expect(reponse.drainedSoilRestrictions[0]?.severity).toBe('interdit');
    expect(reponse.drainedSoilRestrictions[0]?.category).toBe('Environnement faune');

    const retire = await getProductUsages('9910002');
    expect(retire?.product.authorized).toBe(false);
    expect(retire?.product.withdrawnAt?.slice(0, 10)).toBe('2024-03-15');
  });
});
