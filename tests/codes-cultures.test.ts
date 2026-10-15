import { describe, expect, it } from 'vitest';
import { libelleCulturePac, nomCulturePac, SOURCE_CODES_CULTURES } from '../src/lib/pac/codes-cultures';
import { cultureReglementaire } from '../src/lib/regulatory/culture-reglementaire';

/**
 * Les codes cultures TéléPAC, traduits par la nomenclature et non de mémoire.
 */
describe('Nomenclature des cultures PAC', () => {
  it('traduit les codes d’une déclaration courante', () => {
    expect(libelleCulturePac('BTH')).toBe('Blé tendre d’hiver');
    expect(libelleCulturePac('PTR')).toBe('Autre prairie temporaire de 5 ans ou moins');
    expect(libelleCulturePac('SNE')).toBe('Surface agricole temporairement non exploitée');
    expect(libelleCulturePac('BTA')).toBe('Bande tampon');
    // Saisie en minuscules, espaces autour : le même code.
    expect(libelleCulturePac(' mis ')).toBe('Maïs (hors maïs doux)');
  });

  it('ne traduit pas un code qu’elle ne connaît pas', () => {
    expect(libelleCulturePac('QQQ')).toBeNull();
    expect(libelleCulturePac('')).toBeNull();
    expect(libelleCulturePac(null)).toBeNull();
    expect(nomCulturePac('QQQ')).toBe('QQQ');
    expect(nomCulturePac(null)).toBeNull();
  });

  it('dit d’où vient la traduction', () => {
    expect(SOURCE_CODES_CULTURES).toContain('Agence Bio');
    expect(SOURCE_CODES_CULTURES).toContain('2.7.0');
  });
});

describe('Culture reconnue par les règles', () => {
  it('reconnaît un blé d’hiver sous son nom comme sous son code', () => {
    expect(cultureReglementaire({ nom: 'Blé tendre d’hiver' })).toMatchObject({ famille: 'cereale-paille', saison: 'hiver' });
    const parCode = cultureReglementaire({ nom: 'BTH' });
    expect(parCode).toMatchObject({ famille: 'cereale-paille', saison: 'hiver' });
    expect(parCode.preuve).toContain('BTH (Blé tendre d’hiver)');
  });

  it('reconnaît maïs, colza et prairies déclarés', () => {
    expect(cultureReglementaire({ nom: 'MIS' }).famille).toBe('mais');
    expect(cultureReglementaire({ nom: 'CZH' })).toMatchObject({ famille: 'colza', saison: 'hiver' });
    expect(cultureReglementaire({ nom: 'PPH' }).famille).toBe('prairie');
    expect(cultureReglementaire({ nom: 'PTR' }).famille).toBe('prairie');
  });

  it('ne fait pas d’un mélange légumineuses-céréales une céréale à paille', () => {
    expect(cultureReglementaire({ nom: 'MLC' }).famille).toBeNull();
    expect(cultureReglementaire({ nom: 'QQQ' }).famille).toBeNull();
  });
});
