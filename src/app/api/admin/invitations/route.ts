import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { invitationCreateSchema } from '@/lib/validation/admin';
import { createInvitation } from '@/lib/auth/invitations';
import { impliesPlatformAdmin } from '@/lib/auth/accounts';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import { logAudit } from '@/lib/audit';
import { ApiError, badRequest, notFound } from '@/lib/api/errors';
import {
  invitationScope,
  loadFarmInScope,
  portfolioInScope,
  requireAdmin,
} from '@/lib/admin/scope';

/**
 * GET /api/admin/invitations — codes délivrés, du plus récent au plus ancien.
 *
 * Bornés au périmètre : le secondaire ne voit que les codes rattachés à ses
 * portefeuilles. Les codes d'administration n'en ont pas, il ne les voit donc
 * jamais.
 */
export const GET = route(async () => {
  const { scope } = await requireAdmin('invitations:read');

  const invitations = await prisma.invitationCode.findMany({
    where: invitationScope(scope),
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      farm: { select: { name: true } },
      portfolio: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      usedBy: { select: { email: true } },
    },
  });

  return ok({
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      codeHint: invitation.codeHint,
      purpose: invitation.purpose,
      accountType: invitation.accountType,
      status: invitationStatus(invitation),
      email: invitation.email,
      farmName: invitation.farm?.name ?? null,
      portfolioName: invitation.portfolio?.name ?? null,
      role: invitation.role,
      grantsPlatformAdmin: invitation.grantsPlatformAdmin,
      grantsSecondaryAdmin: invitation.grantsSecondaryAdmin,
      note: invitation.note,
      expiresAt: invitation.expiresAt.toISOString(),
      usedAt: invitation.usedAt?.toISOString() ?? null,
      usedByEmail: invitation.usedBy?.email ?? null,
      createdAt: invitation.createdAt.toISOString(),
      createdBy: `${invitation.createdBy.firstName} ${invitation.createdBy.lastName}`,
    })),
  });
});

/**
 * POST /api/admin/invitations — délivre un code.
 *
 * La réponse contient le code en clair : c'est la seule fois où il est
 * lisible. Il n'est pas envoyé par e-mail automatiquement — l'administrateur le
 * transmet par le canal de son choix.
 *
 * Un administrateur secondaire ne délivre que des codes d'exploitant ou de
 * technicien, rattachés à l'un de ses portefeuilles : il ne peut ni créer un
 * administrateur, ni s'attribuer un client hors de son périmètre. Les codes
 * d'administrateur secondaire passent par `/api/admin/administrateurs`.
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('invitations:create');
  const { scope } = auth;
  const input = await parseBody(request, invitationCreateSchema);

  if (!scope.all && (input.accountType === 'ADMIN' || input.grantsPlatformAdmin)) {
    throw new ApiError(
      403,
      "Seul l'administrateur général délivre un code d'administration.",
      'ADMIN_GENERAL_ONLY',
    );
  }

  const farmId = input.farmId && input.farmId.length > 0 ? input.farmId : null;
  let portfolioId = input.portfolioId && input.portfolioId.length > 0 ? input.portfolioId : null;

  if (farmId) {
    // Rejoindre une exploitation : elle doit être dans le périmètre, et c'est
    // son portefeuille qui s'applique.
    const farm = await loadFarmInScope(scope, farmId);
    if (farm.deletedAt) throw notFound('Exploitation introuvable');
    portfolioId = farm.portfolioId;
  } else if (input.accountType !== 'ADMIN') {
    if (portfolioId) {
      if (!portfolioInScope(scope, portfolioId)) throw notFound('Portefeuille introuvable');
      const exists = await prisma.managementPortfolio.count({ where: { id: portfolioId } });
      if (!exists) throw notFound('Portefeuille introuvable');
    } else if (!scope.all) {
      // Le secondaire rattache toujours ce qu'il invite : sans portefeuille,
      // le nouveau client sortirait aussitôt de son périmètre.
      if (scope.portfolioIds.length !== 1) {
        throw badRequest('Choisissez le portefeuille où arrivera ce nouveau client.');
      }
      portfolioId = scope.portfolioIds[0] ?? null;
    }
  } else {
    portfolioId = null;
  }

  // Un compte d'administration sans le droit d'administrer ne pourrait rien
  // faire : ni parcelles, ni portefeuille, ni écrans de gestion. Le type
  // implique donc le droit, sans qu'on ait à y penser en créant le code.
  const grantsPlatformAdmin =
    input.grantsPlatformAdmin || impliesPlatformAdmin(input.accountType);

  const { invitation, code } = await createInvitation({
    createdById: auth.user.id,
    accountType: input.accountType,
    email: input.email || null,
    // Ni l'expert ni l'administrateur ne rejoignent une exploitation : le
    // portefeuille du premier se remplit ensuite, par les codes que les
    // exploitations lui remettent ; le second n'en gère aucune.
    farmId: input.accountType === 'FARMER' ? farmId : null,
    role: input.role,
    grantsPlatformAdmin,
    portfolioId,
    note: input.note || null,
    validityDays: input.validityDays,
  });

  await logAudit({
    action: 'invitation.created',
    userId: auth.user.id,
    farmId,
    entity: 'InvitationCode',
    entityId: invitation.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: {
      role: input.role,
      accountType: input.accountType,
      restrictedTo: input.email || null,
      grantsPlatformAdmin,
      portfolioId,
      actorRole: scope.role,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });

  return ok(
    {
      message: 'Code créé. Notez-le : il ne sera plus affiché.',
      code,
      invitation: {
        id: invitation.id,
        codeHint: invitation.codeHint,
        accountType: invitation.accountType,
        role: invitation.role,
        email: invitation.email,
        portfolioId: invitation.portfolioId,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    },
    201,
  );
});
