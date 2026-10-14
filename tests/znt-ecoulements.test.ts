import { describe, expect, it } from 'vitest';
import { rappelZntEcoulements } from '../src/lib/ephy/limites';

/**
 * Le rappel de ZNT aquatique nourri par la BD TOPAGE : il nomme l'écoulement
 * proche et sa distance, et ne conclut jamais qu'une ZNT s'applique — la
 * désignation des points d'eau est préfectorale, et n'est pas fournie.
 */
const source = 'BD TOPAGE (version 2026)';

describe('ZNT aquatique et écoulements cartographiés', () => {
  it('signale un écoulement à moins de la ZNT, sans en déduire la ZNT', () => {
    const r = rappelZntEcoulements({
      produit: 'PRODUIT ESSAI',
      zntAquaticM: '20.0',
      ecoulements: [
        { label: 'Ruisseau d’essai', nature: 'Ecoulement naturel', distanceM: 12, dedans: false, source },
        { label: 'Fossé lointain', nature: 'Fossé', distanceM: 140, dedans: false, source },
      ],
    });
    expect(r).toContain('ZNT aquatique de 20 m');
    expect(r).toContain('« Ruisseau d’essai » (Ecoulement naturel) à 12 m du contour');
    expect(r).not.toContain('Fossé lointain');
    expect(r).toContain('Si cet écoulement est un point d’eau');
    expect(r).toContain('Parcelys ne sait pas lequel l’est');
  });

  it('ne dit rien quand aucun écoulement n’est à portée, ni quand la ZNT n’est pas un nombre', () => {
    const loin = [{ label: 'Rivière', nature: null, distanceM: 300, dedans: false, source }];
    expect(rappelZntEcoulements({ produit: 'P', zntAquaticM: '5', ecoulements: loin })).toBeNull();
    expect(rappelZntEcoulements({ produit: 'P', zntAquaticM: '5 à 20', ecoulements: [{ ...loin[0]!, distanceM: 1 }] })).toBeNull();
    expect(rappelZntEcoulements({ produit: 'P', zntAquaticM: null, ecoulements: [{ ...loin[0]!, distanceM: 1 }] })).toBeNull();
  });

  it('un écoulement qui traverse la parcelle est toujours cité', () => {
    const r = rappelZntEcoulements({
      produit: 'P',
      zntAquaticM: '5',
      ecoulements: [{ label: 'Bief', nature: null, distanceM: 0, dedans: true, source }],
    });
    expect(r).toContain('« Bief » touche la parcelle');
  });
});
