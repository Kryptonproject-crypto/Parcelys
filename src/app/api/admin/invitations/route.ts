import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { invitationCreateSchema } from '@/lib/validation/admin';
import { createInvitation } from '@/lib/auth/invitations';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

/** GET /api/admin/invitations — codes délivrés, du plus récent au plus ancien. */
export const GET = route(async () => {
  await requirePlatformAdmin();

  const invitations = await prisma.invitationCode.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      farm: { select: { name: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      usedBy: { select: { email: true } },
    },
  });

  return ok({
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      codeHint: invitation.codeHint,
      status: invitationStatus(invitation),
      email: invitation.email,
      farmName: invitation.farm?.name ?? null,
      role: invitation.role,
      grantsPlatformAdmin: invitation.grantsPlatformAdmin,
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
 */
export const POST = route(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin();
  const input = await parseBody(request, invitationCreateSchema);

  const farmId = input.farmId && input.farmId.length > 0 ? input.farmId : null;
  if (farmId) {
    const farm = await prisma.farm.findFirst({
      where: { id: farmId, deletedAt: null },
      select: { id: true },
    });
    if (!farm) throw notFound('Exploitation introuvable');
  }

  const { invitation, code } = await createInvitation({
    createdById: auth.user.id,
    email: input.email || null,
    farmId,
    role: input.role,
    grantsPlatformAdmin: input.grantsPlatformAdmin,
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
      restrictedTo: input.email || null,
      grantsPlatformAdmin: input.grantsPlatformAdmin,
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
        role: invitation.role,
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    },
    201,
  );
});
