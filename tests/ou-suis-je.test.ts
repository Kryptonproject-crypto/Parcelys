import { describe, expect, it } from 'vitest';
import { dansLaParcelle } from '../src/lib/shared/geometrie';

/**
 * « Dans quelle parcelle suis-je ? »
 *
 * Ce que ces tests protègent : **la réponse doit être juste ou absente, jamais
 * approchée**. Ouvrir « la parcelle la plus proche » quand on roule sur la
 * route qui la borde ferait saisir un traitement sur la mauvaise parcelle — et
 * un registre phytosanitaire faux est pire qu'un registre incomplet.
 *
 * Le calcul se fait dans le téléphone, à partir des géométries en cache :
 * c'est au champ, souvent sans réseau, que la question se pose.
 */

/** Un carré de `cote` degrés dont le coin sud-ouest est en (lng, lat). */
function carre(lng: number, lat: number, cote: number): Array<[number, number]> {
  return [
    [lng, lat],
    [lng + cote, lat],
    [lng + cote, lat + cote],
    [lng, lat + cote],
    [lng, lat],
  ];
}

const PARCELLE = {
  type: 'MultiPolygon',
  coordinates: [[carre(3.0, 46.0, 0.01)]],
};

describe('Où suis-je', () => {
  it('reconnaît un point au milieu de la parcelle', () => {
    expect(dansLaParcelle({ lng: 3.005, lat: 46.005 }, PARCELLE)).toBe(true);
  });

  it('refuse un point juste à côté', () => {
    // 0,001° ≈ 80 m : la largeur d'un chemin d'exploitation.
    expect(dansLaParcelle({ lng: 3.011, lat: 46.005 }, PARCELLE)).toBe(false);
    expect(dansLaParcelle({ lng: 3.005, lat: 45.999 }, PARCELLE)).toBe(false);
  });

  it('ne compte pas le trou comme la parcelle', () => {
    // Une mare, un bosquet : on est dans le contour, pas dans la parcelle.
    const trouee = {
      type: 'MultiPolygon',
      coordinates: [[carre(3.0, 46.0, 0.01), carre(3.004, 46.004, 0.002)]],
    };
    expect(dansLaParcelle({ lng: 3.005, lat: 46.005 }, trouee)).toBe(false);
    // Et juste à côté du trou, on y est bien.
    expect(dansLaParcelle({ lng: 3.008, lat: 46.008 }, trouee)).toBe(true);
  });

  it('gère une parcelle en plusieurs morceaux', () => {
    const deuxMorceaux = {
      type: 'MultiPolygon',
      coordinates: [[carre(3.0, 46.0, 0.005)], [carre(3.02, 46.0, 0.005)]],
    };
    expect(dansLaParcelle({ lng: 3.002, lat: 46.002 }, deuxMorceaux)).toBe(true);
    expect(dansLaParcelle({ lng: 3.022, lat: 46.002 }, deuxMorceaux)).toBe(true);
    // Entre les deux morceaux : nulle part.
    expect(dansLaParcelle({ lng: 3.012, lat: 46.002 }, deuxMorceaux)).toBe(false);
  });

  it('accepte aussi un Polygon simple', () => {
    expect(
      dansLaParcelle({ lng: 3.005, lat: 46.005 }, {
        type: 'Polygon',
        coordinates: [carre(3.0, 46.0, 0.01)],
      }),
    ).toBe(true);
  });

  it('répond « non » plutôt que de planter sur une géométrie absente', () => {
    // Une parcelle sans contour dessiné : on ne peut rien dire, et « non » est
    // la seule réponse qui ne trompe personne.
    expect(dansLaParcelle({ lng: 3, lat: 46 }, null)).toBe(false);
    expect(
      dansLaParcelle({ lng: 3, lat: 46 }, { type: 'MultiPolygon', coordinates: [] }),
    ).toBe(false);
  });
});
