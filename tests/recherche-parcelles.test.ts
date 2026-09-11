import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { sansAccent } from '../src/lib/shared/texte';
import { identifiantsParcellesTrouvees } from '../src/lib/services/recherche-parcelles';

/**
 * Retrouver une parcelle par le nom qu'on lui a donné.
 *
 * Deux garanties distinctes sont vérifiées ici :
 *
 *  1. **la recherche trouve sans l'accent.** « cote » doit rendre « La Côte ».
 *     C'est le cas d'usage : on tape au champ, sur un téléphone, sans accent ;
 *  2. **les deux implémentations disent la même chose.** La règle existe en
 *     JavaScript (`sansAccent`, dont se servent l'application mobile et les
 *     filtres du navigateur) et en SQL (`parcelys_sans_accent`, employée par
 *     la base). Deux implémentations peuvent diverger sans que personne le
 *     remarque — jusqu'au jour où le site trouve une parcelle que le téléphone
 *     ne trouve pas. Ce test-ci les confronte, et c'est lui qui les tient
 *     ensemble.
 */

/** Des noms de parcelles tels qu'on en rencontre vraiment. */
const NOMS = [
  'La Côte',
  'Le Chêne',
  'Les Prés Salés',
  'Le Pré du Curé',
  'Champ de l’Épine',
  'Grande Pièce',
  'Îlot 39 — parcelle 3',
  'Derrière l’Étang',
  'Vallée de l’Œuf',
  'LA CROIX ROUGE',
  'Bâtiment Sud',
  'Noë Blanche',
];

describe('Recherche de parcelles', () => {
  let owner: Awaited<ReturnType<typeof createUserWithFarm>>;
  let client: TestClient;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUserWithFarm({
      email: 'recherche@ferme.test',
      farmName: 'Ferme de la Recherche',
    });
    client = new TestClient();
    await client.login(owner.email, owner.password);
  });

  // -------------------------------------------------------------------------
  describe('La règle SQL et la règle JavaScript s’accordent', () => {
    it('rend le même texte dépouillé pour chaque nom éprouvé', async () => {
      const lignes = await prisma.$queryRaw<Array<{ entree: string; sql: string }>>`
        SELECT t.entree, parcelys_sans_accent(t.entree) AS sql
        FROM unnest(${NOMS}::text[]) AS t(entree)
      `;

      expect(lignes).toHaveLength(NOMS.length);
      for (const ligne of lignes) {
        expect({ nom: ligne.entree, resultat: ligne.sql }).toEqual({
          nom: ligne.entree,
          resultat: sansAccent(ligne.entree),
        });
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Trouver sans taper l’accent', () => {
    beforeEach(async () => {
      // Des parcelles réelles, avec les accents, et des attributs différents
      // pour vérifier que les cinq champs sont bien cherchés.
      await client.post('/api/parcels', {
        name: 'La Côte',
        internalNumber: '39-3',
        geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
      });
      await client.post('/api/parcels', {
        name: 'Le Chêne',
        lieuDit: 'Les Sauvattes',
        geometry: testPolygon(1.9, 48.08, 0.01, 0.006),
      });
      await client.post('/api/parcels', {
        name: 'Grande Pièce',
        commune: 'Sainté-Test',
        geometry: testPolygon(1.92, 48.08, 0.01, 0.006),
      });
    });

    const cas: Array<[string, string]> = [
      ['cote', 'La Côte'],
      ['CÔTE', 'La Côte'],
      ['Cote', 'La Côte'],
      ['chene', 'Le Chêne'],
      ['piece', 'Grande Pièce'],
    ];

    for (const [terme, attendu] of cas) {
      it(`« ${terme} » trouve « ${attendu} »`, async () => {
        const ids = await identifiantsParcellesTrouvees(owner.farmId, terme);
        const trouvees = await prisma.parcel.findMany({
          where: { id: { in: ids } },
          select: { name: true },
        });
        expect(trouvees.map((p) => p.name)).toEqual([attendu]);
      });
    }

    it('cherche aussi le lieu-dit, le numéro interne et la commune', async () => {
      for (const [terme, attendu] of [
        ['sauvattes', 'Le Chêne'],
        ['39-3', 'La Côte'],
        ['sainte-test', 'Grande Pièce'],
      ] as Array<[string, string]>) {
        const ids = await identifiantsParcellesTrouvees(owner.farmId, terme);
        const trouvees = await prisma.parcel.findMany({
          where: { id: { in: ids } },
          select: { name: true },
        });
        expect({ terme, noms: trouvees.map((p) => p.name) }).toEqual({
          terme,
          noms: [attendu],
        });
      }
    });

    it('ne rend rien pour un terme qui ne correspond à aucune parcelle', async () => {
      expect(await identifiantsParcellesTrouvees(owner.farmId, 'betterave')).toEqual([]);
    });

    it('ne franchit pas la frontière d’une autre exploitation', async () => {
      const voisin = await createUserWithFarm({
        email: 'voisin@ferme.test',
        farmName: 'Ferme Voisine',
      });
      const autre = new TestClient();
      await autre.login(voisin.email, voisin.password);
      await autre.post('/api/parcels', {
        name: 'La Côte du voisin',
        geometry: testPolygon(2.5, 48.08, 0.01, 0.006),
      });

      const ids = await identifiantsParcellesTrouvees(owner.farmId, 'cote');
      const trouvees = await prisma.parcel.findMany({
        where: { id: { in: ids } },
        select: { name: true },
      });
      expect(trouvees.map((p) => p.name)).toEqual(['La Côte']);
    });
  });
});
