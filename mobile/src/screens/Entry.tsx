import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import type { CachedParcel, OperationKind } from '../lib/types';
import { enqueue } from '../lib/db';
import {
  captureWeather,
  searchCatalog,
  type CatalogProduct,
  type InterventionWeather,
} from '../lib/api';
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
  const [substances, setSubstances] = useState('');

  // Recherche dans le catalogue officiel (en ligne uniquement).
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogHits, setCatalogHits] = useState<CatalogProduct[] | null>(null);
  const [catalogState, setCatalogState] = useState<
    'idle' | 'searching' | 'empty' | 'unconfigured' | 'offline' | 'error'
  >('idle');
  const [verified, setVerified] = useState(false);

  // Conditions relevées à la saisie, jamais à la synchronisation.
  const [weather, setWeather] = useState<InterventionWeather | null>(null);
  const [weatherState, setWeatherState] = useState<'idle' | 'loading' | 'none'>('idle');
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

  /**
   * Les conditions du moment, relevées dès l'ouverture du formulaire.
   *
   * Maintenant, et pas à la synchronisation : une file d'attente peut partir
   * des heures plus tard, et la météo d'alors ne serait pas celle de
   * l'intervention. Sans réseau on ne relève rien — et on ne déduit rien.
   */
  useEffect(() => {
    if (!online) {
      setWeatherState('none');
      return;
    }
    let vivant = true;
    setWeatherState('loading');
    void captureWeather(context.session, parcel.id).then((releve) => {
      if (!vivant) return;
      setWeather(releve);
      setWeatherState(releve ? 'idle' : 'none');
    });
    return () => {
      vivant = false;
    };
  }, [online, context.session, parcel.id]);

  /**
   * Recherche au catalogue, après une pause de frappe.
   *
   * 400 ms : assez pour ne pas lancer une requête par lettre sur une liaison
   * de campagne, assez peu pour que la liste suive la saisie.
   */
  const rechercheEnCours = useRef(0);
  useEffect(() => {
    const terme = catalogQuery.trim();
    if (terme.length < 2) {
      setCatalogHits(null);
      setCatalogState('idle');
      return;
    }
    if (!online) {
      setCatalogHits(null);
      setCatalogState('offline');
      return;
    }

    const jeton = (rechercheEnCours.current += 1);
    setCatalogState('searching');
    const minuteur = setTimeout(() => {
      void searchCatalog(context.session, terme)
        .then((reponse) => {
          // Une réponse arrivée après une frappe plus récente est périmée.
          if (jeton !== rechercheEnCours.current) return;
          if (!reponse.source.configured) {
            setCatalogHits(null);
            setCatalogState('unconfigured');
            return;
          }
          setCatalogHits(reponse.results);
          setCatalogState(reponse.results.length === 0 ? 'empty' : 'idle');
        })
        .catch(() => {
          if (jeton !== rechercheEnCours.current) return;
          setCatalogHits(null);
          setCatalogState('error');
        });
    }, 400);

    return () => clearTimeout(minuteur);
  }, [catalogQuery, online, context.session]);

  /** Un produit choisi au catalogue : nom, AMM et substances viennent de lui. */
  function pickCatalogProduct(product: CatalogProduct): void {
    setProductName(product.name);
    setAmm(product.amm);
    setSubstances(product.substances.join(', '));
    setVerified(true);
    setCatalogQuery('');
    setCatalogHits(null);
    setCatalogState('idle');
  }

  /** Pré-remplit à partir d'un produit déjà utilisé, AMM comprise. */
  function pickKnownProduct(value: string): void {
    const known = referential?.recentPhytoProducts.find(
      (product) => product.productName === value,
    );
    setProductName(value);
    setVerified(false);
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

  /**
   * Les conditions relevées, prêtes à joindre. Vide si rien n'a été relevé :
   * un registre sans météo dit la vérité, un registre avec une météo inventée
   * ment.
   */
  function weatherPayload(): Record<string, unknown> {
    if (!weather) return {};
    const champs: Record<string, unknown> = {};
    if (weather.weatherTempC !== null) champs.weatherTempC = weather.weatherTempC;
    if (weather.weatherWindKmh !== null) champs.weatherWindKmh = weather.weatherWindKmh;
    if (weather.weatherHumidity !== null) champs.weatherHumidity = weather.weatherHumidity;
    if (weather.weatherRainMm !== null) champs.weatherRainMm = weather.weatherRainMm;
    if (weather.weatherSummary) champs.weatherSummary = weather.weatherSummary;
    if (weather.weatherSource) champs.weatherSource = weather.weatherSource;
    return champs;
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
        ...(substances.trim() ? { activeSubstances: substances.trim() } : {}),
        dose: Number(phytoDose),
        doseUnit: phytoUnit,
        // Relevées à l'ouverture du formulaire, sur la parcelle : c'est la
        // météo de l'intervention, pas celle de la synchronisation.
        ...weatherPayload(),
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
        ...weatherPayload(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
    }

    return {
      performedOn: date,
      type: operationType,
      ...(equipment.trim() ? { equipment: equipment.trim() } : {}),
      ...weatherPayload(),
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

        {/*
          Ce qui sera consigné avec la saisie. Affiché, pas caché : l'exploitant
          doit savoir ce qui entre dans son registre — et savoir quand rien n'y
          entre.
        */}
        {weatherState === 'loading' ? (
          <p className="text-[13px] text-ink-3">Relevé des conditions…</p>
        ) : weather ? (
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-3">
              Conditions relevées
            </p>
            <p className="mt-1 text-[14px] text-ink">
              {[
                weather.weatherSummary,
                weather.weatherTempC !== null ? `${weather.weatherTempC} °C` : null,
                weather.weatherWindKmh !== null ? `vent ${weather.weatherWindKmh} km/h` : null,
                weather.weatherHumidity !== null ? `${weather.weatherHumidity} % HR` : null,
                weather.weatherRainMm !== null ? `${weather.weatherRainMm} mm` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Source : {weather.weatherSource ?? 'inconnue'} · relevé maintenant
            </p>
          </div>
        ) : weatherState === 'none' ? (
          <p className="text-[13px] text-ink-3">
            Conditions non relevées — elles resteront vides dans le registre.
          </p>
        ) : null}

        {kind === 'phyto' ? (
          <>
            {/*
              Recherche au catalogue officiel — même source que le site. Elle
              exige du réseau : le catalogue compte des dizaines de milliers de
              fiches, hors de question de l'embarquer. Sans réseau, la saisie
              libre reste ouverte, simplement marquée « non vérifiée ».
            */}
            <Field
              label="Chercher au catalogue E-Phy"
              hint="Nom commercial ou numéro d&apos;AMM. Deux lettres suffisent."
            >
              <Input
                type="search"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder="Ex. : Karaté Zeon, ou 2100094"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>

            {catalogState === 'searching' ? (
              <p className="text-[13px] text-ink-3">Recherche…</p>
            ) : catalogState === 'offline' ? (
              <p className="text-[13px] text-ink-3">
                Hors réseau : le catalogue n&apos;est pas consultable. Saisissez le
                produit à la main ci-dessous.
              </p>
            ) : catalogState === 'unconfigured' ? (
              <Banner tone="warning">
                Le catalogue E-Phy n&apos;a pas encore été synchronisé sur cette
                instance. Rien ne peut être vérifié pour l&apos;instant.
              </Banner>
            ) : catalogState === 'empty' ? (
              <p className="text-[13px] text-ink-3">
                Aucun produit trouvé. Vérifiez l&apos;orthographe, ou saisissez-le à
                la main.
              </p>
            ) : catalogState === 'error' ? (
              <p className="text-[13px] text-ink-3">
                Le catalogue n&apos;a pas répondu. La saisie manuelle reste possible.
              </p>
            ) : null}

            {catalogHits && catalogHits.length > 0 ? (
              <ul className="space-y-1.5">
                {catalogHits.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => pickCatalogProduct(product)}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-left active:bg-surface-2"
                    >
                      <span className="block text-[14px] font-medium text-ink">
                        {product.name}
                      </span>
                      <span className="block text-[12.5px] text-ink-3">
                        AMM {product.amm}
                        {product.holder ? ` · ${product.holder}` : ''}
                      </span>
                      {product.status ? (
                        <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2">
                          {product.status}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {verified ? (
              <Banner tone="info">
                Produit repris du catalogue officiel : AMM et substances actives
                sont celles d&apos;E-Phy. Vérifiez toujours l&apos;étiquette et l&apos;usage
                autorisé avant application.
              </Banner>
            ) : null}

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
