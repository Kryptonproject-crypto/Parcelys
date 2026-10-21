import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPortfolio,
  createSecondaryAdmin,
  createUserWithFarm,
  prisma,
  resetDatabase,
} from './helpers/db';
import { startServer, stopServer, TestClient } from './helpers/server';
import { FAQ_INITIALE } from '../src/lib/shared/faq-initiale';
import { blocsDeReponse, faqDepuisInitiale, rechercherFaq } from '../src/lib/shared/faq';

/**
 * Centre d'aide : la recherche (la même sur le site et dans l'application),
 * le renvoi vers Contact quand rien ne correspond, et l'édition réservée à
 * l'administrateur général.
 */

const faq = faqDepuisInitiale(FAQ_INITIALE);
const premier = (q: string) => rechercherFaq(faq, q)[0]?.slug;

describe('Recherche dans l’aide', () => {
  it('couvre les dix rubriques demandées', () => {
    expect(FAQ_INITIALE.map((c) => c.slug)).toEqual([
      'compte',
      'exploitations',
      'carte',
      'fertilisation',
      'phyto',
      'referentiels',
      'exports',
      'numero',
      'technique',
      'contact',
    ]);
    for (const c of FAQ_INITIALE) expect(c.entrees.length, c.slug).toBeGreaterThanOrEqual(3);
    const slugs = FAQ_INITIALE.flatMap((c) => c.entrees.map((e) => e.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('trouve la bonne réponse, accents et casse mis de côté', () => {
    expect(premier("j'ai oublié mon mot de passe")).toBe('compte-mot-de-passe');
    expect(premier('MOT DE PASSE OUBLIE')).toBe('compte-mot-de-passe');
    expect(premier('produit retiré')).toBe('phyto-retire');
    expect(premier('numero client')).toBe('numero-quoi');
    expect(premier('telepac')).toBe('carte-import-pac');
    expect(premier('synchronisation hors ligne')).toBe('technique-hors-ligne');
  });

  it('ne rend rien pour une recherche sans rapport, ni pour des mots vides', () => {
    expect(rechercherFaq(faq, 'xqzwv blorf')).toEqual([]);
    expect(rechercherFaq(faq, 'le la de')).toEqual([]);
    expect(rechercherFaq(faq, '   ')).toEqual([]);
  });

  it('découpe une réponse en paragraphes et puces, sans interpréter de HTML', () => {
    expect(blocsDeReponse('Un.\n\n- a\n- b\n\nDeux <b>gras</b>.')).toEqual([
      { type: 'p', texte: 'Un.' },
      { type: 'ul', items: ['a', 'b'] },
      { type: 'p', texte: 'Deux <b>gras</b>.' },
    ]);
  });
});

describe('Centre d’aide en ligne', () => {
  let general: TestClient;
  let secondaire: TestClient;
  let exploitant: TestClient;

  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase();
    const g = await createUserWithFarm({ email: 'general@parcelys.test', farmName: 'Siège', platformAdmin: true });
    const f = await createUserWithFarm({ email: 'ferme@ferme.test', farmName: 'Ferme' });
    const s = await createSecondaryAdmin({ email: 'sec@parcelys.test', portfolioIds: [await createPortfolio('Nord')] });
    general = new TestClient();
    await general.login(g.email, g.password);
    exploitant = new TestClient();
    await exploitant.login(f.email, f.password);
    secondaire = new TestClient();
    await secondaire.login(s.email, s.password);
  });

  it('sert la FAQ au public, avec la recherche et le renvoi vers Contact', async () => {
    const anonyme = new TestClient();
    const tout = await anonyme.get<{ categories: Array<{ slug: string; entries: unknown[] }> }>('/api/aide/faq');
    expect(tout.status).toBe(200);
    expect(tout.body.categories).toHaveLength(10);

    const trouve = await anonyme.get<{ results: Array<{ slug: string }> }>(
      `/api/aide/faq?q=${encodeURIComponent('mot de passe oublié')}`,
    );
    expect(trouve.body.results[0]?.slug).toBe('compte-mot-de-passe');

    const rien = await anonyme.get<{ results: unknown[]; contactUrl: string }>('/api/aide/faq?q=xqzwv');
    expect(rien.body.results).toEqual([]);
    expect(rien.body.contactUrl).toBe('/contact');

    const page = await anonyme.page('/aide');
    expect(page.status).toBe(200);
    expect(page.html).toContain('Centre d');
    expect(page.html).toContain('href="/contact"');
    expect(page.html).toContain('À vérifier');
  });

  it('n’insère le contenu initial qu’une fois, et respecte une suppression', async () => {
    await new TestClient().get('/api/aide/faq');
    await new TestClient().get('/api/aide/faq');
    const total = FAQ_INITIALE.reduce((n, c) => n + c.entrees.length, 0);
    expect(await prisma.faqEntry.count()).toBe(total);

    await prisma.faqEntry.deleteMany({ where: { category: { slug: 'numero' } } });
    await prisma.faqCategory.delete({ where: { slug: 'numero' } });
    const apres = await new TestClient().get<{ categories: Array<{ slug: string }> }>('/api/aide/faq');
    expect(apres.body.categories.map((c) => c.slug)).not.toContain('numero');
  });

  it('livre une fois aux serveurs déjà installés les réponses ajoutées depuis', async () => {
    // Un serveur installé en 0.11.0 : contenu initial inséré, sans les ajouts.
    await new TestClient().get('/api/aide/faq');
    const ajouts = FAQ_INITIALE.flatMap((c) => c.entrees.filter((e) => e.ajouteeEn).map((e) => e.slug));
    expect(ajouts).toContain('phyto-registre-numerique');
    await prisma.faqEntry.deleteMany({ where: { slug: { in: ajouts } } });
    await prisma.appSetting.delete({ where: { key: 'faq.ajouts-livres' } });
    // Une entrée déjà présente à la main (même slug) n'est pas écrasée.
    const categorie = await prisma.faqCategory.findUniqueOrThrow({ where: { slug: 'contact' } });
    await prisma.faqEntry.create({
      data: { slug: 'contact-cookies', categoryId: categorie.id, question: 'Rédigée par l’administrateur', answer: 'Texte maison.' },
    });

    await new TestClient().get('/api/aide/faq');
    const total = FAQ_INITIALE.reduce((n, c) => n + c.entrees.length, 0);
    expect(await prisma.faqEntry.count()).toBe(total);
    expect((await prisma.faqEntry.findUniqueOrThrow({ where: { slug: 'contact-cookies' } })).question).toBe(
      'Rédigée par l’administrateur',
    );

    // Supprimée ensuite par l'administrateur : elle ne revient pas.
    await prisma.faqEntry.delete({ where: { slug: 'phyto-registre-numerique' } });
    await new TestClient().get('/api/aide/faq');
    expect(await prisma.faqEntry.count({ where: { slug: 'phyto-registre-numerique' } })).toBe(0);
  });

  it('se modifie par l’administrateur général, sans toucher au code', async () => {
    const admin = await general.get<{ categories: Array<{ id: string; slug: string }> }>('/api/admin/faq');
    const compte = admin.body.categories.find((c) => c.slug === 'compte');
    expect(compte).toBeDefined();

    const creee = await general.post<{ id: string }>('/api/admin/faq/entrees', {
      categoryId: compte?.id,
      question: 'Puis-je me connecter avec mon téléphone ?',
      answer: 'Oui, avec l’application mobile.',
      keywords: 'smartphone android',
      published: false,
    });
    expect(creee.status).toBe(201);

    // Non publiée : absente du public.
    const avant = await new TestClient().get<{ results: unknown[] }>('/api/aide/faq?q=smartphone');
    expect(avant.body.results).toEqual([]);

    await general.patch(`/api/admin/faq/entrees/${creee.body.id}`, { published: true, needsReview: true });
    const apres = await new TestClient().get<{ results: Array<{ question: string; needsReview: boolean }> }>(
      '/api/aide/faq?q=smartphone',
    );
    expect(apres.body.results[0]).toMatchObject({
      question: 'Puis-je me connecter avec mon téléphone ?',
      needsReview: true,
    });

    expect(await prisma.auditLog.count({ where: { action: 'faq.updated' } })).toBe(2);
  });

  it('refuse l’édition à un secondaire, à un exploitant et à un visiteur', async () => {
    const corps = { title: 'Pirate', slug: 'pirate' };
    expect((await secondaire.post('/api/admin/faq/categories', corps)).status).toBe(403);
    expect((await secondaire.get('/api/admin/faq')).status).toBe(403);
    expect((await exploitant.post('/api/admin/faq/categories', corps)).status).toBe(403);
    expect((await new TestClient().post('/api/admin/faq/categories', corps)).status).toBe(401);
    expect(await prisma.faqCategory.count({ where: { slug: 'pirate' } })).toBe(0);
  });
});
