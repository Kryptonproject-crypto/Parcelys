import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { buildHistory, type HistoryEventKind } from '@/lib/services/history';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  formatDateFr,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Historique' };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<HistoryEventKind, string> = {
  CROP: 'Culture',
  HARVEST: 'Récolte',
  FERTILIZATION: 'Apport',
  PHYTO: 'Phytosanitaire',
  OPERATION: 'Travail',
  DOCUMENT: 'Document',
};

const KIND_TONES: Record<HistoryEventKind, 'green' | 'blue' | 'amber' | 'neutral'> = {
  CROP: 'green',
  HARVEST: 'green',
  FERTILIZATION: 'blue',
  PHYTO: 'amber',
  OPERATION: 'neutral',
  DOCUMENT: 'neutral',
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ parcelle?: string; nature?: string; du?: string; au?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('record:read');

  const parcels = await prisma.parcel.findMany({
    where: { farmId: ctx.farmId, deletedAt: null },
    select: { id: true, name: true, internalNumber: true },
    orderBy: { name: 'asc' },
  });

  const parcelIds =
    params.parcelle && parcels.some((p) => p.id === params.parcelle)
      ? [params.parcelle]
      : parcels.map((p) => p.id);

  const events = await buildHistory({
    parcelIds,
    kinds: params.nature ? [params.nature as HistoryEventKind] : undefined,
    from: params.du ? new Date(params.du) : undefined,
    to: params.au ? new Date(params.au) : undefined,
    limit: 400,
  });

  // Regroupement par mois pour une lecture chronologique claire.
  const grouped = new Map<string, typeof events>();
  for (const event of events) {
    const key = event.date.slice(0, 7);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(event);
    else grouped.set(key, [event]);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Historique des interventions"
        description={`${events.length} événement${events.length > 1 ? 's' : ''} sur l'exploitation`}
        actions={
          <LinkButton href="/exports?dataset=historique" variant="outline">
            Exporter
          </LinkButton>
        }
      />

      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <label htmlFor="parcelle" className="mb-1 block text-xs font-medium text-ardoise-600">
              Parcelle
            </label>
            <select
              id="parcelle"
              name="parcelle"
              defaultValue={params.parcelle ?? ''}
              className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm"
            >
              <option value="">Toutes les parcelles</option>
              {parcels.map((parcel) => (
                <option key={parcel.id} value={parcel.id}>
                  {parcel.internalNumber ? `${parcel.internalNumber} — ` : ''}
                  {parcel.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="nature" className="mb-1 block text-xs font-medium text-ardoise-600">
              Nature
            </label>
            <select
              id="nature"
              name="nature"
              defaultValue={params.nature ?? ''}
              className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm"
            >
              <option value="">Toutes</option>
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="du" className="mb-1 block text-xs font-medium text-ardoise-600">
              Du
            </label>
            <input
              id="du"
              name="du"
              type="date"
              defaultValue={params.du ?? ''}
              className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="au" className="mb-1 block text-xs font-medium text-ardoise-600">
              Au
            </label>
            <input
              id="au"
              name="au"
              type="date"
              defaultValue={params.au ?? ''}
              className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm"
            />
          </div>

          <div className="flex items-end sm:col-span-5">
            <button
              type="submit"
              className="h-10 rounded-lg bg-champ-600 px-5 text-sm font-medium text-white transition hover:bg-champ-700"
            >
              Filtrer
            </button>
          </div>
        </form>
      </Card>

      {events.length === 0 ? (
        <EmptyState
          icon="📊"
          title="Aucun événement"
          description="L'historique se construit automatiquement à partir de vos saisies."
        />
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([month, monthEvents]) => (
            <div key={month}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
                {new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </h2>

              <Card>
                <ol className="relative space-y-5 border-l-2 border-ardoise-200 pl-5">
                  {monthEvents.map((event) => (
                    <li key={event.id} className="relative">
                      <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-champ-500" />
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <time className="text-sm font-semibold tabular-nums text-ardoise-900">
                          {formatDateFr(event.date)}
                        </time>
                        <Badge tone={KIND_TONES[event.kind]}>
                          {KIND_LABELS[event.kind]}
                        </Badge>
                        <Link
                          href={`/parcelles/${event.parcelId}`}
                          className="text-sm text-champ-700 hover:underline"
                        >
                          {event.parcelName}
                        </Link>
                      </div>
                      <p className="mt-1 font-medium text-ardoise-800">{event.title}</p>
                      {event.details.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-sm text-ardoise-600">
                          {event.details.map((detail) => (
                            <li key={detail}>{detail}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
