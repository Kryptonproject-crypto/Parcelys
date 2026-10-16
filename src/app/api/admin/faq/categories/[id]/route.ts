import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { faqCategoryUpdateSchema } from '@/lib/validation/admin';
import { conflict, notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

type Ctx = { params: Promise<Record<string, string>> };

/** PATCH — renomme, décrit ou déplace une rubrique. */
export const PATCH = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('faq:manage');
  const { id } = await context.params;
  const input = await parseBody(request, faqCategoryUpdateSchema);
  const category = await prisma.faqCategory.findUnique({ where: { id: id ?? '' } });
  if (!category) throw notFound('Rubrique introuvable');
  await prisma.faqCategory.update({
    where: { id: category.id },
    data: {
      ...(input.title ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
  await logAudit({
    action: 'faq.updated',
    userId: auth.user.id,
    entity: 'FaqCategory',
    entityId: category.id,
    ipAddress: clientIp(request),
    metadata: { op: 'category.updated', title: input.title ?? category.title },
  });
  return ok({ message: 'Rubrique mise à jour.', id: category.id });
});

/** DELETE — supprime une rubrique **vide** : ses questions doivent d'abord partir ailleurs. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('faq:manage');
  const { id } = await context.params;
  const category = await prisma.faqCategory.findUnique({
    where: { id: id ?? '' },
    include: { _count: { select: { entries: true } } },
  });
  if (!category) throw notFound('Rubrique introuvable');
  if (category._count.entries > 0) {
    throw conflict(`Cette rubrique contient encore ${category._count.entries} question(s).`);
  }
  await prisma.faqCategory.delete({ where: { id: category.id } });
  await logAudit({
    action: 'faq.updated',
    userId: auth.user.id,
    entity: 'FaqCategory',
    entityId: category.id,
    ipAddress: clientIp(request),
    metadata: { op: 'category.deleted', title: category.title },
  });
  return ok({ message: 'Rubrique supprimée.', id: category.id });
});
