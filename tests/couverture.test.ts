import { describe, expect, it } from 'vitest';
import { incoherencesDates } from '../src/lib/regulatory/soil-cover';
import { departementDepuisInsee, statutZonage } from '../src/lib/regulatory/geography';

/**
 * Couverture des sols, et territoires.
 *
 * Ce que ces tests protègent : **qu'aucune règle régionale ne soit inventée**.
 * Les périodes de couverture obligatoire relèvent du programme d'actions
 * régional ; les coder en dur donnerait un « conforme » faux, et faux
 * silencieusement.
 *
 * Ne sont donc testées ici que les vérifications qui ne supposent aucun
 * référentiel : la cohérence des dates saisies, et la lecture d'un code INSEE.
 */

describe('Cohérence des dates de couvert', () => {
  it('accepte une chronologie normale', () => {
    expect(
      incoherencesDates({
        sownOn: new Date('2026-08-20'),
        emergedOn: new Date('2026-08-28'),
        destroyedOn: new Date('2026-11-15'),
      }),
    ).toEqual([]);
  });

  it('n’exige pas que les dates soient toutes renseignées', () => {
    // Un couvert semé dont on n'a pas noté la levée reste un couvert semé.
    expect(
      incoherencesDates({ sownOn: new Date('2026-08-20'), emergedOn: null, destroyedOn: null }),
    ).toEqual([]);
    expect(incoherencesDates({ sownOn: null, emergedOn: null, destroyedOn: null })).toEqual([]);
  });

  it('repère une destruction antérieure au semis', () => {
    const problemes = incoherencesDates({
      sownOn: new Date('2026-09-10'),
      emergedOn: null,
      destroyedOn: new Date('2026-08-30'),
    });
    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('antérieure au semis');
  });

  it('repère une levée antérieure au semis', () => {
    const problemes = incoherencesDates({
      sownOn: new Date('2026-09-10'),
      emergedOn: new Date('2026-09-01'),
      destroyedOn: null,
    });
    expect(problemes[0]).toContain('levée');
  });

  it('cumule les incohérences plutôt que de s’arrêter à la première', () => {
    const problemes = incoherencesDates({
      sownOn: new Date('2026-09-10'),
      emergedOn: new Date('2026-09-01'),
      destroyedOn: new Date('2026-08-25'),
    });
    expect(problemes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Statut d’un zonage : trois états, jamais deux', () => {
  const zoneVulnerable = {
    kind: 'ZONE_VULNERABLE' as const,
    code: null,
    label: 'Zone vulnérable',
    areaHa: 8,
    ratio: 1,
    coverage: 'totale' as const,
    referential: {
      code: 'zones-vulnerables',
      version: '2024-07',
      sourceLabel: 'DREAL',
      territory: '45',
    },
  };

  it('dit « dedans » quand la parcelle recoupe la zone', () => {
    expect(
      statutZonage(
        { parcelId: 'p', zones: [zoneVulnerable], unresolved: [], referentialVersions: [] },
        'ZONE_VULNERABLE',
      ),
    ).toBe('dedans');
  });

  it('dit « dehors » seulement quand le zonage a vraiment été déterminé', () => {
    expect(
      statutZonage(
        { parcelId: 'p', zones: [], unresolved: [], referentialVersions: [] },
        'ZONE_VULNERABLE',
      ),
    ).toBe('dehors');
  });

  it('dit « indéterminé » quand le référentiel n’est pas importé', () => {
    // Le piège d'origine : `zones.some(...)` rendait `false` ici, ce qui se
    // lisait « pas en zone vulnérable ». Une contrainte qui s'applique
    // peut-être disparaissait alors de l'écran, sans un mot.
    expect(
      statutZonage(
        {
          parcelId: 'p',
          zones: [],
          unresolved: [
            {
              what: 'Zone vulnérable aux nitrates',
              reason: 'Le référentiel « zones-vulnerables » n’a pas été importé.',
              remedy: 'Importez-le.',
            },
          ],
          referentialVersions: [],
        },
        'ZONE_VULNERABLE',
      ),
    ).toBe('indetermine');
  });

  it('dit « indéterminé » quand la parcelle n’a pas de contour', () => {
    expect(
      statutZonage(
        {
          parcelId: 'p',
          zones: [],
          unresolved: [
            {
              what: 'Contexte réglementaire',
              reason: 'La parcelle n’a pas de contour tracé.',
              remedy: 'Tracez le contour.',
            },
          ],
          referentialVersions: [],
        },
        'ZONE_VULNERABLE',
      ),
    ).toBe('indetermine');
  });

  it('dit « indéterminé » quand il n’y a aucun contexte', () => {
    expect(statutZonage(null, 'ZONE_VULNERABLE')).toBe('indetermine');
  });
});

describe('Département depuis un code INSEE', () => {
  it('lit un département métropolitain', () => {
    expect(departementDepuisInsee('45010')).toBe('45');
    expect(departementDepuisInsee('69123')).toBe('69');
  });

  it('lit trois chiffres en outre-mer', () => {
    // Deux caractères donneraient « 97 » pour toute l'outre-mer, et feraient
    // chercher un programme d'actions dans un département inexistant.
    expect(departementDepuisInsee('97123')).toBe('971');
    expect(departementDepuisInsee('97411')).toBe('974');
  });

  it('lit la Corse, dont le code porte une lettre', () => {
    expect(departementDepuisInsee('2A004')).toBe('2A');
    expect(departementDepuisInsee('2b033')).toBe('2B');
  });

  it('refuse ce qui n’est pas un code INSEE plutôt que d’en tirer quelque chose', () => {
    expect(departementDepuisInsee(null)).toBeNull();
    expect(departementDepuisInsee('')).toBeNull();
    expect(departementDepuisInsee('45')).toBeNull();
    expect(departementDepuisInsee('Artenay')).toBeNull();
    expect(departementDepuisInsee('450100')).toBeNull();
  });
});
