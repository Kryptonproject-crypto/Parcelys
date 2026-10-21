'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const CLE = 'parcelys.cookies-informe';
/** Treize mois : la durée que la CNIL retient pour redemander un choix. */
const VALIDITE_MS = 13 * 30 * 24 * 3600 * 1000;

/**
 * Bandeau d'information sur les cookies.
 *
 * Information, pas consentement : Parcelys ne dépose que des traceurs
 * strictement nécessaires (session, thème, dernier opérateur), exemptés de
 * consentement par l'article 82 de la loi Informatique et Libertés. Un bouton
 * « Refuser » qui ne changerait rien serait un faux choix — la CNIL le
 * reproche autant qu'un consentement forcé. Le bandeau dit donc ce qui est
 * déposé, renvoie au détail, et se ferme.
 *
 * Il ne s'affiche qu'après le montage : rendu côté serveur, il clignoterait
 * à chaque page pour ceux qui l'ont déjà lu.
 *
 * Dans le flux de la page, en haut, et non posé par-dessus : flottant, il
 * masquait le bouton « Se connecter » sur téléphone jusqu'à ce qu'on le
 * ferme. Il figure sur l'accueil, les pages publiques et celles de connexion —
 * là où se fait toute première visite —, pas dans l'espace connecté.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const lu = Number(localStorage.getItem(CLE) ?? 0);
      setVisible(!lu || Date.now() - lu > VALIDITE_MS);
    } catch {
      // Stockage indisponible (navigation privée stricte) : on informe quand même.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function fermer(): void {
    try {
      localStorage.setItem(CLE, String(Date.now()));
    } catch {
      // Rien à retenir : le bandeau reviendra, sans autre conséquence.
    }
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Information sur les cookies"
      className="no-print relative z-10 border-b border-line bg-surface-2"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 text-[13px] leading-relaxed text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <p>
          <strong className="text-ink">Cookies : le strict nécessaire.</strong> Un cookie
          de connexion et quelques préférences (thème, dernier opérateur saisi). Ni
          publicité, ni mesure d’audience : aucun consentement ne vous est demandé.{' '}
          <Link href="/cookies" className="font-medium text-champ-700 underline dark:text-champ-400">
            Détail des cookies
          </Link>
        </p>
        <button
          type="button"
          onClick={fermer}
          className="min-h-9 shrink-0 self-start rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-3 sm:self-auto"
        >
          J’ai compris
        </button>
      </div>
    </div>
  );
}
