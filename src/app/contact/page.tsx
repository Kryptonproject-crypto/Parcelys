import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { PARCELYS } from '@/lib/constants/identity';
import { getAuthContext } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/accounts';
import { exploitationsDuCompte } from '@/lib/support/tickets';
import { PublicShell } from '@/components/marketing/PublicShell';
import { ContactForm, type ContexteContact } from '@/components/support/ContactForm';
import {
  IconExport,
  IconHelp,
  IconPhyto,
  IconSecurity,
  type LucideIcon,
} from '@/components/ui/icons';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Écrire à Parcelys : assistance, question sur vos données, signalement d’une anomalie.',
};
export const dynamic = 'force-dynamic';

/**
 * Contact.
 *
 * Un formulaire, désormais, plutôt qu'une simple adresse : chaque demande
 * reçoit un numéro (DEM-…), arrive directement à l'administrateur qui suit le
 * client, et garde l'historique des échanges et des statuts. L'adresse
 * e-mail reste affichée pour qui préfère sa messagerie.
 *
 * Connecté, le formulaire préremplit le nom, l'adresse et le numéro client
 * depuis la session. Anonyme, il fonctionne aussi — quelqu'un qui n'arrive
 * plus à se connecter doit pouvoir écrire — mais l'identité reste à vérifier.
 */

const MOTIFS: Array<{ icon: LucideIcon; titre: string; texte: string }> = [
  {
    icon: IconSecurity,
    titre: 'Accès et compte',
    texte:
      'Code d’invitation, mot de passe oublié, adresse e-mail à changer, accès d’un technicien à retirer.',
  },
  {
    icon: IconPhyto,
    titre: 'Une donnée qui vous semble fausse',
    texte:
      'Un produit dont l’autorisation ne correspond pas au catalogue, une surface inattendue. Précisez la parcelle et la date : la réponse sera plus rapide.',
  },
  {
    icon: IconExport,
    titre: 'Vos données personnelles',
    texte:
      'Accès, rectification, effacement, portabilité. L’export complet de vos données est aussi disponible à tout moment depuis votre profil.',
  },
];

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ sujet?: string }>;
}) {
  const [{ sujet }, auth] = await Promise.all([searchParams, getAuthContext()]);
  const compte = auth && auth.user.emailVerified ? auth : null;

  let contexte: ContexteContact = { compte: null };
  if (compte) {
    const fermes = exploitationsDuCompte(compte);
    const [farms, moi] = await Promise.all([
      prisma.farm.findMany({
        where: { id: { in: fermes.map((f) => f.farmId) } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, customerNumber: true },
      }),
      prisma.user.findUnique({
        where: { id: compte.user.id },
        select: { technicianNumber: true, accountType: true },
      }),
    ]);
    contexte = {
      compte: {
        name: `${compte.user.firstName} ${compte.user.lastName}`,
        email: compte.user.email,
        technicianNumber: moi?.accountType === 'AGRONOMIST' ? moi.technicianNumber : null,
        farms,
        activeFarmId: compte.activeFarmId,
      },
    };
  }

  return (
    <PublicShell
      title="Nous écrire"
      description="Une demande, un numéro, une réponse — et l'historique gardé des deux côtés."
      espace={auth ? { href: homePathFor(auth.user.accountType), label: 'Mon espace' } : null}
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
        <p className="flex items-center gap-2 text-[14.5px] text-ink-2">
          <IconHelp size={18} aria-hidden className="text-champ-700 dark:text-champ-300" />
          La réponse est peut-être déjà dans le centre d&apos;aide.
        </p>
        <Link href="/aide" className="font-medium text-champ-700 underline dark:text-champ-400">
          Consulter l&apos;aide
        </Link>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <ContactForm contexte={contexte} sujetInitial={(sujet ?? '').slice(0, 150)} />
      </div>

      {compte ? (
        <p className="mt-4 text-[13.5px] text-ink-3">
          Vos demandes précédentes :{' '}
          <Link href="/mes-demandes" className="underline hover:text-ink">
            Mes demandes
          </Link>
          .
        </p>
      ) : null}

      <p className="mt-6 text-[13.5px] leading-relaxed text-ink-3">
        Vous préférez votre messagerie ? Écrivez à{' '}
        <a href={`mailto:${PARCELYS.contact.support}`} className="font-medium underline hover:text-ink">
          {PARCELYS.contact.support}
        </a>{' '}
        — en précisant votre numéro client.
      </p>

      <h2 className="mt-10 text-[19px] font-semibold tracking-tight text-ink">
        Ce dont on parle le plus souvent
      </h2>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {MOTIFS.map(({ icon: Icon, titre, texte }) => (
          <li key={titre} className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-champ-700 dark:text-champ-300">
              <Icon size={19} aria-hidden />
            </span>
            <h3 className="mt-3 text-[15px] font-semibold text-ink">{titre}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{texte}</p>
          </li>
        ))}
      </ul>

      <div className="mt-10 rounded-xl border border-ble-500/40 bg-ble-50 p-5 dark:bg-ble-700/15">
        <h2 className="text-[15px] font-semibold text-ink">Un doute sur un produit phytosanitaire ?</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          Parcelys reprend le catalogue officiel E-Phy de l’ANSES sans le modifier, mais ne se
          substitue ni à l’étiquette du produit ni à la décision d’autorisation en vigueur. En
          cas de divergence, c’est l’étiquette qui fait foi — signalez-nous l’écart, nous
          vérifierons la synchronisation.
        </p>
      </div>

      <p className="mt-10 text-[13.5px] text-ink-3">
        Voir aussi la{' '}
        <Link href="/confidentialite" className="underline hover:text-ink">
          politique de confidentialité
        </Link>{' '}
        et les{' '}
        <Link href="/cgu" className="underline hover:text-ink">
          conditions générales d’utilisation
        </Link>
        .
      </p>
    </PublicShell>
  );
}
