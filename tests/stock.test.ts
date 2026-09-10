import { describe, expect, it } from 'vitest';
import {
  convertirQuantite,
  expliquerConversion,
  familleDe,
  normaliserUnite,
  uniteConnue,
} from '../src/lib/stock/units';
import {
  alertesStock,
  calculerSolde,
  calculerSoldesParLot,
  quantiteSignee,
  sensAttendu,
} from '../src/lib/stock/balance';

/**
 * Stocks et lots.
 *
 * Ce que ces tests protègent : **un solde qui ne ment pas**. Un chiffre faux
 * sur un produit phytosanitaire n'est pas une gêne d'inventaire, c'est un écart
 * de traçabilité lors d'un contrôle — et il ne se voit qu'à ce moment-là.
 */

describe('Unités de stock', () => {
  it('ne convertit jamais une masse en volume', () => {
    // La densité varie d'un produit à l'autre et l'étiquette ne la donne pas
    // toujours. Une conversion « raisonnable » serait une donnée inventée.
    expect(convertirQuantite(10, 'kg', 'L')).toBeNull();
    expect(convertirQuantite(10, 'L', 'kg')).toBeNull();
    expect(expliquerConversion('kg', 'L')).toContain('densité');
  });

  it('convertit à l’intérieur d’une même famille', () => {
    expect(convertirQuantite(1500, 'mL', 'L')).toBe(1.5);
    expect(convertirQuantite(2, 't', 'kg')).toBe(2000);
    expect(convertirQuantite(500, 'g', 'kg')).toBe(0.5);
    expect(convertirQuantite(1, 'hL', 'L')).toBe(100);
  });

  it('refuse de faire correspondre deux dénombrables différents', () => {
    // Rien ne dit combien un « sac » vaut de « bidons ».
    expect(convertirQuantite(3, 'sac', 'bidon')).toBeNull();
    expect(convertirQuantite(3, 'sac', 'sac')).toBe(3);
    expect(expliquerConversion('sac', 'bidon')).toContain('dénombrables');
  });

  it('accepte les façons courantes d’écrire une unité', () => {
    expect(normaliserUnite(' Litres ')).toBe('l');
    expect(normaliserUnite('KG')).toBe('kg');
    expect(normaliserUnite('Tonnes')).toBe('t');
    expect(normaliserUnite('unités')).toBe('unité');
    expect(normaliserUnite('doses')).toBe('dose');
    expect(familleDe('m³')).toBe('volume');
  });

  it('ne retire un pluriel que s’il donne une unité connue', () => {
    // Une règle générale « enlever le s final » finirait par casser une unité
    // valide sans qu'on comprenne pourquoi le solde devient incalculable.
    expect(uniteConnue('sacs')).toBe(true);
    expect(normaliserUnite('boulons')).toBe('boulons');
    expect(uniteConnue('boulons')).toBe(false);
  });

  it('dit qu’une unité lui est inconnue plutôt que de la deviner', () => {
    expect(uniteConnue('brouettes')).toBe(false);
    expect(expliquerConversion('brouettes', 'L')).toContain('inconnue');
  });
});

describe('Solde de stock', () => {
  it('additionne les mouvements signés', () => {
    const solde = calculerSolde(
      [
        { quantity: 20, unit: 'L' },
        { quantity: -5, unit: 'L' },
        { quantity: -2.5, unit: 'L' },
      ],
      'L',
    );
    expect(solde.quantite).toBe(12.5);
    expect(solde.complet).toBe(true);
  });

  it('ramène les mouvements à l’unité de l’article', () => {
    const solde = calculerSolde(
      [
        { quantity: 5, unit: 'L' },
        { quantity: -500, unit: 'mL' },
      ],
      'L',
    );
    expect(solde.quantite).toBe(4.5);
  });

  it('écarte un mouvement inconvertible et le dit, au lieu de l’ignorer', () => {
    // Un solde amputé sans le dire vaudrait moins que pas de solde du tout.
    const solde = calculerSolde(
      [
        { quantity: 20, unit: 'L' },
        { quantity: -3, unit: 'kg' },
      ],
      'L',
    );
    expect(solde.quantite).toBe(20);
    expect(solde.complet).toBe(false);
    expect(solde.ecartes).toHaveLength(1);
    expect(solde.ecartes[0]?.raison).toContain('densité');
  });

  it('n’accumule pas de décimales parasites au fil des conversions', () => {
    const solde = calculerSolde(
      Array.from({ length: 30 }, () => ({ quantity: -100, unit: 'mL' })),
      'L',
    );
    expect(solde.quantite).toBe(-3);
  });

  it('sépare les soldes par lot', () => {
    const mouvements = [
      { quantity: 10, unit: 'L', lotId: 'A' },
      { quantity: -4, unit: 'L', lotId: 'A' },
      { quantity: 5, unit: 'L', lotId: 'B' },
      // Un mouvement sans lot ne doit fausser aucun des deux.
      { quantity: -1, unit: 'L', lotId: null },
    ];
    const parLot = calculerSoldesParLot(mouvements, 'L');
    expect(parLot.get('A')?.quantite).toBe(6);
    expect(parLot.get('B')?.quantite).toBe(5);
    expect(parLot.size).toBe(2);
    // Le solde global, lui, compte tout.
    expect(calculerSolde(mouvements, 'L').quantite).toBe(10);
  });
});

describe('Sens des mouvements', () => {
  it('impose le signe que la nature commande', () => {
    expect(sensAttendu('ENTREE')).toBe(1);
    expect(sensAttendu('SORTIE')).toBe(-1);
    expect(sensAttendu('RETOUR')).toBe(-1);
    expect(sensAttendu('DESTRUCTION')).toBe(-1);
  });

  it('laisse l’ajustement d’inventaire aller dans les deux sens', () => {
    expect(sensAttendu('AJUSTEMENT')).toBeNull();
    expect(quantiteSignee('AJUSTEMENT', -2)).toBe(-2);
    expect(quantiteSignee('AJUSTEMENT', 2)).toBe(2);
  });

  it('corrige une saisie positive en sortie', () => {
    // L'interface fait saisir « 20 litres sortis », pas « −20 ».
    expect(quantiteSignee('SORTIE', 20)).toBe(-20);
    // Et une saisie déjà négative ne redevient pas positive.
    expect(quantiteSignee('SORTIE', -20)).toBe(-20);
    expect(quantiteSignee('ENTREE', -20)).toBe(20);
  });
});

describe('Alertes de stock', () => {
  const lotsVides = { lots: [], soldesParLot: new Map() };

  it('explique un solde négatif au lieu de le constater', () => {
    const alertes = alertesStock({
      solde: { quantite: -3, unite: 'L', ecartes: [], complet: true },
      seuil: null,
      ...lotsVides,
    });
    const negatif = alertes.find((a) => a.code === 'solde-negatif');
    expect(negatif?.niveau).toBe('anomalie');
    // Un solde négatif est presque toujours un achat non saisi, pas un vol.
    expect(negatif?.message).toContain('achat');
  });

  it('n’invente pas de seuil quand aucun n’est fixé', () => {
    const alertes = alertesStock({
      solde: { quantite: 0.2, unite: 'L', ecartes: [], complet: true },
      seuil: null,
      ...lotsVides,
    });
    expect(alertes.some((a) => a.code === 'sous-seuil')).toBe(false);
  });

  it('signale le passage sous le seuil fixé par l’exploitant', () => {
    const alertes = alertesStock({
      solde: { quantite: 2, unite: 'L', ecartes: [], complet: true },
      seuil: 5,
      ...lotsVides,
    });
    expect(alertes.some((a) => a.code === 'sous-seuil')).toBe(true);
  });

  it('signale un lot périmé sans décider à la place de l’exploitant', () => {
    const lot = {
      id: 'L1',
      lotNumber: 'ABC-2023',
      expiresOn: new Date('2026-01-15'),
    };
    const alertes = alertesStock({
      solde: { quantite: 4, unite: 'L', ecartes: [], complet: true },
      seuil: null,
      lots: [lot],
      soldesParLot: new Map([
        ['L1', { quantite: 4, unite: 'L', ecartes: [], complet: true }],
      ]),
      aujourdHui: new Date('2026-09-10'),
    });
    const perime = alertes.find((a) => a.code === 'lot-perime');
    expect(perime).toBeDefined();
    expect(perime?.message).toContain('ABC-2023');
    expect(perime?.message).toContain('vous appartient');
  });

  it('ne signale pas un lot périmé qui est déjà vide', () => {
    const alertes = alertesStock({
      solde: { quantite: 0, unite: 'L', ecartes: [], complet: true },
      seuil: null,
      lots: [{ id: 'L1', lotNumber: 'ABC', expiresOn: new Date('2026-01-15') }],
      soldesParLot: new Map([
        ['L1', { quantite: 0, unite: 'L', ecartes: [], complet: true }],
      ]),
      aujourdHui: new Date('2026-09-10'),
    });
    expect(alertes.some((a) => a.code.startsWith('lot-'))).toBe(false);
  });

  it('prévient avant la date limite, pas seulement après', () => {
    const alertes = alertesStock({
      solde: { quantite: 4, unite: 'L', ecartes: [], complet: true },
      seuil: null,
      lots: [{ id: 'L1', lotNumber: 'XYZ', expiresOn: new Date('2026-10-01') }],
      soldesParLot: new Map([
        ['L1', { quantite: 4, unite: 'L', ecartes: [], complet: true }],
      ]),
      aujourdHui: new Date('2026-09-10'),
    });
    expect(alertes.some((a) => a.code === 'lot-bientot-perime')).toBe(true);
  });

  it('avertit qu’un solde ne porte pas sur tous les mouvements', () => {
    const alertes = alertesStock({
      solde: {
        quantite: 20,
        unite: 'L',
        ecartes: [{ quantite: -3, unite: 'kg', raison: 'densité inconnue' }],
        complet: false,
      },
      seuil: null,
      ...lotsVides,
    });
    expect(alertes.some((a) => a.code === 'unites-melangees')).toBe(true);
  });
});
