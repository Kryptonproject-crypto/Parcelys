'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { EphyProductSearch, type EphyProduct } from '@/components/forms/EphyProductSearch';
import { IconPlus } from '@/components/ui/icons';

type Categorie = 'PHYTOSANITAIRE' | 'ENGRAIS' | 'AMENDEMENT' | 'SEMENCE' | 'AUTRE';

const CATEGORIES: Array<{ code: Categorie; libelle: string }> = [
  { code: 'PHYTOSANITAIRE', libelle: 'Produit phytosanitaire' },
  { code: 'ENGRAIS', libelle: 'Engrais' },
  { code: 'AMENDEMENT', libelle: 'Amendement, produit organique' },
  { code: 'SEMENCE', libelle: 'Semence' },
  { code: 'AUTRE', libelle: 'Autre' },
];

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Enregistrer un achat : le produit, la quantité reçue, le lot.
 *
 * Plusieurs produits arrivent souvent ensemble, sur une même facture : après
 * chaque enregistrement, la date et le fournisseur restent, le produit et la
 * quantité se vident — on enchaîne le suivant.
 *
 * Un produit phytosanitaire se choisit dans le catalogue E-Phy : c'est ainsi
 * qu'il sera proposé, avec son lot, à la saisie d'un traitement.
 */
export function EnregistrerAchat({
  unites,
  engrais,
  organiques,
}: {
  unites: readonly string[];
  engrais: Array<{ id: string; name: string }>;
  organiques: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [ouvert, setOuvert] = useState(false);
  const [categorie, setCategorie] = useState<Categorie>('PHYTOSANITAIRE');
  const [produit, setProduit] = useState<EphyProduct | null>(null);
  const [refId, setRefId] = useState('');
  const [nom, setNom] = useState('');
  const [quantite, setQuantite] = useState('');
  const [unite, setUnite] = useState('L');
  const [achatLe, setAchatLe] = useState(aujourdhui());
  const [fournisseur, setFournisseur] = useState('');
  const [lot, setLot] = useState('');
  const [dlu, setDlu] = useState('');
  const [prix, setPrix] = useState('');
  const [notes, setNotes] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajoutes, setAjoutes] = useState<string[]>([]);

  function changerCategorie(c: Categorie) {
    setCategorie(c);
    setProduit(null);
    setRefId('');
    setNom('');
    setUnite(c === 'PHYTOSANITAIRE' ? 'L' : c === 'SEMENCE' ? 'kg' : c === 'AUTRE' ? 'unité' : 't');
  }

  async function enregistrer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErreur(null);
    const q = Number(quantite.replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) {
      setErreur('Indiquez la quantité reçue.');
      return;
    }
    if (categorie === 'PHYTOSANITAIRE' && !produit) {
      setErreur('Choisissez le produit dans le catalogue E-Phy.');
      return;
    }
    const p = prix.trim() === '' ? null : Number(prix.replace(',', '.'));
    if (p !== null && !Number.isFinite(p)) {
      setErreur('Le prix unitaire n’est pas un nombre.');
      return;
    }
    setEnvoi(true);
    try {
      await apiPost('/api/stocks/achats', {
        category: categorie,
        phytoProductId: categorie === 'PHYTOSANITAIRE' ? (produit?.id ?? null) : null,
        fertilizerId: categorie === 'ENGRAIS' && refId ? refId : null,
        organicInputId: categorie === 'AMENDEMENT' && refId ? refId : null,
        name: nom.trim() || null,
        quantity: q,
        unit: unite,
        purchasedOn: achatLe,
        lotNumber: lot.trim() || null,
        supplier: fournisseur.trim() || null,
        expiresOn: dlu || null,
        unitPrice: p,
        notes: notes.trim() || null,
      });
      const libelle =
        produit?.name ??
        engrais.find((e) => e.id === refId)?.name ??
        organiques.find((o) => o.id === refId)?.name ??
        nom;
      toast.success(`Achat enregistré : ${libelle}`);
      setAjoutes((a) => [...a, `${libelle} — ${q.toLocaleString('fr-FR')} ${unite}${lot.trim() ? `, lot ${lot.trim()}` : ''}`]);
      // Le suivant : même facture, autre produit.
      setProduit(null);
      setRefId('');
      setNom('');
      setQuantite('');
      setLot('');
      setDlu('');
      setPrix('');
      setNotes('');
      router.refresh();
    } catch (err) {
      setErreur(err instanceof ApiRequestError ? err.message : 'Enregistrement impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return (
      <div className="mb-5">
        <Button icon={IconPlus} onClick={() => setOuvert(true)}>
          Enregistrer un achat
        </Button>
      </div>
    );
  }

  return (
    <Card className="mb-5">
      <CardHeader
        title="Enregistrer un achat"
        description="Le produit, la quantité reçue et le lot. Le stock augmente d’autant ; chaque traitement saisi avec ce lot le fera baisser."
      />
      <form onSubmit={(e) => void enregistrer(e)} className="space-y-4" noValidate>
        {erreur ? <Alert tone="danger">{erreur}</Alert> : null}

        <Field label="Nature" htmlFor="achat-cat">
          <Select id="achat-cat" value={categorie} onChange={(e) => changerCategorie(e.target.value as Categorie)}>
            {CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.libelle}
              </option>
            ))}
          </Select>
        </Field>

        {categorie === 'PHYTOSANITAIRE' ? (
          <Field label="Produit (catalogue E-Phy)" required>
            <EphyProductSearch selected={produit} onSelect={setProduit} />
          </Field>
        ) : categorie === 'ENGRAIS' || categorie === 'AMENDEMENT' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Produit du référentiel" htmlFor="achat-ref">
              <Select id="achat-ref" value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">— Autre, à nommer —</option>
                {(categorie === 'ENGRAIS' ? engrais : organiques).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!refId ? (
              <Field label="Nom" htmlFor="achat-nom" required>
                <Input id="achat-nom" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={200} />
              </Field>
            ) : null}
          </div>
        ) : (
          <Field label="Nom" htmlFor="achat-nom" required hint={categorie === 'SEMENCE' ? 'Espèce et variété.' : undefined}>
            <Input id="achat-nom" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={200} />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Quantité reçue" htmlFor="achat-q" required>
            <Input id="achat-q" inputMode="decimal" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
          </Field>
          <Field label="Unité" htmlFor="achat-u">
            <Select id="achat-u" value={unite} onChange={(e) => setUnite(e.target.value)}>
              {unites.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date d’achat" htmlFor="achat-date" required>
            <Input id="achat-date" type="date" value={achatLe} max={aujourdhui()} onChange={(e) => setAchatLe(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Numéro de lot" htmlFor="achat-lot" hint="Celui de l’emballage : c’est ce qu’un contrôle demande.">
            <Input id="achat-lot" value={lot} onChange={(e) => setLot(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Fournisseur" htmlFor="achat-fourn">
            <Input id="achat-fourn" value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Date limite d’utilisation" htmlFor="achat-dlu">
            <Input id="achat-dlu" type="date" value={dlu} onChange={(e) => setDlu(e.target.value)} />
          </Field>
          <Field label={`Prix unitaire (€ / ${unite})`} htmlFor="achat-prix">
            <Input id="achat-prix" inputMode="decimal" value={prix} onChange={(e) => setPrix(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes" htmlFor="achat-notes">
          <Textarea id="achat-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={envoi}>
            Enregistrer l’achat
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOuvert(false)}>
            Fermer
          </Button>
        </div>

        {ajoutes.length > 0 ? (
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <p className="text-[13px] font-medium text-ink-2">Enregistrés</p>
            <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
              {ajoutes.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
