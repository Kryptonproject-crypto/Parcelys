import { useEffect, useMemo, useState } from 'react';
import type { AppContext } from '../App';
import { fetchFaq } from '../lib/api';
import { blocsDeReponse, faqDepuisInitiale, rechercherFaq, type FaqCategorieVue } from '@commun/faq';
import { FAQ_INITIALE } from '@commun/faq-initiale';
import { Banner, Button, Header, Input } from '../components/ui';

const CLE_CACHE = 'parcelys.faq';

/**
 * Centre d'aide, consultable sans réseau.
 *
 * L'application garde la dernière version reçue du serveur ; à défaut — tout
 * premier lancement hors ligne — elle affiche la version embarquée dans
 * l'APK. La recherche est la même fonction que sur le site.
 */
function lireCache(): FaqCategorieVue[] | null {
  try {
    const brut = localStorage.getItem(CLE_CACHE);
    return brut ? (JSON.parse(brut) as FaqCategorieVue[]) : null;
  } catch {
    return null;
  }
}

export function AideScreen({ context }: { context: AppContext }) {
  const { back, navigate, online, session } = context;
  const [categories, setCategories] = useState<FaqCategorieVue[]>(
    () => lireCache() ?? faqDepuisInitiale(FAQ_INITIALE),
  );
  const [horsLigne, setHorsLigne] = useState(false);
  const [query, setQuery] = useState('');
  const [ouverte, setOuverte] = useState<string | null>(null);

  useEffect(() => {
    if (!online) {
      setHorsLigne(true);
      return;
    }
    void fetchFaq(session.serverUrl)
      .then((fraiche) => {
        setCategories(fraiche);
        setHorsLigne(false);
        try {
          localStorage.setItem(CLE_CACHE, JSON.stringify(fraiche));
        } catch {
          // Stockage plein ou refusé : on garde l'affichage, sans cache.
        }
      })
      .catch(() => setHorsLigne(true));
  }, [online, session.serverUrl]);

  const resultats = useMemo(() => (query.trim() ? rechercherFaq(categories, query) : null), [categories, query]);
  const entrees = resultats ?? categories.flatMap((c) => c.entries);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title="Aide" subtitle="Questions fréquentes" onBack={back} />
      <div className="flex-1 space-y-4 px-4 py-4">
        {horsLigne ? (
          <Banner tone="info">Hors ligne : vous lisez la dernière version enregistrée de l&apos;aide.</Banner>
        ) : null}
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher : synchronisation, produit retiré…"
          aria-label="Rechercher dans l'aide"
        />

        {resultats && resultats.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
            <p className="font-semibold text-ink">Aucune réponse pour « {query} »</p>
            <p className="mt-1.5 text-[14px] text-ink-3">Posez directement votre question au support.</p>
            <Button className="mt-4" onClick={() => navigate({ name: 'contact', sujet: query.slice(0, 120) })}>
              Contacter le support
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {entrees.map((e) => {
              const ouvert = ouverte === e.id;
              return (
                <li key={e.id} className="rounded-2xl border border-line bg-surface">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left"
                    aria-expanded={ouvert}
                    onClick={() => setOuverte(ouvert ? null : e.id)}
                  >
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium uppercase tracking-wide text-ink-3">
                        {e.categoryTitle}
                      </span>
                      <span className="block font-medium text-ink">{e.question}</span>
                      {e.needsReview ? (
                        <span className="mt-1 inline-block rounded-full bg-ble-500/20 px-2 py-0.5 text-[12px] text-ble-600 dark:text-ble-400">
                          À vérifier
                        </span>
                      ) : null}
                    </span>
                    <span aria-hidden className="text-ink-3">{ouvert ? '−' : '+'}</span>
                  </button>
                  {ouvert ? (
                    <div className="space-y-2 border-t border-line px-4 py-3 text-[14.5px] leading-relaxed text-ink-2">
                      {blocsDeReponse(e.answer).map((b, i) =>
                        b.type === 'p' ? (
                          <p key={i}>{b.texte}</p>
                        ) : (
                          <ul key={i} className="list-disc space-y-1 pl-5">
                            {b.items.map((item, j) => (
                              <li key={j}>{item}</li>
                            ))}
                          </ul>
                        ),
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 pt-2">
          <Button full onClick={() => navigate({ name: 'contact' })}>
            Contacter le support
          </Button>
          <Button full variant="secondary" onClick={() => navigate({ name: 'demandes' })}>
            Mes demandes
          </Button>
        </div>
      </div>
    </div>
  );
}
