import type { Metadata } from 'next';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  TableWrapper,
  Td,
  Th,
  Tr,
  cn,
  formatDateLongFr,
} from '@/components/ui';
import { IconAudit } from '@/components/ui/icons';

export const metadata: Metadata = { title: "Journal d'audit — Administration" };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 60;

/** Familles d'actions proposées en filtre, avec le préfixe correspondant. */
const CATEGORIES = [
  { key: 'tout', label: 'Tout', prefix: null },
  { key: 'auth', label: 'Authentification', prefix: 'auth.' },
  { key: 'admin', label: 'Administration', prefix: 'admin.' },
  { key: 'invitation', label: 'Invitations', prefix: 'invitation.' },
  { key: 'parcel', label: 'Parcelles', prefix: 'parcel.' },
  { key: 'document', label: 'Documents', prefix: 'document.' },
  { key: 'export', label: 'Exports', prefix: 'export.' },
] as const;

/** Actions à mettre en évidence : elles touchent à l'accès ou aux données. */
const SENSITIVE = new Set([
  'auth.account_locked',
  'auth.login_failed',
  'access.denied',
  'invitation.rejected',
  'admin.user_suspended',
  'admin.user_deleted',
  'admin.platform_role_changed',
  'account.deleted',
]);

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ categorie?: string; page?: string }>;
}) {
  await requirePageAdmin();
  const params = await searchParams;

  const category =
    CATEGORIES.find((c) => c.key === params.categorie) ?? CATEGORIES[0];
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.AuditLogWhereInput = category.prefix
    ? { action: { startsWith: category.prefix } }
    : {};

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { email: true } },
        farm: { select: { name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function href(next: { categorie?: string; page?: number }): string {
    const search = new URLSearchParams();
    const cat = next.categorie ?? category.key;
    const p = next.page ?? page;
    if (cat !== 'tout') search.set('categorie', cat);
    if (p > 1) search.set('page', String(p));
    const suffix = search.toString();
    return suffix ? `/administration/journal?${suffix}` : '/administration/journal';
  }

  return (
    <>
      <PageHeader
        icon={IconAudit}
        title="Journal d'audit"
        description={`${total.toLocaleString('fr-FR')} entrée(s). Conservation par défaut : 365 jours.`}
      />

      <div className="mb-4">
        <Alert tone="info">
          Le journal enregistre les accès et les modifications, avec l&apos;adresse IP et
          l&apos;agent utilisateur. Il constitue une donnée personnelle : sa durée de
          conservation est limitée et se purge depuis l&apos;onglet{' '}
          <Link href="/administration/maintenance" className="font-medium underline">
            Maintenance
          </Link>
          .
        </Alert>
      </div>

      <nav aria-label="Filtrer par famille d'action" className="mb-4">
        <ul className="flex flex-wrap gap-1">
          {CATEGORIES.map((item) => (
            <li key={item.key}>
              <Link
                href={href({ categorie: item.key, page: 1 })}
                aria-current={item.key === category.key ? 'page' : undefined}
                className={cn(
                  'inline-flex rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  item.key === category.key
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {entries.length === 0 ? (
        <EmptyState
          icon={IconAudit}
          title="Aucune entrée"
          description="Rien n'a encore été enregistré pour cette famille d'actions."
        />
      ) : (
        <>
          <TableWrapper>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Action</Th>
                <Th>Auteur</Th>
                <Th>Exploitation</Th>
                <Th>Origine</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Tr key={entry.id}>
                  <Td>
                    <span className="whitespace-nowrap text-[12.5px] text-ink-3">
                      {formatDateLongFr(entry.createdAt)}
                    </span>
                  </Td>
                  <Td>
                    <code
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[12px]',
                        SENSITIVE.has(entry.action)
                          ? 'bg-brique-50 text-brique-600 dark:bg-brique-700/25 dark:text-brique-100'
                          : 'bg-surface-2 text-ink-2',
                      )}
                    >
                      {entry.action}
                    </code>
                    {entry.entity ? (
                      <span className="ml-2 text-[11.5px] text-ink-3">{entry.entity}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="text-[12.5px] text-ink-2">
                      {entry.user?.email ?? <Badge tone="neutral">Anonyme</Badge>}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[12.5px] text-ink-3">
                      {entry.farm?.name ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-[12.5px] text-ink-3">
                      {entry.ipAddress ?? '—'}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrapper>

          {pages > 1 ? (
            <nav
              aria-label="Pagination du journal"
              className="mt-4 flex items-center justify-between text-sm"
            >
              {page > 1 ? (
                <Link
                  href={href({ page: page - 1 })}
                  className="text-champ-700 hover:underline dark:text-champ-400"
                >
                  ← Page précédente
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-3">
                Page {page} sur {pages}
              </span>
              {page < pages ? (
                <Link
                  href={href({ page: page + 1 })}
                  className="text-champ-700 hover:underline dark:text-champ-400"
                >
                  Page suivante →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
