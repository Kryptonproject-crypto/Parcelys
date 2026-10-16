import type { NextRequest } from 'next/server';
import { ok, route } from '@/lib/api/handler';
import { lireFaq } from '@/lib/aide/faq';
import { rechercherFaq } from '@/lib/shared/faq';

/**
 * GET /api/aide/faq — le centre d'aide, public.
 *
 * Sans `q` : toutes les rubriques publiées. Avec `q` : en plus, les entrées
 * qui correspondent, les plus pertinentes d'abord. Aucun résultat : la
 * réponse renvoie vers la page Contact.
 */
export const GET = route(async (request: NextRequest) => {
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 120);
  const categories = await lireFaq();
  const publiques = categories.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    entries: c.entries.map((e) => ({
      id: e.id,
      slug: e.slug,
      question: e.question,
      answer: e.answer,
      keywords: e.keywords,
      needsReview: e.needsReview,
      categorySlug: e.categorySlug,
      categoryTitle: e.categoryTitle,
    })),
  }));
  const results = q.trim() ? rechercherFaq(publiques, q) : null;
  return ok({
    categories: publiques,
    query: q,
    results,
    contactUrl: '/contact',
  });
});
