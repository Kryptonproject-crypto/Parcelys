'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { Alert, Badge, Spinner } from '@/components/ui';

export type EphyProduct = {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  status: string | null;
  authorized: boolean;
  withdrawnAt: string | null;
  formulation: string | null;
  productType: string | null;
  substances: string[];
};

type SearchResponse = {
  results: EphyProduct[];
  total: number;
  withdrawnHidden: number;
  source: {
    label: string;
    lastSyncAt: string | null;
    productsInBase: number;
    authorizedInBase: number;
    configured: boolean;
  };
};

function dateCourte(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR');
}

/**
 * Recherche de produit dans le référentiel officiel E-Phy.
 *
 * Aucun résultat n'est fabriqué : si le référentiel n'a pas été synchronisé, le
 * composant l'annonce et propose la saisie libre. La provenance et la date de
 * synchronisation sont toujours affichées.
 *
 * Les produits retirés du marché sont écartés par défaut — ils forment plus des
 * quatre cinquièmes du catalogue officiel, qui est un historique. Ils restent
 * accessibles d'un clic : on en a besoin pour compléter un registre ancien.
 */
export function EphyProductSearch({
  onSelect,
  selected,
}: {
  onSelect: (product: EphyProduct | null) => void;
  selected: EphyProduct | null;
}) {
  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [results, setResults] = useState<EphyProduct[]>([]);
  const [source, setSource] = useState<SearchResponse['source'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [withdrawnHidden, setWithdrawnHidden] = useState(0);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Charge la provenance dès l'ouverture, même sans recherche.
  useEffect(() => {
    void apiFetch<SearchResponse>('/api/phytosanitary/products?q=')
      .then((data) => setSource(data.source))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setWithdrawnHidden(0);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setLoading(true);
      void apiFetch<SearchResponse>(
        `/api/phytosanitary/products?q=${encodeURIComponent(query)}&limit=25` +
          (includeWithdrawn ? '&includeWithdrawn=true' : ''),
      )
        .then((data) => {
          setResults(data.results);
          setTotal(data.total);
          setWithdrawnHidden(data.withdrawnHidden);
          setSource(data.source);
          setSearched(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, includeWithdrawn]);

  const lastSync = dateCourte(source?.lastSyncAt ?? null);

  if (selected) {
    const retraitLe = dateCourte(selected.withdrawnAt);
    return (
      <div
        className={`rounded-lg border p-3.5 ${
          selected.authorized
            ? 'border-champ-300 bg-accent-soft'
            : 'border-brique-400 bg-brique-50 dark:bg-brique-700/15'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink">{selected.name}</p>
            <p className="mt-0.5 text-sm text-ink-2">
              AMM {selected.amm}
              {selected.holder ? ` · ${selected.holder}` : ''}
            </p>
            {selected.substances.length > 0 ? (
              <p className="mt-1 text-sm text-ink-2">
                <span className="text-ink-3">Substances actives : </span>
                {selected.substances.join(', ')}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selected.status ? (
                <Badge tone={selected.authorized ? 'green' : 'red'}>
                  {selected.authorized ? 'Autorisé' : 'Retiré du marché'}
                </Badge>
              ) : null}
              {selected.formulation ? <Badge>{selected.formulation}</Badge> : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelect(null)}
            className="shrink-0 text-sm text-champ-700 dark:text-champ-400 hover:underline"
          >
            Changer
          </button>
        </div>

        {!selected.authorized ? (
          <p className="mt-2.5 rounded-md bg-brique-100 px-2.5 py-2 text-[13px] leading-relaxed text-brique-700 dark:bg-brique-700/25 dark:text-brique-200">
            Ce produit ne figure plus parmi les produits autorisés du catalogue
            E-Phy{retraitLe ? ` (retrait au ${retraitLe})` : ''}. Il reste
            sélectionnable pour compléter un registre antérieur au retrait ;
            l’appliquer aujourd’hui ne l’est pas.
          </p>
        ) : null}

        <p className="mt-2.5 border-t border-line pt-2 text-xs text-ink-3">
          {source?.label ?? 'Données issues de sources officielles'}
          {lastSync ? ` — dernière synchronisation : ${lastSync}` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom commercial ou numéro d'AMM (ex. Roundup, 2020024)"
          className="h-10 w-full rounded-lg border border-line-strong px-3 pr-9 text-sm
                     placeholder:text-ink-3/70 focus:border-champ-500 focus:ring-2 focus:ring-champ-500/20"
        />
        {loading ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3">
            <Spinner />
          </span>
        ) : null}
      </div>

      {source && !source.configured ? (
        <Alert tone="warning" title="Référentiel E-Phy non synchronisé">
          Aucun produit n&apos;est disponible en base. Parcelys ne génère jamais de donnée
          réglementaire : lancez une synchronisation
          (<code className="rounded bg-surface/60 px-1">npm run ephy:sync</code>) pour
          importer le catalogue officiel de l&apos;ANSES, ou saisissez le produit
          manuellement ci-dessous.
        </Alert>
      ) : null}

      {results.length > 0 ? (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onSelect(product)}
                className="block w-full px-3 py-2.5 text-left transition hover:bg-accent-soft/60"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-ink">{product.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-3">
                    AMM {product.amm}
                  </span>
                </div>
                {product.substances.length > 0 ? (
                  <p className="mt-0.5 truncate text-xs text-ink-3">
                    {product.substances.join(', ')}
                  </p>
                ) : null}
                <span
                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[12.5px] font-medium sm:text-[11px] ${
                    product.authorized
                      ? 'bg-accent-soft text-champ-800 dark:text-champ-300'
                      : 'bg-brique-100 text-brique-700 dark:bg-brique-700/30 dark:text-brique-200'
                  }`}
                >
                  {product.authorized
                    ? 'Autorisé'
                    : `Retiré${
                        dateCourte(product.withdrawnAt)
                          ? ` le ${dateCourte(product.withdrawnAt)}`
                          : ' du marché'
                      }`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {searched && results.length === 0 && !loading && source?.configured ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
          Aucun produit autorisé pour «&nbsp;{query}&nbsp;» dans le catalogue E-Phy.
          {withdrawnHidden > 0
            ? ` ${withdrawnHidden} produit${withdrawnHidden > 1 ? 's' : ''} retiré${
                withdrawnHidden > 1 ? 's' : ''
              } du marché correspond${withdrawnHidden > 1 ? 'ent' : ''} à cette recherche.`
            : ' Vérifiez l’orthographe ou saisissez le produit manuellement.'}
        </p>
      ) : null}

      {/* Le catalogue officiel est un historique : plus de quatre produits sur
          cinq y sont retirés. Les afficher d'office donnait l'impression d'un
          catalogue faux ; les cacher sans le dire donnerait l'impression d'un
          catalogue incomplet. On les compte, et on laisse le choix. */}
      {withdrawnHidden > 0 && !includeWithdrawn ? (
        <button
          type="button"
          onClick={() => setIncludeWithdrawn(true)}
          className="text-xs text-champ-700 underline hover:text-champ-800 dark:text-champ-400"
        >
          Afficher aussi les {withdrawnHidden} produit
          {withdrawnHidden > 1 ? 's' : ''} retiré{withdrawnHidden > 1 ? 's' : ''} du
          marché (registre antérieur)
        </button>
      ) : null}

      {includeWithdrawn ? (
        <button
          type="button"
          onClick={() => setIncludeWithdrawn(false)}
          className="text-xs text-ink-3 underline hover:text-ink"
        >
          Ne montrer que les produits autorisés
        </button>
      ) : null}

      {results.length > 0 && total > results.length ? (
        <p className="text-xs text-ink-3">
          {results.length} résultats affichés sur {total}. Affinez votre recherche.
        </p>
      ) : null}

      {source ? (
        <p className="text-xs text-ink-3">
          {source.label}
          {lastSync
            ? ` — dernière synchronisation : ${lastSync}`
            : ' — aucune synchronisation enregistrée'}
          {source.productsInBase > 0
            ? ` (${source.authorizedInBase.toLocaleString('fr-FR')} produits autorisés
               sur ${source.productsInBase.toLocaleString('fr-FR')} référencés)`
            : ''}
        </p>
      ) : null}
    </div>
  );
}
