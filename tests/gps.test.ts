import { describe, expect, it } from 'vitest';
import { LisseurGps, ecartMetres, evaluerReleve, type Releve } from '../src/lib/shared/gps';

/**
 * Précision du GPS au champ (`src/lib/shared/gps.ts`).
 *
 * Les erreurs de position sont tirées d'un générateur pseudo-aléatoire à
 * graine fixe : les tests rendent toujours le même résultat, et l'on compare
 * l'erreur du point lissé à celle des points bruts sur les mêmes tirages.
 */

const ORIGINE = { lat: 46.34, lng: 3.29 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((ORIGINE.lat * Math.PI) / 180));

/** Générateur à graine (mulberry32). */
function hasard(graine: number): () => number {
  let a = graine;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bruit gaussien (Box-Muller), en mètres. */
function gauss(r: () => number, sigma: number): number {
  return sigma * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

function point(est: number, nord: number, extra: Partial<Releve> = {}): Releve {
  return { lat: ORIGINE.lat + nord * M_LAT, lng: ORIGINE.lng + est * M_LNG, ...extra };
}

const moyenne = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('LisseurGps — suivi continu', () => {
  it('immobile, garde le point bleu bien plus près de la vérité que les points bruts', () => {
    const r = hasard(7);
    const lisseur = new LisseurGps();
    const brut: number[] = [];
    const lisse: number[] = [];
    for (let s = 0; s < 60; s++) {
      const mesure = point(gauss(r, 5), gauss(r, 5), { accuracy: 6, timestamp: s * 1000, speed: 0 });
      const sortie = lisseur.ajouter(mesure);
      if (s >= 10) {
        brut.push(ecartMetres(mesure, ORIGINE));
        lisse.push(ecartMetres(sortie, ORIGINE));
      }
    }
    expect(moyenne(lisse)).toBeLessThan(moyenne(brut) / 2);
  });

  it('en marchant, suit sans traîner : moins d’erreur que le brut, retard borné', () => {
    const r = hasard(11);
    const lisseur = new LisseurGps();
    const brut: number[] = [];
    const lisse: number[] = [];
    for (let s = 0; s < 120; s++) {
      const vrai = point(1.4 * s, 0);
      const mesure = point(1.4 * s + gauss(r, 4), gauss(r, 4), {
        accuracy: 5,
        timestamp: s * 1000,
        speed: 1.4,
      });
      const sortie = lisseur.ajouter(mesure);
      if (s >= 10) {
        brut.push(ecartMetres(mesure, vrai));
        lisse.push(ecartMetres(sortie, vrai));
      }
    }
    expect(moyenne(lisse)).toBeLessThan(moyenne(brut));
    expect(Math.max(...lisse)).toBeLessThan(10);
  });

  it('fait peu de cas d’un point isolé très imprécis', () => {
    const lisseur = new LisseurGps();
    for (let s = 0; s < 10; s++) lisseur.ajouter(point(0, 0, { accuracy: 4, timestamp: s * 1000, speed: 0 }));
    const sortie = lisseur.ajouter(point(60, 0, { accuracy: 60, timestamp: 10_000, speed: 0 }));
    expect(ecartMetres(sortie, ORIGINE)).toBeLessThan(5);
  });

  it('saute franchement quand un point précis tombe loin (sortie d’un hangar)', () => {
    const lisseur = new LisseurGps();
    for (let s = 0; s < 10; s++) lisseur.ajouter(point(0, 0, { accuracy: 40, timestamp: s * 1000, speed: 0 }));
    for (let s = 0; s < 10; s++) lisseur.ajouter(point(0, 0, { accuracy: 3, timestamp: 10_000 + s * 1000, speed: 0 }));
    const sortie = lisseur.ajouter(point(300, 0, { accuracy: 3, timestamp: 21_000, speed: 0 }));
    expect(ecartMetres(sortie, point(300, 0))).toBeLessThan(1);
  });

  it('rend la précision annoncée par le récepteur, sans l’embellir', () => {
    const lisseur = new LisseurGps();
    for (let s = 0; s < 20; s++) {
      const sortie = lisseur.ajouter(point(0, 0, { accuracy: 7, timestamp: s * 1000 }));
      expect(sortie.accuracy).toBe(7);
    }
  });
});

describe('evaluerReleve — relevé ponctuel', () => {
  it('rien reçu : pas de résultat', () => {
    expect(evaluerReleve([], { precisionVisee: 10, releves: 3 })).toBeNull();
  });

  it('écarte le premier point du réseau, imprécis, au profit des points satellites', () => {
    const points = [
      point(35, 10, { accuracy: 40 }),
      point(1, -1, { accuracy: 4 }),
      point(-1, 1, { accuracy: 5 }),
      point(0.5, 0, { accuracy: 4 }),
    ];
    const r = evaluerReleve(points, { precisionVisee: 5, releves: 3 });
    expect(r?.retenus).toBe(3);
    expect(r?.atteint).toBe(true);
    expect(ecartMetres(r!.position, ORIGINE)).toBeLessThan(1);
  });

  it('n’annonce pas atteint tant que la précision visée ou le nombre de points manquent', () => {
    expect(evaluerReleve([point(0, 0, { accuracy: 12 }), point(0, 0, { accuracy: 12 }), point(0, 0, { accuracy: 12 })], { precisionVisee: 10, releves: 3 })?.atteint).toBe(false);
    expect(evaluerReleve([point(0, 0, { accuracy: 4 }), point(0, 0, { accuracy: 4 })], { precisionVisee: 10, releves: 3 })?.atteint).toBe(false);
  });

  it('annonce la meilleure précision reçue, pas une précision divisée par la moyenne', () => {
    const r = evaluerReleve(
      [point(0, 0, { accuracy: 6 }), point(1, 0, { accuracy: 6 }), point(0, 1, { accuracy: 6 }), point(1, 1, { accuracy: 6 })],
      { precisionVisee: 10, releves: 3 },
    );
    expect(r?.precision).toBe(6);
    expect(r?.position.accuracy).toBe(6);
  });

  it('moyenne mieux qu’un point seul sur des tirages bruités', () => {
    const r = hasard(3);
    let erreurSeul = 0;
    let erreurMoyenne = 0;
    for (let essai = 0; essai < 200; essai++) {
      const points = Array.from({ length: 5 }, () => point(gauss(r, 4), gauss(r, 4), { accuracy: 4 }));
      erreurSeul += ecartMetres(points[0]!, ORIGINE);
      erreurMoyenne += ecartMetres(evaluerReleve(points, { precisionVisee: 5, releves: 5 })!.position, ORIGINE);
    }
    expect(erreurMoyenne).toBeLessThan(erreurSeul * 0.6);
  });
});

describe('Réglages du suivi sur Android', () => {
  /**
   * Le greffon Android fait de `timeout` l'intervalle du suivi continu : à
   * 20 000 ms, le point bleu ne bougeait que toutes les vingt secondes. Ce
   * test relit le fichier pour qu'une valeur longue ne revienne pas sans bruit
   * — le code natif, lui, n'est pas exécutable ici.
   */
  it('demande une position par seconde au suivi natif', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../mobile/src/lib/geolocation.ts', import.meta.url), 'utf8');
    const natif = /const OPTIONS_SUIVI = NATIF\s*\?\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const valeur = (cle: string) => Number(new RegExp(`${cle}:\\s*([\\d_]+)`).exec(natif)?.[1]?.replace(/_/g, ''));
    expect(valeur('timeout')).toBeLessThanOrEqual(1_000);
    expect(valeur('minimumUpdateInterval')).toBeLessThanOrEqual(1_000);
    expect(natif).toMatch(/enableHighAccuracy:\s*true/);
  });
});
