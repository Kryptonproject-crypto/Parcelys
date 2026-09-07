import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireParcelAccess } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, route } from '@/lib/api/handler';
import { storeDocument, validateUpload } from '@/lib/storage/documents';
import { documentMetaSchema } from '@/lib/validation/farming';
import { logAudit } from '@/lib/audit';
import { badRequest, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

const idOf = (params: Record<string, string>): string => {
  const id = params.id;
  if (!id) throw notFound('Parcelle introuvable');
  return id;
};

/** GET /api/parcels/:id/documents — documents attachés à la parcelle. */
export const GET = route(async (_request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  await requireParcelAccess(id, 'document:read');

  const items = await prisma.document.findMany({
    where: { parcelId: id },
    include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return ok({
    items: items.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      category: d.category,
      description: d.description,
      createdAt: d.createdAt,
      uploadedBy: d.uploadedBy
        ? `${d.uploadedBy.firstName} ${d.uploadedBy.lastName}`
        : null,
    })),
  });
});

/**
 * POST /api/parcels/:id/documents — téléversement (multipart/form-data).
 * Le contenu est validé (extension, taille, MIME, signature) avant écriture.
 */
export const POST = route(async (request: NextRequest, context: Ctx) => {
  const id = idOf(await context.params);
  const { ctx } = await requireParcelAccess(id, 'document:write');
  await enforceRateLimit(`upload:${ctx.user.id}`, { limit: 30, windowSeconds: 300 });

  const form = await request.formData().catch(() => {
    throw badRequest('Requête multipart invalide.');
  });

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw badRequest('Aucun fichier reçu (champ « file » attendu).');
  }

  const meta = documentMetaSchema.parse({
    category: form.get('category') ?? undefined,
    description: form.get('description') ?? undefined,
  });

  const validated = validateUpload({
    fileName: file.name,
    mimeType: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
  });

  const storageKey = await storeDocument(ctx.farmId, validated);

  const document = await prisma.document.create({
    data: {
      farmId: ctx.farmId,
      parcelId: id,
      fileName: validated.fileName,
      storageKey,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      checksum: validated.checksum,
      category: meta.category,
      description: meta.description ?? null,
      uploadedById: ctx.user.id,
    },
  });

  await logAudit({
    action: 'document.uploaded',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    entity: 'document',
    entityId: document.id,
    ipAddress: clientIp(request),
    metadata: { fileName: validated.fileName, sizeBytes: validated.sizeBytes },
  });

  return ok(
    {
      item: {
        id: document.id,
        fileName: document.fileName,
        sizeBytes: document.sizeBytes,
        category: document.category,
        createdAt: document.createdAt,
      },
      message: 'Document ajouté',
    },
    201,
  );
});
