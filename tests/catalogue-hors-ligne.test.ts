import { describe, expect, it } from 'vitest';
import {
  chercherHorsLigne,
  ficheHorsLigne,
  provenanceHorsLigne,
  retiresMasques,
} from '../mobile/src/lib/catalogue-local';
import type { OfflineCatalogueEntry, Referential } from '../mobile/src/lib/types';
import { checkDose, usagesForCrop } from '../src/lib/ephy/dose';

/**
 * Le catalogue embarqué dans le téléphone.
 *
 * Ce que ces tests protègent : **le contrôle de dose doit fonctionner sans
 * réseau**. Avant, hors connexion, l'application acceptait la saisie d'un
 * traitement sans rien vérifier — ni dose maximale, ni culture autorisée, ni
 * ZNT, ni délai avant récolte. Au champ, pulvérisateur en route, c'est-à-dire
 * exactement là où le contrôle sert.
 *
 * Le second point protégé est de langage, et il compte autant : le catalogue
 * embarqué n'est **pas** le catalogue E-Phy. Un produit absent doit se dire
 * « pas dans ceux que vous avez employés », jamais « produit inconnu » — qui
 * laisserait entendre que le produit n'existe pas, ou qu'il n'est pas autorisé.
 */

function usage(partiel: Partial<OfflineCatalogueEntry['usages'][number]> = {}) {
  return {
    id: 'u1',
    cropLabel: 'Blé',
    targetLabel: 'Septoriose',
    usageLabel: 'Blé * Trt Part.Aer. * Septoriose',
    doseValue: '1.5',
    doseUnit: 'L/ha',
    status: 'Autorisé',
    preHarvestDelay: '35',
    maxApplications: '2',
    minIntervalDays: '21',
    zntAquaticM: '5',
    zntArthropodM: null,
    zntPlantM: null,
    conditions: null,
    ...partiel,
  };
}

function entree(partiel: Partial<OfflineCatalogueEntry> = {}): OfflineCatalogueEntry {
  return {
    amm: '2100094',
    productId: 'prod-1',
    name: 'FONGI-ESSAI',
    holder: 'Essai SAS',
    formulation: 'SC',
    productType: 'PPP',
    substances: ['Prothioconazole'],
    status: 'Autorisé',
    authorized: true,
    withdrawnAt: null,
    usages: [usage()],
    crops: ['Blé'],
    drainedSoilRestrictions: [],
    ...partiel,
  };
}

function referentiel(entrees: OfflineCatalogueEntry[]): Referential {
  return {
    crops: [],
    fertilizers: [],
    organicInputs: [],
    recentPhytoProducts: [],
    doseUnits: ['L/ha'],
    parcelTypes: [],
    operationTypes: [],
    phytoCatalogue: entrees,
    phytoCatalogueSource: {
      label: 'Catalogue E-Phy (ANSES)',
      lastSyncAt: '2026-09-08T00:00:00.000Z',
      configured: true,
      omitted: 0,
    },
  } as Referential;
}

describe('Catalogue embarqué', () => {
  describe('Recherche', () => {
    const ref = referentiel([
      entree(),
      entree({
        amm: '2000111',
        productId: 'prod-2',
        name: 'HERBI-ESSAI',
        substances: ['Glyphosate'],
      }),
      entree({
        amm: '9900001',
        productId: 'prod-3',
        name: 'RETIRE-ESSAI',
        authorized: false,
        status: 'Retiré',
        withdrawnAt: '2024-01-01T00:00:00.000Z',
      }),
    ]);

    it('trouve par nom, sans se soucier de la casse ni des accents', () => {
      expect(chercherHorsLigne(ref, 'fongi').map((p) => p.amm)).toEqual(['2100094']);
      expect(chercherHorsLigne(ref, 'HERBI').map((p) => p.amm)).toEqual(['2000111']);
    });

    it('trouve par numéro d’AMM, même partiel', () => {
      expect(chercherHorsLigne(ref, '2100').map((p) => p.name)).toEqual(['FONGI-ESSAI']);
      expect(chercherHorsLigne(ref, '2100094').map((p) => p.name)).toEqual(['FONGI-ESSAI']);
    });

    it('trouve par substance active', () => {
      // C'est ainsi qu'on cherche quand on a le bidon en main et que le nom
      // commercial ne dit rien.
      expect(chercherHorsLigne(ref, 'glyphosate').map((p) => p.amm)).toEqual(['2000111']);
    });

    it('écarte les produits retirés par défaut, et sait les compter', () => {
      // Proposer un produit retiré au moment de saisir un traitement, ce serait
      // proposer une infraction.
      expect(chercherHorsLigne(ref, 'essai').map((p) => p.amm)).not.toContain('9900001');
      expect(retiresMasques(ref, 'essai')).toBe(1);
    });

    it('les rend accessibles quand on les demande', () => {
      // Un traitement passé se saisit parfois après coup, et il faut alors
      // pouvoir nommer le produit employé.
      expect(chercherHorsLigne(ref, 'retire', true).map((p) => p.amm)).toEqual(['9900001']);
    });

    it('ne cherche pas sur une lettre', () => {
      expect(chercherHorsLigne(ref, 'f')).toEqual([]);
    });

    it('rend une liste vide plutôt qu’une erreur sans catalogue', () => {
      // Un appareil qui n'a pas resynchronisé depuis une version antérieure n'a
      // pas de catalogue embarqué : il doit continuer à fonctionner.
      expect(chercherHorsLigne(null, 'fongi')).toEqual([]);
      expect(chercherHorsLigne({} as Referential, 'fongi')).toEqual([]);
    });
  });

  describe('Fiche produit', () => {
    const ref = referentiel([entree()]);

    it('se retrouve par AMM comme par identifiant', () => {
      expect(ficheHorsLigne(ref, '2100094')?.product.name).toBe('FONGI-ESSAI');
      expect(ficheHorsLigne(ref, 'prod-1')?.product.name).toBe('FONGI-ESSAI');
    });

    it('rend null pour un produit non embarqué — c’est une réponse, pas un échec', () => {
      expect(ficheHorsLigne(ref, '0000000')).toBeNull();
    });

    it('porte la provenance du catalogue, jamais celle de l’instantané', () => {
      const fiche = ficheHorsLigne(ref, '2100094');
      expect(fiche?.source.lastSyncAt).toBe('2026-09-08T00:00:00.000Z');
      // Le compte annoncé est celui des produits embarqués, pas les 15 000 du
      // catalogue : la fiche ne doit pas laisser croire qu'on les a tous.
      expect(fiche?.source.productsInBase).toBe(1);
    });
  });

  describe('Contrôle de dose hors ligne', () => {
    // Le point de tout l'exercice : la fiche embarquée doit alimenter le même
    // contrôle que la fiche reçue du serveur, sans qu'il sache d'où elle vient.
    const ref = referentiel([entree()]);
    const fiche = ficheHorsLigne(ref, '2100094');

    it('retient l’usage correspondant à la culture de la parcelle', () => {
      expect(fiche).not.toBeNull();
      const retenus = usagesForCrop(fiche!.usages, 'Blé tendre d’hiver');
      expect(retenus).toHaveLength(1);
      expect(retenus[0]?.doseValue).toBe('1.5');
    });

    it('signale un dépassement de dose sans réseau', () => {
      const verdict = checkDose({
        usages: fiche!.usages,
        crop: 'Blé',
        dose: 2.5,
        doseUnit: 'L/ha',
      });
      expect(verdict.verdict).toBe('depassement');
      expect(verdict.authorized).toEqual({ value: 1.5, unit: 'L/ha' });
    });

    it('ne signale rien quand la dose est conforme', () => {
      const verdict = checkDose({
        usages: fiche!.usages,
        crop: 'Blé',
        dose: 1.2,
        doseUnit: 'L/ha',
      });
      expect(verdict.verdict).toBe('conforme');
    });

    it('ne conclut pas quand la culture n’a aucun usage retenu', () => {
      // Ne rien savoir n'est pas la même chose que savoir que c'est bon. Sans
      // usage correspondant, le contrôle doit se taire, pas rassurer.
      const verdict = checkDose({
        usages: fiche!.usages,
        crop: 'Betterave',
        dose: 99,
        doseUnit: 'L/ha',
      });
      expect(verdict.verdict).toBe('usage-inconnu');
      expect(verdict.verdict).not.toBe('conforme');
    });
  });

  describe('Provenance affichée', () => {
    it('dit combien de produits sont embarqués et combien manquent', () => {
      const ref = referentiel([entree()]);
      ref.phytoCatalogueSource!.omitted = 4;
      const p = provenanceHorsLigne(ref);
      expect(p.disponible).toBe(true);
      expect(p.produits).toBe(1);
      expect(p.omis).toBe(4);
    });

    it('se déclare indisponible plutôt que vide quand rien n’est embarqué', () => {
      expect(provenanceHorsLigne(null).disponible).toBe(false);
      expect(provenanceHorsLigne(null).produits).toBe(0);
    });
  });
});
