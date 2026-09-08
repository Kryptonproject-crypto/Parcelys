import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import {
  advisoryCodeCreateSchema,
  engagementRevokeSchema,
} from '@/lib/validation/advisory';
import { createInvitation } from '@/lib/auth/invitations';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

/**
 * Experts agronomiques suivant l'exploitation.
 *
 * C'est l'exploitation qui décide : elle délivre un code d'accès à l'expert de
 * son choix, et peut mettre fin à la mission quand elle veut. Un administrateur
 * d'instance ne s'immisce pas dans ce lien — il crée les comptes experts, pas
 * les missions.
 */

/** GET /api/farms/advisors — missions en cours et codes en attente. */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('advisor:manage');

  const [engagements, codes] = await Promise.all([
    prisma.advisoryEngagement.findMany({
      where: { farmId: ctx.farmId },
      include: {
        expert: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            organization: true,
            advisorCertificate: true,
          },
        },
        grantedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.invitationCode.findMany({
      where: {
        farmId: ctx.farmId,
        purpose: 'ADVISORY_ACCESS',
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        codeHint: true,
        email: true,
        note: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return ok({
    engagements: engagements.map((engagement) => ({
      id: engagement.id,
      status: engagement.status,
      startedAt: engagement.startedAt.toISOString(),
      endedAt: engagement.endedAt?.toISOString() ?? null,
      note: engagement.note,
      grantedBy: engagement.grantedBy
        ? `${engagement.grantedBy.firstName} ${engagement.grantedBy.lastName}`
        : null,
      expert: {
        id: engagement.expert.id,
        name: `${engagement.expert.firstName} ${engagement.expert.lastName}`,
        email: engagement.expert.email,
        organization: engagement.expert.organization,
        // Affiché tel que saisi : Parcelys ne vérifie pas ce numéro et ne le
        // présente jamais comme validé.
        certificate: engagement.expert.advisorCertificate,
      },
    })),
    pendingCodes: codes.map((code) => ({
      id: code.id,
      codeHint: code.codeHint,
      email: code.email,
      note: code.note,
      expiresAt: code.expiresAt.toISOString(),
      createdAt: code.createdAt.toISOString(),
    })),
  });
});

/**
 * POST /api/farms/advisors — délivre un code d'accès conseil.
 *
 * Le code est renvoyé en clair une seule fois, comme tous les codes de
 * Parcelys : la base n'en garde que l'empreinte.
 */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('advisor:manage');
  const input = await parseBody(request, advisoryCodeCreateSchema);

  const { invitation, code } = await createInvitation({
    createdById: ctx.user.id,
    purpose: 'ADVISORY_ACCESS',
    farmId: ctx.farmId,
    role: 'ADVISOR',
    email: input.email || null,
    note: input.note || null,
    validityDays: input.validityDays,
  });

  await logAudit({
    action: 'advisor.access_granted',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'InvitationCode',
    entityId: invitation.id,
    ipAddress: clientIp(request),
    metadata: { restrictedTo: input.email || null },
  });

  return ok(
    {
      message: 'Code créé. Notez-le : il ne sera plus affiché.',
      code,
      expiresAt: invitation.expiresAt.toISOString(),
    },
    201,
  );
});

/**
 * DELETE /api/farms/advisors — met fin à une mission de conseil.
 *
 * L'expert perd immédiatement l'accès : ses préconisations passées restent,
 * elles font partie de l'historique de l'exploitation.
 */
export const DELETE = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('advisor:manage');
  const input = await parseBody(request, engagementRevokeSchema);

  const engagement = await prisma.advisoryEngagement.findFirst({
    where: { id: input.engagementId, farmId: ctx.farmId },
    include: { expert: { select: { email: true } } },
  });
  if (!engagement) throw notFound('Mission introuvable');

  if (engagement.status === 'ENDED') {
    return ok({ message: 'Cette mission était déjà terminée.', id: engagement.id });
  }

  await prisma.advisoryEngagement.update({
    where: { id: engagement.id },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  await logAudit({
    action: 'advisor.access_revoked',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'AdvisoryEngagement',
    entityId: engagement.id,
    ipAddress: clientIp(request),
    metadata: { expertEmail: engagement.expert.email },
  });

  return ok({ message: "L'accès de cet expert a été retiré.", id: engagement.id });
});
