import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import { getEnv } from '@/lib/env';
import { currentCampaignYear } from '@/lib/constants/agronomy';
import { listRecommendations } from '@/lib/services/advisory';
import { ParcelsMapLoader } from '@/components/map/ParcelsMapLoader';
import type { MapParcel } from '@/components/map/ParcelsMap';
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
  TableWrapper,
  Td,
  Th,
  Tr,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import {
  IconArea,
  IconFarm,
  IconParcels,
  IconPhyto,
  IconPlus,
} from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Exploitation suivie' };
export const dynamic = 'force-dynamic';

/**
 * Fiche d'une exploitation du portefeuille.
 *
 * Tout est en lecture. L'expert voit le parcellaire, les cultures en place et
 * les derniers traitements — ce qu'il lui faut pour conseiller — et rien de
 * plus : ni documents, ni membres, ni paramètres. Les permissions du rôle
 * `ADVISOR` le garantissent côté serveur ; cette page ne fait que s'y
 * conformer.
 */
export default async function PortfolioFarmPage({
  params,
}: {
  params: Promise<{ farmId: string }>;
}) {
  const { farmId } = await params;
  const ctx = await requirePageFarmAccess('parcel:read', farmId);
  const env = getEnv();
  const year = currentCampaignYear();

  const [farm, geojson, recentPhyto, recommendations] = await Promise.all([
    prisma.farm.findUniqueOrThrow({
      where: { id: ctx.farmId },
      select: { id: true, name: true, city: true, department: true },
    }),
    getFarmParcelsGeoJSON(ctx.farmId, year),
    prisma.phytosanitaryApplication.findMany({
      where: { parcel: { farmId: ctx.farmId } },
      include: { parcel: { select: { id: true, name: true } } },
      orderBy: { appliedOn: 'desc' },
      take: 12,
    }),
    listRecommendations({ farmId: ctx.farmId, authorId: ctx.user.id, take: 8 }),
  ]);

  const parcels: MapParcel[] = geojson.features.map((feature) => ({
    id: feature.properties.id,
    name: feature.properties.name,
    internalNumber: feature.properties.internalNumber,
    commune: feature.properties.commune,
    areaHa: feature.properties.areaHa,
    crop: feature.properties.crop,
    geometry: feature.geometry,
  }));

  const totalArea = geojson.features.reduce(
    (sum, feature) => sum + feature.properties.areaHa,
    0,
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        icon={IconFarm}
        title={farm.name}
        description={
          [farm.city, farm.department].filter(Boolean).join(' · ') ||
          'Exploitation suivie'
        }
        breadcrumb={
          <Link href="/portefeuille" className="hover:text-ink">
            ← Portefeuille
          </Link>
        }
        actions={
          <LinkButton
            href={`/portefeuille/${farm.id}/preconisations/nouvelle`}
            icon={IconPlus}
          >
            Nouvelle préconisation
          </LinkButton>
        }
      />

      <div className="mb-5">
        <Alert tone="info">
          Vous consultez cette exploitation en tant qu&apos;expert agronomique.
          Vous pouvez lire son parcellaire et ses registres, et lui transmettre
          des préconisations — vous n&apos;écrivez rien dans ses registres.
        </Alert>
      </div>

      <section aria-label="Chiffres" className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Parcelles"
          value={parcels.length}
          icon={IconParcels}
          accent
        />
        <StatCard
          label="Surface"
          value={formatNumberFr(totalArea, 1)}
          unit="ha"
          hint="Calculée par PostGIS"
          icon={IconArea}
        />
        <StatCard
          label="Traitements récents"
          value={recentPhyto.length}
          hint="Douze derniers enregistrés"
          icon={IconPhyto}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="px-5 pt-5">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Parcellaire
            </h2>
            <p className="mt-0.5 text-sm text-ink-3">
              Cliquez sur une parcelle pour ouvrir son historique
            </p>
          </div>
          <div className="p-5 pt-4">
            {parcels.length > 0 ? (
              <>
                <ParcelsMapLoader
                  parcels={parcels}
                  tileUrl={env.MAP_TILE_URL}
                  attribution={env.MAP_TILE_ATTRIBUTION}
                  heightClass="h-[380px]"
                  linkBase={`/portefeuille/${farm.id}/parcelles`}
                />

                {/*
                  Les parcelles nommées, sous la carte. Un polygone ne se
                  cherche pas au doigt sur un téléphone, et rien ne disait
                  jusqu'ici comment s'appellent les parcelles de cette
                  exploitation — il fallait les deviner en tâtonnant.
                */}
                <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
                  {parcels.map((parcel) => (
                    <li key={parcel.id}>
                      <Link
                        href={`/portefeuille/${farm.id}/parcelles/${parcel.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 transition-colors hover:border-champ-500/50 hover:bg-surface-2 sm:min-h-0"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium text-ink">
                            {parcel.name}
                          </span>
                          <span className="block truncate text-[12.5px] text-ink-3">
                            {[
                              parcel.internalNumber,
                              parcel.crop ?? 'sans culture déclarée',
                              parcel.commune,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-2">
                          {formatNumberFr(parcel.areaHa, 2)} ha
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState
                icon={IconParcels}
                title="Aucune parcelle cartographiée"
                description="Cette exploitation n'a pas encore dessiné son parcellaire."
              />
            )}
          </div>
        </Card>

        <Card padded={false} className="flex flex-col">
          <div className="px-5 pt-5">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Vos préconisations
            </h2>
            <p className="mt-0.5 text-sm text-ink-3">
              Les huit dernières sur cette exploitation
            </p>
          </div>
          <div className="flex-1 px-5 py-4">
            <RecommendationList
              recommendations={recommendations}
              viewer="expert"
              emptyLabel="Vous n'avez encore rien transmis à cette exploitation."
              compact
            />
          </div>
          <div className="border-t border-line px-5 py-3">
            <LinkButton
              href={`/portefeuille/${farm.id}/preconisations`}
              variant="ghost"
              size="sm"
            >
              Toutes les préconisations
            </LinkButton>
          </div>
        </Card>
      </div>

      <div className="mt-5">
        <Card padded={false}>
          <div className="px-5 pt-5">
            <CardHeader
              icon={IconPhyto}
              title="Derniers traitements enregistrés"
              description="Registre de l'exploitation, en lecture seule."
            />
          </div>

          {recentPhyto.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                icon={IconPhyto}
                title="Aucun traitement enregistré"
                description="Le registre phytosanitaire de cette exploitation est vide."
              />
            </div>
          ) : (
            <div className="px-5 pb-5">
              <TableWrapper>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Parcelle</Th>
                    <Th>Produit</Th>
                    <Th align="right">Dose</Th>
                    <Th>Cible</Th>
                  </tr>
                </thead>
                <tbody>
                  {recentPhyto.map((treatment) => (
                    <Tr key={treatment.id}>
                      <Td>
                        <span className="whitespace-nowrap text-[13px]">
                          {formatDateFr(treatment.appliedOn)}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          href={`/portefeuille/${farm.id}/parcelles/${treatment.parcel.id}`}
                          className="text-champ-700 hover:underline dark:text-champ-400"
                        >
                          {treatment.parcel.name}
                        </Link>
                      </Td>
                      <Td>
                        <span className="block text-ink">{treatment.productName}</span>
                        {treatment.amm ? (
                          <Badge tone="green">AMM {treatment.amm}</Badge>
                        ) : (
                          <Badge tone="amber">Non vérifié au catalogue</Badge>
                        )}
                      </Td>
                      <Td align="right">
                        {formatNumberFr(treatment.dose, 2)} {treatment.doseUnit}
                      </Td>
                      <Td>
                        <span className="text-[13px] text-ink-3">
                          {treatment.targetLabel ?? '—'}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableWrapper>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
