import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoverDestructionMethod, SoilCoverKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess, requireParcelAccess } from '@/lib/auth/rbac';
import { badRequest } from '@/lib/api/errors';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';
import {
  couvertureExploitation,
  incoherencesDates,
} from '@/lib/regulatory/soil-cover';
import { currentCampaignYear } from '@/lib/constants/agronomy';

/**
 * GET /api/soil-covers?year= — couverture des sols de l'exploitation.
 *
 * La réponse porte l'état du référentiel régional, et pas seulement les
 * couverts : sans lui, aucune période de couverture obligatoire n'est
 * vérifiable, et l'écran doit le dire au lieu de laisser croire à un contrôle.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read', request.nextUrl.searchParams.get('farmId'));
  const annee = Number(request.nextUrl.searchParams.get('year')) || currentCampaignYear();

  return ok({
    campaignYear: annee,
    parcelles: await couvertureExploitation({ farmId: ctx.farmId, campaignYear: annee }),
  });
});

const Couvert = z.object({
  parcelId: z.string().min(1),
  cropYearId: z.string().min(1).nullable().optional(),
  kind: z.nativeEnum(SoilCoverKind),
  species: z.string().trim().max(300).nullable().optional(),
  sownOn: z.coerce.date().nullable().optional(),
  emergedOn: z.coerce.date().nullable().optional(),
  destroyedOn: z.coerce.date().nullable().optional(),
  destructionMethod: z.nativeEnum(CoverDestructionMethod).nullable().optional(),
  areaHa: z.number().positive().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

/**
 * POST /api/soil-covers — enregistrer un couvert.
 *
 * Refuse les dates incohérentes — une destruction avant le semis est une erreur
 * de saisie certaine, pas une question réglementaire. Ne refuse **rien
 * d'autre** : les périodes autorisées relèvent du programme d'actions régional,
 * et inventer une contrainte serait pire que n'en poser aucune.
 */
export const POST = route(async (request: NextRequest) => {
  const body = await parseBody(request, Couvert);
  const { ctx } = await requireParcelAccess(body.parcelId, 'record:write');

  const problemes = incoherencesDates({
    sownOn: body.sownOn ?? null,
    emergedOn: body.emergedOn ?? null,
    destroyedOn: body.destroyedOn ?? null,
  });
  if (problemes.length > 0) throw badRequest(problemes.join(' '));

  if (body.cropYearId) {
    const campagne = await prisma.cropYear.findFirst({
      where: { id: body.cropYearId, parcelId: body.parcelId },
      select: { id: true },
    });
    if (!campagne) throw badRequest('Cette campagne n’appartient pas à cette parcelle.');
  }

  const couvert = await prisma.soilCover.create({
    data: {
      parcelId: body.parcelId,
      cropYearId: body.cropYearId ?? null,
      kind: body.kind,
      species: body.species ?? null,
      sownOn: body.sownOn ?? null,
      emergedOn: body.emergedOn ?? null,
      destroyedOn: body.destroyedOn ?? null,
      destructionMethod: body.destructionMethod ?? null,
      areaHa: body.areaHa ?? null,
      notes: body.notes ?? null,
      createdById: ctx.user.id,
    },
    select: { id: true, kind: true, sownOn: true },
  });

  await logAudit({
    action: 'soilCover.created',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'soilCover',
    entityId: couvert.id,
    ipAddress: clientIp(request),
    metadata: { kind: couvert.kind, parcelId: body.parcelId },
  });

  return ok(couvert, 201);
});
