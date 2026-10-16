import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageAuth } from '@/lib/auth/page-guards';
import { listerMesDemandes } from '@/lib/support/tickets';
import { LIBELLES_STATUT, TONS_STATUT } from '@/lib/shared/support';
import { Badge, EmptyState, LinkButton, PageHeader, formatDateFr } from '@/components/ui';
import { IconPlus, IconSupport } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Mes demandes' };
export const dynamic = 'force-dynamic';

/** Les demandes de support du compte connecté — et seulement les siennes. */
export default async function MesDemandesPage() {
  const auth = await requirePageAuth();
  const demandes = await listerMesDemandes(auth.user.id);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={IconSupport}
        title="Mes demandes"
        description="Vos demandes au support, leur statut et les réponses."
        actions={
          <LinkButton href="/contact" icon={IconPlus}>
            Nouvelle demande
          </LinkButton>
        }
      />
      {demandes.length === 0 ? (
        <EmptyState
          icon={IconSupport}
          title="Aucune demande"
          description="Une question ? Consultez d'abord le centre d'aide, puis écrivez-nous depuis la page Contact."
          action={
            <LinkButton href="/aide" variant="outline">
              Centre d&apos;aide
            </LinkButton>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {demandes.map((d) => (
            <li key={d.id}>
              <Link
                href={`/mes-demandes/${d.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card transition-colors hover:border-champ-300"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{d.subject}</span>
                  <span className="block text-[12.5px] text-ink-3">
                    <span className="font-mono">{d.number}</span> · dernière activité le {formatDateFr(d.lastActivityAt)}
                  </span>
                </span>
                <span className="shrink-0">
                  <Badge tone={TONS_STATUT[d.status]}>{LIBELLES_STATUT[d.status]}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
