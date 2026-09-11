import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { roleHasPermission } from '@/lib/auth/rbac';
import { requirePageParcelAccess } from '@/lib/auth/page-guards';
import { getParcelGeometry } from '@/lib/geo/repository';
import { getEnv } from '@/lib/env';
import { buildHistory } from '@/lib/services/history';
import { computeNutrientBalance } from '@/lib/services/fertilization';
import { currentCampaignYear, PARCEL_STATUS_LABELS } from '@/lib/constants/agronomy';
import { incoherencesDates } from '@/lib/regulatory/soil-cover';
import { getEphySourceInfo } from '@/lib/ephy/search';
import { ParcelsMapLoader } from '@/components/map/ParcelsMapLoader';
import { computeParcelContext } from '@/lib/regulatory/geography';
import { couchesPourExploitation } from '@/lib/regulatory/map-layers';
import { ParcelTabs } from '@/app/(app)/parcelles/[id]/ParcelTabs';
import { ParcelActions } from '@/app/(app)/parcelles/[id]/ParcelActions';
import { RenameParcel } from '@/app/(app)/parcelles/[id]/RenameParcel';
import {
  Badge,
  Card,
  LinkButton,
  PageHeader,
  formatNumberFr,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const parcel = await prisma.parcel.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: parcel?.name ?? 'Parcelle' };
}

export default async function ParcelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string; retour?: string }>;
}) {
  const { id } = await params;

  /**
   * Le contexte de la liste, rapporté tel qu'il en venait.
   *
   * Le lien de retour pointait sur `/parcelles` en dur : recherche, filtre,
   * vue et campagne étaient perdus à chaque aller-retour. Sur une exploitation
   * de 140 parcelles, cela suffit à ne plus s'en servir.
   *
   * Le paramètre est reconstruit par `URLSearchParams` plutôt que recollé tel
   * quel : une chaîne venue de l'adresse ne doit pas se retrouver dans un
   * `href` sans avoir été relue.
   */
  const { retour } = await searchParams;
  const retourListe = retour
    ? `/parcelles?${new URLSearchParams(retour).toString()}`
    : '/parcelles';
  const { onglet } = await searchParams;

  const { ctx } = await requirePageParcelAccess(id, 'parcel:read');
  const env = getEnv();
  const year = currentCampaignYear();

  const [
    parcel,
    geometry,
    fertilizations,
    phytoTreatments,
    operations,
    soilCovers,
    couches,
    documents,
    history,
    crops,
    fertilizers,
    organicInputs,
    ephySource,
  ] = await Promise.all([
    prisma.parcel.findUnique({
      where: { id },
      include: {
        cropYears: { include: { crop: true }, orderBy: { campaignYear: 'desc' } },
      },
    }),
    getParcelGeometry(id),
    prisma.fertilizerApplication.findMany({
      where: { parcelId: id },
      include: { cropYear: { include: { crop: { select: { name: true } } } } },
      orderBy: { appliedOn: 'desc' },
    }),
    prisma.phytosanitaryApplication.findMany({
      where: { parcelId: id },
      include: { product: { select: { status: true } } },
      orderBy: { appliedOn: 'desc' },
    }),
    prisma.agriculturalOperation.findMany({
      where: { parcelId: id },
      orderBy: { performedOn: 'desc' },
    }),
    prisma.soilCover.findMany({
      where: { parcelId: id },
      orderBy: [{ sownOn: 'desc' }, { createdAt: 'desc' }],
    }),
    couchesPourExploitation({ farmId: ctx.farmId }),
    prisma.document.findMany({
      where: { parcelId: id },
      orderBy: { createdAt: 'desc' },
    }),
    buildHistory({ parcelIds: [id], limit: 300 }),
    prisma.crop.findMany({
      where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.fertilizer.findMany({
      where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.organicInput.findMany({
      where: { OR: [{ farmId: null }, { farmId: ctx.farmId }] },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    getEphySourceInfo(),
  ]);

  if (!parcel) notFound();

  const currentCrop = parcel.cropYears.find((cy) => cy.campaignYear === year) ?? null;
  const canWrite = roleHasPermission(ctx.role, 'record:write');
  const canEditParcel = roleHasPermission(ctx.role, 'parcel:write');
  const canDeleteParcel = roleHasPermission(ctx.role, 'parcel:delete');

  const balance = computeNutrientBalance(
    fertilizations.map((f) => ({
      treatedAreaHa: f.treatedAreaHa.toString(),
      nSupplied: f.nSupplied?.toString() ?? null,
      pSupplied: f.pSupplied?.toString() ?? null,
      kSupplied: f.kSupplied?.toString() ?? null,
    })),
  );

  /**
   * Contexte réglementaire, recalculé à l'affichage.
   *
   * À l'affichage plutôt qu'à la création de la parcelle : un zonage importé
   * après coup doit se répercuter sans qu'on ait à repasser sur chaque
   * parcelle. Le calcul est une découpe PostGIS sur un index GiST, sans
   * commune mesure avec le reste du chargement de la page.
   *
   * Un échec ne casse pas la fiche : le contexte vaut alors `null` et le bloc
   * affiche qu'il n'a pas été déterminé. Une parcelle doit rester consultable
   * même quand le moteur réglementaire a un problème.
   */
  const contexteReglementaire = await computeParcelContext(id)
    .then((contexte) => ({
      ...contexte,
      commune: parcel.commune,
      computedAt: new Date().toISOString(),
    }))
    .catch(() => null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={parcel.name}
        breadcrumb={
          <Link
            href={retourListe}
            className="hover:text-champ-700 dark:hover:text-champ-400"
          >
            ← Retour aux parcelles
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-champ-700 dark:text-champ-400">
              {formatNumberFr(parcel.areaHa, 4)} ha
            </span>
            {parcel.internalNumber ? <span>N° {parcel.internalNumber}</span> : null}
            {parcel.commune ? <span>{parcel.commune}</span> : null}
            {parcel.lieuDit ? <span>Lieu-dit {parcel.lieuDit}</span> : null}
            <Badge tone={parcel.status === 'ACTIVE' ? 'green' : 'neutral'}>
              {PARCEL_STATUS_LABELS[parcel.status] ?? parcel.status}
            </Badge>
            {currentCrop ? (
              <Badge tone="green">
                {currentCrop.crop.name} — campagne {year}
              </Badge>
            ) : (
              <Badge tone="amber">Culture {year} non renseignée</Badge>
            )}
          </span>
        }
        actions={
          <>
            {canEditParcel ? (
              <>
                {/* Renommer d'abord : c'est le geste que l'on fait cent fois
                    après un import, quand « Îlot 39 — parcelle 3 » doit
                    devenir « La Croix Rouge ». « Modifier » ouvre l'assistant
                    complet, contour compris — ce n'est pas le même besoin. */}
                <RenameParcel
                  parcelId={id}
                  name={parcel.name}
                  internalNumber={parcel.internalNumber}
                  lieuDit={parcel.lieuDit}
                />
                <LinkButton href={`/parcelles/${id}/modifier`} variant="outline">
                  Modifier
                </LinkButton>
              </>
            ) : null}
            {canDeleteParcel ? (
              <ParcelActions parcelId={id} parcelName={parcel.name} />
            ) : null}
          </>
        }
      />

      {/* Carte de la parcelle */}
      {geometry ? (
        <Card className="mb-5" padded={false}>
          <div className="p-3">
            <ParcelsMapLoader
              parcels={[
                {
                  id: parcel.id,
                  name: parcel.name,
                  internalNumber: parcel.internalNumber,
                  commune: parcel.commune,
                  areaHa: Number(parcel.areaHa),
                  crop: currentCrop?.crop.name ?? null,
                  geometry,
                },
              ]}
              tileUrl={env.MAP_TILE_URL}
              attribution={env.MAP_TILE_ATTRIBUTION}
              selectedId={parcel.id}
              readOnly
              heightClass="h-[320px]"
              regulatoryLayers={couches}
            />
          </div>
        </Card>
      ) : null}

      <ParcelTabs
        activeTab={onglet ?? 'general'}
        canWrite={canWrite}
        parcel={{
          id: parcel.id,
          name: parcel.name,
          internalNumber: parcel.internalNumber,
          commune: parcel.commune,
          inseeCode: parcel.inseeCode,
          lieuDit: parcel.lieuDit,
          cadastralRef: parcel.cadastralRef,
          pacId: parcel.pacId,
          parcelType: parcel.parcelType,
          status: parcel.status,
          notes: parcel.notes,
          areaHa: Number(parcel.areaHa),
          centroidLat: parcel.centroidLat,
          centroidLng: parcel.centroidLng,
          drainedSoil: parcel.drainedSoil,
          createdAt: parcel.createdAt.toISOString(),
        }}
        regulatoryContext={contexteReglementaire}
        campaignYear={year}
        cropYears={parcel.cropYears.map((cy) => ({
          id: cy.id,
          cropId: cy.cropId,
          cropName: cy.crop.name,
          campaignYear: cy.campaignYear,
          variety: cy.variety,
          sowingDate: cy.sowingDate?.toISOString() ?? null,
          expectedHarvestDate: cy.expectedHarvestDate?.toISOString() ?? null,
          actualHarvestDate: cy.actualHarvestDate?.toISOString() ?? null,
          yieldValue: cy.yieldValue?.toString() ?? null,
          yieldUnit: cy.yieldUnit,
          notes: cy.notes,
        }))}
        fertilizations={fertilizations.map((f) => ({
          id: f.id,
          appliedOn: f.appliedOn.toISOString(),
          inputType: f.inputType,
          productLabel: f.productLabel,
          dose: f.dose.toString(),
          doseUnit: f.doseUnit,
          treatedAreaHa: f.treatedAreaHa.toString(),
          totalQuantity: f.totalQuantity.toString(),
          totalUnit: f.totalUnit,
          nSupplied: f.nSupplied?.toString() ?? null,
          pSupplied: f.pSupplied?.toString() ?? null,
          kSupplied: f.kSupplied?.toString() ?? null,
          supplier: f.supplier,
          batchNumber: f.batchNumber,
          cropName: f.cropYear?.crop.name ?? null,
          notes: f.notes,
        }))}
        balance={balance}
        phytoTreatments={phytoTreatments.map((p) => ({
          id: p.id,
          appliedOn: p.appliedOn.toISOString(),
          productName: p.productName,
          amm: p.amm,
          activeSubstances: p.activeSubstances,
          targetLabel: p.targetLabel,
          dose: p.dose.toString(),
          doseUnit: p.doseUnit,
          sprayVolumeLHa: p.sprayVolumeLHa?.toString() ?? null,
          treatedAreaHa: p.treatedAreaHa.toString(),
          quantityUsed: p.quantityUsed.toString(),
          quantityUnit: p.quantityUnit,
          weatherSummary: p.weatherSummary,
          weatherTempC: p.weatherTempC?.toString() ?? null,
          weatherWindKmh: p.weatherWindKmh?.toString() ?? null,
          weatherHumidity: p.weatherHumidity?.toString() ?? null,
          operator: p.operator,
          productStatus: p.product?.status ?? null,
          notes: p.notes,
        }))}
        operations={operations.map((o) => ({
          id: o.id,
          performedOn: o.performedOn.toISOString(),
          type: o.type,
          equipment: o.equipment,
          operator: o.operator,
          durationHours: o.durationHours?.toString() ?? null,
          notes: o.notes,
          irrigationMm: o.irrigationMm?.toString() ?? null,
          irrigationVolumeM3Ha: o.irrigationVolumeM3Ha?.toString() ?? null,
          waterSource: o.waterSource,
          waterNitrateMgL: o.waterNitrateMgL?.toString() ?? null,
        }))}
        soilCovers={soilCovers.map((c) => ({
          id: c.id,
          kind: c.kind,
          species: c.species,
          sownOn: c.sownOn?.toISOString() ?? null,
          emergedOn: c.emergedOn?.toISOString() ?? null,
          destroyedOn: c.destroyedOn?.toISOString() ?? null,
          destructionMethod: c.destructionMethod,
          areaHa: c.areaHa?.toString() ?? null,
          incoherences: incoherencesDates(c),
        }))}
        documents={documents.map((d) => ({
          id: d.id,
          fileName: d.fileName,
          sizeBytes: d.sizeBytes,
          mimeType: d.mimeType,
          category: d.category,
          description: d.description,
          createdAt: d.createdAt.toISOString(),
        }))}
        history={history}
        referentials={{
          crops: crops.map((c) => ({
            id: c.id,
            name: c.name,
            category: c.category,
          })),
          fertilizers: fertilizers.map((f) => ({
            id: f.id,
            name: f.name,
            category: f.category,
            nPercent: f.nPercent?.toString() ?? null,
            pPercent: f.pPercent?.toString() ?? null,
            kPercent: f.kPercent?.toString() ?? null,
            defaultUnit: f.defaultUnit,
          })),
          organicInputs: organicInputs.map((o) => ({
            id: o.id,
            name: o.name,
            category: o.category,
            nContent: o.nContent?.toString() ?? null,
            pContent: o.pContent?.toString() ?? null,
            kContent: o.kContent?.toString() ?? null,
            defaultUnit: o.defaultUnit,
          })),
        }}
        ephySource={ephySource}
      />
    </div>
  );
}
