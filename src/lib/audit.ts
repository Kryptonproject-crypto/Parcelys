import 'server-only';
import { prisma } from '@/lib/prisma';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.email_verified'
  | 'auth.verification_failed'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.account_locked'
  | 'account.deleted'
  | 'account.data_exported'
  | 'farm.created'
  | 'farm.updated'
  | 'farm.member_added'
  | 'farm.member_removed'
  | 'farm.member_role_changed'
  // Suppression et rétablissement d'une exploitation par un administrateur.
  // Une exploitation porte des registres réglementaires : ces deux gestes
  // laissent une trace, même si la suppression reste logique.
  | 'farm.deleted_by_admin'
  | 'farm.restored_by_admin'
  | 'parcel.created'
  | 'parcel.updated'
  | 'parcel.geometry_updated'
  | 'parcel.deleted'
  | 'cropyear.created'
  | 'cropyear.updated'
  | 'cropyear.deleted'
  | 'fertilization.created'
  | 'fertilization.updated'
  | 'fertilization.deleted'
  | 'phyto.created'
  | 'phyto.updated'
  | 'phyto.deleted'
  | 'operation.created'
  | 'operation.updated'
  | 'operation.deleted'
  | 'soilCover.created'
  | 'soilCover.deleted'
  | 'document.uploaded'
  | 'document.downloaded'
  | 'document.deleted'
  | 'export.generated'
  | 'ephy.synced'
  | 'access.denied'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.used'
  | 'invitation.rejected'
  | 'admin.user_suspended'
  | 'admin.user_restored'
  | 'admin.user_deleted'
  | 'admin.user_unlocked'
  | 'admin.user_email_verified'
  | 'admin.user_sessions_revoked'
  | 'admin.platform_role_changed'
  | 'admin.maintenance_changed'
  | 'admin.cleanup_run'
  | 'admin.updates_checked'
  | 'advisor.access_granted'
  | 'advisor.access_revoked'
  | 'advisor.access_redeemed'
  // Rattachement décidé depuis l'administration d'instance, et non par
  // l'exploitation elle-même : distingué pour qu'un contrôle du journal
  // fasse la différence entre un accès consenti et un accès imposé.
  | 'advisor.access_granted_by_admin'
  | 'advisor.access_revoked_by_admin'
  // Échanges avec TéléPAC. Un import PAC réécrit le parcellaire : il doit
  // laisser une trace, au même titre qu'un accès aux données.
  | 'pac.imported'
  | 'pac.exported'
  | 'pac.snapshot_restored'
  | 'recommendation.created'
  | 'recommendation.updated'
  | 'recommendation.proposed'
  | 'recommendation.responded'
  | 'recommendation.applied'
  | 'recommendation.withdrawn';

/**
 * Journalisation applicative et de sécurité.
 * Ne doit jamais faire échouer l'action métier : les erreurs sont avalées.
 */
export async function logAudit(params: {
  action: AuditAction;
  farmId?: string | null;
  userId?: string | null;
  entity?: string;
  entityId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: params.action,
        farmId: params.farmId ?? null,
        userId: params.userId ?? null,
        entity: params.entity ?? null,
        entityId: params.entityId ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent?.slice(0, 300) ?? null,
        metadata: (params.metadata ?? undefined) as never,
      },
    });
  } catch (error) {
    console.error('[audit] écriture impossible', error);
  }
}

/** Purge conforme à la limitation de conservation (RGPD). */
export async function purgeOldAuditLogs(retentionDays = 365): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
