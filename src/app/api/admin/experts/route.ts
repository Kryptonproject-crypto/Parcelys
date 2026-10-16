import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientIp, ok, parseBody, route } from '@/lib/api/handler';
import { farmScope, loadTechnicianInScope, requireAdmin } from '@/lib/admin/scope';
import { listAdminTechnicians, listFarmOptions } from '@/lib/admin/overview';
import { advisoryGrantSchema, advisoryRevokeSchema } from '@/lib/validation/admin';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { conflict, notFound } from '@/lib/api/errors';

/**
 * Rattachement des experts agronomiques aux exploitations, côté administration.
 *
 * La voie ordinaire reste celle de l'exploitation : elle délivre un code
 * d'accès conseil, et décide donc elle-même qui lit ses registres. Cette route
 * est la voie de l'administrateur d'instance, utile quand il administre les deux
 * côtés — mais elle ouvre l'accès aux données d'une exploitation sans que
 * celle-ci ait cliqué. Deux garde-fous, en conséquence : chaque ouverture est
 * inscrite au journal d'audit, et l'exploitation reçoit une notification.
 */

/**
 * GET /api/admin/experts — techniciens (comptes experts) et exploitations
 * proposables, bornés au périmètre. `q` accepte un nom, une adresse, une
 * structure ou un numéro `TEC-…`.
 */
export const GET = route(async (request: NextRequest) => {
  const { scope } = await requireAdmin('technicians:read');
  const q = new URL(request.url).searchParams.get('q')?.slice(0, 120) ?? '';
  const pageParam = Number(new URL(request.url).searchParams.get('page') ?? '1');

  const [page, farms] = await Promise.all([
    listAdminTechnicians({ scope, search: q, page: pageParam }),
    listFarmOptions(scope),
  ]);

  return ok({ experts: page.rows, total: page.total, page: page.page, farms });
});

/** POST /api/admin/experts — ouvre à un expert l'accès à une exploitation. */
export const POST = route(async (request: NextRequest) => {
  const auth = await requireAdmin('technicians:missions');
  const input = await parseBody(request, advisoryGrantSchema);

  // On vérifie que la cible est bien un compte expert : ouvrir une « mission de
  // conseil » à un compte exploitant lui donnerait un accès qui ne correspond à
  // aucun rôle prévu. Et, pour un administrateur secondaire, que le technicien
  // comme l'exploitation sont dans ses portefeuilles — sinon : introuvables.
  const expert = await loadTechnicianInScope(auth.scope, input.expertId);
  if (expert.suspendedAt) {
    throw conflict("Ce compte expert est suspendu : levez la suspension avant de lui confier une exploitation.");
  }

  const farm = await prisma.farm.findFirst({
    where: { id: input.farmId, deletedAt: null, ...farmScope(auth.scope) },
    select: {
      id: true,
      name: true,
      // L'exploitation n'a pas de colonne « propriétaire » : le
      // propriétaire est un membre portant le rôle OWNER.
      members: {
        where: { role: 'OWNER' },
        select: { userId: true },
        take: 1,
      },
    },
  });
  if (!farm) throw notFound('Exploitation introuvable');

  const existing = await prisma.advisoryEngagement.findUnique({
    where: { farmId_expertId: { farmId: farm.id, expertId: expert.id } },
  });
  if (existing?.status === 'ACTIVE') {
    throw conflict('Cet expert suit déjà cette exploitation.');
  }

  // Une mission reprise réactive la ligne existante : l'index d'unicité tient,
  // et l'historique de la relation reste d'un seul tenant.
  const engagement = existing
    ? await prisma.advisoryEngagement.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          endedAt: null,
          startedAt: new Date(),
          grantedById: auth.user.id,
          note: input.note || null,
        },
      })
    : await prisma.advisoryEngagement.create({
        data: {
          farmId: farm.id,
          expertId: expert.id,
          grantedById: auth.user.id,
          note: input.note || null,
        },
      });

  await logAudit({
    action: 'advisor.access_granted_by_admin',
    userId: auth.user.id,
    farmId: farm.id,
    entity: 'AdvisoryEngagement',
    entityId: engagement.id,
    ipAddress: clientIp(request),
    metadata: { expertEmail: expert.email, farmName: farm.name },
  });

  // L'exploitation doit savoir qui vient d'obtenir accès à ses données, même
  // quand la décision vient de l'administration.
  const ownerId = farm.members[0]?.userId;
  if (ownerId) {
    await createNotification({
      userId: ownerId,
      farmId: farm.id,
      type: 'RECOMMENDATION',
      title: 'Un expert suit désormais votre exploitation',
      body:
        `${expert.firstName} ${expert.lastName} (${expert.email}) a accès à vos ` +
        'parcelles et registres. Vous pouvez y mettre fin à tout moment depuis ' +
        '« Paramètres → Experts agronomiques ».',
    });
  }

  return ok(
    {
      message: `${expert.firstName} ${expert.lastName} suit désormais « ${farm.name} ».`,
      id: engagement.id,
    },
    201,
  );
});

/** DELETE /api/admin/experts — met fin à une mission de conseil. */
export const DELETE = route(async (request: NextRequest) => {
  const auth = await requireAdmin('technicians:missions');
  const input = await parseBody(request, advisoryRevokeSchema);

  // Clore une mission est un geste sur l'accès aux données de l'exploitation :
  // il suffit que l'exploitation soit dans le périmètre.
  const engagement = await prisma.advisoryEngagement.findFirst({
    where: { id: input.engagementId, farm: farmScope(auth.scope) },
    include: {
      expert: { select: { email: true } },
      farm: { select: { id: true, name: true } },
    },
  });
  if (!engagement) throw notFound('Mission introuvable');

  if (engagement.status === 'ENDED') {
    return ok({ message: 'Cette mission était déjà terminée.', id: engagement.id });
  }

  await prisma.advisoryEngagement.update({
    where: { id: engagement.id },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  await logAudit({
    action: 'advisor.access_revoked_by_admin',
    userId: auth.user.id,
    farmId: engagement.farm.id,
    entity: 'AdvisoryEngagement',
    entityId: engagement.id,
    ipAddress: clientIp(request),
    metadata: { expertEmail: engagement.expert.email, farmName: engagement.farm.name },
  });

  // Les préconisations déjà transmises restent : elles font partie de
  // l'historique de l'exploitation, et l'expert n'y a plus accès de toute façon.
  return ok({
    message: `Accès retiré. Les préconisations déjà transmises sont conservées.`,
    id: engagement.id,
  });
});
