import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { portfolioUpdateSchema } from '@/lib/validation/admin';
import { conflict, notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

type Ctx = { params: Promise<Record<string, string>> };

/** PATCH — renomme un portefeuille ou change sa description. */
export const PATCH = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('portfolios:manage');
  const { id } = await context.params;
  const input = await parseBody(request, portfolioUpdateSchema);

  const portfolio = await prisma.managementPortfolio.findUnique({ where: { id: id ?? '' } });
  if (!portfolio) throw notFound('Portefeuille introuvable');

  if (input.name && input.name !== portfolio.name) {
    const homonyme = await prisma.managementPortfolio.count({
      where: { name: input.name, id: { not: portfolio.id } },
    });
    if (homonyme) throw conflict('Un portefeuille porte déjà ce nom.');
  }

  const updated = await prisma.managementPortfolio.update({
    where: { id: portfolio.id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
    },
  });

  await logAudit({
    action: 'portfolio.updated',
    userId: auth.user.id,
    entity: 'ManagementPortfolio',
    entityId: portfolio.id,
    ipAddress: clientIp(request),
    metadata: { from: portfolio.name, to: updated.name },
  });

  return ok({ message: 'Portefeuille mis à jour.', id: portfolio.id });
});

/**
 * DELETE — supprime un portefeuille **vide**.
 *
 * Un portefeuille qui contient encore des exploitations, des techniciens ou
 * des demandes ouvertes ne se supprime pas : ses clients basculeraient en
 * silence chez l'administrateur général. Il faut d'abord les transférer — un
 * geste visible et journalisé, client par client.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('portfolios:manage');
  const { id } = await context.params;

  const portfolio = await prisma.managementPortfolio.findUnique({
    where: { id: id ?? '' },
    include: {
      _count: {
        select: {
          farms: true,
          technicians: true,
          tickets: { where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } },
          managers: true,
        },
      },
    },
  });
  if (!portfolio) throw notFound('Portefeuille introuvable');

  const { farms, technicians, tickets } = portfolio._count;
  if (farms + technicians + tickets > 0) {
    throw conflict(
      `Ce portefeuille n'est pas vide : ${farms} exploitation(s), ${technicians} ` +
        `technicien(s), ${tickets} demande(s) ouverte(s). Transférez-les d'abord.`,
      { farms, technicians, tickets },
    );
  }

  await prisma.managementPortfolio.delete({ where: { id: portfolio.id } });

  await logAudit({
    action: 'portfolio.deleted',
    userId: auth.user.id,
    entity: 'ManagementPortfolio',
    entityId: portfolio.id,
    ipAddress: clientIp(request),
    metadata: { name: portfolio.name, managers: portfolio._count.managers },
  });

  return ok({ message: `Portefeuille « ${portfolio.name} » supprimé.`, id: portfolio.id });
});
