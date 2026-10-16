import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { operationSchema } from '@/lib/validation/farming';
import { logAudit } from '@/lib/audit';
import { preparerTravail } from '@/lib/services/saisies';
import { notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/operations — travaux réalisés sur la parcelle. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  await requireParcelAccess(id, 'record:read');

  const items = await prisma.agriculturalOperation.findMany({
    where: { parcelId: id },
    orderBy: { performedOn: 'desc' },
  });

  return ok({ items });
});

/** POST /api/parcels/:id/operations — enregistre un travail agricole. */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx } = await requireParcelAccess(id, 'record:write');
  const input = await parseBody(request, operationSchema);

  // Mêmes champs, même météo qu'à la modification (`src/lib/services/saisies.ts`).
  const created = await prisma.agriculturalOperation.create({
    data: {
      ...(await preparerTravail({ parcel: { id }, input, modification: false })),
      parcelId: id,
      createdById: ctx.user.id,
    },
  });

  await logAudit({
    action: 'operation.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'agriculturalOperation',
    entityId: created.id,
    ipAddress: clientIp(request),
    metadata: { type: input.type },
  });

  return ok({ item: created, message: 'Travail enregistré' }, 201);
});
