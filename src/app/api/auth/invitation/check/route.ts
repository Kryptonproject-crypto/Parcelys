import type { NextRequest } from 'next/server';
import { checkInvitationSchema } from '@/lib/validation/auth';
import { findUsableInvitation } from '@/lib/auth/invitations';
import { ROLE_LABELS } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { logAudit } from '@/lib/audit';

/**
 * POST /api/auth/invitation/check
 *
 * Vérifie un code d'invitation sans le consommer, pour que le formulaire
 * d'inscription puisse s'adapter : rattachement à une exploitation existante ou
 * création d'une nouvelle exploitation, rôle accordé, adresse imposée.
 *
 * Le point d'entrée est public, comme l'inscription elle-même, mais fortement
 * limité en débit : le seul renseignement qu'il donne est celui que possède
 * déjà quiconque détient le code.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  await enforceRateLimit(
    `invitation:${ip}`,
    RateLimits.invitationAttempt,
    "Trop d'essais de code d'invitation. Réessayez dans un quart d'heure.",
  );

  const input = await parseBody(request, checkInvitationSchema);

  let invitation: Awaited<ReturnType<typeof findUsableInvitation>>;
  try {
    invitation = await findUsableInvitation(input.code, input.email || null);
  } catch (error) {
    await logAudit({
      action: 'invitation.rejected',
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
      metadata: { stage: 'check' },
    });
    throw error;
  }

  // Un code d'accès conseil ne s'active pas ici : il n'appelle pas la création
  // d'un compte, mais l'ajout d'une exploitation au portefeuille d'un expert
  // déjà inscrit. Le dire tout de suite évite un parcours d'inscription inutile.
  if (invitation.purpose === 'ADVISORY_ACCESS') {
    return ok({
      scope: 'ADVISORY_ACCESS' as const,
      farmName: invitation.farm?.name ?? null,
      accountType: 'AGRONOMIST' as const,
      role: invitation.role,
      roleLabel: ROLE_LABELS[invitation.role],
      email: invitation.email,
      grantsPlatformAdmin: false,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  }

  return ok({
    scope:
      invitation.accountType === 'AGRONOMIST'
        ? ('EXPERT_ACCOUNT' as const)
        : invitation.farmId
          ? ('EXISTING_FARM' as const)
          : ('NEW_FARM' as const),
    accountType: invitation.accountType,
    farmName: invitation.farm?.name ?? null,
    role: invitation.role,
    roleLabel: ROLE_LABELS[invitation.role],
    email: invitation.email,
    grantsPlatformAdmin: invitation.grantsPlatformAdmin,
    expiresAt: invitation.expiresAt.toISOString(),
  });
});
