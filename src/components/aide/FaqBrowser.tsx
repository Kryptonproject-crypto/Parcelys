'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  blocsDeReponse,
  rechercherFaq,
  type FaqCategorieVue,
  type FaqEntreeVue,
} from '@/lib/shared/faq';
import { Badge, Input, cn } from '@/components/ui';
import { IconChevronDown, IconHelp, IconSearch, IconSupport } from '@/components/ui/icons';

/** Une réponse, sans jamais interpréter de HTML : paragraphes et puces seulement. */
function Reponse({ texte }: { texte: string }) {
  return (
    <div className="space-y-2.5 text-[14.5px] leading-relaxed text-ink-2">
      {blocsDeReponse(texte).map((bloc, i) =>
        bloc.type === 'p' ? (
          <p key={i}>{bloc.texte}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {bloc.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Question({ entree, ouverte = false }: { entree: FaqEntreeVue; ouverte?: boolean }) {
  return (
    <details
      id={entree.slug ?? entree.id}
      open={ouverte}
      className="group rounded-xl border border-line bg-surface shadow-card [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3.5 text-[15px] font-medium text-ink">
        <span className="min-w-0">
          {entree.question}
          {entree.needsReview ? (
            <Badge tone="amber" className="ml-2 align-middle">
              À vérifier
            </Badge>
          ) : null}
        </span>
        <IconChevronDown
          size={18}
          aria-hidden
          className="mt-0.5 shrink-0 text-ink-3 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line px-4 py-4">
        <Reponse texte={entree.answer} />
        {entree.needsReview ? (
          <p className="mt-3 text-[12.5px] text-ink-3">
            Cette réponse doit encore être confirmée. En cas de doute, écrivez-nous.
          </p>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Le centre d'aide : recherche instantanée, rubriques, et renvoi vers
 * Contact quand rien ne correspond.
 */
export function FaqBrowser({
  categories,
  initialQuery = '',
  contactHref = '/contact',
}: {
  categories: FaqCategorieVue[];
  initialQuery?: string;
  contactHref?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [rubrique, setRubrique] = useState<string | null>(null);
  const resultats = useMemo(() => (query.trim() ? rechercherFaq(categories, query) : null), [categories, query]);
  const affichees = rubrique ? categories.filter((c) => c.slug === rubrique) : categories;

  return (
    <div className="space-y-8">
      <div className="relative">
        <IconSearch size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher : mot de passe, TéléPAC, produit retiré, numéro client…"
          aria-label="Rechercher dans l'aide"
          className="h-12 pl-11 text-[15px]"
        />
      </div>

      {resultats ? (
        <section aria-live="polite" aria-label="Résultats de la recherche">
          {resultats.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-card">
              <IconHelp size={28} aria-hidden className="mx-auto text-ink-3" />
              <p className="mt-3 font-medium text-ink">Aucune réponse ne correspond à « {query} ».</p>
              <p className="mt-1 text-sm text-ink-3">
                Reformulez avec d&apos;autres mots, ou posez directement votre question.
              </p>
              <Link
                href={`${contactHref}?sujet=${encodeURIComponent(query.slice(0, 120))}`}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-champ-700 px-5 text-[15px] font-medium text-white hover:bg-champ-800"
              >
                <IconSupport size={17} aria-hidden />
                Écrire au support
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-3">{resultats.length} réponse(s)</p>
              <ul className="space-y-2.5">
                {resultats.slice(0, 15).map((entree, i) => (
                  <li key={entree.id}>
                    <p className="mb-1 text-[12.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
                      {entree.categoryTitle}
                    </p>
                    <Question entree={entree} ouverte={i === 0} />
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-ink-3">
                Ce n&apos;est pas ce que vous cherchiez ?{' '}
                <Link className="font-medium text-champ-700 underline dark:text-champ-400" href={contactHref}>
                  Contactez le support
                </Link>
                .
              </p>
            </>
          )}
        </section>
      ) : (
        <>
          <nav aria-label="Rubriques" className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRubrique(null)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                rubrique === null ? 'border-champ-600 bg-accent-soft text-accent-ink' : 'border-line text-ink-2 hover:bg-surface-2',
              )}
            >
              Toutes
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setRubrique(c.slug)}
                aria-pressed={rubrique === c.slug}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  rubrique === c.slug ? 'border-champ-600 bg-accent-soft text-accent-ink' : 'border-line text-ink-2 hover:bg-surface-2',
                )}
              >
                {c.title}
              </button>
            ))}
          </nav>
          {affichees.map((c) => (
            <section key={c.id} id={`rubrique-${c.slug}`} aria-labelledby={`titre-${c.slug}`}>
              <h2 id={`titre-${c.slug}`} className="text-[19px] font-semibold tracking-tight text-ink">
                {c.title}
              </h2>
              {c.description ? <p className="mt-1 text-sm text-ink-3">{c.description}</p> : null}
              <ul className="mt-3 space-y-2.5">
                {c.entries.map((entree) => (
                  <li key={entree.id}>
                    <Question entree={entree} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="rounded-xl border border-line bg-surface p-5 shadow-card sm:flex sm:items-center sm:justify-between">
            <p className="text-[14.5px] text-ink-2">Votre question n&apos;y est pas ?</p>
            <Link
              href={contactHref}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-champ-700 px-5 text-[15px] font-medium text-white hover:bg-champ-800 sm:mt-0"
            >
              <IconSupport size={17} aria-hidden />
              Contacter le support
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
