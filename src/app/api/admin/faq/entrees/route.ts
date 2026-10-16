import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { faqEntrySchema } from '@/lib/validation/admin';
import { notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

/** POST — ajoute une question au centre d'aide. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('faq:manage');
  const input = await parseBody(request, faqEntrySchema);
  if (!(await prisma.faqCategory.count({ where: { id: input.categoryId } }))) {
    throw notFound('Rubrique introuvable');
  }
  const entry = await prisma.faqEntry.create({
    data: {
      categoryId: input.categoryId,
      question: input.question,
      answer: input.answer,
      keywords: input.keywords || null,
      position: input.position,
      published: input.published,
      needsReview: input.needsReview,
      updatedById: auth.user.id,
    },
  });
  await logAudit({
    action: 'faq.updated',
    userId: auth.user.id,
    entity: 'FaqEntry',
    entityId: entry.id,
    ipAddress: clientIp(request),
    metadata: { op: 'entry.created', question: entry.question },
  });
  return ok({ message: 'Question ajoutée.', id: entry.id }, 201);
});
