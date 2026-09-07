import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { getFarmParcelsGeoJSON } from '@/lib/geo/repository';
import { getEnv } from '@/lib/env';
import { NewParcelWizard } from '@/app/(app)/parcelles/nouvelle/NewParcelWizard';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Nouvelle parcelle' };
export const dynamic = 'force-dynamic';

export default async function NewParcelPage() {
  const ctx = await requirePageFarmAccess('parcel:write');
  const env = getEnv();

  // Parcelles existantes affichées en fond de carte pour se repérer.
  const geojson = await getFarmParcelsGeoJSON(ctx.farmId);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Nouvelle parcelle"
        breadcrumb={
          <Link href="/parcelles" className="hover:text-champ-700 dark:hover:text-champ-400">
            ← Retour aux parcelles
          </Link>
        }
        description="Tracez le contour sur la carte, puis complétez les informations."
      />

      <NewParcelWizard
        tileUrl={env.MAP_TILE_URL}
        attribution={env.MAP_TILE_ATTRIBUTION}
        otherParcels={geojson.features.map((f) => ({
          id: f.properties.id,
          name: f.properties.name,
          geometry: f.geometry,
        }))}
      />
    </div>
  );
}
