import { describe, expect, it } from 'vitest';
import { dansUnCalcul, memoise } from '../src/lib/memoire-calcul';
import { cheminsDEauDuContexte, type Proximite } from '../src/lib/regulatory/geography';

/**
 * Les deux raccourcis qui rendent la synthèse de conformité utilisable sur un
 * Raspberry Pi — et les garde-fous qui les empêchent de changer un résultat.
 */
describe('Mémoire d’un calcul', () => {
  it('hors calcul, ne garde rien : chaque appel relit', async () => {
    let lectures = 0;
    const lire = () => memoise('cle', async () => ++lectures);
    await lire();
    await lire();
    expect(lectures).toBe(2);
  });

  it('dans un calcul, une lecture par clé — et rien ne survit au calcul', async () => {
    let lectures = 0;
    const lire = (cle: string) => memoise(cle, async () => ++lectures);
    await dansUnCalcul(async () => {
      expect(await lire('a')).toBe(1);
      expect(await lire('a')).toBe(1);
      expect(await lire('b')).toBe(2);
      // Un calcul imbriqué partage la mémoire de celui qui l'englobe.
      await dansUnCalcul(async () => expect(await lire('a')).toBe(1));
    });
    await dansUnCalcul(async () => expect(await lire('a')).toBe(3));
  });

  it('ne garde pas un échec : l’appel suivant retente', async () => {
    let essais = 0;
    await dansUnCalcul(async () => {
      const lire = () =>
        memoise('fragile', async () => {
          essais += 1;
          if (essais === 1) throw new Error('base indisponible');
          return 'lu';
        });
      await expect(lire()).rejects.toThrow('base indisponible');
      expect(await lire()).toBe('lu');
    });
  });

  it('deux calculs simultanés ne se mélangent pas', async () => {
    const [a, b] = await Promise.all([
      dansUnCalcul(() => memoise('x', async () => 'premier')),
      dansUnCalcul(() => memoise('x', async () => 'second')),
    ]);
    expect([a, b]).toEqual(['premier', 'second']);
  });
});

describe('Cours d’eau proches lus dans le contexte enregistré', () => {
  const element = (distanceM: number, label = `à ${distanceM} m`): Proximite => ({
    kind: 'TRONCON_HYDROGRAPHIQUE',
    code: label,
    label,
    distanceM,
    dedans: distanceM === 0,
    attributes: null,
    referential: { code: 'cours-eau', version: '2026', sourceLabel: 'BD TOPAGE', territory: '84' },
  });
  const contexte = (proximites: Proximite[]) => ({
    parcelId: 'p',
    zones: [],
    proximites,
    unresolved: [],
    referentialVersions: [],
  });

  it('rend les premiers éléments du rayon, dans l’ordre enregistré', () => {
    const c = contexte([element(0, 'a'), element(0, 'b'), element(3.2), element(4.1), element(60)]);
    expect(cheminsDEauDuContexte(c, 5, 3)?.map((p) => p.label)).toEqual(['a', 'b', 'à 3.2 m']);
    expect(cheminsDEauDuContexte(c, 2, 3)?.map((p) => p.label)).toEqual(['a', 'b']);
    expect(cheminsDEauDuContexte(contexte([element(60)]), 5, 3)).toEqual([]);
  });

  it('ignore les points de prélèvement, qui ne sont pas des cours d’eau', () => {
    const puits: Proximite = { ...element(1, 'puits'), kind: 'POINT_PRELEVEMENT' };
    expect(cheminsDEauDuContexte(contexte([puits, element(3)]), 5, 3)?.map((p) => p.label)).toEqual(['à 3 m']);
  });

  it('renvoie à la mesure quand l’arrondi ne dit pas de quel côté de la limite on est', () => {
    // 5,0 m gardé peut valoir 4,96 m comme 5,04 m.
    expect(cheminsDEauDuContexte(contexte([element(5)]), 5, 3)).toBeNull();
    expect(cheminsDEauDuContexte(contexte([element(4.95)]), 5, 3)).toBeNull();
    expect(cheminsDEauDuContexte(contexte([element(4.9)]), 5, 3)).not.toBeNull();
  });

  it('renvoie à la mesure quand la liste gardée est pleine et encore dans le rayon', () => {
    const dix = Array.from({ length: 10 }, (_, i) => element(i * 0.4, `e${i}`));
    expect(cheminsDEauDuContexte(contexte(dix), 5, 3)).toBeNull();
  });

  it('renvoie à la mesure sans contexte, ou au-delà du rayon gardé', () => {
    expect(cheminsDEauDuContexte(null, 5, 3)).toBeNull();
    expect(cheminsDEauDuContexte(contexte([element(1)]), 600, 3)).toBeNull();
    expect(cheminsDEauDuContexte(contexte([element(1)]), Number.NaN, 3)).toBeNull();
  });
});
