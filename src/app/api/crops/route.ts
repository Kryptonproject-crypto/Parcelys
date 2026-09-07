import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { customCropSchema } from '@/lib/validation/farming';
import { conflict } from '@/lib/api/errors';

/** GET /api/crops — référentiel de cultures (global + propre à l'exploitation). */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('record:read');

  const crops = await prisma.crop.findMany({
    where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return ok({ items: crops });
});

/** POST /api/crops — crée une culture personnalisée pour l'exploitation. */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('referential:write');
  const input = await parseBody(request, customCropSchema);

  const code = input.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .slice(0, 40);

  const existing = await prisma.crop.findFirst({
    where: { farmId: ctx.farmId, code },
    select: { id: true },
  });
  if (existing) throw conflict('Une culture porte déjà ce nom dans votre exploitation.');

  const crop = await prisma.crop.create({
    data: {
      farmId: ctx.farmId,
      code,
      name: input.name,
      category: input.category ?? 'Personnalisée',
      isCustom: true,
    },
  });

  return ok({ item: crop, message: 'Culture créée' }, 201);
});
