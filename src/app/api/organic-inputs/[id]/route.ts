import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { conflict, notFound } from '@/lib/api/errors';
import { organicProductSchema } from '@/lib/validation/farming';
import { verifierClassement } from '@/lib/regulatory/gren-options';

type Contexte = { params: Promise<Record<string, string>> };

/**
 * PATCH /api/organic-inputs/[id] — modifie un produit de l'exploitation.
 *
 * Seuls les produits **de l'exploitation** se modifient : un produit générique
 * est partagé, et le changer ici le changerait ailleurs. Les apports déjà
 * enregistrés gardent l'azote calculé à leur saisie.
 */
export const PATCH = route(async (request: NextRequest, { params }: Contexte) => {
  const ctx = await requireFarmAccess('referential:write');
  const id = (await params).id;
  if (!id) throw notFound('Produit introuvable dans votre exploitation');
  const input = await parseBody(request, organicProductSchema);
  await verifierClassement(input.regulatoryClass ?? null);

  const produit = await prisma.organicInput.findFirst({
    where: { id, farmId: ctx.farmId },
    select: { id: true },
  });
  if (!produit) throw notFound('Produit introuvable dans votre exploitation');

  const homonyme = await prisma.organicInput.findFirst({
    where: { farmId: ctx.farmId, name: input.name, id: { not: id } },
    select: { id: true },
  });
  if (homonyme) throw conflict('Un autre produit porte déjà ce nom.');

  const item = await prisma.organicInput.update({
    where: { id },
    data: {
      name: input.name,
      category: input.category ?? 'Personnalisé',
      nContent: input.nContent ?? null,
      pContent: input.pContent ?? null,
      kContent: input.kContent ?? null,
      dryMatter: input.dryMatter ?? null,
      defaultUnit: input.defaultUnit,
      regulatoryClass: input.regulatoryClass
        ? (input.regulatoryClass as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });
  return ok({ item, message: 'Produit modifié' });
});
