import { describe, expect, it } from 'vitest';
import {
  rappelDangersRiverains,
  rappelZnt,
  rappelZntEcoulements,
  zntAquatiqueApplicable,
} from '../src/lib/ephy/limites';

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

describe('ZNT aquatique applicable à un usage', () => {
  const sans = { zntAquaticM: null, conditions: [], culturesDuProduit: ['Blé*Désherbage'] };

  it('prend la valeur de l’usage quand le catalogue en donne une', () => {
    expect(zntAquatiqueApplicable({ ...sans, zntAquaticM: '20.0' })).toEqual({ origine: 'usage', metres: 20, ecrit: '20.0' });
  });

  it('ne devine pas une valeur illisible', () => {
    expect(zntAquatiqueApplicable({ ...sans, zntAquaticM: '5 à 20' }).origine).toBe('indeterminee');
  });

  it('lit la ZNT écrite dans une condition d’emploi plutôt que d’appliquer le défaut', () => {
    const r = zntAquatiqueApplicable({
      ...sans,
      conditions: [
        { label: "Condition: Pour protéger les organismes aquatiques, respecter une zone non traitée de 20 mètres en bordure des points d'eau." },
      ],
    });
    expect(r).toMatchObject({ origine: 'conditions', metres: 20 });
  });

  it('ignore une ZNT qui ne vise pas l’eau (zone non cultivée adjacente)', () => {
    const r = zntAquatiqueApplicable({
      ...sans,
      conditions: [
        { label: 'SPe 3 : Pour protéger les arthropodes non cibles, respecter une zone non traitée de 5 mètres par rapport à la zone non cultivée adjacente.' },
      ],
    });
    expect(r).toEqual({ origine: 'defaut', metres: 5 });
  });

  it('applique 5 m quand ni l’usage ni les conditions n’en fixent (arrêté du 4 mai 2017, art. 12-III)', () => {
    expect(zntAquatiqueApplicable(sans)).toEqual({ origine: 'defaut', metres: 5 });
    const rappel = rappelZnt({
      produit: 'P',
      zntAquaticM: null,
      zntArthropodM: null,
      zntPlantM: null,
      aquatique: zntAquatiqueApplicable(sans),
    });
    expect(rappel).toContain('milieu aquatique 5 m');
    expect(rappel).toContain('article 12-III');
    expect(rappel).toContain('sauf mention contraire sur l’étiquette');
  });

  it('n’applique pas le défaut à un produit autorisé en rizière (art. 13-II)', () => {
    const r = zntAquatiqueApplicable({ ...sans, culturesDuProduit: ['Riz*Désherbage'] });
    expect(r.origine).toBe('indeterminee');
  });

  it('le défaut de 5 m sert aussi au rapprochement avec les écoulements', () => {
    const r = rappelZntEcoulements({
      produit: 'P',
      zntAquaticM: null,
      aquatique: zntAquatiqueApplicable(sans),
      ecoulements: [{ label: 'Fossé', nature: 'Fossé', distanceM: 3, dedans: false, source }],
    });
    expect(r).toContain('ZNT aquatique de 5 m (largeur par défaut');
    expect(r).toContain('« Fossé »');
  });
});

describe('Mentions de danger et riverains', () => {
  it('signale un produit CMR, sans chiffrer une distance qu’il ne peut vérifier', () => {
    const r = rappelDangersRiverains({
      produit: 'PRODUIT ESSAI',
      dangers: [
        { code: 'H302', label: 'Nocif en cas d’ingestion' },
        { code: 'H351', label: 'Susceptible de provoquer le cancer.' },
      ],
    });
    expect(r).toContain('H351 (Susceptible de provoquer le cancer)');
    expect(r).not.toContain('H302');
    expect(r).toContain('Parcelys ne la calcule pas');
    expect(r).not.toMatch(/\d+ ?m(è|e)tres/);
  });

  it('se tait pour un produit sans mention CMR', () => {
    expect(rappelDangersRiverains({ produit: 'P', dangers: [{ code: 'H410', label: null }] })).toBeNull();
  });
});
