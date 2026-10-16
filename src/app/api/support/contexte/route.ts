import { prisma } from '@/lib/prisma';
import { ok, route } from '@/lib/api/handler';
import { requireAuth } from '@/lib/auth/rbac';
import { exploitationsDuCompte } from '@/lib/support/tickets';

/**
 * GET /api/support/contexte — ce que le formulaire de contact préremplit pour
 * le compte connecté : nom, adresse, et ses numéros clients — ceux de **ses**
 * exploitations (pas celles qu'il suit en conseil), ou son numéro de
 * technicien.
 */
export const GET = route(async () => {
  const auth = await requireAuth();
  const fermes = exploitationsDuCompte(auth);
  const [numeros, moi] = await Promise.all([
    prisma.farm.findMany({
      where: { id: { in: fermes.map((f) => f.farmId) } },
      select: { id: true, name: true, customerNumber: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: { technicianNumber: true, accountType: true },
    }),
  ]);
  return ok({
    name: `${auth.user.firstName} ${auth.user.lastName}`,
    email: auth.user.email,
    accountType: moi.accountType,
    technicianNumber: moi.accountType === 'AGRONOMIST' ? moi.technicianNumber : null,
    activeFarmId: auth.activeFarmId,
    farms: numeros,
  });
});
