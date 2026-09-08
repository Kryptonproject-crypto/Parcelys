import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { userActionSchema } from '@/lib/validation/admin';
import {
  assertNotLastAdmin,
  assertNotSelf,
  loadManagedUser,
} from '@/lib/admin/users';
import { revokeAllSessions } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit';
import { conflict, notFound } from '@/lib/api/errors';
import type { AuditAction } from '@/lib/audit';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * PATCH /api/admin/users/:id — actions d'administration sur un compte.
 *
 * Chaque action est nommée explicitement plutôt qu'exposée sous forme de champs
 * modifiables : l'API ne permet pas de toucher au mot de passe, à l'adresse ni
 * aux données agronomiques d'un tiers.
 */
export const PATCH = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requirePlatformAdmin();
  const { id } = await context.params;
  if (!id) throw notFound('Compte introuvable');

  const target = await loadManagedUser(id);
  if (target.deletedAt) throw notFound('Compte introuvable');

  const input = await parseBody(request, userActionSchema);
  const ip = clientIp(request);
  const userAgent = request.headers.get('user-agent');

  let message: string;
  let action: AuditAction;
  const metadata: Record<string, unknown> = { targetEmail: target.email };

  switch (input.action) {
    case 'suspend': {
      assertNotSelf(
        auth.user.id,
        target.id,
        'Vous ne pouvez pas suspendre votre propre compte.',
      );
      await assertNotLastAdmin(
        target,
        "Impossible de suspendre le dernier administrateur de l'instance.",
      );
      await prisma.user.update({
        where: { id: target.id },
        data: {
          suspendedAt: new Date(),
          suspendedReason: input.reason?.trim() || null,
        },
      });
      // Les sessions ouvertes cessent immédiatement.
      await revokeAllSessions(target.id);
      action = 'admin.user_suspended';
      metadata.reason = input.reason || null;
      message = 'Compte suspendu et sessions fermées.';
      break;
    }

    case 'restore': {
      await prisma.user.update({
        where: { id: target.id },
        data: { suspendedAt: null, suspendedReason: null },
      });
      action = 'admin.user_restored';
      message = 'Compte réactivé.';
      break;
    }

    case 'unlock': {
      await prisma.user.update({
        where: { id: target.id },
        data: { lockedUntil: null, failedLoginCount: 0 },
      });
      action = 'admin.user_unlocked';
      message = 'Verrouillage levé.';
      break;
    }

    case 'verify-email': {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { emailVerifiedAt: true },
      });
      if (user.emailVerifiedAt) {
        return ok({ message: 'Cette adresse était déjà vérifiée.', id: target.id });
      }
      await prisma.user.update({
        where: { id: target.id },
        data: { emailVerifiedAt: new Date() },
      });
      action = 'admin.user_email_verified';
      message = 'Adresse marquée comme vérifiée.';
      break;
    }

    case 'revoke-sessions': {
      const count = await revokeAllSessions(target.id);
      action = 'admin.user_sessions_revoked';
      metadata.sessions = count;
      message =
        count > 0
          ? `${count} session(s) fermée(s).`
          : 'Aucune session ouverte pour ce compte.';
      break;
    }

    case 'set-platform-admin': {
      if (!input.value) {
        assertNotSelf(
          auth.user.id,
          target.id,
          'Vous ne pouvez pas retirer votre propre rôle d’administrateur.',
        );
        await assertNotLastAdmin(
          target,
          "Impossible de retirer le dernier administrateur de l'instance.",
        );
      }
      await prisma.user.update({
        where: { id: target.id },
        data: { isPlatformAdmin: input.value },
      });
      action = 'admin.platform_role_changed';
      metadata.isPlatformAdmin = input.value;
      message = input.value
        ? 'Rôle administrateur accordé.'
        : 'Rôle administrateur retiré.';
      break;
    }
  }

  await logAudit({
    action,
    userId: auth.user.id,
    entity: 'User',
    entityId: target.id,
    ipAddress: ip,
    userAgent,
    metadata,
  });

  return ok({ message, id: target.id });
});

/**
 * DELETE /api/admin/users/:id — suppression logique.
 *
 * Les données agronomiques (interventions, registres) restent attachées à leur
 * exploitation : ce sont des enregistrements réglementaires que l'exploitant
 * doit conserver. Seul l'accès du compte est supprimé. La suppression complète
 * des données personnelles reste à la main de l'intéressé, depuis son profil.
 */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requirePlatformAdmin();
  const { id } = await context.params;
  if (!id) throw notFound('Compte introuvable');

  const target = await loadManagedUser(id);
  if (target.deletedAt) return ok({ message: 'Compte déjà supprimé.', id });

  assertNotSelf(
    auth.user.id,
    target.id,
    'Vous ne pouvez pas supprimer votre propre compte depuis l’administration. Utilisez votre profil.',
  );
  await assertNotLastAdmin(
    target,
    "Impossible de supprimer le dernier administrateur de l'instance.",
  );

  // Une exploitation dont ce compte est l'unique propriétaire deviendrait
  // inaccessible : on refuse plutôt que de laisser des données orphelines.
  const ownedFarms = await prisma.farm.findMany({
    where: {
      deletedAt: null,
      members: { some: { userId: target.id, role: 'OWNER' } },
    },
    select: {
      name: true,
      _count: { select: { members: true } },
      members: { where: { role: 'OWNER', userId: { not: target.id } }, select: { id: true } },
    },
  });

  const orphaned = ownedFarms.filter((farm) => farm.members.length === 0);
  if (orphaned.length > 0) {
    throw conflict(
      `Ce compte est l'unique propriétaire de : ${orphaned
        .map((f) => f.name)
        .join(', ')}. Désignez d'abord un autre propriétaire.`,
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        deletedAt: now,
        suspendedAt: now,
        suspendedReason: 'Compte supprimé par un administrateur',
        isPlatformAdmin: false,
      },
    });
    await tx.session.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: now },
    });
  });

  await logAudit({
    action: 'admin.user_deleted',
    userId: auth.user.id,
    entity: 'User',
    entityId: target.id,
    ipAddress: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    metadata: { targetEmail: target.email },
  });

  return ok({ message: 'Compte supprimé.', id: target.id });
});
