import { describe, expect, it } from 'vitest';
import {
  comparerParcelles,
  familleVisuelle,
  libelleParcelle,
  nomCourtDeCulture,
  nomDitLeNumero,
} from '../src/lib/shared/cultures';
import { lignesDEtiquette } from '../src/lib/shared/carte';
import { uniteAffichee } from '../src/lib/shared/unites';

/** L'affichage des cultures et des parcelles, commun au site et à l'application. */
describe('Affichage des cultures', () => {
  it('raccourcit les libellés PAC pour les listes', () => {
    expect(
      nomCourtDeCulture('Prairie permanente - herbe prédominante (ressources fourragères ligneuses absentes ou peu présentes)'),
    ).toBe('Prairie permanente');
    expect(nomCourtDeCulture('Maïs (hors maïs doux)')).toBe('Maïs');
    expect(nomCourtDeCulture('Blé tendre d’hiver')).toBe('Blé tendre d’hiver');
    expect(nomCourtDeCulture('(sans nom)')).toBe('(sans nom)');
    expect(nomCourtDeCulture('  ')).toBeNull();
  });

  it('range chaque culture dans sa famille, la prairie avant le fourrage', () => {
    expect(familleVisuelle('Prairie permanente - herbe prédominante (ressources fourragères…)')).toBe('prairie');
    expect(familleVisuelle('Mélange de légumineuses fourragères prépondérantes et de céréales')).toBe('fourrage');
    expect(familleVisuelle('Triticale d’hiver')).toBe('cereale');
    expect(familleVisuelle('Maïs (hors maïs doux)')).toBe('mais');
    expect(familleVisuelle('Colza d’hiver')).toBe('oleagineux');
    expect(familleVisuelle('Pois de printemps semé avant le 31/05')).toBe('proteagineux');
    expect(familleVisuelle('Surface agricole temporairement non exploitée')).toBe('non-cultive');
    expect(familleVisuelle('Bande tampon')).toBe('non-cultive');
    expect(familleVisuelle('QQQ')).toBe('autre');
  });
});

describe('Affichage des parcelles', () => {
  it('trie dans l’ordre des îlots, pas dans l’ordre alphabétique', () => {
    const tries = ['10-2', '4-26', '4-3', '1-1', '12-1', '4-29']
      .map((n) => ({ internalNumber: n, name: `P ${n}` }))
      .sort(comparerParcelles)
      .map((p) => p.internalNumber);
    expect(tries).toEqual(['1-1', '4-3', '4-26', '4-29', '10-2', '12-1']);
    // Sans numéro : après, par nom, « Îlot 2 » avant « Îlot 10 ».
    const sans = [{ name: 'Îlot 10' }, { name: 'Îlot 2' }, { name: 'A', internalNumber: '9-9' }].sort(comparerParcelles);
    expect(sans.map((p) => p.name)).toEqual(['A', 'Îlot 2', 'Îlot 10']);
  });

  it('ne répète pas le numéro que le nom dit déjà', () => {
    expect(nomDitLeNumero('Îlot 4 — parcelle 3', '4-3')).toBe(true);
    expect(nomDitLeNumero('La Croix Rouge', '4-3')).toBe(false);
    expect(nomDitLeNumero('Îlot 4 — parcelle 3', '5-3')).toBe(false);
    expect(libelleParcelle({ name: 'Îlot 4 — parcelle 3', internalNumber: '4-3' })).toBe('Îlot 4 — parcelle 3');
    expect(libelleParcelle({ name: 'La Croix Rouge', internalNumber: '4-3' })).toBe('4-3 — La Croix Rouge');
    expect(
      lignesDEtiquette({ name: 'Îlot 4 — parcelle 3', internalNumber: '4-3', commune: null, areaHa: 2, cropName: 'Maïs (hors maïs doux)' }),
    ).toEqual(['Îlot 4 — parcelle 3', '2 ha', 'Maïs']);
  });

  it('écrit le litre « L »', () => {
    expect(uniteAffichee('l')).toBe('L');
    expect(uniteAffichee('ml')).toBe('mL');
    expect(uniteAffichee('kg')).toBe('kg');
    expect(uniteAffichee(null)).toBe('');
  });
});
