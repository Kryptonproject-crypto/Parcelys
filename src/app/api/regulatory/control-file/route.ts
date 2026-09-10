import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CampaignDocumentKind } from '@prisma/client';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { badRequest } from '@/lib/api/errors';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import {
  assemblerDossier,
  documentsVerrouilles,
  verrouillerDocument,
} from '@/lib/regulatory/control-file';
import { cahierEpandage } from '@/lib/regulatory/organic-nitrogen';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { logAudit } from '@/lib/audit';

/**
 * GET /api/regulatory/control-file?year= — le dossier de contrôle d'une campagne.
 *
 * Recalculé à chaque appel : une pièce déposée doit apparaître immédiatement,
 * sinon l'exploitant cesse de faire confiance au reste du dossier.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read', request.nextUrl.searchParams.get('farmId'));
  const annee = Number(request.nextUrl.searchParams.get('year')) || currentCampaignYear();

  const [dossier, verrous] = await Promise.all([
    assemblerDossier({ farmId: ctx.farmId, campaignYear: annee }),
    documentsVerrouilles({ farmId: ctx.farmId, campaignYear: annee }),
  ]);

  return ok({ dossier, verrous });
});

const Verrouillage = z.object({
  campaignYear: z.number().int().min(1900).max(2200),
  kind: z.nativeEnum(CampaignDocumentKind),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/**
 * POST /api/regulatory/control-file — verrouiller un document de campagne.
 *
 * Le contenu figé est **produit ici**, pas transmis par le client : accepter un
 * contenu envoyé reviendrait à laisser verrouiller n'importe quoi sous le nom
 * d'un registre officiel.
 */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:write');
  const body = await parseBody(request, Verrouillage);

  let contenu: unknown;
  let rowCount = 0;
  let gaps: string | null = null;

  if (body.kind === 'CAHIER_EPANDAGE') {
    const cahier = await cahierEpandage({
      farmId: ctx.farmId,
      campaignYear: body.campaignYear,
    });
    contenu = cahier;
    rowCount = cahier.lignes.length;
    gaps =
      cahier.lignesIncompletes > 0
        ? `${cahier.lignesIncompletes} ligne(s) incomplète(s) au moment du verrouillage.`
        : null;
  } else if (body.kind === 'DOSSIER_CONTROLE') {
    const dossier = await assemblerDossier({
      farmId: ctx.farmId,
      campaignYear: body.campaignYear,
    });
    contenu = dossier;
    rowCount = dossier.pieces.length;
    const manquantes = dossier.pieces.filter(
      (p) => p.statut !== 'presente',
    );
    gaps =
      manquantes.length > 0
        ? manquantes.map((p) => `${p.label} : ${p.statut}`).join(' · ')
        : null;
  } else {
    // Les autres natures viendront quand leur contenu figé sera défini. Refuser
    // vaut mieux que verrouiller un document vide sous un nom officiel.
    throw badRequest(
      `Le verrouillage de « ${body.kind} » n’est pas encore disponible. ` +
        'Natures gérées : cahier d’épandage, dossier de contrôle.',
    );
  }

  const resultat = await verrouillerDocument({
    farmId: ctx.farmId,
    campaignYear: body.campaignYear,
    kind: body.kind,
    contenu,
    rowCount,
    gaps,
    lockedById: ctx.user.id,
    notes: body.notes ?? null,
  });

  if (!resultat.ok) throw badRequest(resultat.raison);

  await logAudit({
    action: 'campaignDocument.locked',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'campaignDocument',
    entityId: resultat.id,
    ipAddress: clientIp(request),
    metadata: {
      kind: body.kind,
      campaignYear: body.campaignYear,
      version: resultat.version,
      inchange: resultat.inchange,
    },
  });

  return ok(resultat, resultat.inchange ? 200 : 201);
});
