import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { rechercherNumero } from '@/lib/admin/recherche';
import { EmptyState, PageHeader } from '@/components/ui';
import { IconNumber } from '@/components/ui/icons';

export const metadata: Metadata = { title: 'Recherche — Administration' };
export const dynamic = 'force-dynamic';

/**
 * Recherche par numéro. Trouvé dans le périmètre : on ouvre la fiche. Sinon,
 * une seule réponse — « aucun résultat » — qu'il n'existe pas ou qu'il soit
 * hors périmètre.
 */
export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { scope } = await requirePageAdminScope('dashboard:read');
  const q = ((await searchParams).q ?? '').slice(0, 40);
  const resultat = q ? await rechercherNumero(scope, q) : null;
  if (resultat?.found) redirect(resultat.url);

  return (
    <>
      <PageHeader icon={IconNumber} title="Recherche par numéro" />
      <EmptyState
        icon={IconNumber}
        title={
          !q
            ? 'Tapez un numéro'
            : resultat?.reason === 'format'
              ? `« ${q} » n'est pas un numéro reconnu`
              : `Aucun résultat pour « ${q} »`
        }
        description={
          <>
            Les numéros ont la forme <strong>EXP-000012</strong> (exploitation),{' '}
            <strong>TEC-000004</strong> (technicien) ou <strong>DEM-000031</strong> (demande).{' '}
            {scope.all
              ? null
              : 'La recherche ne porte que sur vos portefeuilles. '}
            Pour chercher par nom, utilisez les listes{' '}
            <Link className="underline" href="/administration/exploitations">
              Exploitations
            </Link>{' '}
            ou{' '}
            <Link className="underline" href="/administration/utilisateurs">
              Comptes
            </Link>
            .
          </>
        }
      />
    </>
  );
}
