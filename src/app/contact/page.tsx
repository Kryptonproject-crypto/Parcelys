import type { Metadata } from 'next';
import Link from 'next/link';
import { PARCELYS } from '@/lib/constants/identity';
import { PublicShell } from '@/components/marketing/PublicShell';
import {
  IconExport,
  IconPhyto,
  IconSecurity,
  type LucideIcon,
} from '@/components/ui/icons';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Écrire à Parcelys : assistance, question sur vos données, signalement d’une anomalie.',
};

/**
 * Contact.
 *
 * Une seule adresse, et c'est volontaire : Parcelys est édité par une personne.
 * Multiplier les adresses donnerait l'illusion d'un service client à étages et
 * rallongerait les réponses.
 *
 * Pas de formulaire non plus : il faudrait stocker les messages, les modérer et
 * les protéger, pour un résultat qu'un client de messagerie fait mieux — avec
 * une trace des deux côtés, ce qui vaut mieux quand on parle de registres
 * réglementaires.
 */

const MOTIFS: Array<{ icon: LucideIcon; titre: string; texte: string }> = [
  {
    icon: IconSecurity,
    titre: 'Accès et compte',
    texte:
      'Code d’invitation, mot de passe oublié, adresse e-mail à changer, accès d’un expert agronomique à retirer.',
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

export default function ContactPage() {
  return (
    <PublicShell
      title="Nous écrire"
      description="Une adresse, une personne, une réponse."
    >
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <p className="text-[14.5px] leading-relaxed text-ink-2">
          Parcelys est édité par <strong>{PARCELYS.editeur.nom}</strong>,{' '}
          {PARCELYS.editeur.qualite}. Les messages arrivent directement chez lui.
        </p>

        <a
          href={`mailto:${PARCELYS.contact.support}`}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-champ-700 px-5 text-[15px] font-medium text-white transition-colors hover:bg-champ-800"
        >
          {PARCELYS.contact.support}
        </a>

        <p className="mt-4 text-[13.5px] leading-relaxed text-ink-3">
          Décrivez ce que vous faisiez, ce que vous attendiez et ce qui s’est
          produit. Une copie d’écran vaut souvent mieux qu’un paragraphe.
        </p>
      </div>

      <h2 className="mt-10 text-[19px] font-semibold tracking-tight text-ink">
        Ce dont on parle le plus souvent
      </h2>

      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {MOTIFS.map(({ icon: Icon, titre, texte }) => (
          <li
            key={titre}
            className="rounded-xl border border-line bg-surface p-5 shadow-card"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-champ-700 dark:text-champ-300">
              <Icon size={19} aria-hidden />
            </span>
            <h3 className="mt-3 text-[15px] font-semibold text-ink">{titre}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{texte}</p>
          </li>
        ))}
      </ul>

      <div className="mt-10 rounded-xl border border-ble-500/40 bg-ble-50 p-5 dark:bg-ble-700/15">
        <h2 className="text-[15px] font-semibold text-ink">
          Un doute sur un produit phytosanitaire ?
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          Parcelys reprend le catalogue officiel E-Phy de l’ANSES sans le
          modifier, mais ne se substitue ni à l’étiquette du produit ni à la
          décision d’autorisation en vigueur. En cas de divergence, c’est
          l’étiquette qui fait foi — signalez-nous l’écart, nous vérifierons la
          synchronisation.
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
