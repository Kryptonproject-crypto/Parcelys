import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageAuth } from '@/lib/auth/page-guards';
import { listNotifications, NOTIFICATION_LABELS, type NotificationType } from '@/lib/notifications';
import { MarkAllRead } from '@/app/(app)/notifications/MarkAllRead';
import { Badge, Card, EmptyState, PageHeader, formatDateFr } from '@/components/ui';
import { IconNotification } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const auth = await requirePageAuth();
  const notifications = await listNotifications(auth.user.id, 100);
  const unread = notifications.filter((n) => n.readAt === null).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={`${notifications.length} notification${notifications.length > 1 ? 's' : ''}${unread > 0 ? ` · ${unread} non lue${unread > 1 ? 's' : ''}` : ''}`}
        actions={unread > 0 ? <MarkAllRead /> : undefined}
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={IconNotification}
          title="Aucune notification"
          description="Vous serez alerté ici des rappels d'intervention, des points de vigilance sur vos registres et des mises à jour du référentiel E-Phy."
        />
      ) : (
        <ul className="space-y-3">
          {notifications.map((notification) => {
            const body = (
              <Card
                className={
                  notification.readAt === null ? 'border-champ-300 bg-accent-soft/30' : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={notification.readAt === null ? 'green' : 'neutral'}>
                        {NOTIFICATION_LABELS[notification.type as NotificationType] ??
                          notification.type}
                      </Badge>
                      <span className="text-xs text-ink-3">
                        {formatDateFr(notification.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 font-medium text-ink">
                      {notification.title}
                    </p>
                    {notification.body ? (
                      <p className="mt-0.5 text-sm text-ink-2">{notification.body}</p>
                    ) : null}
                  </div>
                  {notification.readAt === null ? (
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-champ-500"
                      aria-label="Non lue"
                    />
                  ) : null}
                </div>
              </Card>
            );

            return (
              <li key={notification.id}>
                {notification.link ? (
                  <Link href={notification.link} className="block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
