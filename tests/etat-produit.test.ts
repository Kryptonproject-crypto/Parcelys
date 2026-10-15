import { describe, expect, it } from 'vitest';
import { etatDuProduit } from '../src/lib/shared/produits';
import { chercherHorsLigne, type CatalogueEmbarque } from '../src/lib/ephy/catalogue-local';

/** L'état d'un produit dit en clair, et la recherche hors réseau. */
describe('État d’un produit retiré', () => {
  const ankora = { authorized: false, withdrawnAt: '2025-12-10T00:00:00.000Z', finUtilisation: '2026-12-10T00:00:00.000Z' };

  it('dit jusqu’à quand un produit retiré s’emploie', () => {
    expect(etatDuProduit(ankora, new Date('2026-10-15T12:00:00Z'))).toEqual({
      ton: 'delai',
      libelle: 'Retiré le 10/12/2025 — utilisable jusqu’au 10/12/2026',
    });
    // Le dernier jour compte encore.
    expect(etatDuProduit(ankora, new Date('2026-12-10T12:00:00Z')).ton).toBe('delai');
    expect(etatDuProduit(ankora, new Date('2026-12-11T12:00:00Z'))).toEqual({
      ton: 'interdit',
      libelle: 'Retiré le 10/12/2025 — utilisation interdite depuis le 10/12/2026',
    });
  });

  it('ne promet rien sans fin d’utilisation publiée', () => {
    expect(etatDuProduit({ authorized: false, withdrawnAt: null }).ton).toBe('interdit');
    expect(etatDuProduit({ authorized: true, withdrawnAt: null })).toEqual({ ton: 'autorise', libelle: 'Autorisé' });
  });
});

describe('Recherche hors réseau', () => {
  const usage = (endUsage: string | null) => ({
    id: 'u',
    cropLabel: 'Blé',
    targetLabel: null,
    usageLabel: 'Blé*Désherbage',
    doseValue: '0.6',
    doseUnit: 'L/ha',
    status: 'Retrait',
    preHarvestDelay: null,
    maxApplications: null,
    minIntervalDays: null,
    zntAquaticM: null,
    zntArthropodM: null,
    zntPlantM: null,
    conditions: null,
    endUsage,
  });
  const entree = (amm: string, name: string, endUsage: string | null) => ({
    amm,
    productId: amm,
    name,
    holder: null,
    formulation: null,
    productType: null,
    substances: [],
    status: 'RETIRE',
    authorized: false,
    withdrawnAt: '2025-12-10T00:00:00.000Z',
    usages: [usage(endUsage)],
    crops: ['Blé'],
    drainedSoilRestrictions: [],
  });
  const referential: CatalogueEmbarque = {
    phytoCatalogue: [entree('2230520', 'ANKORA', '2026-12-10T00:00:00.000Z'), entree('2000001', 'ANCIEN', '2020-01-01T00:00:00.000Z')],
  };

  it('propose le retiré encore utilisable, écarte le périmé sauf par son AMM exacte', () => {
    const le = new Date('2026-10-15T12:00:00Z');
    const r = chercherHorsLigne(referential, 'an', false, le);
    expect(r.map((p) => p.name)).toEqual(['ANKORA']);
    expect(r[0]?.finUtilisation).toBe('2026-12-10T00:00:00.000Z');
    expect(chercherHorsLigne(referential, '2000001', false, le).map((p) => p.name)).toEqual(['ANCIEN']);
    expect(chercherHorsLigne(referential, 'an', true, le)).toHaveLength(2);
  });
});
