/**
 * Comparaison d'une dose saisie à la dose retenue au catalogue officiel.
 *
 * Ce module ne calcule pas une dose autorisée : il en **rapproche** une, saisie
 * par l'exploitant, de celle que l'ANSES publie pour l'usage correspondant. La
 * différence n'est pas rhétorique. Trois règles la tiennent :
 *
 *  1. On ne convertit jamais une masse en volume. `L/ha` et `kg/ha` ne sont pas
 *     comparables sans la densité du produit, que le catalogue ne publie pas.
 *     Devant deux unités incomparables, la réponse est « non vérifiable » —
 *     jamais un dépassement supposé, jamais un feu vert.
 *
 *  2. Un usage absent du catalogue ne vaut pas autorisation. Si la culture
 *     saisie ne figure dans aucun usage du produit, on le dit ; on ne prend pas
 *     la dose d'une autre culture en guise d'approximation.
 *
 *  3. La dose du catalogue est un texte (« 1.5 », « 0,75 », parfois vide). On
 *     l'interprète sans la corriger : ce qui n'est pas un nombre reste
 *     inexploitable, et l'usage est signalé comme tel.
 *
 * Le verdict alimente une alerte à la saisie. Il ne bloque rien : l'étiquette du
 * produit fait foi, et un exploitant peut avoir une raison légitime — dose
 * réduite, mélange, dérogation — que le catalogue ne connaît pas.
 */

// Import relatif, et pas `@/lib/ephy/schema` : ce module est aussi compilé
// dans l'application mobile, qui a son propre alias `@`. Voir l'entrée
// `@partage` de `mobile/vite.config.ts` — le contrôle de dose réglementaire
// n'existe qu'ici, et les deux applications lisent le même code.
import { normalizeSearchTerm } from './schema';

/** Un usage du catalogue, réduit à ce qui sert au rapprochement. */
export type UsageForDose = {
  id: string;
  cropLabel: string | null;
  targetLabel: string | null;
  usageLabel: string | null;
  doseValue: string | null;
  doseUnit: string | null;
  status: string | null;
  preHarvestDelay: string | null;
  maxApplications: string | null;
  minIntervalDays: string | null;
  zntAquaticM: string | null;
  zntArthropodM: string | null;
  zntPlantM: string | null;
  conditions: string | null;
};

export type DoseVerdict =
  /** La dose saisie ne dépasse pas la dose retenue, unités comparables. */
  | 'conforme'
  /** La dose saisie dépasse la dose retenue. */
  | 'depassement'
  /** Unités non comparables (masse contre volume, dose de bouillie…). */
  | 'unites-incomparables'
  /** Aucun usage du catalogue ne correspond à la culture saisie. */
  | 'usage-inconnu'
  /** Un usage correspond, mais sa dose n'est pas exploitable numériquement. */
  | 'dose-non-exploitable'
  /** Le produit n'a pas été retrouvé au catalogue (saisie libre). */
  | 'hors-catalogue';

export type DoseCheck = {
  verdict: DoseVerdict;
  /** Usage retenu pour la comparaison, s'il y en a un. */
  usage: UsageForDose | null;
  /** Dose du catalogue, dans son unité, quand elle est exploitable. */
  authorized: { value: number; unit: string } | null;
  /** Dose saisie ramenée à l'unité du catalogue, quand la conversion est licite. */
  entered: { value: number; unit: string } | null;
  /** Rapport dose saisie / dose autorisée (1.2 = 20 % au-dessus). */
  ratio: number | null;
  /** Phrase destinée à l'exploitant. Toujours renseignée. */
  message: string;
};

/**
 * Familles d'unités et facteur vers l'unité de référence de la famille.
 *
 * Seules les conversions à l'intérieur d'une famille sont permises : ce sont des
 * changements de préfixe, pas des hypothèses physiques. `L/hL`, `kg/hL` et les
 * doses au mètre carré forment leurs propres familles — une dose de bouillie ne
 * se compare pas à une dose à l'hectare sans connaître le volume appliqué.
 */
const UNIT_FAMILIES: Record<string, { family: string; factor: number }> = {
  // Volume par hectare — référence : L/ha
  'l/ha': { family: 'volume/ha', factor: 1 },
  'ml/ha': { family: 'volume/ha', factor: 0.001 },
  'cl/ha': { family: 'volume/ha', factor: 0.01 },
  // Masse par hectare — référence : kg/ha
  'kg/ha': { family: 'masse/ha', factor: 1 },
  'g/ha': { family: 'masse/ha', factor: 0.001 },
  'mg/ha': { family: 'masse/ha', factor: 0.000001 },
  // Volume par hectolitre de bouillie — référence : L/hL
  'l/hl': { family: 'volume/hl', factor: 1 },
  'ml/hl': { family: 'volume/hl', factor: 0.001 },
  // Masse par hectolitre de bouillie — référence : kg/hL
  'kg/hl': { family: 'masse/hl', factor: 1 },
  'g/hl': { family: 'masse/hl', factor: 0.001 },
  // Masse par quintal de récolte — référence : kg/q
  'kg/q': { family: 'masse/q', factor: 1 },
  'g/q': { family: 'masse/q', factor: 0.001 },
  // Volume par quintal — référence : L/q
  'l/q': { family: 'volume/q', factor: 1 },
  'ml/q': { family: 'volume/q', factor: 0.001 },
  // Surfaces réduites — référence : L/m² et g/m²
  'l/m²': { family: 'volume/m2', factor: 1 },
  'ml/m²': { family: 'volume/m2', factor: 0.001 },
  'g/m²': { family: 'masse/m2', factor: 1 },
  'kg/m²': { family: 'masse/m2', factor: 1000 },
};

function unitKey(unit: string): string {
  return unit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/m2\b/, 'm²')
    .replace(/hl/g, 'hl');
}

/** Convertit `value` de `from` vers `to`, ou `null` si la famille diffère. */
export function convertDose(value: number, from: string, to: string): number | null {
  const source = UNIT_FAMILIES[unitKey(from)];
  const target = UNIT_FAMILIES[unitKey(to)];
  if (!source || !target) return null;
  if (source.family !== target.family) return null;
  return (value * source.factor) / target.factor;
}

/**
 * Lit une dose du catalogue.
 *
 * Les valeurs sont écrites au point décimal dans l'export, mais la virgule
 * apparaît dans certaines éditions. On accepte les deux et on refuse tout le
 * reste — « voir conditions d'emploi », « SANS DOSE » et autres mentions
 * littérales existent bel et bien dans le fichier officiel.
 */
export function parseCatalogDose(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Un usage est-il en vigueur ? Les usages retirés ne servent pas de référence. */
export function isUsageInForce(usage: Pick<UsageForDose, 'status'>): boolean {
  return /autoris/i.test(usage.status ?? '');
}

/**
 * Retient les usages du produit qui correspondent à la culture saisie.
 *
 * Le rapprochement se fait sur le libellé normalisé, avec inclusion dans les
 * deux sens : le catalogue écrit « Blé », l'exploitant « blé tendre d'hiver »,
 * et l'inverse arrive aussi. Au-delà, on ne devine pas : « Orge » ne vaut pas
 * pour « Blé », et un rapprochement approximatif sur une dose réglementaire
 * serait pire que pas de rapprochement du tout.
 */
export function usagesForCrop(usages: UsageForDose[], crop: string): UsageForDose[] {
  const wanted = normalizeSearchTerm(crop);
  if (wanted.length < 2) return [];

  return usages.filter((usage) => {
    const candidate = normalizeSearchTerm(usage.cropLabel ?? '');
    if (candidate.length < 2) return false;
    return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
  });
}

/**
 * Rapproche la dose saisie de celle du catalogue.
 *
 * Quand plusieurs usages correspondent à la culture (cibles différentes), on
 * retient **la dose la plus élevée en vigueur** : c'est la seule qui permette
 * d'affirmer un dépassement sans se tromper. Annoncer un dépassement à un
 * exploitant qui traite une autre cible à dose supérieure autorisée serait une
 * fausse alerte, et une fausse alerte finit par faire ignorer les vraies.
 */
export function checkDose(input: {
  usages: UsageForDose[] | null;
  crop: string | null;
  dose: number;
  doseUnit: string;
}): DoseCheck {
  const base = { usage: null, authorized: null, entered: null, ratio: null };

  if (!input.usages) {
    return {
      ...base,
      verdict: 'hors-catalogue',
      message:
        'Produit saisi librement : aucune dose de référence à comparer. Reportez-vous à l’étiquette.',
    };
  }

  if (!input.crop || input.crop.trim().length < 2) {
    return {
      ...base,
      verdict: 'usage-inconnu',
      message:
        'Indiquez la culture traitée pour comparer la dose à celle du catalogue officiel.',
    };
  }

  const correspondants = usagesForCrop(input.usages, input.crop).filter(isUsageInForce);
  if (correspondants.length === 0) {
    return {
      ...base,
      verdict: 'usage-inconnu',
      message:
        `Aucun usage autorisé sur « ${input.crop} » pour ce produit au catalogue E-Phy. ` +
        'Vérifiez l’étiquette : un usage absent du catalogue n’est pas un usage autorisé.',
    };
  }

  // Parmi les usages de cette culture, celui dont la dose est la plus élevée
  // une fois ramenée à l'unité saisie.
  let meilleur: { usage: UsageForDose; value: number; unit: string; converti: number } | null =
    null;
  let vuSansDose = false;

  for (const usage of correspondants) {
    const value = parseCatalogDose(usage.doseValue);
    const unit = usage.doseUnit?.trim();
    if (value === null || !unit) {
      vuSansDose = true;
      continue;
    }
    const converti = convertDose(value, unit, input.doseUnit);
    if (converti === null) continue;
    if (!meilleur || converti > meilleur.converti) {
      meilleur = { usage, value, unit, converti };
    }
  }

  if (!meilleur) {
    // Une dose existe peut-être, mais dans une unité incomparable à la saisie.
    const avecDose = correspondants.find(
      (u) => parseCatalogDose(u.doseValue) !== null && u.doseUnit,
    );
    if (avecDose) {
      return {
        ...base,
        usage: avecDose,
        verdict: 'unites-incomparables',
        authorized: {
          value: parseCatalogDose(avecDose.doseValue) as number,
          unit: avecDose.doseUnit as string,
        },
        message:
          `Le catalogue retient ${avecDose.doseValue} ${avecDose.doseUnit} pour cet usage, ` +
          `saisie en ${input.doseUnit} : les deux unités ne se convertissent pas sans la ` +
          'densité du produit. Comparaison impossible — reportez-vous à l’étiquette.',
      };
    }
    return {
      ...base,
      usage: correspondants[0] ?? null,
      verdict: vuSansDose ? 'dose-non-exploitable' : 'usage-inconnu',
      message:
        'Le catalogue ne publie pas de dose exploitable pour cet usage. ' +
        'Reportez-vous à l’étiquette du produit.',
    };
  }

  const ratio = input.dose / meilleur.converti;
  const authorized = { value: meilleur.value, unit: meilleur.unit };
  const entered = { value: input.dose, unit: input.doseUnit };

  // Marge de tolérance : 0,5 %, pour absorber les arrondis d'unité (1000 mL/ha
  // contre 1 L/ha), pas pour tolérer un dépassement.
  if (ratio > 1.005) {
    const ecart = Math.round((ratio - 1) * 100);
    return {
      usage: meilleur.usage,
      authorized,
      entered,
      ratio,
      verdict: 'depassement',
      message:
        `Surdosage : ${formatNombre(input.dose)} ${input.doseUnit} saisis pour une dose ` +
        `retenue de ${formatNombre(meilleur.value)} ${meilleur.unit} sur « ` +
        `${meilleur.usage.cropLabel ?? input.crop} »` +
        (meilleur.usage.targetLabel ? ` (${meilleur.usage.targetLabel})` : '') +
        `, soit ${ecart} % au-dessus.`,
    };
  }

  return {
    usage: meilleur.usage,
    authorized,
    entered,
    ratio,
    verdict: 'conforme',
    message:
      `Dose conforme à l’usage retenu au catalogue : ${formatNombre(meilleur.value)} ` +
      `${meilleur.unit} au maximum sur « ${meilleur.usage.cropLabel ?? input.crop} »` +
      (meilleur.usage.targetLabel ? ` (${meilleur.usage.targetLabel})` : '') +
      '.',
  };
}

function formatNombre(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
}
