import Link from 'next/link';
import type { ReactNode } from 'react';
import { mentionsCompletes } from '@/lib/constants/identity';

/**
 * Mise en forme commune des pages légales : mentions légales, confidentialité,
 * cookies, conditions générales. Mêmes titres, même interligne, mêmes renvois
 * — un visiteur qui passe de l'une à l'autre ne doit pas avoir l'impression de
 * changer de site.
 */
export function Section({ titre, children, id }: { titre: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-[17px] font-semibold text-ink">{titre}</h2>
      <div className="mt-2 space-y-2.5 text-[14.5px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export function Corps({ children }: { children: ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}

/** Une mention exigée mais pas encore fournie : signalée, jamais inventée. */
export function AManquer({ quoi }: { quoi: string }) {
  return <span className="font-medium text-ble-700 dark:text-ble-300">{quoi} : à renseigner par l’éditeur.</span>;
}

/** Bandeau en tête des pages légales tant que l'adresse et le SIRET manquent. */
export function MentionsIncompletes() {
  if (mentionsCompletes()) return null;
  return (
    <div className="mb-8 rounded-lg border border-ble-500/40 bg-ble-50 p-4 text-sm text-ble-700 dark:bg-ble-700/15 dark:text-ble-100">
      <strong>Adresse postale, téléphone et SIRET de l’éditeur à renseigner.</strong> Ils
      sont exigés par la loi ; ils ne sont pas inventés en attendant, ils sont signalés. Le
      reste de ce document décrit fidèlement le service tel qu’il fonctionne.
    </div>
  );
}

/** Renvois entre pages légales, en pied de chacune. */
export function AutresPagesLegales({ courante }: { courante: string }) {
  const pages = [
    { href: '/mentions-legales', libelle: 'Mentions légales' },
    { href: '/confidentialite', libelle: 'Données personnelles' },
    { href: '/cookies', libelle: 'Cookies et traceurs' },
    { href: '/cgu', libelle: 'Conditions générales' },
  ].filter((p) => p.href !== courante);
  return (
    <nav aria-label="Autres pages légales" className="mt-12 border-t border-line pt-6 text-sm">
      <span className="text-ink-3">Voir aussi : </span>
      {pages.map((p, i) => (
        <span key={p.href}>
          {i > 0 ? ' · ' : ''}
          <Link href={p.href} className="font-medium text-champ-700 hover:underline dark:text-champ-400">
            {p.libelle}
          </Link>
        </span>
      ))}
    </nav>
  );
}
