import { z } from 'zod';
import { classementDeclareSchema } from '@/lib/regulatory/classement-produit';
import { geometrySchema } from '@/lib/geo/types';
import { CLASSES_REDUCTION_DERIVE, TYPES_PULVERISATEUR } from '@/lib/shared/pulverisateur';
import {
  DOCUMENT_CATEGORIES,
  DOSE_UNITS,
  TOTAL_UNITS,
  YIELD_UNITS,
} from '@/lib/constants/agronomy';

/**
 * Texte optionnel, avec trois intentions à distinguer — et c'est tout l'enjeu :
 *
 *  - champ **absent** → `undefined` : une mise à jour n'y touche pas ;
 *  - champ **vidé** (`''` ou `null`) → `null` : on efface ;
 *  - texte → le texte, rogné.
 *
 * Confondre les deux premiers rendait tout effacement impossible : un lieu-dit
 * saisi par erreur restait attaché à la parcelle pour de bon, puisque `''`
 * devenait `undefined` et que la route ne modifie pas ce qu'elle reçoit comme
 * absent. Refuser `null`, lui, cassait le renommage depuis l'application de
 * terrain : l'écran envoie ses trois libellés à chaque fois, et `null` pour
 * celui qu'on laisse vide — le lot partait donc en entier au rebut dès qu'une
 * parcelle n'avait pas de numéro interne.
 *
 * Même raisonnement à trois états que `drainedSoil` plus bas : l'absence de
 * réponse et la réponse vide ne disent pas la même chose.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

/** Date ISO (`YYYY-MM-DD` ou datetime complet) convertie en `Date`. */
const dateSchema = z
  .string()
  .min(1, 'Date requise')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Date invalide')
  .transform((v) => new Date(v));

const optionalDateSchema = z
  .string()
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? new Date(v) : undefined))
  .refine((v) => v === undefined || !Number.isNaN(v.getTime()), 'Date invalide');

const positiveDecimal = (max = 1_000_000) =>
  z.coerce
    .number({ invalid_type_error: 'Valeur numérique attendue' })
    .positive('La valeur doit être supérieure à 0')
    .max(max, 'Valeur hors limites');

const optionalDecimal = (max = 1_000_000) =>
  z.coerce
    .number()
    .min(0)
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined));

// ---------------------------------------------------------------------------
// Parcelles
// ---------------------------------------------------------------------------

export const parcelCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nom de parcelle requis').max(120),
  internalNumber: optionalText(40),
  commune: optionalText(120),
  inseeCode: optionalText(10),
  lieuDit: optionalText(120),
  cadastralRef: optionalText(60),
  pacId: optionalText(40),
  parcelType: optionalText(60),
  status: z.enum(['ACTIVE', 'FALLOW', 'ARCHIVED']).default('ACTIVE'),
  /**
   * Sol artificiellement drainé.
   *
   * Trois états, et le troisième compte : `undefined` laisse la parcelle « non
   * renseignée ». Plusieurs produits interdisent l'application sur sol drainé
   * (mentions SPe 2), et prendre l'absence de réponse pour un « non » ferait
   * taire l'avertissement précisément là où il manque.
   */
  drainedSoil: z.boolean().nullish(),
  notes: optionalText(2000),
  geometry: geometrySchema,
});

export const parcelUpdateSchema = parcelCreateSchema
  .partial()
  .extend({ geometry: geometrySchema.optional() });

export const parcelQuerySchema = z.object({
  /**
   * Exploitation visée, quand elle diffère de l'exploitation active : c'est le
   * cas de l'expert agronomique, qui consulte plusieurs portefeuilles sans
   * jamais « basculer » de compte. Un identifiant hors périmètre renvoie 404.
   */
  farmId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  cropId: z.string().optional(),
  status: z.enum(['ACTIVE', 'FALLOW', 'ARCHIVED']).optional(),
  parcelType: z.string().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  commune: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['name', 'area', 'commune', 'recent']).default('name'),
});

// ---------------------------------------------------------------------------
// Cultures
// ---------------------------------------------------------------------------

export const cropYearSchema = z.object({
  cropId: z.string().min(1, 'Culture requise'),
  campaignYear: z.coerce.number().int().min(1900).max(2200),
  variety: optionalText(120),
  sowingDate: optionalDateSchema,
  expectedHarvestDate: optionalDateSchema,
  actualHarvestDate: optionalDateSchema,
  yieldValue: optionalDecimal(100_000),
  yieldUnit: z.enum(YIELD_UNITS).optional(),
  notes: optionalText(2000),
});

export const customCropSchema = z.object({
  name: z.string().trim().min(1, 'Nom de culture requis').max(120),
  category: optionalText(80),
});

// ---------------------------------------------------------------------------
// Apports
// ---------------------------------------------------------------------------

/**
 * Conditions météo d'une intervention.
 *
 * Les mêmes pour un traitement, un apport et un travail : le vent emporte
 * l'azote comme il emporte la bouillie, la pluie lessive l'un comme l'autre.
 * Les valeurs sont facultatives — au champ, sans réseau, on ne les a pas, et
 * une donnée réglementaire ne s'invente pas.
 *
 * `captureWeather` demande au serveur d'aller les chercher lui-même à partir
 * des coordonnées de la parcelle ; l'application de terrain, elle, les relève
 * au moment de la saisie et les transmet telles quelles, parce qu'une file
 * d'attente peut partir des heures plus tard — la météo de la synchronisation
 * ne serait pas celle de l'intervention.
 */
export const weatherFields = {
  captureWeather: z.boolean().default(false),
  weatherTempC: optionalDecimal(80),
  weatherWindKmh: optionalDecimal(300),
  weatherHumidity: optionalDecimal(100),
  weatherRainMm: optionalDecimal(1000),
  weatherSummary: optionalText(160),
  /** D'où viennent ces valeurs. Jamais inventé : nul si rien n'a été relevé. */
  weatherSource: optionalText(60),
} as const;

const fertilizationFields = z.object({
    ...weatherFields,
    appliedOn: dateSchema,
    inputType: z.enum(['ORGANIC', 'MINERAL']),
    fertilizerId: z.string().optional(),
    organicInputId: z.string().optional(),
    productLabel: z.string().trim().min(1, 'Produit requis').max(160),
    dose: positiveDecimal(100_000),
    doseUnit: z.enum(DOSE_UNITS),
    /** Par défaut la superficie de la parcelle ; modifiable si apport partiel. */
    treatedAreaHa: optionalDecimal(100_000),
    totalUnit: z.enum(TOTAL_UNITS).optional(),
    nSupplied: optionalDecimal(100_000),
    pSupplied: optionalDecimal(100_000),
    kSupplied: optionalDecimal(100_000),
    supplier: optionalText(160),
    batchNumber: optionalText(80),
    operator: optionalText(120),
    notes: optionalText(2000),
    cropYearId: z.string().optional(),
  });

/** Un apport minéral ne cite pas de produit organique, et inversement. */
function produitCoherent(
  d: { inputType: 'MINERAL' | 'ORGANIC'; organicInputId?: string; fertilizerId?: string },
  ctx: z.RefinementCtx,
): void {
  if (d.inputType === 'MINERAL' && d.organicInputId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Un apport minéral ne peut pas référencer un produit organique',
      path: ['organicInputId'],
    });
  }
  if (d.inputType === 'ORGANIC' && d.fertilizerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Un apport organique ne peut pas référencer un engrais minéral',
      path: ['fertilizerId'],
    });
  }
}

export const fertilizationSchema = fertilizationFields.superRefine(produitCoherent);

/**
 * Élément fertilisant à la modification : un nombre est une valeur saisie
 * (analyse du produit), `null` demande le recalcul depuis le référentiel, et
 * l'absence conserve ce qui était enregistré s'il s'agissait d'une saisie.
 *
 * La distinction compte parce que l'application ne montre pas ces champs : une
 * modification faite au téléphone ne doit pas effacer une teneur relevée sur
 * une analyse et saisie au bureau.
 */
const elementModifiable = z.union([z.null(), optionalDecimal(100_000)]);

export const fertilizationUpdateSchema = fertilizationFields
  .extend({
    nSupplied: elementModifiable,
    pSupplied: elementModifiable,
    kSupplied: elementModifiable,
  })
  .superRefine(produitCoherent);

// ---------------------------------------------------------------------------
// Phytosanitaire
// ---------------------------------------------------------------------------

/** Heure `HH:MM` (00:00 à 23:59), facultative et effaçable comme un texte. */
const heureSchema = optionalText(5).refine(
  (v) => v == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  'Heure attendue au format HH:MM (ex. 07:30).',
);

/**
 * SIRET d'un prestataire ou d'une exploitation en entraide : 14 chiffres,
 * espaces tolérés. Vide efface.
 */
const siretFacultatif = optionalText(20)
  .transform((v) => (typeof v === 'string' ? v.replace(/\s/g, '') : v))
  .refine((v) => v == null || /^\d{14}$/.test(v), 'Le SIRET comporte 14 chiffres.');

/**
 * Mentions du registre en vigueur au 1er janvier 2026 (arrêté du 24 décembre
 * 2025, annexe I). Facultatives : les heures et le stade ne sont exigés que
 * lorsque l'autorisation du produit les encadre, et le serveur n'invente
 * jamais une valeur qu'on ne lui a pas donnée.
 */
const mentionsRegistre2026 = {
  startTime: heureSchema,
  endTime: heureSchema,
  bbchStage: optionalText(20),
  /** Production biologique au moment du traitement ; `null` : non renseigné. */
  organicProduction: z.boolean().nullish(),
  appliedBy: z.enum(['EXPLOITATION', 'PRESTATAIRE', 'ENTRAIDE']).nullish(),
  contractorName: optionalText(160),
  contractorSiret: siretFacultatif,
} as const;

/** Un traitement ne finit pas avant d'avoir commencé. */
function heuresCoherentes(
  d: { startTime?: string | null; endTime?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (d.startTime && d.endTime && d.endTime < d.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'L’heure de fin précède l’heure de début.',
      path: ['endTime'],
    });
  }
}

const phytoFields = z.object({
  appliedOn: dateSchema,
  /** Référence au produit E-Phy ; absent si saisie libre (produit non trouvé). */
  productId: z.string().optional(),
  productName: z.string().trim().min(1, 'Produit requis').max(200),
  amm: optionalText(30),
  activeSubstances: optionalText(500),
  cropLabel: optionalText(160),
  targetLabel: optionalText(200),
  dose: positiveDecimal(10_000),
  doseUnit: z.enum(DOSE_UNITS),
  sprayVolumeLHa: optionalDecimal(5_000),
  treatedAreaHa: optionalDecimal(100_000),
  operator: optionalText(120),
  notes: optionalText(2000),
  cropYearId: z.string().optional(),
  /**
   * Lot de stock réellement employé.
   *
   * C'est au champ, le bidon en main, qu'on connaît le numéro de lot — pas au
   * bureau une semaine plus tard. Facultatif : tout le monde ne tient pas de
   * stock, et l'exiger empêcherait d'enregistrer un traitement réellement
   * effectué, ce qui produirait un registre faux.
   */
  stockLotId: z.string().optional(),
  ...mentionsRegistre2026,
  ...weatherFields,
});

export const phytoApplicationSchema = phytoFields.superRefine(heuresCoherentes);

/**
 * Modification d'un traitement. Le lot de stock suit trois cas : absent, la
 * sortie de stock déjà rattachée est gardée (et ajustée à la nouvelle
 * quantité) ; vide ou `null`, elle est annulée ; un autre lot, elle passe sur
 * celui-ci.
 */
export const phytoApplicationUpdateSchema = phytoFields
  .extend({
    stockLotId: z
      .string()
      .nullish()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
  })
  .superRefine(heuresCoherentes);

// ---------------------------------------------------------------------------
// Travaux
// ---------------------------------------------------------------------------

export const operationSchema = z.object({
  performedOn: dateSchema,
  type: z.enum([
    'LABOUR', 'DECHAUMAGE', 'SEMIS', 'ROULAGE', 'HERSAGE', 'BROYAGE',
    'FAUCHE', 'RECOLTE', 'TRANSPORT', 'IRRIGATION', 'AUTRE',
  ]),
  equipment: optionalText(160),
  operator: optionalText(120),
  durationHours: optionalDecimal(1000),
  notes: optionalText(2000),

  /**
   * Irrigation. Ces champs n'ont de sens que pour `type: 'IRRIGATION'`, et le
   * schéma ne l'impose pas : refuser un volume saisi sur un autre type
   * n'apporterait rien, alors qu'une saisie perdue coûte une donnée.
   *
   * `waterNitrateMgL` est la teneur en **nitrate** (NO₃), telle que les
   * analyses d'eau la rendent — pas la teneur en azote. Le libellé du
   * formulaire le dit aussi : les confondre surestime la fourniture d'un
   * facteur 4,4 et conduit à sous-fertiliser.
   */
  irrigationVolumeM3Ha: optionalDecimal(100_000),
  irrigationMm: optionalDecimal(2000),
  waterSource: optionalText(160),
  waterNitrateMgL: optionalDecimal(1000),
  waterAnalysisOn: dateSchema.optional(),

  ...weatherFields,
});

// ---------------------------------------------------------------------------
// Documents & exports
// ---------------------------------------------------------------------------

export const documentMetaSchema = z.object({
  parcelId: z.string().optional(),
  category: z.enum(DOCUMENT_CATEGORIES).default('AUTRE'),
  description: optionalText(500),
});

export const exportQuerySchema = z.object({
  /** Exploitation visée — voir `parcelQuerySchema.farmId`. */
  farmId: z.string().optional(),
  dataset: z.enum([
    'parcelles',
    'phytosanitaire',
    'apports',
    'bilan-engrais',
    'historique',
    'travaux',
    'cultures',
    'cahier-epandage',
    'registre-phyto-numerique',
  ]),
  format: z.enum(['csv', 'xlsx', 'pdf', 'json']),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  parcelIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
  cropIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
});

// ---------------------------------------------------------------------------
// Profil / exploitation
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: optionalText(30),
});

export const preferencesSchema = z.object({
  unitSystem: z.enum(['metric']).default('metric'),
  locale: z.enum(['fr']).default('fr'),
  notifyByEmail: z.boolean(),
  weatherProvider: z.enum(['open-meteo', 'openweathermap']).optional(),
});

export const farmSchema = z.object({
  name: z.string().trim().min(1, "Nom de l'exploitation requis").max(150),
  siret: optionalText(20),
  addressLine: optionalText(200),
  postalCode: optionalText(10),
  city: optionalText(120),
  department: optionalText(80),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  /**
   * Conduite en agriculture biologique. Absent : inchangé ; `null` ou `''` :
   * « non renseigné ».
   */
  organicFarming: z
    .enum(['AUCUNE', 'TOTALE', 'PARTIELLE'])
    .nullish()
    .or(z.literal('').transform(() => null)),
});

/**
 * Pulvérisateur de l'exploitation. Chaque champ peut rester « non renseigné »
 * (`null`) : Parcelys ne suppose jamais un équipement qu'on ne lui a pas dit.
 */
export const sprayerSchema = z
  .object({
    sprayerType: z.enum(TYPES_PULVERISATEUR).nullable(),
    driftReductionPct: z
      .number()
      .int()
      .refine((v) => (CLASSES_REDUCTION_DERIVE as readonly number[]).includes(v), {
        message: 'Classe de réduction de dérive inconnue (0, 50, 66, 75 ou 90 %).',
      })
      .nullable(),
    driftEquipment: optionalText(200),
    riverainCharterApplied: z.boolean().nullable(),
  })
  .transform((v) => ({
    ...v,
    // Sans moyen anti-dérive, il n'y a pas de matériel à décrire.
    driftEquipment: v.driftReductionPct && v.driftReductionPct > 0 ? (v.driftEquipment ?? null) : null,
  }));

export const memberInviteSchema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide'),
  role: z.enum(['ADMIN', 'EMPLOYEE', 'VIEWER']),
  jobTitle: optionalText(80),
});

export type ParcelCreateInput = z.infer<typeof parcelCreateSchema>;
export type FertilizationInput = z.infer<typeof fertilizationSchema>;
export type PhytoApplicationInput = z.infer<typeof phytoApplicationSchema>;

// ---------------------------------------------------------------------------
// Produits organiques de l'exploitation
// ---------------------------------------------------------------------------

/**
 * Un produit organique propre à l'exploitation : ses teneurs (issues d'une
 * analyse) et son classement réglementaire déclaré.
 *
 * Les teneurs sont en kg d'élément par tonne ou par m³ de produit brut. Le
 * classement reprend le type du programme national et les dénominations de
 * la fiche GREN 19 ; chacune est facultative — non déclarée, la règle qui en
 * dépend reste indéterminée.
 */
export const organicProductSchema = z.object({
  name: z.string().trim().min(1, 'Nom du produit requis').max(120),
  category: optionalText(80),
  nContent: optionalDecimal(500),
  pContent: optionalDecimal(500),
  kContent: optionalDecimal(500),
  dryMatter: optionalDecimal(100),
  defaultUnit: z.enum(['t/ha', 'm3/ha']).default('t/ha'),
  regulatoryClass: classementDeclareSchema.optional(),
});
