import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { listerDemandesAdmin } from '@/lib/support/tickets';
import {
  LIBELLES_IDENTITE,
  LIBELLES_STATUT,
  STATUTS_DEMANDE,
  TONS_STATUT,
  libelleRubrique,
} from '@/lib/shared/support';
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  TableWrapper,
  Td,
  Th,
  Tr,
  formatDateFr,
} from '@/components/ui';
import { IconExport, IconSupport } from '@/components/ui/icons';
import { ListFilters } from '@/app/(admin)/administration/ListFilters';
import { AdminPagination } from '@/app/(admin)/administration/Pagination';

export const metadata: Metadata = { title: 'Support — Administration' };
export const dynamic = 'force-dynamic';

const FILTRES = [
  { value: 'ouvertes', label: 'Ouvertes' },
  ...STATUTS_DEMANDE.map((s) => ({ value: s, label: LIBELLES_STATUT[s] })),
  { value: 'toutes', label: 'Toutes' },
];

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; q?: string; page?: string; moi?: string }>;
}) {
  const { scope } = await requirePageAdminScope('support:read');
  const params = await searchParams;
  const statut = FILTRES.some((f) => f.value === params.statut) ? (params.statut as string) : 'ouvertes';
  const search = params.q?.trim().slice(0, 120) ?? '';
  const mine = params.moi === '1';

  const result = await listerDemandesAdmin({
    scope,
    statut,
    search,
    mine,
    page: Number(params.page) || 1,
  });

  return (
    <>
      <PageHeader
        icon={IconSupport}
        title="Demandes de support"
        description={
          scope.all
            ? `${result.total} demande(s) — toutes les demandes de Parcelys.`
            : `${result.total} demande(s) — celles de vos portefeuilles.`
        }
        actions={
          <>
            <LinkButton
              href={mine ? '/administration/support' : '/administration/support?moi=1'}
              variant="outline"
            >
              {mine ? 'Toutes les demandes' : 'Attribuées à moi'}
            </LinkButton>
            <LinkButton href="/api/admin/exports?type=demandes" variant="outline" icon={IconExport} prefetch={false}>
              CSV
            </LinkButton>
          </>
        }
      />
      <ListFilters
        basePath="/administration/support"
        filters={FILTRES}
        current={statut}
        search={search}
        placeholder="Sujet, nom, adresse, DEM-…, EXP-…"
        extraParams={{ moi: mine ? '1' : undefined }}
      />
      {result.rows.length === 0 ? (
        <EmptyState icon={IconSupport} title="Aucune demande" description="Rien ne correspond à ce filtre." />
      ) : (
        <TableWrapper>
          <thead>
            <tr>
              <Th>Demande</Th>
              <Th>Demandeur</Th>
              <Th>Statut</Th>
              <Th>Responsable</Th>
              <Th align="right">Activité</Th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={`/administration/support/${t.id}`} className="block font-medium text-ink hover:underline">
                    {t.subject}
                  </Link>
                  <span className="block font-mono text-[12px] text-ink-2">{t.number}</span>
                  <span className="block text-[12.5px] text-ink-3">{libelleRubrique(t.area)}</span>
                </Td>
                <Td>
                  <span className="block text-ink">{t.requesterName}</span>
                  <span className="block break-all text-[12.5px] text-ink-3">{t.requesterEmail}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {t.declaredNumber ? (
                      <span className="font-mono text-[12px] text-ink-2">{t.declaredNumber}</span>
                    ) : null}
                    <Badge tone={t.identity === 'UNVERIFIED' ? 'amber' : t.identity === 'ACCOUNT' ? 'green' : 'blue'}>
                      {LIBELLES_IDENTITE[t.identity]}
                    </Badge>
                  </span>
                </Td>
                <Td>
                  <span className="shrink-0">
                    <Badge tone={TONS_STATUT[t.status]}>{LIBELLES_STATUT[t.status]}</Badge>
                  </span>
                </Td>
                <Td>
                  <span className="block text-[13px] text-ink-2">
                    {t.assigneeName ?? <span className="text-ink-3">Non attribuée</span>}
                  </span>
                  {scope.all ? (
                    <span className="block text-[12.5px] text-ink-3">{t.portfolioName ?? 'Sans portefeuille'}</span>
                  ) : null}
                </Td>
                <Td align="right">
                  <span className="text-[12.5px] text-ink-3">{formatDateFr(t.lastActivityAt)}</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrapper>
      )}
      <AdminPagination
        basePath="/administration/support"
        params={{ statut: statut === 'ouvertes' ? undefined : statut, q: search || undefined, moi: mine ? '1' : undefined }}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </>
  );
}
