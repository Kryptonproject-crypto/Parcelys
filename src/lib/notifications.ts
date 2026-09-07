import 'server-only';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { notificationEmail } from '@/lib/email/templates';

export type NotificationType =
  | 'WEATHER'
  | 'INTERVENTION_REMINDER'
  | 'REGISTRY_CHECK'
  | 'EPHY_SYNC'
  | 'EXPIRATION'
  | 'ACCOUNT_SECURITY';

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  WEATHER: 'Météo',
  INTERVENTION_REMINDER: "Rappel d'intervention",
  REGISTRY_CHECK: 'Vérification de registre',
  EPHY_SYNC: 'Synchronisation E-Phy',
  EXPIRATION: 'Expiration',
  ACCOUNT_SECURITY: 'Sécurité du compte',
};

export async function createNotification(params: {
  userId: string;
  farmId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Double l'alerte d'un e-mail si l'utilisateur l'a activé dans ses préférences. */
  alsoEmail?: boolean;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: params.userId,
      farmId: params.farmId ?? null,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      link: params.link ?? null,
    },
  });

  if (!params.alsoEmail) return;

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true, firstName: true, notifyByEmail: true, deletedAt: true },
  });
  if (!user || user.deletedAt || !user.notifyByEmail) return;

  await sendEmail(
    notificationEmail({
      to: user.email,
      firstName: user.firstName,
      title: params.title,
      body: params.body ?? '',
      link: params.link,
    }),
  );
}

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAsRead(userId: string, ids?: string[]): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return count;
}

/** Notifie tous les membres d'une exploitation (hors auteur éventuel). */
export async function notifyFarmMembers(params: {
  farmId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  excludeUserId?: string;
  alsoEmail?: boolean;
}): Promise<void> {
  const members = await prisma.farmMember.findMany({
    where: {
      farmId: params.farmId,
      ...(params.excludeUserId ? { userId: { not: params.excludeUserId } } : {}),
    },
    select: { userId: true },
  });

  await Promise.all(
    members.map((m) =>
      createNotification({
        userId: m.userId,
        farmId: params.farmId,
        type: params.type,
        title: params.title,
        body: params.body,
        link: params.link,
        alsoEmail: params.alsoEmail,
      }),
    ),
  );
}
