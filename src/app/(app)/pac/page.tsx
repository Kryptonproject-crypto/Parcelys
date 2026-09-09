import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { PacPanel, type PacDashboard } from '@/app/(app)/pac/PacPanel';
import { PageHeader } from '@/components/ui';
import { IconArea } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'PAC / TéléPAC' };
export const dynamic = 'force-dynamic';

/** Campagne en cours : une déclaration se prépare sur l'année civile courante. */
function campagneCourante(): number {
  return new Date().getFullYear();
}

export default async function PacPage() {
  const ctx = await requirePageFarmAccess('parcel:read');
  const year = campagneCourante();

  const campaign = await prisma.pacCampaign.findUnique({
    where: { farmId_year: { farmId: ctx.farmId, year } },
    select: { id: true, lastImportAt: true, lastExportAt: true },
  });

  const [ilotCount, parcelles, snapshots, changesSinceImport] = await Promise.all([
    campaign
      ? prisma.pacIlot.count({ where: { campaignId: campaign.id } })
      : Promise.resolve(0),
    prisma.$queryRaw<Array<{ n: bigint; area: number | null }>>`
      SELECT count(*)::bigint AS n,
             COALESCE(SUM(ST_Area(pg.geom::geography) / 10000.0), 0) AS area
      FROM parcels p
      LEFT JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
      WHERE p.farm_id = ${ctx.farmId} AND p.deleted_at IS NULL
    `,
    prisma.pacSnapshot.findMany({
      where: { campaign: { farmId: ctx.farmId } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, label: true, parcelCount: true, createdAt: true },
    }),
    // Ce qui a bougé depuis le dernier import : c'est ce qui distingue un
    // dossier synchronisé d'un dossier qui a divergé.
    campaign?.lastImportAt
      ? prisma.pacChange.count({
          where: {
            campaignId: campaign.id,
            createdAt: { gt: campaign.lastImportAt },
            changeType: { notIn: ['import.create', 'import.update'] },
          },
        })
      : Promise.resolve(0),
  ]);

  const dashboard: PacDashboard = {
    year,
    ilotCount,
    parcelCount: Number(parcelles[0]?.n ?? 0),
    areaHa: Number(parcelles[0]?.area ?? 0),
    lastImportAt: campaign?.lastImportAt?.toISOString() ?? null,
    lastExportAt: campaign?.lastExportAt?.toISOString() ?? null,
    changesSinceImport,
    snapshots: snapshots.map((s) => ({
      id: s.id,
      label: s.label,
      parcelCount: s.parcelCount,
      createdAt: s.createdAt.toISOString(),
    })),
    // Les campagnes proposées : l'année en cours et les quatre précédentes.
    availableYears: [0, 1, 2, 3, 4].map((n) => year - n),
  };

  return (
    <>
      <PageHeader
        icon={IconArea}
        title="PAC / TéléPAC"
        description="Importer votre dossier TéléPAC, le contrôler, et préparer l’export."
      />
      <PacPanel dashboard={dashboard} />
    </>
  );
}
