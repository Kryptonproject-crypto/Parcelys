import { describe, expect, it } from 'vitest';
import {
  computeNutrientBalance,
  computeNutrients,
  computeTotalQuantity,
} from '../src/lib/services/fertilization';
import { geodesicAreaM2, m2ToHectares, approximateCentroid } from '../src/lib/geo/area';
import { closeRings, toMultiPolygon } from '../src/lib/geo/types';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';
import { generateNumericCode, generateToken, hashToken, safeEqual } from '../src/lib/auth/tokens';
import {
  decodeCsv,
  parseCsv,
  parseFrenchDate,
  pick,
  resolveColumns,
  splitSubstances,
} from '../src/lib/ephy/parser';
import {
  normalizeHeader,
  normalizeSearchTerm,
  splitUsageLabel,
  PRODUCT_COLUMNS,
  USAGE_COLUMNS,
} from '../src/lib/ephy/schema';
import { currentCampaignYear } from '../src/lib/constants/agronomy';
import { registerSchema, passwordSchema, siretSchema } from '../src/lib/validation/auth';
import { compareVersions } from '../src/lib/updates/releases';

// ---------------------------------------------------------------------------
describe('Calculs de fertilisation', () => {
  it('multiplie la dose par la surface et déduit l’unité totale', () => {
    expect(computeTotalQuantity(180, 'kg/ha', 12.5)).toEqual({
      totalQuantity: 2250,
      totalUnit: 'kg',
    });
    expect(computeTotalQuantity(25, 't/ha', 4.2)).toEqual({
      totalQuantity: 105,
      totalUnit: 't',
    });
    expect(computeTotalQuantity(30, 'm3/ha', 3.5)).toEqual({
      totalQuantity: 105,
      totalUnit: 'm3',
    });
    expect(computeTotalQuantity(1.5, 'L/ha', 8.3333)).toEqual({
      totalQuantity: 12.5,
      totalUnit: 'L',
    });
  });

  it('calcule les éléments d’un engrais minéral à partir de sa teneur', () => {
    // 200 kg/ha d'ammonitrate 33,5 % → 67 kg N/ha
    expect(
      computeNutrients({ dose: 200, doseUnit: 'kg/ha', mineral: { nPercent: 33.5 } }),
    ).toEqual({ nSupplied: 67, pSupplied: null, kSupplied: null });

    // NPK 15-15-15 à 300 kg/ha → 45 de chaque
    expect(
      computeNutrients({
        dose: 300,
        doseUnit: 'kg/ha',
        mineral: { nPercent: 15, pPercent: 15, kPercent: 15 },
      }),
    ).toEqual({ nSupplied: 45, pSupplied: 45, kSupplied: 45 });
  });

  it('convertit les grammes en kilogrammes pour les micro-doses', () => {
    // 2000 g/ha à 10 % → 2 kg/ha × 10 % = 0,2 kg N/ha
    expect(
      computeNutrients({ dose: 2000, doseUnit: 'g/ha', mineral: { nPercent: 10 } }),
    ).toEqual({ nSupplied: 0.2, pSupplied: null, kSupplied: null });
  });

  it('applique les teneurs organiques en kg par tonne', () => {
    // 25 t/ha de fumier à 4,5 kg N/t → 112,5 kg N/ha
    expect(
      computeNutrients({
        dose: 25,
        doseUnit: 't/ha',
        organic: { nContent: 4.5, pContent: 2.5, kContent: 6 },
      }),
    ).toEqual({ nSupplied: 112.5, pSupplied: 62.5, kSupplied: 150 });
  });

  it('n’estime jamais une teneur inconnue', () => {
    expect(computeNutrients({ dose: 100, doseUnit: 'kg/ha' })).toEqual({
      nSupplied: null,
      pSupplied: null,
      kSupplied: null,
    });

    expect(
      computeNutrients({ dose: 100, doseUnit: 'kg/ha', mineral: { nPercent: 20 } }),
    ).toMatchObject({ pSupplied: null, kSupplied: null });
  });

  it('pondère le bilan NPK par les surfaces traitées', () => {
    const balance = computeNutrientBalance([
      { treatedAreaHa: 10, nSupplied: 60, pSupplied: 30, kSupplied: 40 },
      { treatedAreaHa: 5, nSupplied: 30, pSupplied: 15, kSupplied: 20 },
    ]);

    // (60 × 10) + (30 × 5) = 750 kg N sur 15 ha → 50 kg N/ha
    expect(balance.totalN).toBe(750);
    expect(balance.perHectareN).toBe(50);
    expect(balance.areaHa).toBe(15);
    expect(balance.incompleteCount).toBe(0);
  });

  it('compte les apports sans teneur connue sans fausser le total', () => {
    const balance = computeNutrientBalance([
      { treatedAreaHa: 10, nSupplied: 60 },
      { treatedAreaHa: 10, nSupplied: null },
    ]);

    expect(balance.totalN).toBe(600);
    expect(balance.incompleteCount).toBe(1);
    // La moyenne tient compte des 20 ha : elle est bien sous-estimée, ce que
    // l'interface signale à l'utilisateur.
    expect(balance.perHectareN).toBe(30);
  });

  it('gère une liste vide sans division par zéro', () => {
    const balance = computeNutrientBalance([]);
    expect(balance).toMatchObject({ totalN: 0, perHectareN: 0, areaHa: 0 });
  });

  it('accepte les Decimal sérialisés en chaîne', () => {
    const balance = computeNutrientBalance([
      { treatedAreaHa: '12.5000', nSupplied: '67.00' },
    ]);
    expect(balance.totalN).toBe(837.5);
  });
});

// ---------------------------------------------------------------------------
describe('Géométrie', () => {
  it('calcule une aire géodésique cohérente avec les dimensions réelles', () => {
    // À 48° N, 0,01° de longitude ≈ 744 m et 0,006° de latitude ≈ 667 m.
    const geometry = toMultiPolygon({
      type: 'Polygon',
      coordinates: [
        [
          [1.88, 48.08],
          [1.89, 48.08],
          [1.89, 48.086],
          [1.88, 48.086],
          [1.88, 48.08],
        ],
      ],
    });

    const hectares = m2ToHectares(geodesicAreaM2(geometry));
    expect(hectares).toBeGreaterThan(45);
    expect(hectares).toBeLessThan(55);
  });

  it('soustrait les trous du polygone', () => {
    const outer: Array<[number, number]> = [
      [0, 0],
      [0.02, 0],
      [0.02, 0.02],
      [0, 0.02],
      [0, 0],
    ];
    const hole: Array<[number, number]> = [
      [0.005, 0.005],
      [0.015, 0.005],
      [0.015, 0.015],
      [0.005, 0.015],
      [0.005, 0.005],
    ];

    const withoutHole = geodesicAreaM2({ type: 'MultiPolygon', coordinates: [[outer]] });
    const withHole = geodesicAreaM2({
      type: 'MultiPolygon',
      coordinates: [[outer, hole]],
    });

    expect(withHole).toBeLessThan(withoutHole);
    // Le trou occupe (0,01)² sur (0,02)², soit un quart de la surface.
    expect(withHole / withoutHole).toBeCloseTo(0.75, 2);
  });

  it('normalise un Polygon en MultiPolygon', () => {
    const result = toMultiPolygon({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    expect(result.type).toBe('MultiPolygon');
    expect(result.coordinates).toHaveLength(1);
  });

  it('ferme un anneau laissé ouvert par le dessin', () => {
    const closed = closeRings({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [1, 1],
            [2, 1],
            [2, 2],
          ],
        ],
      ],
    });

    const ring = closed.coordinates[0]?.[0];
    expect(ring).toHaveLength(4);
    expect(ring?.[0]).toEqual(ring?.[3]);
  });

  it('n’ajoute pas de point à un anneau déjà fermé', () => {
    const ring: Array<[number, number]> = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 1],
    ];
    const closed = closeRings({ type: 'MultiPolygon', coordinates: [[ring]] });
    expect(closed.coordinates[0]?.[0]).toHaveLength(4);
  });

  it('calcule un centroïde approximatif', () => {
    const centroid = approximateCentroid({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
          ],
        ],
      ],
    });
    expect(centroid?.lng).toBeCloseTo(1, 5);
    expect(centroid?.lat).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
describe('Mots de passe et jetons', () => {
  it('produit une empreinte vérifiable et jamais réversible', async () => {
    const hash = await hashPassword('MotDePasseSolide1');
    expect(hash).not.toContain('MotDePasseSolide1');
    expect(await verifyPassword('MotDePasseSolide1', hash)).toBe(true);
    expect(await verifyPassword('MauvaisMotDePasse1', hash)).toBe(false);
  });

  it('produit une empreinte différente à chaque hachage (sel aléatoire)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('MemeMotDePasse1'),
      hashPassword('MemeMotDePasse1'),
    ]);
    expect(first).not.toBe(second);
    expect(await verifyPassword('MemeMotDePasse1', second)).toBe(true);
  });

  it('rejette une empreinte corrompue sans lever d’exception', async () => {
    expect(await verifyPassword('MotDePasse1', 'pas-une-empreinte')).toBe(false);
    expect(await verifyPassword('MotDePasse1', '')).toBe(false);
  });

  it('génère des jetons uniques et non devinables', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken(32)));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('génère des codes numériques à 6 chiffres', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
    }
  });

  it('hache les jetons de façon déterministe', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compare deux empreintes à temps constant', () => {
    expect(safeEqual('abcdef', 'abcdef')).toBe(true);
    expect(safeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Validation', () => {
  it('impose une politique de mot de passe', () => {
    expect(passwordSchema.safeParse('court1A').success).toBe(false);
    expect(passwordSchema.safeParse('minusculesseules').success).toBe(false);
    expect(passwordSchema.safeParse('MAJUSCULESSEULES1').success).toBe(false);
    expect(passwordSchema.safeParse('SansChiffreIci').success).toBe(false);
    expect(passwordSchema.safeParse('MotDePasse1').success).toBe(true);
  });

  it('accepte un SIRET à 14 chiffres et un SIREN à 9', () => {
    expect(siretSchema.safeParse('12345678901234').success).toBe(true);
    expect(siretSchema.safeParse('123 456 789 01234').success).toBe(true);
    expect(siretSchema.safeParse('123456789').success).toBe(true);
    expect(siretSchema.safeParse('12345').success).toBe(false);
    expect(siretSchema.safeParse('ABCDEFGHIJKLMN').success).toBe(false);
  });

  it('exige l’acceptation des deux consentements à l’inscription', () => {
    const base = {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@ferme.test',
      password: 'MotDePasse1',
      passwordConfirmation: 'MotDePasse1',
      farmName: 'Ferme',
      acceptTerms: true,
      acceptPrivacy: true,
    };

    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, acceptPrivacy: false }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Campagne culturale', () => {
  it('bascule au 1er août', () => {
    expect(currentCampaignYear(new Date('2026-07-31T12:00:00Z'))).toBe(2026);
    expect(currentCampaignYear(new Date('2026-08-01T12:00:00Z'))).toBe(2027);
    expect(currentCampaignYear(new Date('2026-01-15T12:00:00Z'))).toBe(2026);
    expect(currentCampaignYear(new Date('2026-12-20T12:00:00Z'))).toBe(2027);
  });
});

// ---------------------------------------------------------------------------
describe('Import E-Phy', () => {
  it('normalise les intitulés de colonnes', () => {
    expect(normalizeHeader('Numéro AMM')).toBe('numero amm');
    expect(normalizeHeader("État d'autorisation")).toBe('etat d autorisation');
    expect(normalizeHeader('  Nom  produit  ')).toBe('nom produit');
  });

  it('associe les colonnes du fichier produits malgré les variations d’intitulé', () => {
    const { resolved, missing } = resolveColumns(
      ['Numéro AMM', 'nom produit', 'Titulaire', "Etat d'autorisation", 'Substances actives'],
      PRODUCT_COLUMNS,
    );

    expect(resolved.amm).toBe('Numéro AMM');
    expect(resolved.name).toBe('nom produit');
    expect(resolved.holder).toBe('Titulaire');
    expect(resolved.status).toBe("Etat d'autorisation");
    expect(resolved.substances).toBe('Substances actives');
    // Les colonnes absentes sont signalées, pas devinées.
    expect(missing).toContain('formulation');
    expect(resolved.formulation).toBeNull();
  });

  it('associe les colonnes du fichier usages', () => {
    const { resolved } = resolveColumns(
      [
        'numero AMM',
        'identifiant usage lib court',
        'dose retenue',
        'dose retenue unite',
        'delai avant recolte jour',
        'condition emploi',
      ],
      USAGE_COLUMNS,
    );

    expect(resolved.amm).toBe('numero AMM');
    expect(resolved.usageLabel).toBe('identifiant usage lib court');
    expect(resolved.dose).toBe('dose retenue');
    expect(resolved.doseUnit).toBe('dose retenue unite');
    expect(resolved.preHarvestDelay).toBe('delai avant recolte jour');
  });

  it('lit un CSV à séparateur point-virgule', () => {
    const csv = 'numero AMM;nom produit;titulaire\n2020024;PRODUIT TEST;SOCIÉTÉ X\n';
    const rows = parseCsv(Buffer.from(csv, 'utf8'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['numero AMM']).toBe('2020024');
    expect(rows[0]?.['nom produit']).toBe('PRODUIT TEST');
  });

  it('décode le Windows-1252 des exports officiels', () => {
    // « Société » en Windows-1252 : le « é » vaut 0xE9.
    const bytes = Buffer.from([0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9]);
    expect(decodeCsv(bytes)).toBe('Société');
  });

  it('décode l’UTF-8 avec BOM', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Société', 'utf8'),
    ]);
    expect(decodeCsv(bytes)).toBe('Société');
  });

  it('extrait une valeur uniquement si la colonne existe', () => {
    const row = { 'nom produit': 'TEST', vide: '   ' };
    const resolved = { name: 'nom produit', holder: null, empty: 'vide' };

    expect(pick(row, resolved, 'name')).toBe('TEST');
    expect(pick(row, resolved, 'holder')).toBeUndefined();
    // Une cellule vide n'est pas une valeur.
    expect(pick(row, resolved, 'empty')).toBeUndefined();
  });

  it('convertit les dates françaises et ISO', () => {
    expect(parseFrenchDate('15/03/2024')?.toISOString().slice(0, 10)).toBe('2024-03-15');
    expect(parseFrenchDate('2024-03-15')?.toISOString().slice(0, 10)).toBe('2024-03-15');
    expect(parseFrenchDate('')).toBeNull();
    expect(parseFrenchDate(undefined)).toBeNull();
    expect(parseFrenchDate('pas une date')).toBeNull();
  });

  it('découpe une liste de substances actives', () => {
    expect(splitSubstances('glyphosate | 2,4-D')).toEqual(['glyphosate', '2,4-D']);
    expect(splitSubstances('soufre')).toEqual(['soufre']);
    expect(splitSubstances('cuivre (sous forme d’hydroxyde)')).toEqual(['cuivre']);
    expect(splitSubstances(undefined)).toEqual([]);
    expect(splitSubstances('')).toEqual([]);
  });

  it('découpe un libellé d’usage E-Phy sans le reformuler', () => {
    expect(splitUsageLabel('Blé*Trt Part.Aer.*Oïdium')).toEqual({
      crop: 'Blé',
      target: 'Oïdium',
    });
    expect(splitUsageLabel('Vigne')).toEqual({ crop: 'Vigne', target: null });
    expect(splitUsageLabel(undefined)).toEqual({ crop: null, target: null });
  });

  it('normalise les termes de recherche sans accent ni casse', () => {
    expect(normalizeSearchTerm('Roundup')).toBe('roundup');
    expect(normalizeSearchTerm('DÉSHERBANT  Blé')).toBe('desherbant ble');
  });
});

describe('Comparaison de versions', () => {
  it('classe les versions sémantiques', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.9', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('ignore le « v » des étiquettes Git', () => {
    expect(compareVersions('v1.3.0', '1.2.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.0', 'v1.2.0')).toBe(0);
  });

  it('place une pré-publication avant la version finale', () => {
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.2.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0-rc.2', '1.2.0-rc.1')).toBeGreaterThan(0);
  });

  it('compare des numéros de longueur différente', () => {
    // « 1.2 » vaut « 1.2.0 » : une publication ne doit pas paraître plus
    // récente parce qu'elle a été étiquetée sans le correctif.
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });
});
