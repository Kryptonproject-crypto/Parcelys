import { z } from 'zod';
import { geometrySchema } from '@/lib/geo/types';
import {
  DOCUMENT_CATEGORIES,
  DOSE_UNITS,
  TOTAL_UNITS,
  YIELD_UNITS,
} from '@/lib/constants/agronomy';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : undefined));

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

export const fertilizationSchema = z
  .object({
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
  })
  .refine(
    (d) => d.inputType !== 'MINERAL' || !d.organicInputId,
    { message: 'Un apport minéral ne peut pas référencer un produit organique', path: ['organicInputId'] },
  )
  .refine(
    (d) => d.inputType !== 'ORGANIC' || !d.fertilizerId,
    { message: 'Un apport organique ne peut pas référencer un engrais minéral', path: ['fertilizerId'] },
  );

// ---------------------------------------------------------------------------
// Phytosanitaire
// ---------------------------------------------------------------------------

export const phytoApplicationSchema = z.object({
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
  /** Renseigne automatiquement les conditions météo depuis le fournisseur. */
  captureWeather: z.boolean().default(false),
  weatherTempC: optionalDecimal(80),
  weatherWindKmh: optionalDecimal(300),
  weatherHumidity: optionalDecimal(100),
  weatherRainMm: optionalDecimal(1000),
  weatherSummary: optionalText(160),
});

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
  dataset: z.enum(['parcelles', 'phytosanitaire', 'apports', 'historique', 'travaux', 'cultures']),
  format: z.enum(['csv', 'xlsx', 'pdf']),
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
});

export const memberInviteSchema = z.object({
  email: z.string().trim().email('Adresse e-mail invalide'),
  role: z.enum(['ADMIN', 'EMPLOYEE', 'VIEWER']),
  jobTitle: optionalText(80),
});

export type ParcelCreateInput = z.infer<typeof parcelCreateSchema>;
export type FertilizationInput = z.infer<typeof fertilizationSchema>;
export type PhytoApplicationInput = z.infer<typeof phytoApplicationSchema>;
