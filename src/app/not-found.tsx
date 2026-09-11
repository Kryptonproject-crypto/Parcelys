import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page introuvable' };

/**
 * Page introuvable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI ELLE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il n'y en avait aucune. Next.js servait alors sa page par défaut :
 * « 404 — This page could not be found », en anglais, sans mise en forme et
 * sans un lien pour revenir. Un exploitant qui ouvre un signet vers une
 * parcelle supprimée tombait là-dessus, et n'avait plus qu'à retaper l'adresse.
 *
 * Elle est délibérément sobre : ce qui manque à quelqu'un d'égaré, c'est de
 * savoir où il est et comment repartir, pas une illustration.
 */
export default function PageIntrouvable() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Erreur 404
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Cette page n’existe pas</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          L’adresse est peut-être erronée, ou la parcelle, le document ou la fiche que
          vous cherchez a été supprimé depuis.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
          >
            Tableau de bord
          </Link>
          <Link
            href="/parcelles"
            className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:border-line-strong"
          >
            Mes parcelles
          </Link>
        </div>

        <p className="mt-6 text-[12.5px] text-ink-3">
          Si vous êtes arrivé ici depuis un lien de Parcelys,{' '}
          <Link href="/contact" className="underline hover:text-ink-2">
            signalez-le
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
