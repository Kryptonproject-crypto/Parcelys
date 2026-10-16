import type { Metadata } from 'next';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { lireFaq } from '@/lib/aide/faq';
import { LinkButton, PageHeader } from '@/components/ui';
import { IconExternal, IconHelp } from '@/components/ui/icons';
import { FaqEditor } from '@/app/(admin)/administration/aide/FaqEditor';

export const metadata: Metadata = { title: "Centre d'aide — Administration" };
export const dynamic = 'force-dynamic';

/** Le contenu du centre d'aide, modifiable sans toucher au code — administrateur général seul. */
export default async function AdminHelpPage() {
  await requirePageAdminScope('faq:manage');
  const categories = await lireFaq({ inclureNonPubliees: true });

  return (
    <>
      <PageHeader
        icon={IconHelp}
        title="Centre d'aide"
        description="Rubriques et questions de la FAQ publique (site et application). Les modifications sont immédiates."
        actions={
          <LinkButton href="/aide" variant="outline" icon={IconExternal}>
            Voir la FAQ
          </LinkButton>
        }
      />
      <FaqEditor categories={categories} />
    </>
  );
}
