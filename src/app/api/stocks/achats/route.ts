import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { StockCategory } from '@prisma/client';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { badRequest } from '@/lib/api/errors';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import { enregistrerAchat } from '@/lib/services/stock';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

const Achat = z.object({
  category: z.nativeEnum(StockCategory),
  phytoProductId: z.string().trim().min(1).max(40).nullable().optional(),
  fertilizerId: z.string().trim().min(1).max(40).nullable().optional(),
  organicInputId: z.string().trim().min(1).max(40).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  quantity: z.number().positive('Quantité positive attendue').max(1_000_000),
  unit: z.string().trim().min(1).max(20),
  purchasedOn: date,
  lotNumber: z.string().trim().max(100).nullable().optional(),
  supplier: z.string().trim().max(200).nullable().optional(),
  expiresOn: date.nullable().optional(),
  unitPrice: z.number().nonnegative().max(1_000_000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * POST /api/stocks/achats — un achat : l'article (créé au premier achat), le
 * lot et l'entrée en stock, en une fois.
 */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:write');
  const body = await parseBody(request, Achat);
  const jour = (iso: string) => new Date(`${iso}T12:00:00Z`);
  if (jour(body.purchasedOn) > new Date(Date.now() + 86_400_000)) {
    throw badRequest('La date d’achat est dans le futur.');
  }

  const resultat = await enregistrerAchat(ctx.farmId, {
    category: body.category,
    phytoProductId: body.phytoProductId ?? null,
    fertilizerId: body.fertilizerId ?? null,
    organicInputId: body.organicInputId ?? null,
    name: body.name ?? null,
    quantity: body.quantity,
    unit: body.unit,
    purchasedOn: jour(body.purchasedOn),
    lotNumber: body.lotNumber ?? null,
    supplier: body.supplier ?? null,
    expiresOn: body.expiresOn ? jour(body.expiresOn) : null,
    unitPrice: body.unitPrice ?? null,
    notes: body.notes ?? null,
    createdById: ctx.user.id,
  });
  if (!resultat.ok) throw badRequest(resultat.raison);

  await logAudit({
    action: 'stock.purchase',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'stockLot',
    entityId: resultat.lotId,
    ipAddress: clientIp(request),
    metadata: { quantity: body.quantity, unit: body.unit, itemCreated: resultat.cree },
  });

  return ok({ ...resultat, message: 'Achat enregistré' }, 201);
});
