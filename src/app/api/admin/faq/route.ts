import { ok, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { lireFaq } from '@/lib/aide/faq';

/** GET /api/admin/faq — tout le centre d'aide, entrées non publiées comprises. */
export const GET = route(async () => {
  await requireAdmin('faq:manage');
  return ok({ categories: await lireFaq({ inclureNonPubliees: true }) });
});
