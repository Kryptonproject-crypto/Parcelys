import 'server-only';
import { prisma } from '@/lib/prisma';
import type { ActivityMonth } from '@/components/charts/ActivityChart';

/**
 * Nombre d'interventions par mois sur les douze derniers mois.
 *
 * Les trois natures sont comptées séparément pour alimenter les colonnes
 * empilées du tableau de bord. Les mois sans intervention restent présents avec
 * des valeurs nulles : l'axe temporel doit rester continu, sans trou.
 */
export async function getMonthlyActivity(
  parcelIds: string[],
  months = 12,
): Promise<ActivityMonth[]> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  // Squelette des mois, du plus ancien au plus récent.
  const buckets = new Map<string, ActivityMonth>();
  for (let i = 0; i < months; i += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = date.toISOString().slice(0, 7);
    buckets.set(key, {
      month: key,
      label: date.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' }),
      fertilization: 0,
      phyto: 0,
      operation: 0,
    });
  }

  if (parcelIds.length === 0) return [...buckets.values()];

  const [fertilizations, phyto, operations] = await Promise.all([
    prisma.fertilizerApplication.findMany({
      where: { parcelId: { in: parcelIds }, appliedOn: { gte: start } },
      select: { appliedOn: true },
    }),
    prisma.phytosanitaryApplication.findMany({
      where: { parcelId: { in: parcelIds }, appliedOn: { gte: start } },
      select: { appliedOn: true },
    }),
    prisma.agriculturalOperation.findMany({
      where: { parcelId: { in: parcelIds }, performedOn: { gte: start } },
      select: { performedOn: true },
    }),
  ]);

  const tally = (dates: Date[], field: keyof Omit<ActivityMonth, 'month' | 'label'>): void => {
    for (const date of dates) {
      const bucket = buckets.get(date.toISOString().slice(0, 7));
      if (bucket) bucket[field] += 1;
    }
  };

  tally(fertilizations.map((r) => r.appliedOn), 'fertilization');
  tally(phyto.map((r) => r.appliedOn), 'phyto');
  tally(operations.map((r) => r.performedOn), 'operation');

  return [...buckets.values()];
}
