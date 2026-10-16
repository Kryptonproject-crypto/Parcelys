import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { secondaryActionSchema } from '@/lib/validation/admin';
import { revokeAllSessions } from '@/lib/auth/session';
import { ApiError, conflict, notFound } from '@/lib/api/errors';
import { logAudit, type AuditAction } from '@/lib/audit';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * PATCH /api/admin/administrateurs/:id — gestion d'un administrateur secondaire.
 *
 * Administrateur général seul. Les actions :
 *   promote          un compte d'administration sans rôle devient secondaire ;
 *   add-portfolio    élargit son périmètre d'un portefeuille ;
 *   remove-portfolio le réduit d'un portefeuille ;
 *   deactivate       suspend le compte (sessions fermées, réversible) ;
 *   reactivate       lève la suspension ;
 *   revoke           retire le rôle et tous les portefeuilles, ferme les
 *                    sessions — le compte subsiste, sans aucun droit.
 *
 * Aucune de ces actions ne touche un administrateur général, et aucune ne
 * peut en créer un : nommer un général passe par la gestion des comptes.
 */
export const PATCH = route(async (request: NextRequest, context: Ctx) => {
  const auth = await requireAdmin('admins:manage');
  const { id } = await context.params;
  const input = await parseBody(request, secondaryActionSchema);
  const ip = clientIp(request);

  const target = await prisma.user.findFirst({
    where: { id: id ?? '', deletedAt: null },
    select: {
      id: true,
      email: true,
      accountType: true,
      isPlatformAdmin: true,
      isSecondaryAdmin: true,
      suspendedAt: true,
    },
  });
  if (!target) throw notFound('Compte introuvable');
  if (target.isPlatformAdmin) {
    throw new ApiError(
      409,
      'Ce compte est administrateur général : ces actions ne concernent que les secondaires.',
      'TARGET_IS_GENERAL_ADMIN',
    );
  }
  if (target.id === auth.user.id) {
    throw new ApiError(409, 'Action impossible sur votre propre compte.', 'SELF_ACTION_FORBIDDEN');
  }

  const loadPortfolio = async (portfolioId: string) => {
    const portfolio = await prisma.managementPortfolio.findUnique({
      where: { id: portfolioId },
      select: { id: true, name: true },
    });
    if (!portfolio) throw notFound('Portefeuille introuvable');
    return portfolio;
  };

  let action: AuditAction;
  let message: string;
  const metadata: Record<string, unknown> = { targetEmail: target.email };

  switch (input.action) {
    case 'promote': {
      if (target.isSecondaryAdmin) throw conflict('Ce compte est déjà administrateur secondaire.');
      // Seul un compte d'administration devient secondaire : un exploitant ou
      // un technicien garde son métier, et ne mélange pas ses propres données
      // avec celles qu'il administrerait.
      if (target.accountType !== 'ADMIN') {
        throw new ApiError(
          409,
          "Seul un compte d'administration peut devenir administrateur secondaire. Invitez la personne avec un code d'administrateur secondaire.",
          'NOT_ADMIN_ACCOUNT',
        );
      }
      const portfolio = await loadPortfolio(input.portfolioId);
      await prisma.$transaction([
        prisma.user.update({ where: { id: target.id }, data: { isSecondaryAdmin: true } }),
        prisma.portfolioManager.create({
          data: { portfolioId: portfolio.id, userId: target.id, grantedById: auth.user.id },
        }),
      ]);
      action = 'admin.secondary_promoted';
      metadata.portfolio = portfolio.name;
      message = `Administrateur secondaire du portefeuille « ${portfolio.name} ».`;
      break;
    }

    case 'add-portfolio': {
      if (!target.isSecondaryAdmin) throw conflict("Ce compte n'est pas administrateur secondaire.");
      const portfolio = await loadPortfolio(input.portfolioId);
      const exists = await prisma.portfolioManager.findUnique({
        where: { portfolioId_userId: { portfolioId: portfolio.id, userId: target.id } },
      });
      if (exists) return ok({ message: 'Ce portefeuille faisait déjà partie de son périmètre.', id: target.id });
      await prisma.portfolioManager.create({
        data: { portfolioId: portfolio.id, userId: target.id, grantedById: auth.user.id },
      });
      action = 'admin.secondary_scope_added';
      metadata.portfolio = portfolio.name;
      message = `Portefeuille « ${portfolio.name} » ajouté à son périmètre.`;
      break;
    }

    case 'remove-portfolio': {
      if (!target.isSecondaryAdmin) throw conflict("Ce compte n'est pas administrateur secondaire.");
      const portfolio = await loadPortfolio(input.portfolioId);
      const { count } = await prisma.portfolioManager.deleteMany({
        where: { portfolioId: portfolio.id, userId: target.id },
      });
      if (count === 0) return ok({ message: 'Ce portefeuille ne faisait pas partie de son périmètre.', id: target.id });
      // Les demandes qui lui étaient attribuées dans ce portefeuille repassent
      // au responsable suivant — ou à personne, et donc au général.
      await prisma.supportTicket.updateMany({
        where: { portfolioId: portfolio.id, assigneeId: target.id },
        data: { assigneeId: null },
      });
      action = 'admin.secondary_scope_removed';
      metadata.portfolio = portfolio.name;
      message = `Portefeuille « ${portfolio.name} » retiré de son périmètre.`;
      break;
    }

    case 'deactivate': {
      if (!target.isSecondaryAdmin) throw conflict("Ce compte n'est pas administrateur secondaire.");
      await prisma.user.update({
        where: { id: target.id },
        data: { suspendedAt: new Date(), suspendedReason: input.reason?.trim() || 'Désactivé par l’administrateur général' },
      });
      await revokeAllSessions(target.id);
      action = 'admin.secondary_deactivated';
      metadata.reason = input.reason || null;
      message = 'Administrateur désactivé : sessions fermées, périmètre conservé.';
      break;
    }

    case 'reactivate': {
      if (!target.isSecondaryAdmin && target.accountType !== 'ADMIN') {
        throw conflict("Ce compte n'est pas un compte d'administration.");
      }
      await prisma.user.update({
        where: { id: target.id },
        data: { suspendedAt: null, suspendedReason: null },
      });
      action = 'admin.secondary_reactivated';
      message = 'Administrateur réactivé.';
      break;
    }

    case 'revoke': {
      if (!target.isSecondaryAdmin) throw conflict("Ce compte n'est pas administrateur secondaire.");
      const removed = await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: target.id }, data: { isSecondaryAdmin: false } });
        await tx.supportTicket.updateMany({ where: { assigneeId: target.id }, data: { assigneeId: null } });
        const { count } = await tx.portfolioManager.deleteMany({ where: { userId: target.id } });
        return count;
      });
      await revokeAllSessions(target.id);
      action = 'admin.secondary_revoked';
      metadata.portfoliosRemoved = removed;
      message = 'Accès d’administration révoqué. Le compte subsiste, sans aucun droit.';
      break;
    }
  }

  await logAudit({
    action,
    userId: auth.user.id,
    entity: 'User',
    entityId: target.id,
    ipAddress: ip,
    userAgent: request.headers.get('user-agent'),
    metadata,
  });

  return ok({ message, id: target.id });
});
