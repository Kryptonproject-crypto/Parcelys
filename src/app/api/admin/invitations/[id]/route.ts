import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import { logAudit } from '@/lib/audit';
import { conflict, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * DELETE /api/admin/invitations/:id — révoque un code non encore utilisé.
 *
 * Le code n'est pas supprimé : la trace de son émission et de sa révocation
 * fait partie du journal.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requirePlatformAdmin();
  const { id } = await context.params;
  if (!id) throw notFound('Invitation introuvable');

  const invitation = await prisma.invitationCode.findUnique({ where: { id } });
  if (!invitation) throw notFound('Invitation introuvable');

  const status = invitationStatus(invitation);
  if (status === 'USED') {
    throw conflict('Ce code a déjà été utilisé : il ne peut plus être révoqué.');
  }
  if (status === 'REVOKED') {
    return ok({ message: 'Ce code était déjà révoqué.', id });
  }

  await prisma.invitationCode.update({
    where: { id },
    data: { revokedAt: new Date(), revokedById: auth.user.id },
  });

  await logAudit({
    action: 'invitation.revoked',
    userId: auth.user.id,
    entity: 'InvitationCode',
    entityId: id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { codeHint: invitation.codeHint },
  });

  return ok({ message: 'Code révoqué.', id });
});
