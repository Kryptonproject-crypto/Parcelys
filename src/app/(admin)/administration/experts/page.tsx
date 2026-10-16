import type { Metadata } from 'next';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import {
  listAdminTechnicians,
  listFarmOptions,
  listPortfolioOptions,
} from '@/lib/admin/overview';
import { ExpertsPanel } from '@/app/(admin)/administration/experts/ExpertsPanel';
import { ListFilters } from '@/app/(admin)/administration/ListFilters';
import { AdminPagination } from '@/app/(admin)/administration/Pagination';
import { LinkButton, PageHeader } from '@/components/ui';
import { IconAdvisor, IconExport } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Techniciens — Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminExpertsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; statut?: string }>;
}) {
  const { scope } = await requirePageAdminScope('technicians:read');
  const params = await searchParams;
  const search = params.q?.trim().slice(0, 120) ?? '';
  const sansPortefeuille = scope.all && params.statut === 'sans-portefeuille';

  const [result, farms, portfolios] = await Promise.all([
    listAdminTechnicians({ scope, search, sansPortefeuille, page: Number(params.page) || 1 }),
    listFarmOptions(scope),
    listPortfolioOptions(scope),
  ]);

  return (
    <>
      <PageHeader
        icon={IconAdvisor}
        title="Experts et techniciens"
        description={`${result.total} technicien(s)${scope.all ? '' : ' dans vos portefeuilles'} — qui suit quelle exploitation, et comment ouvrir ou retirer un accès.`}
        actions={
          <LinkButton href="/api/admin/exports?type=techniciens" icon={IconExport} variant="outline" prefetch={false}>
            CSV
          </LinkButton>
        }
      />
      <ListFilters
        basePath="/administration/experts"
        filters={
          scope.all
            ? [
                { value: 'tous', label: 'Tous' },
                { value: 'sans-portefeuille', label: 'Sans portefeuille' },
              ]
            : undefined
        }
        current={sansPortefeuille ? 'sans-portefeuille' : 'tous'}
        search={search}
        placeholder="Nom, structure, TEC-…"
      />
      <ExpertsPanel
        experts={result.rows}
        farms={farms}
        portfolios={portfolios}
        general={scope.all}
      />
      <AdminPagination
        basePath="/administration/experts"
        params={{ q: search || undefined, statut: sansPortefeuille ? 'sans-portefeuille' : undefined }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
