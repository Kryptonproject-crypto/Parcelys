import type { NextRequest } from 'next/server';
import type { FarmRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createsFarmOnRegistration, impliesPlatformAdmin } from '@/lib/auth/accounts';
import { registerSchema } from '@/lib/validation/auth';
import { hashPassword } from '@/lib/auth/password';
import { issueVerificationCode } from '@/lib/auth/verification';
import {
  consumeInvitation,
  findUsableInvitation,
  isBootstrapAllowed,
} from '@/lib/auth/invitations';
import { clientIp, enforceRateLimit, ok, parseBody, route } from '@/lib/api/handler';
import { RateLimits } from '@/lib/auth/rate-limit';
import { logAudit } from '@/lib/audit';
import { DEFAULT_CROPS } from '@/lib/constants/agronomy';
import { ApiError, conflict } from '@/lib/api/errors';

/**
 * POST /api/auth/register
 *
 * L'inscription publique est fermée : un code d'invitation délivré par un
 * administrateur est obligatoire. Seule exception, l'amorçage — tant que la
 * base ne contient aucun compte, le premier inscrit devient l'administrateur de
 * l'instance ; il n'y a alors personne pour lui remettre un code.
 *
 * Selon le code, le nouveau compte crée sa propre exploitation (rôle
 * propriétaire) ou rejoint une exploitation existante avec le rôle prévu par
 * l'invitation. L'utilisateur n'est pas connecté tant que son adresse n'est pas
 * vérifiée.
 */
export const POST = route(async (request: NextRequest) => {
  const ip = clientIp(request);
  await enforceRateLimit(
    `register:${ip}`,
    RateLimits.register,
    'Trop de créations de compte depuis cette adresse. Réessayez dans une heure.',
  );

  const input = await parseBody(request, registerSchema);
  const emailNormalized = input.email.trim().toLowerCase();
  const rawCode = input.invitationCode?.trim() ?? '';

  const bootstrap = await isBootstrapAllowed();

  if (!bootstrap && rawCode.length === 0) {
    throw new ApiError(
      403,
      "Les inscriptions sont fermées. Un code d'invitation délivré par un administrateur est nécessaire pour créer un compte.",
      'INVITATION_REQUIRED',
    );
  }

  // Résolution de l'invitation avant toute écriture : un code invalide ne doit
  // laisser aucune trace de compte.
  let invitation: Awaited<ReturnType<typeof findUsableInvitation>> | null = null;
  if (!bootstrap) {
    await enforceRateLimit(
      `invitation:${ip}`,
      RateLimits.invitationAttempt,
      "Trop d'essais de code d'invitation. Réessayez dans un quart d'heure.",
    );
    try {
      invitation = await findUsableInvitation(rawCode, emailNormalized);
    } catch (error) {
      await logAudit({
        action: 'invitation.rejected',
        ipAddress: ip,
        userAgent: request.headers.get('user-agent'),
        metadata: { email: emailNormalized },
      });
      throw error;
    }
  }

  // Un code destiné à ouvrir une mission de conseil ne crée pas de compte :
  // il s'active depuis un compte expert déjà inscrit.
  if (invitation && invitation.purpose !== 'ACCOUNT') {
    throw new ApiError(
      403,
      "Ce code ouvre un accès conseil, il ne crée pas de compte. Connectez-vous à votre compte expert, puis activez-le depuis votre portefeuille.",
      'INVITATION_NOT_FOR_ACCOUNT',
    );
  }

  const accountType = invitation?.accountType ?? 'FARMER';
  // Ni l'expert ni l'administrateur n'ont d'exploitation à eux : le premier
  // suit celles qui le missionnent, le second n'en gère aucune. Leur en faire
  // créer une leur donnerait des parcelles fictives et fausserait les
  // décomptes de l'instance.
  const creeUneExploitation = createsFarmOnRegistration(accountType);

  const joinsExistingFarm = creeUneExploitation && invitation?.farmId != null;
  const farmName = input.farmName?.trim() ?? '';

  if (creeUneExploitation && !joinsExistingFarm && farmName.length === 0) {
    throw new ApiError(400, 'Données invalides', 'VALIDATION_ERROR', [
      { field: 'farmName', message: "Nom de l'exploitation requis" },
    ]);
  }

  const existing = await prisma.user.findUnique({
    where: { emailNormalized },
    select: { id: true },
  });
  if (existing) {
    throw conflict('Un compte existe déjà avec cette adresse e-mail.');
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  const role: FarmRole = invitation?.role ?? 'OWNER';

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email.trim(),
        emailNormalized,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        acceptedTermsAt: now,
        acceptedPrivacyAt: now,
        accountType,
        organization: input.organization?.trim() || null,
        // Le tout premier compte administre l'instance ; ensuite, seul un code
        // le prévoyant explicitement confère ce pouvoir. Un compte
        // d'administration l'obtient de son type : sans ce droit il n'aurait
        // ni exploitation, ni portefeuille, ni écran de gestion — rien.
        isPlatformAdmin:
          bootstrap ||
          (invitation?.grantsPlatformAdmin ?? false) ||
          impliesPlatformAdmin(accountType),
      },
    });

    if (invitation) {
      // Consommation dans la même transaction : deux inscriptions simultanées
      // avec le même code ne peuvent pas aboutir toutes les deux.
      await consumeInvitation(tx, invitation.id, created.id);
    }

    // L'expert s'arrête ici : ni exploitation, ni appartenance. Son
    // portefeuille se remplira par les codes d'accès que les exploitations lui
    // remettront.
    if (!creeUneExploitation) return created;

    if (joinsExistingFarm && invitation?.farmId) {
      await tx.farmMember.create({
        data: { farmId: invitation.farmId, userId: created.id, role },
      });
      return created;
    }

    const farm = await tx.farm.create({
      data: {
        name: farmName,
        siret: input.siret && input.siret.length > 0 ? input.siret : null,
      },
    });

    await tx.farmMember.create({
      data: { farmId: farm.id, userId: created.id, role: 'OWNER' },
    });

    // Référentiel de cultures propre à l'exploitation, modifiable ensuite.
    await tx.crop.createMany({
      data: DEFAULT_CROPS.map((crop) => ({
        farmId: farm.id,
        code: crop.code,
        name: crop.name,
        category: crop.category,
      })),
      skipDuplicates: true,
    });

    return created;
  });

  await issueVerificationCode({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
  });

  await logAudit({
    action: 'auth.register',
    userId: user.id,
    farmId: invitation?.farmId ?? null,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
    metadata: {
      bootstrap,
      accountType,
      invitationId: invitation?.id ?? null,
      farmName: !creeUneExploitation ? null : joinsExistingFarm ? invitation?.farm?.name : farmName,
      role: creeUneExploitation ? role : null,
    },
  });

  if (invitation) {
    await logAudit({
      action: 'invitation.used',
      userId: user.id,
      farmId: invitation.farmId,
      entity: 'InvitationCode',
      entityId: invitation.id,
      ipAddress: ip,
      metadata: { role },
    });
  }

  return ok(
    {
      message:
        'Compte créé. Un code de vérification à 6 chiffres vient de vous être envoyé par e-mail.',
      email: user.email,
      nextStep: 'verification-email',
    },
    201,
  );
});
