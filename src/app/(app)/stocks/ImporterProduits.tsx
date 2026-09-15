'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Select,
  Spinner,
  formatDateFr,
} from '@/components/ui';

/**
 * Importer en stock les produits que l'exploitation emploie déjà.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CET ÉCRAN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * L'écran des stocks était en lecture seule. Le modèle savait rattacher un
 * article au référentiel depuis le début, l'API aussi — mais rien ne l'appelait,
 * et commencer à suivre son local phyto voulait dire tout ressaisir à la main.
 *
 * Or les produits sont déjà là : chaque traitement, chaque apport nomme le sien.
 * Cet écran les propose, avec l'unité que les saisies portent déjà et le nombre
 * de fois qu'ils ont servi, pour que le suivi démarre en un geste.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il ne remplit pas le stock. Importer crée le **suivi** ; le solde reste à zéro
 * tant qu'aucune entrée n'est saisie. L'écran le dit, parce qu'une liste qui se
 * remplit donne facilement l'impression d'un local inventorié.
 *
 * Et il ne devine aucune unité. Quand les saisies ne s'accordent pas — le même
 * produit noté tantôt en litres, tantôt en kilos —, le bouton reste inactif tant
 * que l'exploitant n'a pas tranché : Parcelys ne convertit pas une masse en
 * volume, et choisir la plus fréquente reviendrait à le faire en douce.
 */

type Produit = {
  source: 'phyto' | 'engrais' | 'organique';
  refId: string;
  label: string;
  amm: string | null;
  categorie: string;
  unite: string | null;
  unitesRencontrees: Array<{ unite: string; occurrences: number }>;
  nombreUtilisations: number;
  premiereUtilisationLe: string;
  derniereUtilisationLe: string;
};

type Resultat = {
  refId: string;
  label: string;
  etat: 'cree' | 'deja-suivi' | 'refuse';
  motif?: string;
};

const LIBELLE_SOURCE: Record<Produit['source'], string> = {
  phyto: 'Phytosanitaire',
  engrais: 'Engrais',
  organique: 'Amendement',
};

export function ImporterProduits({ unitesCourantes }: { unitesCourantes: readonly string[] }) {
  const router = useRouter();

  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [avertissement, setAvertissement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  /** Produits cochés, et l'unité retenue pour chacun. */
  const [choisis, setChoisis] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState(false);
  const [resultats, setResultats] = useState<Resultat[] | null>(null);

  const cle = (p: Produit) => `${p.source}:${p.refId}`;

  useEffect(() => {
    if (!ouvert) return;

    let abandonne = false;
    setChargement(true);
    setErreur(null);

    apiFetch<{ produits: Produit[]; avertissement: string }>('/api/stocks/importables')
      .then((data) => {
        if (abandonne) return;
        setProduits(data.produits);
        setAvertissement(data.avertissement);
        // Pré-cocher ceux dont l'unité ne fait aucun doute : ce sont ceux pour
        // lesquels il n'y a rien à décider. Les autres restent à trancher.
        const initial: Record<string, string> = {};
        for (const p of data.produits) {
          if (p.unite) initial[`${p.source}:${p.refId}`] = p.unite;
        }
        setChoisis(initial);
      })
      .catch((cause: unknown) => {
        if (!abandonne) setErreur(cause instanceof Error ? cause.message : 'Lecture impossible.');
      })
      .finally(() => {
        if (!abandonne) setChargement(false);
      });

    return () => {
      abandonne = true;
    };
  }, [ouvert]);

  const selection = produits.filter((p) => choisis[cle(p)]);

  async function importer() {
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await apiFetch<{ resultats: Resultat[]; crees: number }>(
        '/api/stocks/importables',
        {
          method: 'POST',
          body: JSON.stringify({
            selections: selection.map((p) => ({
              source: p.source,
              refId: p.refId,
              unit: choisis[cle(p)],
            })),
          }),
        },
      );
      setResultats(reponse.resultats);
      // Retirer de la liste ce qui est passé : reproposer un produit déjà suivi
      // ferait croire que l'import a échoué.
      const traites = new Set(
        reponse.resultats.filter((r) => r.etat !== 'refuse').map((r) => r.refId),
      );
      setProduits((actuels) => actuels.filter((p) => !traites.has(p.refId)));
      if (reponse.crees > 0) router.refresh();
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : 'Import impossible.');
      /*
       * Quand aucune demande n'aboutit, le serveur répond 400 — et joint le
       * détail par produit. L'afficher évite un message unique qui laisse
       * chercher lequel des quinze produits a bloqué.
       */
      const detail = (cause as { details?: unknown })?.details;
      if (Array.isArray(detail)) setResultats(detail as Resultat[]);
    } finally {
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <div className="mb-5">
        <Button variant="outline" onClick={() => setOuvert(true)}>
          Importer les produits déjà employés
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title="Importer les produits déjà employés"
        description="Les produits nommés dans vos traitements et vos apports, qu’aucun article de stock ne suit encore"
        action={
          <Button variant="ghost" size="sm" onClick={() => setOuvert(false)}>
            Fermer
          </Button>
        }
      />

      {avertissement ? (
        <Alert tone="info" className="mb-4">
          {avertissement}
        </Alert>
      ) : null}

      {erreur ? (
        <Alert tone="warning" title="Échec" className="mb-4">
          {erreur}
        </Alert>
      ) : null}

      {resultats ? <Bilan resultats={resultats} /> : null}

      {chargement ? (
        <p className="flex items-center gap-2 py-6 text-sm text-ink-3">
          <Spinner size={16} /> Lecture des saisies…
        </p>
      ) : produits.length === 0 ? (
        <p className="py-6 text-sm text-ink-3">
          Aucun produit à importer : tout ce qui est employé dans vos saisies est
          déjà suivi en stock. Un produit saisi en texte libre, sans rattachement
          au référentiel, n’apparaît pas ici — il reste à créer à la main.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {produits.map((p) => {
              const k = cle(p);
              const coche = Boolean(choisis[k]);
              const aTrancher = p.unite === null;

              return (
                <li key={k} className="py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <Checkbox
                      checked={coche}
                      onChange={(e) => {
                        const actif = e.target.checked;
                        setChoisis((c) => {
                          const suite = { ...c };
                          if (!actif) delete suite[k];
                          // Sans unité proposée, on ne coche rien tout seul :
                          // l'utilisateur doit d'abord en choisir une.
                          else suite[k] = p.unite ?? (p.unitesRencontrees[0]?.unite ?? '');
                          return suite;
                        });
                      }}
                      aria-label={`Suivre ${p.label} en stock`}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-ink">{p.label}</span>
                        <Badge tone="neutral">{LIBELLE_SOURCE[p.source]}</Badge>
                        {p.amm ? (
                          <span className="text-[12.5px] text-ink-3">AMM {p.amm}</span>
                        ) : null}
                      </div>

                      <p className="mt-0.5 text-[13px] text-ink-3">
                        {p.nombreUtilisations} utilisation
                        {p.nombreUtilisations > 1 ? 's' : ''} · dernière le{' '}
                        {formatDateFr(p.derniereUtilisationLe)}
                      </p>

                      {aTrancher ? (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-ble-700 dark:text-ble-300">
                          Vos saisies emploient plusieurs unités pour ce produit (
                          {p.unitesRencontrees
                            .map((u) => `${u.unite} × ${u.occurrences}`)
                            .join(', ')}
                          ). Parcelys ne convertit pas une masse en volume :
                          choisissez celle dans laquelle vous tenez ce stock.
                        </p>
                      ) : null}
                    </div>

                    <label className="shrink-0">
                      <span className="sr-only">Unité de stock pour {p.label}</span>
                      <Select
                        value={choisis[k] ?? ''}
                        onChange={(e) =>
                          setChoisis((c) => {
                            const suite = { ...c };
                            if (e.target.value) suite[k] = e.target.value;
                            else delete suite[k];
                            return suite;
                          })
                        }
                      >
                        <option value="">Unité…</option>
                        {/*
                          Les unités déjà rencontrées d'abord : ce sont les seules
                          qui ne demandent aucune conversion des saisies passées.
                        */}
                        {p.unitesRencontrees.map((u) => (
                          <option key={u.unite} value={u.unite}>
                            {u.unite} (employée {u.occurrences}×)
                          </option>
                        ))}
                        {unitesCourantes
                          .filter(
                            (u) =>
                              !p.unitesRencontrees.some(
                                (v) => v.unite.toLowerCase() === u.toLowerCase(),
                              ),
                          )
                          .map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                      </Select>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={importer} disabled={selection.length === 0} loading={envoi}>
              Suivre {selection.length} produit{selection.length > 1 ? 's' : ''} en stock
            </Button>
            <button
              type="button"
              onClick={() => {
                const tout: Record<string, string> = {};
                for (const p of produits) {
                  // Seuls ceux dont l'unité est certaine : « tout cocher » ne
                  // doit pas trancher à la place de l'utilisateur.
                  if (p.unite) tout[cle(p)] = p.unite;
                }
                setChoisis(tout);
              }}
              className="text-sm text-champ-700 underline-offset-2 hover:underline dark:text-champ-400"
            >
              Tout cocher (sauf unités à trancher)
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Le détail par produit, plutôt qu'un « N produits importés » qui masque les refus. */
function Bilan({ resultats }: { resultats: Resultat[] }) {
  const crees = resultats.filter((r) => r.etat === 'cree');
  const autres = resultats.filter((r) => r.etat !== 'cree');

  return (
    <div className="mb-4 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
      <p className="text-sm font-medium text-ink">
        {crees.length} produit{crees.length > 1 ? 's' : ''} suivi
        {crees.length > 1 ? 's' : ''} en stock.
      </p>

      {crees.some((r) => r.motif) ? (
        <ul className="mt-2 space-y-1">
          {crees
            .filter((r) => r.motif)
            .map((r) => (
              <li key={r.refId} className="text-[13px] text-ink-2">
                {r.motif}
              </li>
            ))}
        </ul>
      ) : null}

      {autres.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {autres.map((r) => (
            <li key={r.refId} className="flex items-start gap-2 text-[13px]">
              <Badge tone={r.etat === 'refuse' ? 'red' : 'neutral'}>
                {r.etat === 'refuse' ? 'Refusé' : 'Déjà suivi'}
              </Badge>
              <span className="text-ink-2">
                {r.label}
                {r.motif ? ` — ${r.motif}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2.5 text-[12.5px] text-ink-3">
        Le solde de ces articles est à zéro : saisissez une entrée pour le
        renseigner.
      </p>
    </div>
  );
}
