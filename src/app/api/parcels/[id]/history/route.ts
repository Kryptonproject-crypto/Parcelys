import type { NextRequest } from 'next/server';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { buildHistory, type HistoryEventKind } from '@/lib/services/history';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/** GET /api/parcels/:id/history — chronologie complète de la parcelle. */
export const GET = route(async (request: NextRequest, context: Ctx) => {
  const params = await context.params;
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');

  await requireParcelAccess(id, 'record:read');

  const kindsParam = request.nextUrl.searchParams.get('kinds');
  const kinds = kindsParam
    ? (kindsParam.split(',').filter(Boolean) as HistoryEventKind[])
    : undefined;

  const events = await buildHistory({ parcelIds: [id], kinds, limit: 500 });
  return ok({ events });
});
