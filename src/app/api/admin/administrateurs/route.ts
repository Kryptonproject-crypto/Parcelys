import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { listAdministrators } from '@/lib/admin/administrateurs';
import { secondaryInviteSchema } from '@/lib/validation/admin';
import { createInvitation } from '@/lib/auth/invitations';
import { conflict, notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';

/**
 * Administrateurs — administrateur général seul.
 *
 * GET  : généraux, secondaires et leurs portefeuilles, comptes sans rôle,
 *        invitations d'administrateur secondaire en attente.
 * POST : invite un administrateur secondaire. Le code ne crée **jamais** un
 *        administrateur général : `grantsPlatformAdmin` est forcé à faux, et
 *        la base refuserait de toute façon un compte des deux niveaux.
 */
export const GET = route(async () => {
  await requireAdmin('admins:manage');
  return ok(await listAdministrators());
});

export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('admins:manage');
  const input = await parseBody(request, secondaryInviteSchema);
  const ip = clientIp(request);

  let portfolioId = input.portfolioId || null;
  let portfolioName: string;

  if (portfolioId) {
    const portfolio = await prisma.managementPortfolio.findUnique({
      where: { id: portfolioId },
      select: { name: true },
    });
    if (!portfolio) throw notFound('Portefeuille introuvable');
    portfolioName = portfolio.name;
  } else {
    const name = (input.newPortfolioName ?? '').trim();
    const homonyme = await prisma.managementPortfolio.count({ where: { name } });
    if (homonyme) throw conflict('Un portefeuille porte déjà ce nom.');
    const created = await prisma.managementPortfolio.create({
      data: { name, createdById: auth.user.id },
    });
    portfolioId = created.id;
    portfolioName = created.name;
    await logAudit({
      action: 'portfolio.created',
      userId: auth.user.id,
      entity: 'ManagementPortfolio',
      entityId: created.id,
      ipAddress: ip,
      metadata: { name, forSecondaryAdmin: true },
    });
  }

  const { invitation, code } = await createInvitation({
    createdById: auth.user.id,
    accountType: 'ADMIN',
    email: input.email || null,
    farmId: null,
    role: 'OWNER',
    grantsPlatformAdmin: false,
    grantsSecondaryAdmin: true,
    portfolioId,
    note: input.note || null,
    validityDays: input.validityDays,
  });

  await logAudit({
    action: 'admin.secondary_invited',
    userId: auth.user.id,
    entity: 'InvitationCode',
    entityId: invitation.id,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
    metadata: {
      restrictedTo: input.email || null,
      portfolioId,
      portfolioName,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });

  return ok(
    {
      message: `Code créé pour un administrateur secondaire du portefeuille « ${portfolioName} ». Notez-le : il ne sera plus affiché.`,
      code,
      invitation: {
        id: invitation.id,
        codeHint: invitation.codeHint,
        portfolioId,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    },
    201,
  );
});
