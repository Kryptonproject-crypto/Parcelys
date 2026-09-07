import type { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { countUnread, listNotifications, markAsRead } from '@/lib/notifications';
import { z } from 'zod';

/** GET /api/notifications — notifications de l'utilisateur. */
export const GET = route(async () => {
  const auth = await requireAuth();
  const [items, unread] = await Promise.all([
    listNotifications(auth.user.id),
    countUnread(auth.user.id),
  ]);
  return ok({ items, unread });
});

const markSchema = z.object({ ids: z.array(z.string()).optional() });

/** PATCH /api/notifications — marque des notifications comme lues. */
export const PATCH = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  const input = await parseBody(request, markSchema);
  const count = await markAsRead(auth.user.id, input.ids);
  return ok({ message: `${count} notification(s) marquée(s) comme lue(s)`, count });
});
