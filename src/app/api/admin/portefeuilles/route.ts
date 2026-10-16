import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { listPortfolios } from '@/lib/admin/portefeuilles';
import { portfolioCreateSchema } from '@/lib/validation/admin';
import { conflict } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

/**
 * Portefeuilles de gestion — administrateur général seul.
 *
 * GET  : tous les portefeuilles, leurs gestionnaires et leurs effectifs.
 * POST : en crée un.
 */
export const GET = route(async () => {
  await requireAdmin('portfolios:manage');
  return ok({ portfolios: await listPortfolios() });
});

export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('portfolios:manage');
  const input = await parseBody(request, portfolioCreateSchema);

  const existing = await prisma.managementPortfolio.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  if (existing) throw conflict('Un portefeuille porte déjà ce nom.');

  const portfolio = await prisma.managementPortfolio.create({
    data: {
      name: input.name,
      description: input.description || null,
      createdById: auth.user.id,
    },
  });

  await logAudit({
    action: 'portfolio.created',
    userId: auth.user.id,
    entity: 'ManagementPortfolio',
    entityId: portfolio.id,
    ipAddress: clientIp(request),
    metadata: { name: portfolio.name },
  });

  return ok({ message: `Portefeuille « ${portfolio.name} » créé.`, id: portfolio.id }, 201);
});
