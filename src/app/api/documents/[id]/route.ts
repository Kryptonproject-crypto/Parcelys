import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireVerifiedAuth, roleHasPermission } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { deleteDocument, readDocument } from '@/lib/storage/documents';
import { logAudit } from '@/lib/audit';
import { ApiError, notFound } from '@/lib/api/errors';

type Ctx = { params: Promise<Record<string, string>> };

/**
 * Charge un document en vérifiant que l'utilisateur est membre de
 * l'exploitation propriétaire. Le fichier n'est jamais servi depuis un chemin
 * fourni par le client.
 */
async function loadAccessibleDocument(documentId: string) {
  const auth = await requireVerifiedAuth();

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      farmId: { in: auth.memberships.map((m) => m.farmId) },
    },
  });
  if (!document) throw notFound('Document introuvable');

  const role = auth.memberships.find((m) => m.farmId === document.farmId)?.role ?? null;
  return { auth, document, role };
}

/** GET /api/documents/:id — télécharge le fichier. */
export const GET = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Document introuvable');

  const { auth, document, role } = await loadAccessibleDocument(id);
  if (!roleHasPermission(role, 'document:read')) {
    throw new ApiError(403, 'Accès non autorisé à ce document', 'FORBIDDEN');
  }

  const content = await readDocument(document.storageKey).catch(() => {
    throw notFound('Fichier absent du stockage');
  });

  await logAudit({
    action: 'document.downloaded',
    userId: auth.user.id,
    farmId: document.farmId,
    entity: 'document',
    entityId: document.id,
    ipAddress: clientIp(request),
  });

  return new NextResponse(new Uint8Array(content), {
    headers: {
      'Content-Type': document.mimeType,
      // `attachment` empêche l'exécution d'un contenu actif dans le navigateur.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(document.fileName)}"`,
      'Content-Length': String(document.sizeBytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

/** DELETE /api/documents/:id — supprime le document et son fichier. */
export const DELETE = route(async (request: NextRequest, context: Ctx) => {
  const id = (await context.params).id;
  if (!id) throw notFound('Document introuvable');

  const { auth, document, role } = await loadAccessibleDocument(id);
  if (!roleHasPermission(role, 'document:delete')) {
    throw new ApiError(
      403,
      'Votre rôle ne permet pas de supprimer un document',
      'FORBIDDEN',
    );
  }

  await prisma.document.delete({ where: { id: document.id } });
  await deleteDocument(document.storageKey);

  await logAudit({
    action: 'document.deleted',
    userId: auth.user.id,
    farmId: document.farmId,
    entity: 'document',
    entityId: document.id,
    ipAddress: clientIp(request),
    metadata: { fileName: document.fileName },
  });

  return ok({ message: 'Document supprimé' });
});
