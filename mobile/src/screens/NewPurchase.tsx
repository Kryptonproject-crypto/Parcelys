import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import { enqueue } from '../lib/db';
import { searchCatalog, type CatalogProduct } from '../lib/api';
import { chercherHorsLigne } from '@partage/catalogue-local';
import { Banner, Button, Field, Header, Input, Select, today } from '../components/ui';
import { etatDuProduit } from '@commun/produits';

/** Unités d'achat : celles d'un bidon, d'un sac, d'une boîte. */
const UNITES = ['L', 'mL', 'kg', 'g', 'unité'];

type ProduitChoisi = {
  id: string;
  name: string;
  amm: string;
  authorized: boolean;
  withdrawnAt: string | null;
  finUtilisation?: string | null;
};

/**
 * Enregistrer un achat de produit phytosanitaire, depuis le téléphone.
 *
 * Les bidons arrivent à la ferme : c'est là qu'on a l'étiquette sous les yeux
 * — nom, numéro de lot, date limite. L'achat part par la file d'attente, comme
 * toute saisie, et le serveur le refuse s'il le refuserait en ligne : produit
 * hors catalogue, unité qu'on ne sait pas convertir, date à venir.
 *
 * Le produit vient toujours du catalogue E-Phy — en ligne, le catalogue
 * entier ; sans réseau, les produits embarqués (ceux déjà employés ou en
 * stock). C'est ce qui permettra de le retrouver, avec son lot, à la saisie
 * du traitement.
 */
export function NewPurchaseScreen({ context }: { context: AppContext }) {
  const { snapshot, online, back, refreshPending, session } = context;
  const referential = snapshot?.referential;
  const farmId = context.activeFarmId ?? snapshot?.farm.id ?? null;

  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<ProduitChoisi[] | null>(null);
  const [etatRecherche, setEtatRecherche] = useState<'repos' | 'recherche' | 'vide' | 'erreur'>('repos');
  // Un bidon acheté avant le retrait du produit se range aussi en stock : les
  // retirés se cherchent sur demande (les encore utilisables sortent d'office).
  const [avecRetires, setAvecRetires] = useState(false);
  const [retiresMasques, setRetiresMasques] = useState(0);
  const [produit, setProduit] = useState<ProduitChoisi | null>(null);
  const [quantite, setQuantite] = useState('');
  const [unite, setUnite] = useState('L');
  const [date, setDate] = useState(today());
  const [lot, setLot] = useState('');
  const [fournisseur, setFournisseur] = useState('');
  const [dlu, setDlu] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const jeton = useRef(0);
  useEffect(() => {
    const terme = recherche.trim();
    if (terme.length < 2) {
      setResultats(null);
      setEtatRecherche('repos');
      return;
    }
    if (!online) {
      const locaux = chercherHorsLigne(referential, terme, avecRetires);
      setResultats(locaux);
      setRetiresMasques(0);
      setEtatRecherche(locaux.length > 0 ? 'repos' : 'vide');
      return;
    }
    const moi = (jeton.current += 1);
    setEtatRecherche('recherche');
    const minuteur = setTimeout(() => {
      void searchCatalog(session, terme, avecRetires)
        .then((r) => {
          if (moi !== jeton.current) return;
          const trouves: ProduitChoisi[] = r.results.map((p: CatalogProduct) => p);
          setResultats(trouves);
          setRetiresMasques(r.withdrawnHidden);
          setEtatRecherche(trouves.length > 0 ? 'repos' : 'vide');
        })
        .catch(() => {
          if (moi !== jeton.current) return;
          setResultats(null);
          setEtatRecherche('erreur');
        });
    }, 400);
    return () => clearTimeout(minuteur);
  }, [recherche, online, referential, session, avecRetires]);

  async function enregistrer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    const q = Number(quantite.replace(',', '.'));
    if (!produit) return setErreur('Choisissez le produit dans le catalogue E-Phy.');
    if (!Number.isFinite(q) || q <= 0) return setErreur('Indiquez la quantité reçue.');
    if (!date || date > today()) return setErreur('La date d’achat ne peut pas être à venir.');
    if (!farmId) return setErreur('Aucune exploitation synchronisée sur ce téléphone.');

    setEnvoi(true);
    try {
      await enqueue({
        clientId: crypto.randomUUID(),
        kind: 'stock.purchase',
        farmId,
        label: `Achat — ${produit.name}, ${q.toLocaleString('fr-FR')} ${unite}${lot.trim() ? `, lot ${lot.trim()}` : ''}`,
        capturedAt: new Date().toISOString(),
        attempts: 0,
        payload: {
          category: 'PHYTOSANITAIRE',
          phytoProductId: produit.id,
          quantity: q,
          unit: unite,
          purchasedOn: date,
          lotNumber: lot.trim() || null,
          supplier: fournisseur.trim() || null,
          expiresOn: dlu || null,
        },
      });
      await refreshPending();
      back();
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={(e) => void enregistrer(e)} className="flex min-h-full flex-col bg-canvas" noValidate>
      <Header title="Enregistrer un achat" subtitle="Produit phytosanitaire" onBack={back} />

      <div className="flex-1 space-y-4 px-4 py-4">
        {erreur ? <Banner tone="danger">{erreur}</Banner> : null}
        {!online ? (
          <Banner tone="warning">
            Hors réseau : l’achat est gardé sur le téléphone et partira à la reconnexion. La recherche
            ne porte que sur les produits déjà employés ou en stock.
          </Banner>
        ) : null}

        {produit ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-champ-500/40 bg-champ-500/10 px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{produit.name}</p>
              <p className="text-[12.5px] text-ink-3">AMM {produit.amm}</p>
              {produit.authorized ? null : (
                <p className="mt-0.5 text-[12.5px] font-medium text-ble-600 dark:text-ble-400">
                  {etatDuProduit(produit).libelle}
                </p>
              )}
            </div>
            <button type="button" className="text-[13px] font-medium text-accent-ink" onClick={() => setProduit(null)}>
              Changer
            </button>
          </div>
        ) : (
          <Field label="Produit (catalogue E-Phy)" required hint="Nom commercial ou numéro d'AMM, tel que sur l'étiquette.">
            <Input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Ex. : Karaté Zeon, ou 2100094"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {etatRecherche === 'recherche' ? <p className="mt-1.5 text-[13px] text-ink-3">Recherche…</p> : null}
            {etatRecherche === 'vide' ? (
              <p className="mt-1.5 text-[13px] text-ink-3">
                {online
                  ? 'Aucun produit autorisé trouvé. Tapez le numéro d’AMM de l’étiquette : il trouve aussi les produits retirés.'
                  : 'Aucun produit embarqué ne correspond : la recherche complète demande du réseau.'}
              </p>
            ) : null}
            {etatRecherche === 'erreur' ? (
              <p className="mt-1.5 text-[13px] text-ink-3">Le catalogue n’a pas répondu. Réessayez.</p>
            ) : null}
            {resultats && resultats.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {resultats.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setProduit(p)}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-left active:bg-surface-2"
                    >
                      <span className="block text-[14px] font-medium text-ink">{p.name}</span>
                      <span className="block text-[12.5px] text-ink-3">AMM {p.amm}</span>
                      {p.authorized ? null : (
                        <span className="mt-0.5 block text-[12px] font-medium text-ble-600 dark:text-ble-400">
                          {etatDuProduit(p).libelle}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {retiresMasques > 0 && !avecRetires ? (
              <button
                type="button"
                onClick={() => setAvecRetires(true)}
                className="mt-2 text-left text-[13px] font-medium text-accent-ink underline"
              >
                {retiresMasques} produit{retiresMasques > 1 ? 's' : ''} retiré{retiresMasques > 1 ? 's' : ''} du marché
                correspond{retiresMasques > 1 ? 'ent' : ''} aussi — les afficher
              </button>
            ) : null}
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantité reçue" required>
            <Input inputMode="decimal" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
          </Field>
          <Field label="Unité">
            <Select value={unite} onChange={(e) => setUnite(e.target.value)}>
              {UNITES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Date d’achat" required>
          <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Numéro de lot" hint="Celui de l’emballage : c’est ce qu’un contrôle demande.">
          <Input value={lot} onChange={(e) => setLot(e.target.value)} autoCapitalize="characters" />
        </Field>

        <Field label="Fournisseur">
          <Input value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} />
        </Field>

        <Field label="Date limite d’utilisation">
          <Input type="date" value={dlu} onChange={(e) => setDlu(e.target.value)} />
        </Field>

        <Button type="submit" full loading={envoi}>
          Enregistrer l’achat
        </Button>
      </div>
    </form>
  );
}
