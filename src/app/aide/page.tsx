import type { Metadata } from 'next';
import { getAuthContext } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/accounts';
import { lireFaq } from '@/lib/aide/faq';
import { PublicShell } from '@/components/marketing/PublicShell';
import { FaqBrowser } from '@/components/aide/FaqBrowser';

export const metadata: Metadata = {
  title: "Centre d'aide",
  description:
    'Questions fréquentes sur Parcelys : compte, exploitations, cartographie, fertilisation, registre phytosanitaire, exports, numéro client, assistance.',
};
export const dynamic = 'force-dynamic';

/**
 * Centre d'aide public — connecté ou non.
 *
 * La recherche est faite dans le navigateur, sur les questions publiées
 * rendues par le serveur : instantanée, et la même que celle de
 * l'application mobile (`src/lib/shared/faq.ts`). `?q=` préremplit la
 * recherche, pour un lien direct. Sans résultat, la page propose Contact.
 */
export default async function AidePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, categories, auth] = await Promise.all([searchParams, lireFaq(), getAuthContext()]);

  return (
    <PublicShell
      title="Centre d'aide"
      description="Les réponses aux questions les plus fréquentes. Vous ne trouvez pas ? Écrivez-nous."
      espace={auth ? { href: homePathFor(auth.user.accountType), label: 'Mon espace' } : null}
    >
      <FaqBrowser
        categories={categories.map((c) => ({
          id: c.id,
          slug: c.slug,
          title: c.title,
          description: c.description,
          entries: c.entries.map((e) => ({
            id: e.id,
            slug: e.slug,
            question: e.question,
            answer: e.answer,
            keywords: e.keywords,
            needsReview: e.needsReview,
            categorySlug: e.categorySlug,
            categoryTitle: e.categoryTitle,
          })),
        }))}
        initialQuery={(q ?? '').slice(0, 120)}
      />
    </PublicShell>
  );
}
