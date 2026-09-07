import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageParcelAccess } from '@/lib/auth/page-guards';
import { getFarmParcelsGeoJSON, getParcelGeometry } from '@/lib/geo/repository';
import { getEnv } from '@/lib/env';
import { NewParcelWizard } from '@/app/(app)/parcelles/nouvelle/NewParcelWizard';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Modifier la parcelle' };
export const dynamic = 'force-dynamic';

export default async function EditParcelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePageParcelAccess(id, 'parcel:write');

  const [parcel, geometry, geojson] = await Promise.all([
    prisma.parcel.findUnique({ where: { id } }),
    getParcelGeometry(id),
    getFarmParcelsGeoJSON(ctx.farmId),
  ]);

  if (!parcel) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Modifier « ${parcel.name} »`}
        breadcrumb={
          <Link href={`/parcelles/${id}`} className="hover:text-champ-700">
            ← Retour à la fiche
          </Link>
        }
      />

      <NewParcelWizard
        tileUrl={getEnv().MAP_TILE_URL}
        attribution={getEnv().MAP_TILE_ATTRIBUTION}
        otherParcels={geojson.features
          .filter((f) => f.properties.id !== id)
          .map((f) => ({
            id: f.properties.id,
            name: f.properties.name,
            geometry: f.geometry,
          }))}
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
          geometry,
        }}
      />
    </div>
  );
}
