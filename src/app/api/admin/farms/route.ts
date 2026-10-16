import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, parseQuery, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { listAdminFarms } from '@/lib/admin/overview';
import { badRequest, conflict, notFound } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { deleteFarmStorage } from '@/lib/storage/documents';

/**
 * Exploitations, côté administration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX SUPPRESSIONS, ET POURQUOI DEUX
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `delete` est **logique** : `deleted_at` est renseigné, rien n'est effacé.
 * Une exploitation porte des registres phytosanitaires et des bilans de
 * fertilisation — des pièces que l'exploitant doit conserver, et qu'un clic ne
 * doit pas pouvoir détruire. Elle se rétablit donc aussi.
 *
 * `purge` efface pour de bon : les parcelles, leurs géométries, les registres,
 * les campagnes PAC, les documents — jusqu'aux fichiers sur le disque. C'est
 * ce qu'il faut pour honorer une demande d'effacement, et c'est irréversible.
 *
 * Trois verrous, parce qu'un seul ne suffit pas à une action sans retour :
 *
 *   1. **l'exploitation doit déjà être supprimée logiquement.** On ne purge pas
 *      en un clic depuis la liste : il faut avoir supprimé, donc avoir vu
 *      l'exploitation basculer et avoir eu le temps d'y revenir ;
 *   2. **le nom exact doit être retapé.** Pas une case à cocher : un nom qu'on
 *      recopie est un nom qu'on a lu ;
 *   3. **ce qui va être détruit est compté et annoncé** avant d'agir, et
 *      rapporté après.
 *
 * Le journal d'audit, lui, survit : `AuditLog.farmId` est en `SetNull`, et le
 * nom de l'exploitation est recopié dans les métadonnées. Effacer les données
 * d'une exploitation ne doit pas effacer la trace qu'un administrateur l'a fait.
 */

const farmActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), farmId: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal('restore'), farmId: z.string().trim().min(1).max(40) }),
  z.object({
    action: z.literal('purge'),
    farmId: z.string().trim().min(1).max(40),
    /** Le nom exact de l'exploitation, retapé par l'administrateur. */
    confirmation: z.string().trim().min(1).max(200),
  }),
]);

const farmQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  statut: z.enum(['toutes', 'actives', 'supprimees', 'sans-portefeuille']).default('toutes'),
  portefeuille: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/**
 * GET — exploitations visibles par l'administrateur connecté.
 *
 * Le général les voit toutes, supprimées comprises ; le secondaire, celles de
 * ses portefeuilles seulement. `q` accepte un nom, une commune, l'adresse du
 * propriétaire ou un numéro `EXP-…`.
 */
export const GET = route(async (request: NextRequest) => {
  const { scope } = await requireAdmin('farms:read');
  const query = parseQuery(request, farmQuerySchema);

  const page = await listAdminFarms({
    scope,
    filter: query.statut,
    search: query.q ?? '',
    portfolioId: query.portefeuille || null,
    page: query.page,
  });

  return ok({
    // Les champs historiques de cette route (`memberCount`, `parcelCount`,
    // `phytoRecordCount`, `owners` détaillés) sont conservés à côté des
    // nouveaux : un client écrit pour la 0.10 continue de fonctionner.
    farms: page.rows.map((farm) => ({
      ...farm,
      memberCount: farm.members,
      parcelCount: farm.parcels,
      phytoRecordCount: farm.phytoRecords,
      owners: farm.ownerAccounts,
    })),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

/** POST — supprime ou rétablit une exploitation. */
export const POST = route(async (request: NextRequest) => {
  // Supprimer, rétablir, purger : l'administrateur général seul. Une
  // exploitation porte des registres réglementaires.
  const auth = await requireAdmin('farms:delete');
  const input = await parseBody(request, farmActionSchema);

  const farm = await prisma.farm.findUnique({
    where: { id: input.farmId },
    select: { id: true, name: true, deletedAt: true, customerNumber: true },
  });
  if (!farm) throw notFound('Exploitation introuvable');

  if (input.action === 'restore') {
    if (farm.deletedAt === null) {
      return ok({ message: `« ${farm.name} » n'était pas supprimée.`, id: farm.id });
    }
    await prisma.farm.update({ where: { id: farm.id }, data: { deletedAt: null } });
    await logAudit({
      action: 'farm.restored_by_admin',
      userId: auth.user.id,
      farmId: farm.id,
      entity: 'Farm',
      entityId: farm.id,
      ipAddress: clientIp(request),
      metadata: { farmName: farm.name, customerNumber: farm.customerNumber },
    });
    return ok({ message: `« ${farm.name} » a été rétablie.`, id: farm.id });
  }

  if (input.action === 'purge') {
    return purger(request, auth.user.id, farm, input.confirmation);
  }

  if (farm.deletedAt !== null) {
    throw conflict('Cette exploitation est déjà supprimée.');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.farm.update({ where: { id: farm.id }, data: { deletedAt: now } });

    // Les experts qui la suivaient perdent l'accès immédiatement : laisser une
    // mission ouverte sur une exploitation supprimée n'aurait aucun sens.
    await tx.advisoryEngagement.updateMany({
      where: { farmId: farm.id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: now },
    });
  });

  await logAudit({
    action: 'farm.deleted_by_admin',
    userId: auth.user.id,
    farmId: farm.id,
    entity: 'Farm',
    entityId: farm.id,
    ipAddress: clientIp(request),
    metadata: { farmName: farm.name, customerNumber: farm.customerNumber },
  });

  return ok({
    message:
      `« ${farm.name} » a été supprimée. Ses registres sont conservés et ` +
      'l’exploitation peut être rétablie.',
    id: farm.id,
  });
});

/**
 * Suppression définitive : l'exploitation et tout ce qu'elle porte.
 *
 * Ce que la cascade de la base emporte, et qu'il n'y a donc pas à lister ici :
 * membres, parcelles (et par elles géométries, cultures, apports, traitements,
 * travaux, couverts, analyses, contexte réglementaire, constats), documents,
 * relevés météo, notifications, codes d'invitation, missions de conseil,
 * préconisations, campagnes PAC (et par elles îlots, entités, imports,
 * sauvegardes, changements), stocks et plans de fumure.
 *
 * Ce que la cascade **n'**emporte **pas**, délibérément :
 *   · le journal d'audit — `farm_id` passe à `NULL`, les lignes restent ;
 *   · les comptes — un utilisateur n'appartient pas à une exploitation, il en
 *     est membre. Supprimer l'exploitation le laisse sans exploitation, pas
 *     sans compte ; c'est à l'administration de traiter son cas ;
 *   · les fichiers sur le disque — la base ne les connaît pas. D'où l'appel
 *     explicite à `deleteFarmStorage`, sans quoi factures et analyses de sol
 *     resteraient sous `UPLOAD_DIR/<farmId>/` après une suppression annoncée
 *     comme complète.
 */
async function purger(
  request: NextRequest,
  adminId: string,
  farm: { id: string; name: string; deletedAt: Date | null; customerNumber: string | null },
  confirmation: string,
): Promise<NextResponse> {
  if (farm.deletedAt === null) {
    throw conflict(
      'Supprimez d’abord l’exploitation, puis purgez-la. Une suppression ' +
        'définitive ne se fait pas depuis la liste en un seul geste.',
    );
  }
  if (confirmation !== farm.name) {
    throw badRequest(
      `Pour confirmer, retapez exactement le nom de l’exploitation : « ${farm.name} ».`,
    );
  }

  // Compté avant, pour pouvoir dire ce qui a été détruit — et non l'affirmer.
  const [parcelles, documents, campagnes, membres, traitements, apports] = await Promise.all([
    prisma.parcel.count({ where: { farmId: farm.id } }),
    prisma.document.findMany({
      where: { farmId: farm.id },
      select: { id: true },
    }),
    prisma.pacCampaign.count({ where: { farmId: farm.id } }),
    prisma.farmMember.count({ where: { farmId: farm.id } }),
    prisma.phytosanitaryApplication.count({ where: { parcel: { farmId: farm.id } } }),
    prisma.fertilizerApplication.count({ where: { parcel: { farmId: farm.id } } }),
  ]);

  const detruit = {
    parcelles,
    documents: documents.length,
    campagnesPac: campagnes,
    membres,
    traitements,
    apports,
  };

  // Le journal d'abord : après la suppression, `farmId` sera `NULL`, et le nom
  // n'existera plus qu'ici.
  await logAudit({
    action: 'farm.purged_by_admin',
    userId: adminId,
    farmId: farm.id,
    entity: 'Farm',
    entityId: farm.id,
    ipAddress: clientIp(request),
    // Le numéro client survit ici à l'exploitation : il n'est jamais
    // réattribué, et c'est sous ce numéro qu'on la retrouvera si l'on en parle.
    metadata: { farmName: farm.name, customerNumber: farm.customerNumber, ...detruit },
  });

  // La base ensuite : c'est elle qui fait foi. Si l'effacement des fichiers
  // échouait, il resterait des fichiers orphelins — gênant, mais sans
  // conséquence ; l'inverse laisserait des lignes pointant vers le vide.
  await prisma.farm.delete({ where: { id: farm.id } });

  const fichiers = await deleteFarmStorage(farm.id);

  return ok({
    id: farm.id,
    detruit: { ...detruit, fichiers },
    message:
      `« ${farm.name} » a été définitivement supprimée : ${parcelles} parcelle(s), ` +
      `${traitements} traitement(s), ${apports} apport(s), ${campagnes} campagne(s) PAC, ` +
      `${documents.length} document(s) et ${fichiers} fichier(s) sur le disque. ` +
      'Les comptes des membres subsistent, sans exploitation. ' +
      'Le journal d’administration conserve la trace de cette suppression.',
  });
}
