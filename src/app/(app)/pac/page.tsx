import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { PacPanel, type PacDashboard } from '@/app/(app)/pac/PacPanel';
import { PageHeader } from '@/components/ui';
import { IconArea } from '@/components/ui/icons';
import { periodeCampagneLabel } from '@/lib/shared/campagne';
import { campagnePacParDefaut, resumeCampagnes } from '@/lib/services/campagnes';

export const metadata: Metadata = { title: 'PAC / TéléPAC' };
export const dynamic = 'force-dynamic';

type SearchParams = { annee?: string };

const RAISONS: Record<'dernier-import' | 'dossier' | 'courante', string> = {
  'dernier-import': 'Campagne de votre dernier import.',
  dossier: 'Campagne du dossier présent dans Parcelys.',
  courante: 'Campagne culturale en cours.',
};

export default async function PacPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requirePageFarmAccess('parcel:read');
  const params = await searchParams;

  /**
   * La campagne ouverte par défaut.
   *
   * Elle prenait l'année civile, alors que le reste du site emploie la
   * campagne culturale : le 11 septembre 2026, la page PAC annonçait
   * « Campagne 2026 » et la liste des parcelles « Campagne 2027 », le même
   * jour, sans un mot d'explication.
   *
   * Une seule définition désormais (`@/lib/shared/campagne`), et sur cette
   * page-ci un défaut qui vise le dossier déposé plutôt que le calendrier :
   * on vient ici pour retrouver ce qu'on a importé. La raison du choix est
   * affichée, et le sélecteur permet d'en changer.
   */
  const resumes = await resumeCampagnes(ctx.farmId);
  const defaut = campagnePacParDefaut(resumes);
  const demandee = Number(params.annee);
  const year =
    Number.isInteger(demandee) && demandee >= 2000 && demandee <= 2100
      ? demandee
      : defaut.year;

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
    periode: periodeCampagneLabel(year),
    raisonDefaut: year === defaut.year ? RAISONS[defaut.raison] : null,
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
    /**
     * Les campagnes proposées, avec ce que chacune contient.
     *
     * Une liste d'années nues obligeait à les essayer une par une pour
     * retrouver celle qui porte le dossier. Toute campagne qui porte quelque
     * chose y figure, si ancienne soit-elle : l'historique d'un exploitant
     * n'a pas à tenir dans une fenêtre de cinq ans.
     */
    campagnes: resumes.map((r) => ({
      year: r.year,
      ilots: r.ilots,
      entites: r.entites,
      parcellesAvecCulture: r.parcellesAvecCulture,
      importee: r.dernierImport !== null,
    })),
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
