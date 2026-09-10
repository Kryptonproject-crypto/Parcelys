import { requirePlatformAdmin } from '@/lib/auth/rbac';
import { ok, route } from '@/lib/api/handler';
import { getReferentialStates } from '@/lib/regulatory/referentials';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/regulatory/referentials — état de tous les référentiels.
 *
 * Réservé à l'administration : c'est de là que se pilotent les imports, et la
 * liste nomme les sources officielles et les variables d'environnement.
 *
 * Les référentiels jamais importés figurent dans la réponse avec leur statut
 * « non configuré » et la phrase disant ce que Parcelys ne peut pas faire sans
 * eux. Ne renvoyer que les référentiels présents laisserait croire que la liste
 * est complète.
 */
export const GET = route(async () => {
  await requirePlatformAdmin();

  const [etats, journal] = await Promise.all([
    getReferentialStates(),
    prisma.regulatoryImport.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: {
        referential: { select: { code: true, name: true, version: true, territory: true } },
      },
    }),
  ]);

  return ok({
    referentials: etats,
    journal: journal.map((entree) => ({
      id: entree.id,
      status: entree.status,
      code: entree.referential.code,
      name: entree.referential.name,
      version: entree.referential.version,
      territory: entree.referential.territory,
      recordCount: entree.recordCount,
      warnings: entree.warnings,
      errorMessage: entree.errorMessage,
      startedAt: entree.startedAt.toISOString(),
      finishedAt: entree.finishedAt?.toISOString() ?? null,
    })),
  });
});
