import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculerDoseGren,
  decrireSaisie,
  optionsPlafond,
  reglesGren,
  saisieGrenSchema,
  type ContexteGren,
  type ReglesGren,
  type SaisieGren,
} from '../src/lib/regulatory/gren-calcul';

/**
 * Le calcul de la dose prévisionnelle, contre la transcription réelle des
 * fiches GREN d'Auvergne-Rhône-Alpes — pas contre des tableaux écrits pour le
 * test. Chaque valeur attendue se relit dans les fiches.
 */

type RegleTranscrite = { code: string; depuis: string; jusquau: string | null; valeur: Record<string, unknown> };
const transcription = JSON.parse(
  readFileSync(join(__dirname, '../data/referentiels-aura/transcriptions/gren-aura.json'), 'utf8'),
) as { regles: RegleTranscrite[] };

function reglesAu(date: string, modifier?: (code: string, valeur: Record<string, unknown>) => Record<string, unknown>): ReglesGren<null> {
  return reglesGren(
    transcription.regles
      .filter((r) => r.depuis <= date && (r.jusquau === null || r.jusquau >= date))
      .map((r) => ({
        code: r.code,
        valeur: modifier ? modifier(r.code, structuredClone(r.valeur)) : r.valeur,
        trace: null,
      })),
  );
}

const REGLES_2026 = reglesAu('2026-02-01');

const contexteAllier = (patch: Partial<ContexteGren> = {}): ContexteGren => ({
  campagne: 2026,
  departement: '03',
  rendements: [2021, 2022, 2023, 2024, 2025].map((campagne, i) => ({
    campagne,
    valeur: [60, 90, 80, 85, 75][i]!,
    unite: 'q/ha',
  })),
  apportsOrganiques: [],
  cultureDHiver: true,
  ...patch,
});

const saisieBle = (patch: Partial<SaisieGren> = {}): SaisieGren =>
  saisieGrenSchema.parse({
    culture: 'cereales-paille',
    typeSol: 'argilo-calcaire-moyen-a-profond',
    espece: 'ble-tendre',
    besoin: { mode: 'variete-non-referencee' },
    objectif: { mode: 'historique' },
    choix: {
      Pi: { stade: '2-talles' },
      Ri: { precedent: 'colza-cereales-betterave' },
      Mh: { systeme: 'enfouis-1-sur-2-sans-mo' },
      Mr: { precedent: 'betterave-colza-luzerne-2ans-pois-soja-haricot-pdt' },
    },
    sansObjet: ['Mhp', 'Nirr'],
    ...patch,
  });

describe('Dose prévisionnelle GREN — bilan des céréales (fiche 2, Auvergne)', () => {
  it('lit chaque terme dans les fiches et applique la formule de l’ex-région', () => {
    const calcul = calculerDoseGren(REGLES_2026, contexteAllier(), saisieBle());

    expect(calcul.bloquants).toEqual([]);
    expect(calcul.sousRegion).toBe('auvergne');
    expect(calcul.methode).toBe('bilan');
    expect(calcul.expression).toBe('X = Pf + Rf – (Pi + Ri + Mh + Mhp + Mr + MrCI + Nirr + Xpro)');

    const v = Object.fromEntries(calcul.termes.map((t) => [t.terme, t.valeur]));
    // Objectif : 60, 90, 80, 85, 75 → sans 60 ni 90 → moyenne de 75, 80, 85
    // (la moyenne des cinq, 78, serait fausse).
    expect(v.y).toBe(80);
    // b = 3 (blé tendre, variété non référencée) × 80 q.
    expect(v.Pf).toBe(240);
    expect(v.Rf).toBe(40);
    expect(v.Pi).toBe(20);
    // Reliquat moyen de l'Allier, argilo-calcaire moyen à profond, précédent céréales.
    expect(v.Ri).toBe(70);
    expect(v.Mh).toBe(30);
    expect(v.Mhp).toBe(0);
    expect(v.Mr).toBe(20);
    // Culture d'hiver : MrCI nul par la fiche.
    expect(v.MrCI).toBe(0);
    expect(v.Nirr).toBe(0);
    expect(v.Xpro).toBe(0);

    // 240 + 40 − (20 + 70 + 30 + 0 + 20 + 0 + 0 + 0) = 140.
    expect(calcul.doseCalculeeKgHa).toBe(140);
    expect(calcul.doseKgHa).toBe(140);
    expect(calcul.regles).toEqual(expect.arrayContaining(['gren-formule-ft2', 'gren-ft2-ri-allier', 'gren-ft2-rf-auvergne', 'gren-objectif-rendement']));
  });

  it('suit le tableau : une valeur changée dans la fiche change la dose (falsification)', () => {
    const regles = reglesAu('2026-02-01', (code, valeur) => {
      if (code !== 'gren-ft2-ri-allier') return valeur;
      for (const l of valeur.lignes as Array<Record<string, unknown>>) {
        if (l.typeSol === 'argilo-calcaire-moyen-a-profond' && l.precedent === 'colza-cereales-betterave') l.valeur = 50;
      }
      return valeur;
    });
    expect(calculerDoseGren(regles, contexteAllier(), saisieBle()).doseKgHa).toBe(160);
  });

  it('ne calcule rien quand un terme manque, et dit lequel', () => {
    const calcul = calculerDoseGren(REGLES_2026, contexteAllier(), saisieBle({ sansObjet: ['Nirr'] }));
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants.map((b) => b.terme)).toEqual([expect.stringContaining('(Mhp)')]);
    expect(calcul.bloquants[0]!.raison).toMatch(/À choisir dans la fiche/);
  });

  it('ne choisit pas le besoin d’une variété à la place de l’exploitant', () => {
    const calcul = calculerDoseGren(REGLES_2026, contexteAllier(), saisieBle({ besoin: undefined }));
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants[0]!.raison).toMatch(/dépend de la variété/);
  });

  it('exige cinq campagnes de rendement, sinon la fiche 20 ou un objectif justifié', () => {
    const quatre = contexteAllier({ rendements: contexteAllier().rendements.slice(1) });
    const sansHistorique = calculerDoseGren(REGLES_2026, quatre, saisieBle());
    expect(sansHistorique.doseKgHa).toBeNull();
    expect(sansHistorique.bloquants[0]!.raison).toMatch(/4 campagne\(s\)/);

    const parDefaut = calculerDoseGren(
      REGLES_2026,
      quatre,
      saisieBle({ objectif: { mode: 'defaut', cultureFiche20: 'ble-tendre-hiver', regimeHydrique: 'pluvial' } }),
    );
    const y = parDefaut.termes.find((t) => t.terme === 'y');
    expect(y?.valeur).toBeGreaterThan(0);
    expect(y?.origine).toMatch(/fiche 20/);
  });

  it('une cellule vide du tableau n’est pas un zéro', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      contexteAllier({ departement: '63' }),
      saisieBle({
        typeSol: 'alluvions',
        choix: { ...saisieBle().choix, Ri: { precedent: 'oignons-ail-echalotes-pdt' } },
      }),
    );
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants.find((b) => b.terme.includes('(Ri)'))?.raison).toMatch(/cellule du tableau est vide/);
  });

  it('un reliquat mesuré prime sur le tableau départemental', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      contexteAllier(),
      saisieBle({ mesures: { Ri: { valeur: 45, justification: 'Reliquat sortie hiver, labo, 12/02/2026' } } }),
    );
    expect(calcul.termes.find((t) => t.terme === 'Ri')?.valeur).toBe(45);
    expect(calcul.doseKgHa).toBe(165);
  });

  it('sans département connu, la sous-région n’est pas devinée', () => {
    const calcul = calculerDoseGren(REGLES_2026, contexteAllier({ departement: null }), saisieBle());
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants[0]!.terme).toBe('territoire');
  });

  it('applique la règle des petites doses : 30 u possibles, aucun apport si le bilan est négatif', () => {
    const petite = calculerDoseGren(
      REGLES_2026,
      contexteAllier(),
      saisieBle({ mesures: { Ri: { valeur: 190, justification: 'mesure' } } }),
    );
    expect(petite.doseCalculeeKgHa).toBe(20);
    expect(petite.doseKgHa).toBe(30);
    expect(petite.regleDose).toMatch(/30 kg N\/ha possibles/);

    const negative = calculerDoseGren(
      REGLES_2026,
      contexteAllier(),
      saisieBle({ mesures: { Ri: { valeur: 250, justification: 'mesure' } } }),
    );
    expect(negative.doseCalculeeKgHa).toBe(-40);
    expect(negative.doseKgHa).toBe(0);
  });
});

describe('Dose prévisionnelle GREN — produits organiques (Xpro, fiche 19)', () => {
  const apport = {
    id: 'a1',
    libelle: 'Fumier',
    date: '2026-03-10',
    quantiteParHa: 20,
    teneurAnalyse: null,
    classement: { keq: 'fumier-herbivores-lapins', teneur: 'fumier-bovins', aplsh: null },
    prevu: true,
  };

  it('quantité × teneur de référence × Kéq du printemps', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      contexteAllier({ apportsOrganiques: [apport] }),
      saisieBle({ groupeCultureKeq: 'culture-hiver-cereales' }),
    );
    const xpro = calcul.termes.find((t) => t.terme === 'Xpro');
    // 20 t × 5,5 kg N/t (fumier bovins, fiche 19) × 0,2 = 22 kg N/ha.
    expect(xpro?.valeur).toBe(22);
    expect(calcul.doseKgHa).toBe(118);
  });

  it('avant le 15/07/2025, la fiche 19 fournie ne s’applique pas : Xpro indéterminé', () => {
    const calcul = calculerDoseGren(
      reglesAu('2025-02-01'),
      contexteAllier({ campagne: 2025, apportsOrganiques: [{ ...apport, date: '2025-03-10' }] }),
      saisieBle({ groupeCultureKeq: 'culture-hiver-cereales' }),
    );
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants.find((b) => b.terme.includes('Xpro'))?.raison).toMatch(/15\/07\/2025/);
  });

  it('un produit sans dénomination Kéq déclarée bloque le calcul', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      contexteAllier({ apportsOrganiques: [{ ...apport, classement: { keq: null, teneur: 'fumier-bovins', aplsh: null } }] }),
      saisieBle({ groupeCultureKeq: 'culture-hiver-cereales' }),
    );
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants.find((b) => b.terme.includes('Xpro'))?.raison).toMatch(/Kéq de la fiche 19 non déclarée/);
  });
});

describe('Dose prévisionnelle GREN — maïs et colza', () => {
  it('maïs en Rhône-Alpes : formule au 1/CAU', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      { campagne: 2026, departement: '38', rendements: [], apportsOrganiques: [], cultureDHiver: false },
      saisieGrenSchema.parse({
        culture: 'mais-sorgho',
        typeSol: 'A2',
        espece: 'mais-grain',
        objectif: { mode: 'declare', valeur: 100, justification: 'moyenne de l’exploitation' },
        choix: { Mr: { precedent: 'autres' } },
        sansObjet: ['Mhp', 'MrCI', 'Mpro', 'Nirr'],
      }),
    );
    expect(calcul.bloquants).toEqual([]);
    expect(calcul.expression).toMatch(/1\/CAU/);
    // Pf = 2,2 × 100 = 220 ; Mh (A2) = 90 ; 1/CAU (90 à 110 q) = 1,5.
    // X = 1,5 × (220 − 90 − 0 − 0 − 0 − 0 − 0) − 0 = 195.
    expect(calcul.doseKgHa).toBe(195);
  });

  it('maïs en Auvergne : Pi ambigu dans la fiche — seul Pi = 0 permet de calculer', () => {
    const saisie = (pi?: number) =>
      saisieGrenSchema.parse({
        culture: 'mais-sorgho',
        typeSol: 'argilo-calcaire-moyen-a-profond',
        espece: 'mais-grain',
        objectif: { mode: 'declare', valeur: 100, justification: 'moyenne' },
        choix: {
          Ri: { precedent: 'colza-cereales-betterave' },
          Mh: { ouverture: 'reliquat-hiver', systeme: 'enfouis-1-sur-2-sans-mo' },
          Mr: { precedent: 'cereales-pailles-enlevees-etc' },
        },
        mesures: pi === undefined ? {} : { Pi: { valeur: pi, justification: 'maïs non semé à l’ouverture' } },
        sansObjet: ['Mhp', 'MrCI', 'Nirr'],
      });
    const ctx: ContexteGren = { campagne: 2026, departement: '03', rendements: [], apportsOrganiques: [], cultureDHiver: false };
    const sansPi = calculerDoseGren(REGLES_2026, ctx, saisie());
    expect(sansPi.doseKgHa).toBeNull();
    expect(sansPi.bloquants.some((b) => b.raison.includes('Pi'))).toBe(true);

    const piNonNul = calculerDoseGren(REGLES_2026, ctx, saisie(10));
    expect(piNonNul.doseKgHa).toBeNull();
    expect(piNonNul.bloquants.some((b) => /pas tranché/.test(b.raison))).toBe(true);

    const piNul = calculerDoseGren(REGLES_2026, ctx, saisie(0));
    if (piNul.bloquants.length > 0) throw new Error(JSON.stringify(piNul.bloquants));
    expect(piNul.doseKgHa).not.toBeNull();
    expect(piNul.avertissements[0]).toMatch(/sans effet/);
  });

  it('colza : Pi par la matière verte, b × y plafonné à 330', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      { campagne: 2026, departement: '03', rendements: [], apportsOrganiques: [], cultureDHiver: true },
      saisieGrenSchema.parse({
        culture: 'colza',
        typeSol: 'terres-noires',
        objectif: { mode: 'declare', valeur: 50, justification: 'moyenne' },
        colza: { mvSortieHiver: 1, mvEntreeHiver: 1.2, precedentPois: false, legumineusesGelives: true },
        sansObjet: ['Mha'],
      }),
    );
    expect(calcul.bloquants).toEqual([]);
    const v = Object.fromEntries(calcul.termes.map((t) => [t.terme, t.valeur]));
    // 7 × 50 = 350, plafonné à 330.
    expect(v.Pf).toBe(330);
    // Nabs SH = 65 ≥ Nabs EH = 60 : Pi = 65.
    expect(v.Pi).toBe(65);
    // Terres noires : catégorie P (profond) de la fiche 20 → Np = 60.
    expect(v.Np).toBe(60);
    expect(v.Fass).toBe(30);
    // X = (330 − (65 + 60)) / 0,8 − (0 + 0 + 0 + 30) = 226,25.
    expect(calcul.doseKgHa).toBe(226.3);
  });

  it('betterave en Rhône-Alpes : les tableaux non transcrits bloquent le calcul', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      { campagne: 2026, departement: '26', rendements: [], apportsOrganiques: [], cultureDHiver: false },
      saisieGrenSchema.parse({ culture: 'betterave-sucriere', typeSol: 'A1', sansObjet: ['Mhp', 'MrCI', 'Nirr'] }),
    );
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants.find((b) => b.terme.includes('(Rf)'))?.raison).toMatch(/Rhône-Alpes/);
    // Le tableau Mh de la fiche 10 ne déclare pas d'ex-région, mais ses types
    // de sol sont ceux de l'Auvergne : il ne vaut pas pour un sol rhônalpin.
    expect(calcul.bloquants.find((b) => b.terme.includes('(Mh)'))?.raison).toMatch(/ne donne pas de tableau Mh pour l’ex-région Rhône-Alpes/);
  });
});

describe('Dose prévisionnelle GREN — cultures au plafond', () => {
  it('tournesol : X ≤ 80 − Nirr − Xpro', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      { campagne: 2026, departement: '03', rendements: [], apportsOrganiques: [], cultureDHiver: false },
      saisieGrenSchema.parse({
        culture: 'tournesol',
        plafond: { option: 'tournesol' },
        irrigation: { volumeMm: 100, nitratesMgL: 44.3 },
      }),
    );
    expect(calcul.methode).toBe('plafond');
    expect(calcul.plafondKgHa).toBe(80);
    // Nirr = 100 × 44,3 / 443 = 10.
    expect(calcul.doseKgHa).toBe(70);
  });

  it('légumes : un antécédent « NC » ne donne pas de plafond', () => {
    const regle = { code: 'gren-plafond-ft12', valeur: REGLES_2026.get('gren-plafond-ft12')!.valeur, trace: null };
    const option = optionsPlafond(regle).find((o) => o.id === 'monoculture:aubergine:pauvre');
    expect(option?.plafond).toBeNull();
    const calcul = calculerDoseGren(
      REGLES_2026,
      { campagne: 2026, departement: '03', rendements: [], apportsOrganiques: [], cultureDHiver: false },
      saisieGrenSchema.parse({ culture: 'legumes', plafond: { option: 'monoculture:aubergine:pauvre' }, sansObjet: ['Nirr'] }),
    );
    expect(calcul.doseKgHa).toBeNull();
    expect(calcul.bloquants[0]!.raison).toMatch(/NC/);
  });

  it('prairies : grille de la fiche 8', () => {
    const calcul = calculerDoseGren(
      REGLES_2026,
      { campagne: 2026, departement: '03', rendements: [], apportsOrganiques: [], cultureDHiver: null },
      saisieGrenSchema.parse({
        culture: 'prairies',
        plafond: { option: 'tableau', choix: { utilisation: 'pature-seule', production: 'moins-5', apportsMO: 'reguliers' } },
        sansObjet: ['Nirr'],
      }),
    );
    expect(calcul.plafondKgHa).toBe(30);
    expect(calcul.doseKgHa).toBe(30);
  });
});

describe('Ce que l’écran demande', () => {
  it('décrit les termes de la formule avec leurs tableaux et leurs options', () => {
    const d = decrireSaisie(REGLES_2026, { departement: '03', cultureDHiver: true }, { culture: 'cereales-paille', espece: 'ble-tendre' });
    expect(d.methode).toBe('bilan');
    expect(d.besoinParVariete).toBe(true);
    expect(d.typesSol.map((t) => t.code)).toContain('terres-noires');
    const ri = d.termes.find((t) => t.terme === 'Ri');
    expect(ri?.tableau?.regle).toBe('gren-ft2-ri-allier');
    expect(ri?.mesurable).toBe(true);
    expect(d.termes.find((t) => t.terme === 'MrCI')?.nulParLaFiche).toMatch(/hiver/);
    expect(d.termes.find((t) => t.terme === 'Mhp')?.coefficient?.regle).toBe('gren-ft2-mhp-coefficient');
  });
});
