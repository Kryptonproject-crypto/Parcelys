'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Ce qui s'affiche quand quelque chose casse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE PAGE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il n'y avait aucune frontière d'erreur. La moindre exception dans un
 * composant — serveur ou client — donnait l'écran par défaut de Next.js :
 * « Application error: a server-side exception has occurred », en anglais, sur
 * fond blanc, sans un bouton. Pour quelqu'un qui travaille seul avec son
 * téléphone au bout d'un champ, c'est un cul-de-sac.
 *
 * Ce qui est affiché, et ce qui ne l'est pas :
 *
 *   · **pas le message d'erreur.** Il peut contenir un fragment de requête, un
 *     identifiant, un chemin de fichier. Next.js le masque déjà en production ;
 *     on ne le réintroduit pas ;
 *   · **le `digest`**, en revanche, oui. C'est la référence courte que Next.js
 *     inscrit aussi dans le journal du serveur : c'est elle qui permet de
 *     retrouver l'incident sans rien divulguer ;
 *   · **deux issues** : réessayer — beaucoup d'erreurs sont passagères, une
 *     base momentanément indisponible, une requête interrompue — et revenir au
 *     tableau de bord.
 */
export default function ErreurApplication({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Le serveur journalise déjà l'erreur ; côté navigateur, la console est le
    // seul endroit où elle reste consultable si l'on veut comprendre.
    console.error('Parcelys — erreur non rattrapée', error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Erreur
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">Quelque chose s’est mal passé</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Cette page n’a pas pu s’afficher. Vos données ne sont pas perdues — rien
          n’est enregistré tant qu’un formulaire n’a pas été validé.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
          >
            Réessayer
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:border-line-strong"
          >
            Tableau de bord
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-6 text-[12.5px] text-ink-3">
            Référence de l’incident :{' '}
            <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono">
              {error.digest}
            </code>
            <br />
            Communiquez-la si vous signalez le problème : elle permet de le retrouver
            dans le journal du serveur.
          </p>
        ) : null}
      </div>
    </main>
  );
}
