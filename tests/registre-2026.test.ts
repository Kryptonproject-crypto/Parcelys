import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithFarm, prisma, resetDatabase, testPolygon } from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { phytoApplicationSchema } from '@/lib/validation/farming';
import { ciblesProposees, type UsageForDose } from '@/lib/ephy/dose';
import type { FicheParcelle, RegistresMobile } from '@/lib/shared/registres';
import { purgeOldAuditLogs } from '@/lib/audit';

/**
 * Registre phytopharmaceutique 2026-2027 (0.12.0).
 *
 * Ce que ces tests protègent :
 *
 *   · les mentions ajoutées au 1er janvier 2026 (arrêté du 24 décembre 2025) —
 *     heures, stade, prestataire, conduite bio — s'enregistrent, se corrigent,
 *     et ne s'effacent pas quand une correction ne les porte pas ;
 *   · la conduite bio se déduit du profil quand il la tranche, et n'est
 *     jamais supposée sinon ;
 *   · le registre numérique est lisible par machine : une information par
 *     colonne, dates ISO, nombres à point décimal, une longitude négative qui
 *     reste un nombre ;
 *   · « À faire » dit quelles mentions manquent ;
 *   · l'application reçoit ces mentions, et peut les envoyer par la file.
 */

type Complets = Extract<RegistresMobile, { unchanged: false }>;

describe('Mentions du registre (validation)', () => {
  const base = { appliedOn: '2026-04-10', productName: 'Produit', dose: 1, doseUnit: 'L/ha' };

  it('accepte des heures HH:MM et refuse une fin avant le début', () => {
    expect(phytoApplicationSchema.safeParse({ ...base, startTime: '07:30', endTime: '09:05' }).success).toBe(true);
    const inverse = phytoApplicationSchema.safeParse({ ...base, startTime: '10:00', endTime: '09:00' });
    expect(inverse.success).toBe(false);
    expect(phytoApplicationSchema.safeParse({ ...base, startTime: '7h30' }).success).toBe(false);
    expect(phytoApplicationSchema.safeParse({ ...base, startTime: '24:00' }).success).toBe(false);
  });

  it('exige 14 chiffres pour le SIRET d’un intervenant, espaces tolérés', () => {
    const ok = phytoApplicationSchema.safeParse({ ...base, appliedBy: 'PRESTATAIRE', contractorSiret: '123 456 789 00012' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.contractorSiret).toBe('12345678900012');
    expect(phytoApplicationSchema.safeParse({ ...base, contractorSiret: '123456789' }).success).toBe(false);
    expect(phytoApplicationSchema.safeParse({ ...base, appliedBy: 'VOISIN' }).success).toBe(false);
  });
});

describe('Cibles proposées d’après le catalogue', () => {
  const usage = (cropLabel: string, targetLabel: string | null): UsageForDose =>
    ({ cropLabel, targetLabel, doseValue: 1, doseUnit: 'L/ha' }) as unknown as UsageForDose;

  it('propose les cibles de la culture, sans doublon, sinon toutes celles du produit', () => {
    const usages = [
      usage('Blé', 'Septoriose'),
      usage('Blé', 'septoriose'),
      usage('Blé', 'Rouille brune'),
      usage('Orge', 'Helminthosporiose'),
      usage('Orge', null),
    ];
    expect(ciblesProposees(usages, 'Blé tendre d’hiver')).toEqual(['Rouille brune', 'Septoriose']);
    expect(ciblesProposees(usages, 'Colza')).toEqual(['Helminthosporiose', 'Rouille brune', 'Septoriose']);
    expect(ciblesProposees([], 'Blé')).toEqual([]);
  });
});

describe('Registre phytopharmaceutique 2026', () => {
  let owner: Awaited<ReturnType<typeof createUserWithFarm>>;
  let client: TestClient;
  let parcelId: string;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUserWithFarm({ email: 'registre@ferme.test', farmName: 'Ferme du Registre' });
    client = new TestClient();
    await client.login(owner.email, owner.password);
    // À l'ouest de Greenwich : la longitude est négative.
    const parcelle = await client.post<{ id: string }>('/api/parcels', {
      name: 'Le Champ Long',
      geometry: testPolygon(-1.68, 48.11, 0.01, 0.006),
    });
    expect(parcelle.status).toBe(201);
    parcelId = parcelle.body.id;
  });

  const traitement = (body: Record<string, unknown> = {}) =>
    client.post<{ item: { id: string } }>(`/api/parcels/${parcelId}/phytosanitary`, {
      appliedOn: '2026-04-10',
      productName: 'Produit d’essai',
      amm: '9999999',
      dose: 1.25,
      doseUnit: 'L/ha',
      ...body,
    });

  it('enregistre heures, stade et prestataire, et les garde quand une correction ne les porte pas', async () => {
    const r = await traitement({
      targetLabel: 'Septoriose',
      operator: 'Opérateur Un',
      startTime: '06:45',
      endTime: '08:10',
      bbchStage: '32',
      appliedBy: 'PRESTATAIRE',
      contractorName: 'Entreprise de travaux',
      contractorSiret: '12345678900012',
    });
    expect(r.status).toBe(201);
    const id = r.body.item.id;

    // Une application pas encore mise à jour n'envoie aucune de ces mentions.
    const c = await client.put(`/api/phytosanitary/applications/${id}`, {
      appliedOn: '2026-04-10',
      productName: 'Produit d’essai',
      amm: '9999999',
      dose: 1.5,
      doseUnit: 'L/ha',
      targetLabel: 'Septoriose',
      operator: 'Opérateur Un',
    });
    expect(c.status).toBe(200);
    const ligne = await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id } });
    expect(ligne).toMatchObject({
      startTime: '06:45',
      endTime: '08:10',
      bbchStage: '32',
      appliedBy: 'PRESTATAIRE',
      contractorName: 'Entreprise de travaux',
      contractorSiret: '12345678900012',
    });
    expect(Number(ligne.dose)).toBe(1.5);

    // Revenir à « l'exploitation » efface le prestataire ; vider une heure l'efface.
    await client.put(`/api/phytosanitary/applications/${id}`, {
      appliedOn: '2026-04-10',
      productName: 'Produit d’essai',
      dose: 1.5,
      doseUnit: 'L/ha',
      appliedBy: 'EXPLOITATION',
      contractorName: 'ne doit pas rester',
      startTime: '',
    });
    const apres = await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id } });
    expect(apres).toMatchObject({ appliedBy: 'EXPLOITATION', contractorName: null, contractorSiret: null, startTime: null, endTime: '08:10' });

    // La correction est journalisée, mentions comprises.
    const journal = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'phyto.updated', entityId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(journal.metadata)).toContain('appliedBy');
  });

  it('refuse une heure de fin antérieure au début', async () => {
    const r = await traitement({ startTime: '10:00', endTime: '09:00' });
    expect(r.status).toBe(400);
  });

  it('déduit la conduite bio du profil quand il la tranche, et ne la suppose jamais sinon', async () => {
    // Non renseignée : la mention reste vide, même si la saisie ne dit rien.
    const vide = await traitement();
    expect((await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id: vide.body.item.id } })).organicProduction).toBeNull();

    // Toute en bio : oui, quoi que dise la saisie.
    await prisma.farm.update({ where: { id: owner.farmId }, data: { organicFarming: 'TOTALE' } });
    const bio = await traitement({ organicProduction: false });
    expect((await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id: bio.body.item.id } })).organicProduction).toBe(true);

    // Aucune surface en bio : non.
    await prisma.farm.update({ where: { id: owner.farmId }, data: { organicFarming: 'AUCUNE' } });
    const conv = await traitement();
    expect((await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id: conv.body.item.id } })).organicProduction).toBe(false);

    // En partie : c'est la saisie qui le dit.
    await prisma.farm.update({ where: { id: owner.farmId }, data: { organicFarming: 'PARTIELLE' } });
    const partiel = await traitement({ organicProduction: true });
    expect((await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id: partiel.body.item.id } })).organicProduction).toBe(true);

    // Figée à la création : passer l'exploitation « sans bio » ne réécrit pas le passé.
    await prisma.farm.update({ where: { id: owner.farmId }, data: { organicFarming: 'AUCUNE' } });
    await client.put(`/api/phytosanitary/applications/${partiel.body.item.id}`, {
      appliedOn: '2026-04-10',
      productName: 'Produit d’essai',
      dose: 1,
      doseUnit: 'L/ha',
    });
    expect((await prisma.phytosanitaryApplication.findUniqueOrThrow({ where: { id: partiel.body.item.id } })).organicProduction).toBe(true);
  });

  it('enregistre la conduite bio de l’exploitation depuis les paramètres', async () => {
    const r = await client.put('/api/farms', { name: 'Ferme du Registre', organicFarming: 'PARTIELLE' });
    expect(r.status).toBe(200);
    expect((await prisma.farm.findUniqueOrThrow({ where: { id: owner.farmId } })).organicFarming).toBe('PARTIELLE');
    // Absent : inchangé.
    await client.put('/api/farms', { name: 'Ferme du Registre' });
    expect((await prisma.farm.findUniqueOrThrow({ where: { id: owner.farmId } })).organicFarming).toBe('PARTIELLE');
    // Vide : non renseigné.
    await client.put('/api/farms', { name: 'Ferme du Registre', organicFarming: '' });
    expect((await prisma.farm.findUniqueOrThrow({ where: { id: owner.farmId } })).organicFarming).toBeNull();
  });

  it('produit un registre numérique lisible par machine (CSV et JSON), et refuse de l’imprimer', async () => {
    await prisma.farm.update({ where: { id: owner.farmId }, data: { siret: '98765432100019', organicFarming: 'AUCUNE' } });
    await traitement({ targetLabel: 'Pucerons', operator: 'Opérateur Un', startTime: '18:30', endTime: '19:15', bbchStage: '61', sprayVolumeLHa: 120 });
    // Un traitement d'une autre année civile ne doit pas sortir.
    await traitement({ appliedOn: '2025-11-20' });

    const csv = await client.download('/api/exports?dataset=registre-phyto-numerique&format=csv&year=2026');
    expect(csv.status).toBe(200);
    const texte = csv.bytes.toString('utf8').replace(/^﻿/, '');
    const [entete, ligne, ...reste] = texte.split('\r\n');
    expect(reste).toHaveLength(0);
    const colonnes = entete!.split(';').map((c) => c.replace(/"/g, ''));
    for (const attendue of [
      'date_utilisation', 'heure_debut', 'heure_fin', 'siret_exploitation', 'latitude', 'longitude',
      'surface_traitee_ha', 'stade_bbch', 'agriculture_biologique', 'numero_amm', 'dose', 'unite_dose',
      'cible', 'operateur',
    ]) {
      expect(colonnes).toContain(attendue);
    }
    const valeurs = ligne!.split(';').map((c) => c.replace(/^"|"$/g, ''));
    const v = (cle: string) => valeurs[colonnes.indexOf(cle)];
    expect(v('date_utilisation')).toBe('2026-04-10');
    expect(v('heure_debut')).toBe('18:30');
    expect(v('siret_exploitation')).toBe('98765432100019');
    expect(v('agriculture_biologique')).toBe('non');
    expect(v('dose')).toBe('1.25');
    // Un nombre n'est jamais préfixé comme une formule : il reste un nombre.
    expect(Number(v('longitude'))).toBeLessThan(0);
    expect(v('longitude')).toMatch(/^-1\.\d+$/);

    const json = await client.get<{ colonnes: Array<{ cle: string }>; lignes: Array<Record<string, unknown>> }>(
      '/api/exports?dataset=registre-phyto-numerique&format=json&year=2026',
    );
    expect(json.status).toBe(200);
    expect(json.body.lignes).toHaveLength(1);
    expect(json.body.lignes[0]).toMatchObject({ dose: 1.25, volume_bouillie_l_ha: 120, stade_bbch: '61', cible: 'Pucerons' });
    expect(typeof json.body.lignes[0]!.surface_traitee_ha).toBe('number');

    const pdf = await client.get('/api/exports?dataset=registre-phyto-numerique&format=pdf&year=2026');
    expect(pdf.status).toBe(400);
  });

  it('dit, dans le registre numérique, ce qui manque plutôt que de le compléter', async () => {
    await traitement({ amm: '' });
    const json = await client.get<{ avertissements: string[]; lignes: Array<Record<string, unknown>> }>(
      '/api/exports?dataset=registre-phyto-numerique&format=json&year=2026',
    );
    expect(json.body.lignes[0]).toMatchObject({ siret_exploitation: '', agriculture_biologique: '', numero_amm: '', cible: '', operateur: '' });
    const avis = json.body.avertissements.join(' | ');
    expect(avis).toContain('SIRET');
    expect(avis).toContain('agriculture biologique');
    expect(avis).toContain('AMM');
  });

  it('dit dans « À faire » quelles mentions manquent', async () => {
    await traitement({ targetLabel: 'Septoriose' });
    await traitement({ operator: 'Opérateur Un' });
    const page = await client.page('/dashboard');
    expect(page.status).toBe(200);
    const html = page.html.replace(/<!-- -->/g, '');
    expect(html).toContain('2 traitements à compléter — manque : cible (1), opérateur (1)');
    expect(html).toContain('Registre phytosanitaire : indiquez le SIRET et la conduite en agriculture biologique de l’exploitation');
    // Le bloc de conformité n'est plus sur le tableau de bord.
    expect(html).not.toContain('Analyse de la campagne en cours');
  });

  it('garde six ans la trace des corrections de registre, un an le reste, et efface l’IP au bout d’un an', async () => {
    const il = (jours: number) => new Date(Date.now() - jours * 24 * 3600 * 1000);
    await prisma.auditLog.deleteMany({});
    await prisma.auditLog.createMany({
      data: [
        { action: 'auth.login', createdAt: il(400), ipAddress: '192.0.2.1' },
        { action: 'auth.login', createdAt: il(10), ipAddress: '192.0.2.2' },
        { action: 'phyto.updated', entityId: 'recent', createdAt: il(10), ipAddress: '192.0.2.3' },
        { action: 'phyto.updated', entityId: 'ancien', createdAt: il(400), ipAddress: '192.0.2.4', userAgent: 'Navigateur' },
        { action: 'fertilization.deleted', entityId: 'tres-ancien', createdAt: il(7 * 365), ipAddress: '192.0.2.5' },
      ],
    });
    await purgeOldAuditLogs(365);
    const restants = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(restants.map((r) => `${r.action}:${r.entityId ?? ''}`)).toEqual([
      'phyto.updated:ancien',
      'auth.login:',
      'phyto.updated:recent',
    ]);
    // La trace d'il y a plus d'un an reste, sans ses données techniques.
    expect(restants[0]).toMatchObject({ ipAddress: null, userAgent: null });
    // La récente garde les siennes.
    expect(restants[2]?.ipAddress).toBe('192.0.2.3');
  });

  it('garde dans le journal ce que disait un traitement supprimé', async () => {
    const r = await traitement({ targetLabel: 'Pucerons', operator: 'Opérateur Un' });
    const id = r.body.item.id;
    expect((await client.delete(`/api/phytosanitary/applications/${id}`)).status).toBe(200);
    const trace = await prisma.auditLog.findFirstOrThrow({ where: { action: 'phyto.deleted', entityId: id } });
    expect(trace.metadata).toMatchObject({
      supprime: { productName: 'Produit d’essai', amm: '9999999', dose: 1.25, targetLabel: 'Pucerons', operator: 'Opérateur Un' },
    });
    expect((trace.metadata as { supprime: { appliedOn: string } }).supprime.appliedOn).toMatch(/^2026-04-10/);
  });

  it('transmet ces mentions à l’application, et les reçoit par la file d’attente', async () => {
    const r = await client.post<{ results: Array<{ status: string; message?: string }> }>('/api/sync', {
      operations: [
        {
          clientId: 'reg2026-0001-phyto',
          kind: 'phyto.create',
          parcelId,
          payload: {
            appliedOn: '2026-04-12',
            productName: 'Produit d’essai',
            dose: 2,
            doseUnit: 'L/ha',
            targetLabel: 'Adventices',
            operator: 'Opérateur Deux',
            treatedAreaHa: 1,
            startTime: '07:00',
            endTime: '07:40',
            bbchStage: '13',
            appliedBy: 'ENTRAIDE',
            contractorName: 'Ferme voisine',
            contractorSiret: '11122233300044',
            organicProduction: false,
            captureWeather: false,
          },
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.results[0]?.status).toBe('applied');

    const reg = await client.get<Complets>(`/api/mobile/registres?farmId=${owner.farmId}`);
    expect(reg.status).toBe(200);
    const fiche = reg.body.parcels[parcelId] as FicheParcelle;
    expect(fiche.traitements[0]).toMatchObject({
      targetLabel: 'Adventices',
      operator: 'Opérateur Deux',
      treatedAreaHa: 1,
      startTime: '07:00',
      endTime: '07:40',
      bbchStage: '13',
      appliedBy: 'ENTRAIDE',
      contractorName: 'Ferme voisine',
      contractorSiret: '11122233300044',
      organicProduction: false,
    });

    const instantane = await client.get<{
      farm: { organicFarming: string | null };
      referential: { recentTargets: string[]; recentOperators: string[] };
    }>('/api/mobile/bootstrap');
    expect(instantane.status).toBe(200);
    expect(instantane.body.farm.organicFarming).toBeNull();
    expect(instantane.body.referential.recentTargets).toContain('Adventices');
    expect(instantane.body.referential.recentOperators).toContain('Opérateur Deux');
  });
});
