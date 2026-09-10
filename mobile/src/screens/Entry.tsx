import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppContext } from '../App';
import type { CachedParcel, OperationKind } from '../lib/types';
import { enqueue } from '../lib/db';
import {
  captureWeather,
  fetchProductUsages,
  searchCatalog,
  type CatalogProduct,
  type CatalogProductUsages,
  type CatalogUsage,
  type InterventionWeather,
} from '../lib/api';
// Même code que le site : le contrôle de dose réglementaire n'existe qu'une
// fois. Voir l'alias `@partage` dans vite.config.ts.
import { checkDose, usagesForCrop } from '@partage/dose';
import {
  chercherHorsLigne,
  ficheHorsLigne,
  provenanceHorsLigne,
  retiresMasques,
} from '../lib/catalogue-local';
import {
  ActionBar,
  Banner,
  Button,
  Field,
  Header,
  Input,
  Select,
  Textarea,
  formatDateFr,
  today,
} from '../components/ui';

export type EntryKind = 'phyto' | 'apport' | 'travaux' | 'couvert';

const TITLES: Record<EntryKind, string> = {
  phyto: 'Traitement phytosanitaire',
  apport: 'Apport de fertilisant',
  travaux: 'Travail réalisé',
  couvert: 'Couvert d’interculture',
};

const KINDS: Record<EntryKind, OperationKind> = {
  phyto: 'phyto.create',
  apport: 'fertilization.create',
  travaux: 'operation.create',
  couvert: 'soilCover.create',
};

/**
 * Natures de couvert.
 *
 * Le semis d'un CIPAN se fait rarement à portée de réseau, et le noter le soir
 * venu, c'est le noter de mémoire — donc parfois pas du tout.
 */
const COUVERTS_PAR_DEFAUT = [
  { value: 'CIPAN', label: 'CIPAN' },
  { value: 'DEROBEE', label: 'Culture dérobée' },
  { value: 'REPOUSSES', label: 'Repousses' },
  { value: 'RESIDUS', label: 'Résidus de récolte' },
  { value: 'COUVERT_PERMANENT', label: 'Couvert permanent' },
  { value: 'AUTRE', label: 'Autre' },
];

const DESTRUCTIONS_PAR_DEFAUT = [
  { value: '', label: 'Non détruit / non renseigné' },
  { value: 'MECANIQUE', label: 'Mécanique' },
  { value: 'GEL', label: 'Gel' },
  { value: 'PATURAGE', label: 'Pâturage' },
  { value: 'ROULAGE', label: 'Roulage' },
  { value: 'BROYAGE', label: 'Broyage' },
  { value: 'CHIMIQUE', label: 'Chimique' },
  { value: 'RECOLTE', label: 'Récolte' },
  { value: 'AUTRE', label: 'Autre' },
];

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
    | 'idle'
    | 'searching'
    | 'empty'
    | 'unconfigured'
    | 'offline'
    | 'offline-vide'
    | 'error'
  >('idle');
  const [verified, setVerified] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  /** Produits retirés du marché écartés de la dernière recherche. */
  const [withdrawnHidden, setWithdrawnHidden] = useState(0);
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);

  /** Usages autorisés du produit choisi : doses, ZNT, conditions de drainage. */
  const [usages, setUsages] = useState<CatalogProductUsages | null>(null);
  const [cropLabel, setCropLabel] = useState('');

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
  // Irrigation. Les champs n'apparaissent que pour ce type de travail : au
  // champ, chaque champ inutile est un champ que l'on renonce à remplir.
  const [irrigationMm, setIrrigationMm] = useState('');
  // Couvert d'interculture.
  const [coverKind, setCoverKind] = useState('CIPAN');
  const [species, setSpecies] = useState('');
  const [emergedOn, setEmergedOn] = useState('');
  const [destroyedOn, setDestroyedOn] = useState('');
  const [destruction, setDestruction] = useState('');
  const [stockLotId, setStockLotId] = useState('');
  const [waterSource, setWaterSource] = useState('');
  const [waterNitrate, setWaterNitrate] = useState('');
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
      // Hors réseau, on cherche dans les produits embarqués — ceux que
      // l'exploitation a déjà employés. Ce n'est pas le catalogue entier, et
      // l'écran le dit : sans cela, ne rien trouver se lirait comme « ce
      // produit n'existe pas ».
      const locaux = chercherHorsLigne(referential, terme, includeWithdrawn);
      setCatalogHits(locaux.length > 0 ? locaux : null);
      setWithdrawnHidden(includeWithdrawn ? 0 : retiresMasques(referential, terme));
      setCatalogState(locaux.length > 0 ? 'offline' : 'offline-vide');
      return;
    }

    const jeton = (rechercheEnCours.current += 1);
    setCatalogState('searching');
    const minuteur = setTimeout(() => {
      void searchCatalog(context.session, terme, includeWithdrawn)
        .then((reponse) => {
          // Une réponse arrivée après une frappe plus récente est périmée.
          if (jeton !== rechercheEnCours.current) return;
          if (!reponse.source.configured) {
            setCatalogHits(null);
            setCatalogState('unconfigured');
            return;
          }
          setCatalogHits(reponse.results);
          setWithdrawnHidden(reponse.withdrawnHidden);
          setCatalogState(reponse.results.length === 0 ? 'empty' : 'idle');
        })
        .catch(() => {
          if (jeton !== rechercheEnCours.current) return;
          setCatalogHits(null);
          setCatalogState('error');
        });
    }, 400);

    return () => clearTimeout(minuteur);
  }, [catalogQuery, online, includeWithdrawn, context.session, referential]);

  /** Un produit choisi au catalogue : nom, AMM et substances viennent de lui. */
  function pickCatalogProduct(product: CatalogProduct): void {
    setProductName(product.name);
    setAmm(product.amm);
    setSubstances(product.substances.join(', '));
    setVerified(true);
    setWithdrawn(!product.authorized);
    setCatalogQuery('');
    setCatalogHits(null);
    setCatalogState('idle');
    setUsages(null);
    setCropLabel('');

    // La fiche embarquée est posée tout de suite, avant même de demander au
    // serveur : si la liaison tombe pendant la requête — ce qui est la règle
    // plutôt que l'exception au milieu d'une parcelle —, le contrôle de dose
    // fonctionne quand même. La réponse en ligne, plus fraîche, la remplace
    // quand elle arrive.
    const embarquee = ficheHorsLigne(referential, product.amm || product.id);
    if (embarquee) {
      setUsages(embarquee);
      if (embarquee.crops.length === 1) {
        setCropLabel(embarquee.crops[0] ?? '');
      } else if (parcel.cropName) {
        const correspondant = usagesForCrop(embarquee.usages, parcel.cropName)[0];
        if (correspondant?.cropLabel) setCropLabel(correspondant.cropLabel);
      }
    }

    // Les usages sont chargés maintenant, tant qu'il y a du réseau : la dose se
    // saisit ensuite, et la liaison peut avoir disparu entre-temps.
    if (online) {
      void fetchProductUsages(context.session, product.id)
        .then((reponse) => {
          setUsages(reponse);
          // Une seule culture au catalogue : inutile de la faire choisir.
          if (reponse.crops.length === 1) {
            setCropLabel(reponse.crops[0] ?? '');
          } else if (parcel.cropName) {
            // La culture de la parcelle porte-t-elle un usage ? Le catalogue
            // dit « Blé » là où l'assolement dit « Blé tendre d'hiver » : on
            // retient le libellé du catalogue, c'est lui qui fait référence.
            const correspondant = usagesForCrop(reponse.usages, parcel.cropName)[0];
            if (correspondant?.cropLabel) setCropLabel(correspondant.cropLabel);
          }
        })
        // Un échec réseau ne doit pas emporter la fiche embarquée déjà posée :
        // l'écraser par `null` remplacerait un contrôle réel par aucun.
        .catch(() => {
          if (!embarquee) setUsages(null);
        });
    }
  }

  /** Pré-remplit à partir d'un produit déjà utilisé, AMM comprise. */
  function pickKnownProduct(value: string): void {
    const known = referential?.recentPhytoProducts.find(
      (product) => product.productName === value,
    );
    setProductName(value);
    setVerified(false);
    setWithdrawn(false);

    // Un produit déjà employé a de bonnes chances d'être embarqué : sa fiche
    // officielle est posée si elle existe. Auparavant, choisir un produit dans
    // cette liste effaçait les usages, donc le contrôle de dose — le raccourci
    // le plus utilisé était celui qui vérifiait le moins.
    const embarquee = known?.amm ? ficheHorsLigne(referential, known.amm) : null;
    setUsages(embarquee);
    if (embarquee) {
      setVerified(true);
      setWithdrawn(!embarquee.product.authorized);
      if (embarquee.crops.length === 1) {
        setCropLabel(embarquee.crops[0] ?? '');
      } else if (parcel.cropName) {
        const correspondant = usagesForCrop(embarquee.usages, parcel.cropName)[0];
        if (correspondant?.cropLabel) setCropLabel(correspondant.cropLabel);
      }
    }
    setCropLabel('');
    if (known) {
      setAmm(known.amm ?? '');
      setPhytoUnit(known.doseUnit);
      if (!phytoDose) setPhytoDose(String(known.lastDose));
    }
  }

  /**
   * Le verdict de dose, recalculé à chaque frappe et sans réseau : les usages
   * sont déjà dans le téléphone, la comparaison est du calcul local.
   */
  const controleDose =
    kind === 'phyto' && usages && phytoDose && Number(phytoDose) > 0
      ? checkDose({
          usages: usages.usages,
          crop: cropLabel || parcel.cropName,
          dose: Number(phytoDose),
          doseUnit: phytoUnit,
        })
      : null;

  /** Usages de la culture retenue, pour afficher ZNT et délais. */
  const usagesCulture: CatalogUsage[] =
    usages && (cropLabel || parcel.cropName)
      ? usagesForCrop(usages.usages, cropLabel || parcel.cropName || '').slice(0, 3)
      : [];

  /**
   * Restriction de sol drainé à signaler ?
   *
   * `drainedSoil === null` veut dire « non renseigné », pas « non drainé » : on
   * prévient dans ce cas aussi, faute de pouvoir affirmer que la parcelle n'est
   * pas concernée.
   */
  const restrictionsDrainage = usages?.drainedSoilRestrictions ?? [];
  const alerteDrainage =
    restrictionsDrainage.length > 0 && parcel.drainedSoil !== false;

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
        // La culture voyage avec la saisie : c'est elle qui rattache le
        // traitement à un usage du catalogue, et le serveur refait le contrôle
        // de dose au moment où la file d'attente part.
        ...(cropLabel || parcel.cropName
          ? { cropLabel: cropLabel || parcel.cropName }
          : {}),
        dose: Number(phytoDose),
        doseUnit: phytoUnit,
        // Le lot employé, quand l'exploitation tient un stock. Le serveur crée
        // la sortie correspondante : au champ il n'y a qu'un geste, et une file
        // d'attente ne sait pas enchaîner deux opérations dont la seconde
        // dépend de l'identifiant produit par la première.
        ...(stockLotId ? { stockLotId } : {}),
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

    if (kind === 'couvert') {
      // Aucune date n'est obligatoire, sauf celle de la saisie : un couvert
      // semé dont on n'a pas noté la levée reste un couvert semé, et exiger la
      // date pousserait à l'inventer. C'est justement celle qu'un contrôle
      // regarderait.
      return {
        parcelId: parcel.id,
        kind: coverKind,
        ...(species.trim() ? { species: species.trim() } : {}),
        sownOn: date,
        ...(emergedOn ? { emergedOn } : {}),
        ...(destroyedOn ? { destroyedOn } : {}),
        ...(destruction ? { destructionMethod: destruction } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
    }

    return {
      performedOn: date,
      type: operationType,
      ...(equipment.trim() ? { equipment: equipment.trim() } : {}),
      // L'irrigation n'est pas un objet à part : c'est un travail sur la
      // parcelle, avec sa date, son opérateur et sa météo. Le serveur applique
      // les mêmes contrôles qu'en ligne.
      ...(operationType === 'IRRIGATION'
        ? {
            ...(irrigationMm ? { irrigationMm: Number(irrigationMm) } : {}),
            ...(waterSource.trim() ? { waterSource: waterSource.trim() } : {}),
            ...(waterNitrate ? { waterNitrateMgL: Number(waterNitrate) } : {}),
          }
        : {}),
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
                Hors réseau : recherche dans les {provenanceHorsLigne(referential).produits}{' '}
                produit(s) que vous avez déjà employés, avec leurs usages officiels.
                {provenanceHorsLigne(referential).synchroniseLe
                  ? ` Catalogue du ${formatDateFr(provenanceHorsLigne(referential).synchroniseLe as string)}.`
                  : ''}
              </p>
            ) : catalogState === 'offline-vide' ? (
              <p className="text-[13px] text-ink-3">
                {provenanceHorsLigne(referential).disponible
                  ? 'Hors réseau : ce produit ne fait pas partie de ceux que vous avez déjà employés. Le catalogue complet demande du réseau ; la saisie à la main reste possible, le produit sera marqué non vérifié.'
                  : 'Hors réseau et aucun produit embarqué. Saisissez le produit à la main ci-dessous : il sera marqué non vérifié.'}
              </p>
            ) : catalogState === 'unconfigured' ? (
              <Banner tone="warning">
                Le catalogue E-Phy n&apos;a pas encore été synchronisé sur cette
                serveur. Rien ne peut être vérifié pour l&apos;instant.
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
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] ${
                          product.authorized
                            ? 'bg-champ-50 text-champ-700'
                            : 'bg-brique-50 text-brique-700'
                        }`}
                      >
                        {product.authorized ? 'Autorisé' : 'Retiré du marché'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {/*
              Le catalogue officiel est un historique : plus de quatre produits
              sur cinq y sont retirés du marché. Les afficher d'office noyait les
              produits utilisables ; les taire ferait croire à un catalogue
              incomplet. On les compte, et on laisse le choix.
            */}
            {withdrawnHidden > 0 && !includeWithdrawn ? (
              <button
                type="button"
                onClick={() => setIncludeWithdrawn(true)}
                className="text-left text-[12.5px] text-champ-700 underline"
              >
                {withdrawnHidden} produit{withdrawnHidden > 1 ? 's' : ''} retiré
                {withdrawnHidden > 1 ? 's' : ''} du marché correspond
                {withdrawnHidden > 1 ? 'ent' : ''} aussi — les afficher
              </button>
            ) : null}
            {includeWithdrawn ? (
              <button
                type="button"
                onClick={() => setIncludeWithdrawn(false)}
                className="text-left text-[12.5px] text-ink-3 underline"
              >
                N&apos;afficher que les produits autorisés
              </button>
            ) : null}

            {verified && !withdrawn ? (
              <Banner tone="info">
                Produit repris du catalogue officiel : AMM et substances actives
                sont celles d&apos;E-Phy. Vérifiez toujours l&apos;étiquette et l&apos;usage
                autorisé avant application.
              </Banner>
            ) : null}

            {withdrawn ? (
              <Banner tone="warning">
                Ce produit ne figure plus parmi les produits autorisés du
                catalogue E-Phy. Il reste saisissable pour compléter un registre
                antérieur à son retrait ; l&apos;appliquer aujourd&apos;hui ne l&apos;est pas.
              </Banner>
            ) : null}

            {/* --- Usages autorisés, dose retenue, ZNT --------------------- */}
            {usages && usages.crops.length > 0 ? (
              <Field
                label="Culture traitée, au catalogue"
                hint="C'est ce libellé qui détermine la dose de référence et les ZNT."
              >
                <Select
                  value={cropLabel}
                  onChange={(event) => setCropLabel(event.target.value)}
                >
                  <option value="">— Choisir la culture —</option>
                  {usages.crops.map((crop) => (
                    <option key={crop} value={crop}>
                      {crop}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {usagesCulture.length > 0 ? (
              <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                <p className="text-[12.5px] font-medium text-ink-2">
                  Ce que le catalogue retient
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {usagesCulture.map((usage) => (
                    <li key={usage.id} className="text-[13px] text-ink-2">
                      <span className="font-medium text-ink">
                        {usage.targetLabel ?? 'Tous usages'}
                      </span>{' '}
                      —{' '}
                      {usage.doseValue && usage.doseUnit
                        ? `${usage.doseValue} ${usage.doseUnit}`
                        : 'dose non publiée'}
                      {usage.preHarvestDelay ? ` · DAR ${usage.preHarvestDelay} j` : ''}
                      {usage.maxApplications
                        ? ` · ${usage.maxApplications} application(s)`
                        : ''}
                      <span className="block text-[12px] text-ink-3">
                        ZNT — aquatique {usage.zntAquaticM ? `${usage.zntAquaticM} m` : '—'}
                        {' · '}arthropodes{' '}
                        {usage.zntArthropodM ? `${usage.zntArthropodM} m` : '—'}
                        {' · '}plantes {usage.zntPlantM ? `${usage.zntPlantM} m` : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] text-ink-3">
                  Une ZNT non publiée est une donnée absente, pas une ZNT nulle.
                  L&apos;étiquette du produit fait foi.
                </p>
              </div>
            ) : null}

            {/* --- Surdosage ---------------------------------------------- */}
            {controleDose && controleDose.verdict === 'depassement' ? (
              <Banner tone="danger">{controleDose.message}</Banner>
            ) : controleDose && controleDose.verdict === 'conforme' ? (
              <p className="text-[13px] text-champ-700">{controleDose.message}</p>
            ) : controleDose &&
              (controleDose.verdict === 'usage-inconnu' ||
                controleDose.verdict === 'unites-incomparables' ||
                controleDose.verdict === 'dose-non-exploitable') ? (
              <Banner tone="warning">{controleDose.message}</Banner>
            ) : null}

            {/* --- Sol drainé --------------------------------------------- */}
            {alerteDrainage ? (
              <Banner tone={parcel.drainedSoil === true ? 'danger' : 'warning'}>
                {parcel.drainedSoil === true
                  ? 'Parcelle déclarée en sol drainé. '
                  : 'Sol drainé non renseigné sur cette parcelle. '}
                Condition d&apos;emploi officielle :{' '}
                {restrictionsDrainage[0]?.label}
              </Banner>
            ) : null}

            {verified && !online && !usages ? (
              <p className="text-[12.5px] text-ink-3">
                Hors réseau : les doses autorisées et les ZNT n&apos;ont pas pu être
                lues. Reportez-vous à l&apos;étiquette du produit.
              </p>
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

            {/*
              Le lot employé. N'apparaît que si l'exploitation tient un stock —
              sinon ce serait un champ vide de plus sur un écran où chaque champ
              inutile est un champ que l'on renonce à remplir.
            */}
            {(referential?.phytoLots?.length ?? 0) > 0 ? (
              <Field
                label="Lot employé"
                hint="C'est ici, le bidon en main, que le numéro de lot est connu. C'est ce qu'un contrôle demande."
              >
                <Select
                  value={stockLotId}
                  onChange={(event) => setStockLotId(event.target.value)}
                >
                  <option value="">— Aucun lot rattaché —</option>
                  {referential?.phytoLots?.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.itemName}
                      {lot.lotNumber ? ` · lot ${lot.lotNumber}` : ' · sans numéro'}
                      {` · reste ${lot.reste} ${lot.unit}`}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
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

            {operationType === 'IRRIGATION' ? (
              <>
                <Field label="Hauteur d’eau (mm)">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={irrigationMm}
                    onChange={(event) => setIrrigationMm(event.target.value)}
                    placeholder="30"
                  />
                </Field>

                <Field label="Origine de l’eau">
                  <Input
                    value={waterSource}
                    onChange={(event) => setWaterSource(event.target.value)}
                    placeholder="Forage, canal…"
                  />
                </Field>

                <Field label="Nitrate de l’eau (mg/L de NO₃)">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={waterNitrate}
                    onChange={(event) => setWaterNitrate(event.target.value)}
                    placeholder="40"
                  />
                </Field>

                <p className="px-1 text-[13px] leading-relaxed text-ink-3">
                  C’est la teneur en <strong>nitrate</strong> que rend une analyse
                  d’eau, pas la teneur en azote. Sans le volume <em>et</em> la
                  teneur, l’azote apporté par l’eau n’est pas chiffré — il n’est
                  pas estimé non plus.
                </p>
              </>
            ) : null}
          </>
        ) : null}

        {kind === 'couvert' ? (
          <>
            <Field label="Nature du couvert" required>
              <Select
                value={coverKind}
                onChange={(event) => setCoverKind(event.target.value)}
              >
                {(referential?.soilCoverKinds ?? COUVERTS_PAR_DEFAUT).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Espèces">
              <Input
                value={species}
                onChange={(event) => setSpecies(event.target.value)}
                placeholder="Moutarde blanche, phacélie"
              />
            </Field>

            <Field label="Levée">
              <Input
                type="date"
                value={emergedOn}
                onChange={(event) => setEmergedOn(event.target.value)}
              />
            </Field>

            <Field label="Destruction">
              <Input
                type="date"
                value={destroyedOn}
                onChange={(event) => setDestroyedOn(event.target.value)}
              />
            </Field>

            <Field label="Mode de destruction">
              <Select
                value={destruction}
                onChange={(event) => setDestruction(event.target.value)}
              >
                {DESTRUCTIONS_PAR_DEFAUT.slice(0, 1)
                  .concat(referential?.coverDestructionMethods ?? DESTRUCTIONS_PAR_DEFAUT.slice(1))
                  .map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
              </Select>
            </Field>

            <p className="px-1 text-[13px] leading-relaxed text-ink-3">
              La date du haut est celle du <strong>semis</strong>. Les périodes de
              couverture obligatoire dépendent du programme d’actions régional :
              Parcelys enregistre ce que vous faites, il n’invente aucune
              échéance.
            </p>
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
