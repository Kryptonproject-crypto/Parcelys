import { useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import { enqueue } from '../lib/db';
import {
  RECOMMENDATION_KIND_LABELS,
  type RecommendationKind,
  type RecommendationPriority,
} from '../lib/types';
import {
  ActionBar,
  Banner,
  Button,
  Field,
  Header,
  Input,
  Select,
  Textarea,
} from '../components/ui';

const PRIORITIES: Array<{ value: RecommendationPriority; label: string }> = [
  { value: 'LOW', label: 'À noter' },
  { value: 'NORMAL', label: 'Normale' },
  { value: 'HIGH', label: 'Urgente' },
];

/**
 * Rédaction d'une préconisation, au champ.
 *
 * Trois règles, les mêmes que sur l'application web :
 *
 *  - **Le motif est obligatoire.** Une préconisation sans raisonnement n'aide
 *    personne et ne justifie rien en cas de contrôle.
 *  - **Rien n'est proposé.** L'application ne suggère aucun produit, aucune
 *    dose, aucun usage : elle n'a pas le catalogue officiel hors ligne, et
 *    inventer une donnée réglementaire serait pire que de ne rien afficher.
 *  - **L'envoi passe par la file d'attente.** Le brouillon reste sur le
 *    téléphone jusqu'à la synchronisation, puis la route habituelle du serveur
 *    vérifie la mission de conseil et la complétude.
 */
export function NewRecommendationScreen({
  context,
  parcelId: initialParcelId,
}: {
  context: AppContext;
  parcelId?: string;
}) {
  const { back, snapshot, refreshPending, online, activeFarmId } = context;
  const parcels = snapshot?.parcels ?? [];
  const doseUnits = snapshot?.referential.doseUnits ?? ['L/ha', 'kg/ha'];

  const [parcelId, setParcelId] = useState(initialParcelId ?? '');
  const [kind, setKind] = useState<RecommendationKind>('PHYTO');
  const [priority, setPriority] = useState<RecommendationPriority>('NORMAL');
  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [productName, setProductName] = useState('');
  const [amm, setAmm] = useState('');
  const [dose, setDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('L/ha');
  const [targetLabel, setTargetLabel] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const farmId = activeFarmId ?? snapshot?.farm.id ?? '';

  function buildPayload(send: boolean): Record<string, unknown> | null {
    if (title.trim().length < 3) {
      setError('Donnez un intitulé à votre préconisation.');
      return null;
    }
    if (rationale.trim().length < 10) {
      setError(
        'Expliquez ce qui motive cette préconisation : c’est ce qui justifie la décision de l’exploitation.',
      );
      return null;
    }
    if (kind === 'PHYTO' && (!productName.trim() || !dose || Number(dose) <= 0)) {
      setError(
        'Une préconisation phytosanitaire cite un produit et une dose. À défaut, choisissez « Observation ».',
      );
      return null;
    }

    return {
      ...(parcelId ? { parcelId } : {}),
      kind,
      priority,
      title: title.trim(),
      rationale: rationale.trim(),
      ...(productName.trim() ? { productName: productName.trim() } : {}),
      ...(amm.trim() ? { amm: amm.trim() } : {}),
      ...(dose && Number(dose) > 0 ? { dose: Number(dose), doseUnit } : {}),
      ...(targetLabel.trim() ? { targetLabel: targetLabel.trim() } : {}),
      ...(windowStart ? { windowStart } : {}),
      ...(windowEnd ? { windowEnd } : {}),
      send,
    };
  }

  async function submit(send: boolean): Promise<void> {
    setError(null);
    const payload = buildPayload(send);
    if (!payload) return;

    if (!farmId) {
      setError('Ouvrez un domaine de votre portefeuille avant de rédiger.');
      return;
    }

    setSaving(true);
    try {
      await enqueue({
        clientId: crypto.randomUUID(),
        kind: 'recommendation.create',
        farmId,
        ...(parcelId ? { parcelId } : {}),
        label: `Préconisation — ${title.trim()}`,
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
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit(true);
      }}
      className="flex min-h-full flex-col bg-canvas"
    >
      <Header
        title="Nouvelle préconisation"
        subtitle={snapshot?.farm.name}
        onBack={back}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {!online ? (
          <Banner tone="warning">
            Hors réseau. Votre préconisation est conservée sur le téléphone et
            partira à la reconnexion.
          </Banner>
        ) : null}

        <Field label="Parcelle" hint="Sans parcelle, la préconisation vaut pour l'ensemble du domaine.">
          <Select value={parcelId} onChange={(event) => setParcelId(event.target.value)}>
            <option value="">— Toute l&apos;exploitation —</option>
            {parcels.map((parcel) => (
              <option key={parcel.id} value={parcel.id}>
                {parcel.internalNumber ? `${parcel.internalNumber} — ` : ''}
                {parcel.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nature" required>
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as RecommendationKind)}
            >
              {Object.entries(RECOMMENDATION_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priorité" required>
            <Select
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as RecommendationPriority)
              }
            >
              {PRIORITIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Intitulé" required>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Protection fongicide T1"
            required
          />
        </Field>

        <Field
          label="Ce qui motive cette préconisation"
          required
          hint="Le stade, l'observation, le risque. C'est ce que l'exploitation lira pour décider."
        >
          <Textarea
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Stade 2 nœuds atteint, septoriose présente sur F3 avec 15 % de fréquence."
            required
          />
        </Field>

        {kind !== 'OBSERVATION' ? (
          <>
            <Field
              label="Produit conseillé"
              required={kind === 'PHYTO'}
              hint="Le nom commercial tel que vous le conseillez. Aucune liste n'est proposée hors ligne : l'application ne devine pas un produit."
            >
              <Input
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="Nom commercial"
              />
            </Field>

            <Field
              label="Numéro d'AMM"
              hint="Le rapprochement au catalogue officiel E-Phy se fera à la synchronisation. Sans AMM, le produit sera signalé comme non vérifié."
            >
              <Input
                value={amm}
                onChange={(event) => setAmm(event.target.value)}
                inputMode="numeric"
                placeholder="2100000"
              />
            </Field>

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Dose conseillée" required={kind === 'PHYTO'}>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  value={dose}
                  onChange={(event) => setDose(event.target.value)}
                />
              </Field>
              <Field label="Unité">
                <Select
                  value={doseUnit}
                  onChange={(event) => setDoseUnit(event.target.value)}
                  className="w-28"
                >
                  {doseUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Cible">
              <Input
                value={targetLabel}
                onChange={(event) => setTargetLabel(event.target.value)}
                placeholder="Septoriose"
              />
            </Field>
          </>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="À partir du">
            <Input
              type="date"
              value={windowStart}
              onChange={(event) => setWindowStart(event.target.value)}
            />
          </Field>
          <Field label="Jusqu'au">
            <Input
              type="date"
              value={windowEnd}
              onChange={(event) => setWindowEnd(event.target.value)}
            />
          </Field>
        </div>

        <p className="px-1 text-[12.5px] leading-relaxed text-ink-3">
          Parcelys ne vérifie ni l&apos;autorisation, ni l&apos;usage, ni la dose
          que vous indiquez : c&apos;est votre conseil, sous votre responsabilité.
          L&apos;exploitation le verra tel que vous l&apos;écrivez, avec la
          mention de sa provenance.
        </p>
      </div>

      <ActionBar>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            loading={saving}
            onClick={() => void submit(false)}
          >
            Brouillon
          </Button>
          <Button type="submit" loading={saving}>
            Transmettre
          </Button>
        </div>
      </ActionBar>
    </form>
  );
}
