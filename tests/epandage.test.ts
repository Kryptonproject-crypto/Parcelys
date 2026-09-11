import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { dansLaPeriode } from '../src/lib/regulatory/epandage';

/**
 * Contrôle avant épandage : les trois verdicts, éprouvés de bout en bout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI COMPTE ICI
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Trois réponses sont possibles, et la troisième est la plus importante :
 *
 *   🟢 **conforme** — tout ce qui devait être vérifié l'a été, et rien ne cloche ;
 *   🔴 **non conforme** — une règle chargée n'est pas respectée ;
 *   🟠 **à vérifier** — un contrôle n'a **pas pu** être fait.
 *
 * Le piège serait de rendre « conforme » quand on n'a rien pu vérifier. Une
 * exploitation dont aucun référentiel n'est importé obtiendrait alors un feu
 * vert permanent, ce que la section 53 interdit expressément. Le premier essai
 * ci-dessous porte précisément là-dessus.
 *
 * Les périodes et les distances employées sont celles d'un programme d'actions
 * **fabriqué pour l'essai** : ce ne sont pas des valeurs réglementaires, et
 * elles ne prétendent pas l'être. Ce qu'on vérifie est le mécanisme — une règle
 * chargée est opposée, une règle absente laisse indéterminé —, pas le contenu
 * d'un arrêté.
 */
describe('Contrôle avant épandage', () => {
  let client: TestClient;
  let farmId = '';
  let parcelId = '';
  let fumierId = '';

  beforeAll(async () => {
    await startServer();
  }, 180_000);

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    const user = await createUserWithFarm({
      email: 'exploitant@epandage.test',
      farmName: 'Exploitation d’épandage',
    });
    farmId = user.farmId;
    client = new TestClient();
    await client.login(user.email, user.password);

    const parcelle = await client.post<{ id: string }>('/api/parcels', {
      name: 'La Prairie',
      status: 'ACTIVE',
      geometry: testPolygon(1.88, 48.08, 0.01, 0.006),
    });
    parcelId = parcelle.body.id;

    // Un fumier dont la teneur en azote est connue : 5 kg N par tonne.
    const fumier = await prisma.organicInput.create({
      data: {
        name: 'Fumier bovin d’essai',
        category: 'Fumier',
        defaultUnit: 't/ha',
        nContent: 5,
      },
      select: { id: true },
    });
    fumierId = fumier.id;
  });

  /** Charge un programme d'actions d'essai, avec les règles demandées. */
  async function chargerProgramme(regles: Array<{
    code: string;
    value: unknown;
    unit?: string;
    sourceRef?: string;
  }>) {
    const referentiel = await prisma.regulatoryReferential.create({
      data: {
        code: 'programme-actions-nitrates',
        name: 'Programme d’actions nitrates (essai)',
        territory: 'FR',
        version: 'essai-1',
        status: 'ACTIF',
        domain: 'NITRATES',
        sourceLabel: 'Programme d’actions d’essai (valeurs fabriquées)',
        sourceUrl: 'https://exemple.invalid/programme-essai',
        publishedAt: new Date('2020-01-01T00:00:00Z'),
      },
      select: { id: true },
    });

    for (const regle of regles) {
      await prisma.regulatoryRule.create({
        data: {
          referentialId: referentiel.id,
          domain: 'NITRATES',
          code: regle.code,
          label: regle.code,
          territory: 'FR',
          value: regle.value as never,
          unit: regle.unit ?? null,
          sourceRef: regle.sourceRef ?? 'Arrêté d’essai, article 1',
          appliesFrom: new Date('2020-01-01T00:00:00Z'),
        },
      });
    }
    return referentiel.id;
  }

  async function controler(corps: Record<string, unknown>) {
    const reponse = await client.post<{
      niveau: string;
      synthese: string;
      points: Array<{ sujet: string; verdict: string; detail: string; source: string | null }>;
    }>('/api/regulatory/spreading', {
      parcelId,
      date: '2026-04-15',
      organicInputId: fumierId,
      quantite: 20,
      unite: 't/ha',
      ...corps,
    });
    return reponse;
  }

  // -------------------------------------------------------------------------
  describe('🟠 à vérifier : quand on n’a pas pu vérifier', () => {
    it('ne rend jamais « conforme » sans référentiel chargé', async () => {
      const { status, body } = await controler({});

      expect(status).toBe(200);
      expect(body.niveau).toBe('A_VERIFIER');
      // Et la phrase ne doit pas laisser croire à un feu vert.
      expect(body.synthese).toContain('n’est pas un feu vert');
    });

    it('nomme chaque contrôle impossible et ce qui manque', async () => {
      const { body } = await controler({});

      const indetermines = body.points.filter((p) => p.verdict === 'indetermine');
      expect(indetermines.length).toBeGreaterThan(0);
      for (const point of indetermines) {
        // Chaque point indéterminé doit dire pourquoi, pas seulement qu'il l'est.
        expect({ sujet: point.sujet, explique: point.detail.length > 40 }).toEqual({
          sujet: point.sujet,
          explique: true,
        });
      }

      const periode = body.points.find((p) => p.sujet === 'Période d’épandage');
      expect(periode?.verdict).toBe('indetermine');
      expect(periode?.detail).toContain('n’en invente pas');
    });

    it('ne suppose pas les 170 kg N/ha quand aucun plafond n’est chargé', async () => {
      const { body } = await controler({});
      const plafond = body.points.find((p) => p.sujet === 'Plafond d’azote organique');

      // Ce qui compte n'est pas que le nombre 170 soit absent du texte — le
      // message l'évoque justement pour dire pourquoi il ne l'emploie pas —
      // mais qu'aucun plafond ne soit **opposé** faute de source.
      expect(plafond?.verdict).toBe('indetermine');
      expect(plafond?.detail).toContain('ne suppose pas');
      expect(plafond?.detail).toContain('Importez le programme d’actions');
      expect(plafond?.source).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('🔴 non conforme : quand une règle chargée est enfreinte', () => {
    it('refuse une date tombant dans une période d’interdiction', async () => {
      await chargerProgramme([
        { code: 'periode-interdiction-epandage', value: { periodes: [{ du: '04-01', au: '05-31' }] } },
      ]);

      const { body } = await controler({ date: '2026-04-15' });
      expect(body.niveau).toBe('NON_CONFORME');

      const periode = body.points.find((p) => p.sujet === 'Période d’épandage');
      expect(periode?.verdict).toBe('alerte');
      expect(periode?.detail).toContain('04-01');
      // La source de la règle doit être citée : « c'est le logiciel qui le dit »
      // n'est pas opposable en contrôle.
      expect(periode?.source).toContain('Arrêté d’essai');
    });

    it('reconnaît une période qui enjambe le 1ᵉʳ janvier', async () => {
      await chargerProgramme([
        { code: 'periode-interdiction-epandage', value: { periodes: [{ du: '11-15', au: '01-15' }] } },
      ]);

      const enPlein = await controler({ date: '2026-12-20' });
      expect(enPlein.body.niveau).toBe('NON_CONFORME');

      const apres = await controler({ date: '2026-02-20' });
      const periode = apres.body.points.find((p) => p.sujet === 'Période d’épandage');
      expect(periode?.verdict).toBe('ok');
    });

    it('refuse un apport qui ferait dépasser le plafond d’azote', async () => {
      await chargerProgramme([
        { code: 'plafond-azote-organique', value: { kgHa: 50 }, unit: 'kg N/ha' },
        { code: 'periode-interdiction-epandage', value: { periodes: [] } },
      ]);

      // 20 t/ha × 5 kg N/t = 100 kg N/ha, pour un plafond d'essai de 50.
      const { body } = await controler({ quantite: 20 });
      expect(body.niveau).toBe('NON_CONFORME');

      const plafond = body.points.find((p) => p.sujet === 'Plafond d’azote organique');
      expect(plafond?.verdict).toBe('alerte');
      expect(plafond?.detail).toContain('50');
      expect(plafond?.detail).toContain('Réduisez');
    });

    it('accepte le même apport sous le plafond', async () => {
      await chargerProgramme([
        { code: 'plafond-azote-organique', value: { kgHa: 200 }, unit: 'kg N/ha' },
      ]);

      const { body } = await controler({ quantite: 20 });
      const plafond = body.points.find((p) => p.sujet === 'Plafond d’azote organique');
      expect(plafond?.verdict).toBe('ok');
      expect(plafond?.detail).toContain('resterait');
    });
  });

  // -------------------------------------------------------------------------
  describe('🟢 conforme : quand tout a pu être vérifié', () => {
    it('rend « conforme » une fois tous les contrôles possibles', async () => {
      await chargerProgramme([
        { code: 'periode-interdiction-epandage', value: { periodes: [{ du: '11-01', au: '01-15' }] } },
        { code: 'plafond-azote-organique', value: { kgHa: 200 }, unit: 'kg N/ha' },
        { code: 'distance-epandage-cours-eau', value: { metres: 35 }, unit: 'm' },
        { code: 'distance-epandage-habitation', value: { metres: 50 }, unit: 'm' },
      ]);

      // Le zonage, pour que la zone vulnérable soit déterminée.
      await chargerZonages();
      // Une culture déclarée sur la campagne.
      await declarerCulture(2026);

      const { body } = await controler({ date: '2026-04-15', campaignYear: 2026 });

      const restants = body.points.filter((p) => p.verdict !== 'ok');
      expect({
        niveau: body.niveau,
        restants: restants.map((p) => `${p.sujet} : ${p.verdict}`),
      }).toEqual({ niveau: 'CONFORME', restants: [] });

      // Et la formule de synthèse est bien celle que la section 53 impose.
      expect(body.synthese).toContain('Aucune anomalie détectée');
      expect(body.synthese).not.toContain('conforme');
    });

    it('mesure la distance au cours d’eau et la compare à la règle', async () => {
      await chargerProgramme([
        { code: 'distance-epandage-cours-eau', value: { metres: 100_000 }, unit: 'm' },
      ]);
      await chargerZonages();

      const { body } = await controler({});
      const distance = body.points.find((p) => p.sujet === 'Distance aux cours d’eau');
      // Le cours d'eau d'essai est à quelques centaines de mètres : une exigence
      // de 100 km ne peut pas être satisfaite.
      expect(distance?.verdict).toBe('alerte');
      expect(distance?.detail).toContain('Distance mesurée');
      // Et la phrase dit d'où part la mesure : du contour, pas du point épandu.
      expect(distance?.detail).toContain('contour de la parcelle');
    });
  });

  /** Un zonage d'essai : la parcelle en zone vulnérable, un cours d'eau à côté. */
  async function chargerZonages() {
    const referentiel = await prisma.regulatoryReferential.create({
      data: {
        code: 'zones-vulnerables',
        name: 'Zones vulnérables (essai)',
        territory: 'FR',
        version: 'essai-1',
        status: 'ACTIF',
        domain: 'NITRATES',
        sourceLabel: 'Zonage d’essai (valeurs fabriquées)',
        publishedAt: new Date('2020-01-01T00:00:00Z'),
      },
      select: { id: true },
    });

    // Une zone vulnérable qui englobe largement la parcelle.
    await prisma.$executeRaw`
      INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, created_at)
      VALUES (
        gen_random_uuid()::text, ${referentiel.id}, 'ZONE_VULNERABLE', 'ZV-ESSAI',
        'Zone vulnérable d’essai',
        ST_Multi(ST_SetSRID(ST_MakeEnvelope(1.5, 47.9, 2.2, 48.4), 4326)),
        now()
      )`;

    // Un cours d'eau à quelques centaines de mètres au sud de la parcelle.
    await prisma.$executeRaw`
      INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, created_at)
      VALUES (
        gen_random_uuid()::text, ${referentiel.id}, 'COURS_EAU', 'CE-ESSAI',
        'Ruisseau d’essai',
        ST_Multi(ST_SetSRID(ST_MakeEnvelope(1.87, 48.070, 1.90, 48.074), 4326)),
        now()
      )`;

    await prisma.$executeRaw`
      INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, created_at)
      VALUES (
        gen_random_uuid()::text, ${referentiel.id}, 'ZONE_ENVIRONNEMENTALE', 'HAB-ESSAI',
        'Zone d’habitation d’essai',
        ST_Multi(ST_SetSRID(ST_MakeEnvelope(1.80, 48.00, 1.82, 48.02), 4326)),
        now()
      )`;
  }

  async function declarerCulture(annee: number) {
    const crop = await prisma.crop.create({
      data: { code: 'PRAIRIE_ESSAI', name: 'Prairie', category: 'Fourrages' },
      select: { id: true },
    });
    await prisma.cropYear.create({
      data: { parcelId, cropId: crop.id, campaignYear: annee },
    });
  }

  // -------------------------------------------------------------------------
  describe('Le calcul des périodes', () => {
    it('inclut les bornes et reconnaît le passage d’année', () => {
      // Période ordinaire.
      expect(dansLaPeriode('04-15', '04-01', '05-31')).toBe(true);
      expect(dansLaPeriode('04-01', '04-01', '05-31')).toBe(true);
      expect(dansLaPeriode('05-31', '04-01', '05-31')).toBe(true);
      expect(dansLaPeriode('03-31', '04-01', '05-31')).toBe(false);
      expect(dansLaPeriode('06-01', '04-01', '05-31')).toBe(false);

      // Période qui enjambe le 1ᵉʳ janvier — la forme la plus courante.
      expect(dansLaPeriode('12-20', '11-15', '01-15')).toBe(true);
      expect(dansLaPeriode('01-10', '11-15', '01-15')).toBe(true);
      expect(dansLaPeriode('11-15', '11-15', '01-15')).toBe(true);
      expect(dansLaPeriode('01-15', '11-15', '01-15')).toBe(true);
      expect(dansLaPeriode('06-01', '11-15', '01-15')).toBe(false);
      expect(dansLaPeriode('01-16', '11-15', '01-15')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Cloisonnement', () => {
    it('refuse de contrôler la parcelle d’une autre exploitation', async () => {
      const voisin = await createUserWithFarm({
        email: 'voisin@epandage.test',
        farmName: 'Ferme voisine',
      });
      const autre = new TestClient();
      await autre.login(voisin.email, voisin.password);

      const reponse = await autre.post('/api/regulatory/spreading', {
        parcelId,
        date: '2026-04-15',
        quantite: 20,
        unite: 't/ha',
      });
      expect(reponse.status).toBe(404);
    });
  });
});
