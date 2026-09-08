import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageParcelAccess } from '@/lib/auth/page-guards';
import { buildHistory } from '@/lib/services/history';
import { listRecommendations } from '@/lib/services/advisory';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { RecommendationList } from '@/components/advisory/RecommendationList';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  StatCard,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import {
  IconArea,
  IconHistory,
  IconParcels,
  IconPhyto,
  IconPlus,
  IconRegistry,
} from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Parcelle suivie' };
export const dynamic = 'force-dynamic';

/**
 * Fiche parcelle vue par l'expert : lecture seule.
 *
 * Le contrôle d'accès passe par `requirePageParcelAccess`, exactement comme
 * côté exploitant. Une parcelle d'une exploitation qui ne l'a pas missionné
 * renvoie 404 — l'appartenance au portefeuille est la seule clé.
 */
export default async function ExpertParcelPage({
  params,
}: {
  params: Promise<{ farmId: string; parcelId: string }>;
}) {
  const { farmId, parcelId } = await params;
  const { ctx, parcel } = await requirePageParcelAccess(parcelId, 'parcel:read');

  // L'URL porte l'exploitation : elle doit correspondre à celle de la parcelle.
  if (ctx.farmId !== farmId) notFound();

  const year = currentCampaignYear();

  const [detail, cropYears, history, recommendations] = await Promise.all([
    prisma.parcel.findUniqueOrThrow({
      where: { id: parcel.id },
      select: {
        internalNumber: true,
        commune: true,
        lieuDit: true,
        parcelType: true,
        status: true,
        notes: true,
        farm: { select: { name: true } },
      },
    }),
    prisma.cropYear.findMany({
      where: { parcelId: parcel.id },
      include: { crop: { select: { name: true } } },
      orderBy: { campaignYear: 'desc' },
      take: 6,
    }),
    buildHistory({ parcelIds: [parcel.id], limit: 40 }),
    listRecommendations({ parcelId: parcel.id, authorId: ctx.user.id, take: 10 }),
  ]);

  const current = cropYears.find((entry) => entry.campaignYear === year);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={IconParcels}
        title={parcel.name}
        description={
          [detail.internalNumber, detail.commune, detail.lieuDit]
            .filter(Boolean)
            .join(' · ') || detail.farm.name
        }
        breadcrumb={
          <Link href={`/portefeuille/${farmId}`} className="hover:text-ink">
            ← {detail.farm.name}
          </Link>
        }
        actions={
          <LinkButton
            href={`/portefeuille/${farmId}/preconisations/nouvelle?parcelId=${parcel.id}`}
            icon={IconPlus}
          >
            Préconiser
          </LinkButton>
        }
      />

      <div className="mb-5">
        <Alert tone="info">
          Consultation en tant qu&apos;expert agronomique. Les registres de cette
          parcelle sont en lecture seule — vous ne pouvez rien y saisir.
        </Alert>
      </div>

      <section aria-label="Chiffres" className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Superficie"
          value={formatNumberFr(Number(parcel.areaHa), 2)}
          unit="ha"
          hint="Calculée par PostGIS"
          icon={IconArea}
          accent
        />
        <StatCard
          label={`Culture ${year}`}
          value={current?.crop.name ?? '—'}
          hint={current?.variety ?? 'Aucune culture déclarée'}
          icon={IconParcels}
        />
        <StatCard
          label="Interventions"
          value={history.length}
          hint="Enregistrées sur la parcelle"
          icon={IconHistory}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader
              icon={IconHistory}
              title="Historique de la parcelle"
              description="Cultures, apports, traitements et travaux."
            />
          </div>
          <div className="max-h-[520px] overflow-y-auto px-5 pb-5">
            {history.length === 0 ? (
              <EmptyState
                icon={IconHistory}
                title="Aucune intervention"
                description="Rien n'a encore été enregistré sur cette parcelle."
              />
            ) : (
              <ol className="space-y-2.5">
                {history.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-lg border border-line p-3 text-[13.5px]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{event.title}</span>
                        {event.details.map((line) => (
                          <span key={line} className="block text-[12.5px] text-ink-3">
                            {line}
                          </span>
                        ))}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-ink-3">
                        {formatDateFr(event.date)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              icon={IconRegistry}
              title="Vos préconisations sur cette parcelle"
            />
            <RecommendationList
              recommendations={recommendations}
              viewer="expert"
              linkBase="/portefeuille/preconisations"
              emptyLabel="Vous n'avez rien préconisé sur cette parcelle."
              compact
            />
          </Card>

          <Card>
            <CardHeader icon={IconPhyto} title="Assolement" />
            {cropYears.length === 0 ? (
              <p className="text-sm text-ink-3">Aucune culture déclarée.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {cropYears.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">
                        {entry.crop.name}
                      </span>
                      {entry.variety ? (
                        <span className="block text-[12.5px] text-ink-3">
                          {entry.variety}
                        </span>
                      ) : null}
                    </span>
                    <Badge tone={entry.campaignYear === year ? 'green' : 'neutral'}>
                      {entry.campaignYear}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {detail.notes ? (
            <Card>
              <CardHeader title="Notes de l'exploitant" />
              <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">
                {detail.notes}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
