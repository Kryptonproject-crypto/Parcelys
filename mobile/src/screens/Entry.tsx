import { useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import type { CachedParcel, OperationKind } from '../lib/types';
import { enqueue } from '../lib/db';
import {
  ActionBar,
  Banner,
  Button,
  Field,
  Header,
  Input,
  Select,
  Textarea,
  today,
} from '../components/ui';

export type EntryKind = 'phyto' | 'apport' | 'travaux';

const TITLES: Record<EntryKind, string> = {
  phyto: 'Traitement phytosanitaire',
  apport: 'Apport de fertilisant',
  travaux: 'Travail réalisé',
};

const KINDS: Record<EntryKind, OperationKind> = {
  phyto: 'phyto.create',
  apport: 'fertilization.create',
  travaux: 'operation.create',
};

/**
 * Saisie d'une intervention.
 *
 * Le formulaire ne propose que ce que l'appareil connaît hors ligne : les
 * produits déjà employés sur l'exploitation, les engrais du référentiel, les
 * unités officielles. La recherche dans le catalogue E-Phy reste en ligne, et
 * la saisie libre est possible — mais elle sera signalée comme non vérifiée
 * dans le registre, exactement comme sur l'application web.
 *
 * Tout part par la file d'attente, réseau ou pas : une saisie enregistrée ne se
 * perd jamais, et il n'y a qu'un seul chemin de code à éprouver.
 */
export function EntryScreen({
  context,
  parcel,
  kind,
}: {
  context: AppContext;
  parcel: CachedParcel;
  kind: EntryKind;
}) {
  const { back, snapshot, refreshPending, online } = context;
  const referential = snapshot?.referential;

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');

  // Phytosanitaire
  const [productName, setProductName] = useState('');
  const [amm, setAmm] = useState('');
  const [phytoDose, setPhytoDose] = useState('');
  const [phytoUnit, setPhytoUnit] = useState('L/ha');

  // Apport
  const [inputType, setInputType] = useState<'MINERAL' | 'ORGANIC'>('MINERAL');
  const [productId, setProductId] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [dose, setDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('kg/ha');

  // Travaux
  const [operationType, setOperationType] = useState('LABOUR');
  const [equipment, setEquipment] = useState('');

  const doseUnits = referential?.doseUnits ?? ['L/ha', 'kg/ha'];

  /** Pré-remplit à partir d'un produit déjà utilisé, AMM comprise. */
  function pickKnownProduct(value: string): void {
    const known = referential?.recentPhytoProducts.find(
      (product) => product.productName === value,
    );
    setProductName(value);
    if (known) {
      setAmm(known.amm ?? '');
      setPhytoUnit(known.doseUnit);
      if (!phytoDose) setPhytoDose(String(known.lastDose));
    }
  }

  function pickFertilizer(value: string): void {
    setProductId(value);
    const list =
      inputType === 'MINERAL'
        ? (referential?.fertilizers ?? [])
        : (referential?.organicInputs ?? []);
    const found = list.find((item) => item.id === value);
    if (found) setProductLabel(found.name);
  }

  function buildPayload(): Record<string, unknown> | null {
    if (kind === 'phyto') {
      if (!productName.trim()) {
        setError('Indiquez le produit appliqué.');
        return null;
      }
      if (!phytoDose || Number(phytoDose) <= 0) {
        setError('Indiquez la dose appliquée.');
        return null;
      }
      return {
        appliedOn: date,
        productName: productName.trim(),
        ...(amm.trim() ? { amm: amm.trim() } : {}),
        dose: Number(phytoDose),
        doseUnit: phytoUnit,
        // Les conditions météo sont relevées côté serveur : le téléphone n'a
        // pas de station et ne doit rien inventer.
        captureWeather: false,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
    }

    if (kind === 'apport') {
      if (!productLabel.trim()) {
        setError('Indiquez le produit apporté.');
        return null;
      }
      if (!dose || Number(dose) <= 0) {
        setError('Indiquez la dose apportée.');
        return null;
      }
      return {
        appliedOn: date,
        inputType,
        ...(productId
          ? inputType === 'MINERAL'
            ? { fertilizerId: productId }
            : { organicInputId: productId }
          : {}),
        productLabel: productLabel.trim(),
        dose: Number(dose),
        doseUnit,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
    }

    return {
      performedOn: date,
      type: operationType,
      ...(equipment.trim() ? { equipment: equipment.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (!payload) return;

    setSaving(true);
    try {
      await enqueue({
        clientId: crypto.randomUUID(),
        kind: KINDS[kind],
        parcelId: parcel.id,
        label: `${TITLES[kind]} — ${parcel.name}`,
        capturedAt: new Date().toISOString(),
        attempts: 0,
        payload,
      });
      await refreshPending();
      back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-full flex-col bg-canvas">
      <Header title={TITLES[kind]} subtitle={parcel.name} onBack={back} />

      <div className="flex-1 space-y-4 px-4 py-4">
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {!online ? (
          <Banner tone="warning">
            Hors réseau. La saisie est conservée sur le téléphone et partira à la
            reconnexion.
          </Banner>
        ) : null}

        <Field label="Date" required>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </Field>

        {kind === 'phyto' ? (
          <>
            {(referential?.recentPhytoProducts.length ?? 0) > 0 ? (
              <Field
                label="Produit déjà utilisé"
                hint="Liste des produits employés sur l'exploitation ces douze derniers mois."
              >
                <Select
                  value={
                    referential?.recentPhytoProducts.some(
                      (p) => p.productName === productName,
                    )
                      ? productName
                      : ''
                  }
                  onChange={(event) => pickKnownProduct(event.target.value)}
                >
                  <option value="">— Saisir un autre produit —</option>
                  {referential?.recentPhytoProducts.map((product) => (
                    <option key={product.productName} value={product.productName}>
                      {product.productName}
                      {product.amm ? ` (AMM ${product.amm})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field label="Nom du produit" required>
              <Input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="Nom commercial"
                required
              />
            </Field>

            <Field
              label="Numéro d'AMM"
              hint="Facultatif hors ligne. Sans AMM, le registre signalera le produit comme non vérifié au catalogue officiel."
            >
              <Input
                value={amm}
                onChange={(event) => setAmm(event.target.value)}
                inputMode="numeric"
                placeholder="2100000"
              />
            </Field>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Dose" required>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={phytoDose}
                  onChange={(event) => setPhytoDose(event.target.value)}
                  required
                />
              </Field>
              <Field label="Unité" required>
                <Select
                  value={phytoUnit}
                  onChange={(event) => setPhytoUnit(event.target.value)}
                >
                  {doseUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </>
        ) : null}

        {kind === 'apport' ? (
          <>
            <Field label="Type d'apport" required>
              <Select
                value={inputType}
                onChange={(event) => {
                  setInputType(event.target.value as 'MINERAL' | 'ORGANIC');
                  setProductId('');
                  setProductLabel('');
                }}
              >
                <option value="MINERAL">Engrais minéral</option>
                <option value="ORGANIC">Produit organique</option>
              </Select>
            </Field>

            <Field
              label="Produit du référentiel"
              hint="Les teneurs N, P, K du référentiel servent au calcul du bilan côté serveur."
            >
              <Select
                value={productId}
                onChange={(event) => pickFertilizer(event.target.value)}
              >
                <option value="">— Saisir un autre produit —</option>
                {(inputType === 'MINERAL'
                  ? (referential?.fertilizers ?? [])
                  : (referential?.organicInputs ?? [])
                ).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Libellé du produit" required>
              <Input
                value={productLabel}
                onChange={(event) => setProductLabel(event.target.value)}
                placeholder="Ammonitrate 33,5 %"
                required
              />
            </Field>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Dose" required>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={dose}
                  onChange={(event) => setDose(event.target.value)}
                  required
                />
              </Field>
              <Field label="Unité" required>
                <Select
                  value={doseUnit}
                  onChange={(event) => setDoseUnit(event.target.value)}
                >
                  {doseUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </>
        ) : null}

        {kind === 'travaux' ? (
          <>
            <Field label="Type de travail" required>
              <Select
                value={operationType}
                onChange={(event) => setOperationType(event.target.value)}
              >
                {(referential?.operationTypes ?? [{ value: 'LABOUR', label: 'Labour' }]).map(
                  (type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ),
                )}
              </Select>
            </Field>

            <Field label="Matériel">
              <Input
                value={equipment}
                onChange={(event) => setEquipment(event.target.value)}
                placeholder="Charrue 4 corps"
              />
            </Field>
          </>
        ) : null}

        <Field label="Observations">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Conditions, remarques…"
          />
        </Field>

        <p className="px-1 text-[13px] leading-relaxed text-ink-3">
          La surface traitée retenue sera celle de la parcelle
          {parcel.areaHa > 0 ? ` (${parcel.areaHa.toFixed(2)} ha)` : ''}, et les
          quantités totales seront calculées par le serveur.
        </p>
      </div>

      <ActionBar>
        <Button type="submit" full loading={saving}>
          Enregistrer
        </Button>
      </ActionBar>
    </form>
  );
}
