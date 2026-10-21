import 'server-only';
import { prisma } from '@/lib/prisma';
import { FAQ_INITIALE } from '@/lib/shared/faq-initiale';
import type { FaqCategorieVue } from '@/lib/shared/faq';

/**
 * Centre d'aide côté serveur : lecture, et insertion du contenu initial.
 *
 * Le contenu initial (`src/lib/shared/faq-initiale.ts`) est écrit en base **une
 * seule fois**, puis l'administrateur général le modifie librement depuis
 * `/administration/aide`. Un réglage d'instance (`faq.initialisee`) le retient :
 * si l'administrateur supprime une rubrique, elle ne réapparaît pas au
 * redémarrage suivant.
 *
 * Deux premiers affichages simultanés ne doublent rien : l'insertion se fait
 * sous un verrou consultatif de transaction, et les identifiants stables
 * (`slug`) sont uniques en base.
 */

const DRAPEAU = 'faq.initialisee';
/** Clé arbitraire du verrou consultatif PostgreSQL de cette opération. */
const VERROU = 724_031_011;

/** Slugs des entrées postérieures au contenu initial déjà livrées à ce serveur. */
const LIVREES = 'faq.ajouts-livres';

/** La liste des slugs livrés, telle que le réglage la garde (texte JSON). */
function lireLivrees(valeur: string | null | undefined): Set<string> {
  try {
    const liste: unknown = valeur ? JSON.parse(valeur) : [];
    return new Set(Array.isArray(liste) ? liste.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

const AJOUTS = FAQ_INITIALE.flatMap((categorie, i) =>
  categorie.entrees
    .filter((e) => e.ajouteeEn)
    .map((entree) => ({ categorie, position: (i + 1) * 10, entree })),
);

/**
 * Entrées ajoutées après la première installation (`ajouteeEn`), livrées une
 * seule fois.
 *
 * Le contenu initial n'est écrit qu'une fois : sans cette étape, une réponse
 * rédigée en 0.12.0 n'apparaissait jamais sur un serveur installé en 0.11.0 —
 * c'est-à-dire chez tous les utilisateurs réels. Chaque entrée livrée est
 * notée : si l'administrateur la supprime ensuite, elle ne revient pas.
 * Une entrée dont le slug existe déjà (créée ou modifiée à la main) n'est pas
 * touchée.
 */
async function livrerNouvellesEntrees(): Promise<void> {
  const reglage = await prisma.appSetting.findUnique({ where: { key: LIVREES } });
  const deja = lireLivrees(reglage?.value);
  if (AJOUTS.every((a) => deja.has(a.entree.slug))) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VERROU})`;
    const relu = await tx.appSetting.findUnique({ where: { key: LIVREES } });
    const livrees = lireLivrees(relu?.value);
    for (const { categorie, position, entree } of AJOUTS) {
      if (livrees.has(entree.slug)) continue;
      const cat = await tx.faqCategory.upsert({
        where: { slug: categorie.slug },
        update: {},
        create: { slug: categorie.slug, title: categorie.titre, description: categorie.description, position },
      });
      const existe = await tx.faqEntry.findUnique({ where: { slug: entree.slug }, select: { id: true } });
      if (!existe) {
        const dernier = await tx.faqEntry.aggregate({ where: { categoryId: cat.id }, _max: { position: true } });
        await tx.faqEntry.create({
          data: {
            slug: entree.slug,
            categoryId: cat.id,
            question: entree.question,
            answer: entree.reponse,
            keywords: entree.motsCles ?? null,
            needsReview: entree.aVerifier ?? false,
            position: (dernier._max.position ?? 0) + 10,
          },
        });
      }
      livrees.add(entree.slug);
    }
    await tx.appSetting.upsert({
      where: { key: LIVREES },
      update: { value: JSON.stringify([...livrees]) },
      create: { key: LIVREES, value: JSON.stringify([...livrees]) },
    });
  });
}

export async function assurerFaqInitiale(): Promise<void> {
  const deja = await prisma.appSetting.findUnique({ where: { key: DRAPEAU } });
  if (deja) {
    await livrerNouvellesEntrees();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VERROU})`;
    if (await tx.appSetting.findUnique({ where: { key: DRAPEAU } })) return;

    for (const [i, categorie] of FAQ_INITIALE.entries()) {
      const cat = await tx.faqCategory.upsert({
        where: { slug: categorie.slug },
        update: {},
        create: {
          slug: categorie.slug,
          title: categorie.titre,
          description: categorie.description,
          position: (i + 1) * 10,
        },
      });
      for (const [j, entree] of categorie.entrees.entries()) {
        await tx.faqEntry.upsert({
          where: { slug: entree.slug },
          update: {},
          create: {
            slug: entree.slug,
            categoryId: cat.id,
            question: entree.question,
            answer: entree.reponse,
            keywords: entree.motsCles ?? null,
            needsReview: entree.aVerifier ?? false,
            position: (j + 1) * 10,
          },
        });
      }
    }
    await tx.appSetting.create({ data: { key: DRAPEAU, value: new Date().toISOString() } });
    // Une installation neuve reçoit tout d'un coup : les ajouts sont livrés.
    await tx.appSetting.upsert({
      where: { key: LIVREES },
      update: { value: JSON.stringify(AJOUTS.map((a) => a.entree.slug)) },
      create: { key: LIVREES, value: JSON.stringify(AJOUTS.map((a) => a.entree.slug)) },
    });
  });
}

/**
 * Le centre d'aide, rubrique par rubrique. Le public ne voit que les entrées
 * publiées ; l'administration, tout.
 */
export async function lireFaq(options: { inclureNonPubliees?: boolean } = {}): Promise<
  Array<FaqCategorieVue & { position: number; entries: Array<FaqCategorieVue['entries'][number] & { published: boolean; position: number; updatedAt: string }> }>
> {
  await assurerFaqInitiale();
  const categories = await prisma.faqCategory.findMany({
    orderBy: [{ position: 'asc' }, { title: 'asc' }],
    include: {
      entries: {
        where: options.inclureNonPubliees ? {} : { published: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  return categories
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      position: c.position,
      entries: c.entries.map((e) => ({
        id: e.id,
        slug: e.slug,
        question: e.question,
        answer: e.answer,
        keywords: e.keywords,
        needsReview: e.needsReview,
        published: e.published,
        position: e.position,
        updatedAt: e.updatedAt.toISOString(),
        categorySlug: c.slug,
        categoryTitle: c.title,
      })),
    }))
    // Une rubrique vide n'a rien à montrer au public.
    .filter((c) => options.inclureNonPubliees || c.entries.length > 0);
}
