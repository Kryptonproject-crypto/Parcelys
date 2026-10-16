import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { faqEntryUpdateSchema } from '@/lib/validation/admin';
import { notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

type Ctx = { params: Promise<Record<string, string>> };

/** PATCH — modifie une question : texte, rubrique, ordre, publication, « à vérifier ». */
export const PATCH = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('faq:manage');
  const { id } = await context.params;
  const input = await parseBody(request, faqEntryUpdateSchema);
  const entry = await prisma.faqEntry.findUnique({ where: { id: id ?? '' } });
  if (!entry) throw notFound('Question introuvable');
  if (input.categoryId && !(await prisma.faqCategory.count({ where: { id: input.categoryId } }))) {
    throw notFound('Rubrique introuvable');
  }
  await prisma.faqEntry.update({
    where: { id: entry.id },
    data: {
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.question ? { question: input.question } : {}),
      ...(input.answer ? { answer: input.answer } : {}),
      ...(input.keywords !== undefined ? { keywords: input.keywords || null } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
      ...(input.needsReview !== undefined ? { needsReview: input.needsReview } : {}),
      updatedById: auth.user.id,
    },
  });
  await logAudit({
    action: 'faq.updated',
    userId: auth.user.id,
    entity: 'FaqEntry',
    entityId: entry.id,
    ipAddress: clientIp(request),
    metadata: { op: 'entry.updated', question: input.question ?? entry.question },
  });
  return ok({ message: 'Question mise à jour.', id: entry.id });
});

/** DELETE — retire une question. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('faq:manage');
  const { id } = await context.params;
  const entry = await prisma.faqEntry.findUnique({ where: { id: id ?? '' } });
  if (!entry) throw notFound('Question introuvable');
  await prisma.faqEntry.delete({ where: { id: entry.id } });
  await logAudit({
    action: 'faq.updated',
    userId: auth.user.id,
    entity: 'FaqEntry',
    entityId: entry.id,
    ipAddress: clientIp(request),
    metadata: { op: 'entry.deleted', question: entry.question },
  });
  return ok({ message: 'Question supprimée.', id: entry.id });
});
