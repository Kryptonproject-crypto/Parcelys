import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { faqCategorySchema } from '@/lib/validation/admin';
import { conflict } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { assurerFaqInitiale } from '@/lib/aide/faq';

/** POST — crée une rubrique du centre d'aide. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('faq:manage');
  const input = await parseBody(request, faqCategorySchema);
  await assurerFaqInitiale();
  if (await prisma.faqCategory.count({ where: { slug: input.slug } })) {
    throw conflict('Une rubrique utilise déjà cet identifiant.');
  }
  const category = await prisma.faqCategory.create({
    data: {
      slug: input.slug,
      title: input.title,
      description: input.description || null,
      position: input.position,
    },
  });
  await logAudit({
    action: 'faq.updated',
    userId: auth.user.id,
    entity: 'FaqCategory',
    entityId: category.id,
    ipAddress: clientIp(request),
    metadata: { op: 'category.created', title: category.title },
  });
  return ok({ message: 'Rubrique créée.', id: category.id }, 201);
});
