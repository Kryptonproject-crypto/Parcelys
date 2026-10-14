import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { conflict } from '@/lib/api/errors';
import { organicProductSchema } from '@/lib/validation/farming';
import { verifierClassement } from '@/lib/regulatory/gren-options';

/** GET /api/organic-inputs — produits organiques disponibles. */
export const GET = route(async () => {
  const ctx = await requireFarmAccess('record:read');

  const items = await prisma.organicInput.findMany({
    where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return ok({ items });
});

/**
 * POST /api/organic-inputs — crée un produit organique propre à l'exploitation,
 * avec ses teneurs et son classement réglementaire déclaré.
 *
 * Les produits génériques (fumier bovin, lisier porcin…) sont communs à toutes
 * les exploitations et n'ont ni teneur ni classement : un fumier n'est pas un
 * autre fumier. L'exploitant crée le sien, d'après son analyse.
 */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('referential:write');
  const input = await parseBody(request, organicProductSchema);
  await verifierClassement(input.regulatoryClass ?? null);

  const existant = await prisma.organicInput.findFirst({
    where: { farmId: ctx.farmId, name: input.name },
    select: { id: true },
  });
  if (existant) throw conflict('Un produit porte déjà ce nom dans votre exploitation.');

  const item = await prisma.organicInput.create({
    data: {
      farmId: ctx.farmId,
      name: input.name,
      category: input.category ?? 'Personnalisé',
      nContent: input.nContent ?? null,
      pContent: input.pContent ?? null,
      kContent: input.kContent ?? null,
      dryMatter: input.dryMatter ?? null,
      defaultUnit: input.defaultUnit,
      regulatoryClass: (input.regulatoryClass ?? undefined) as Prisma.InputJsonValue | undefined,
      isCustom: true,
    },
  });
  return ok({ item, message: 'Produit créé' }, 201);
});
