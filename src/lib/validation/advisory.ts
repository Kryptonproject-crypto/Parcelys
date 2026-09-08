import { z } from 'zod';
import { DOSE_UNITS } from '@/lib/constants/agronomy';
import { emailSchema, invitationCodeSchema } from '@/lib/validation/auth';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(''));

/** Date ISO `aaaa-mm-jj`, convertie en `Date`. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format aaaa-mm-jj')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const optionalDate = dateSchema.optional().or(z.literal('')).transform((v) =>
  v === '' || v === undefined ? undefined : (v as Date),
);

/**
 * Rédaction d'une préconisation.
 *
 * Le champ `rationale` est obligatoire et c'est délibéré : une préconisation
 * sans justification n'est qu'une consigne, l'exploitant ne peut pas
 * l'apprécier, et elle ne vaut rien dans un dossier de contrôle.
 */
export const recommendationCreateSchema = z
  .object({
    parcelId: z.string().trim().max(40).optional().or(z.literal('')),
    kind: z.enum(['PHYTO', 'FERTILIZATION', 'OPERATION', 'OBSERVATION']),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
    title: z.string().trim().min(3, 'Intitulé requis').max(160),
    rationale: z
      .string()
      .trim()
      .min(10, 'Expliquez brièvement pourquoi vous préconisez cette intervention')
      .max(4000),
    productName: optionalText(200),
    amm: optionalText(30),
    dose: z.coerce.number().positive().max(100_000).optional(),
    doseUnit: z.enum(DOSE_UNITS).optional(),
    targetLabel: optionalText(200),
    windowStart: optionalDate,
    windowEnd: optionalDate,
    /** `true` pour transmettre immédiatement, `false` pour garder un brouillon. */
    send: z.boolean().default(false),
  })
  .refine(
    (data) =>
      !data.windowStart ||
      !data.windowEnd ||
      data.windowEnd.getTime() >= data.windowStart.getTime(),
    { message: 'La fin de fenêtre précède son début', path: ['windowEnd'] },
  );

export const recommendationUpdateSchema = recommendationCreateSchema;

/** Décision de l'exploitation sur une préconisation transmise. */
export const recommendationResponseSchema = z.object({
  decision: z.enum(['ACCEPTED', 'DECLINED']),
  note: optionalText(1000),
});

/** Rattachement d'une préconisation acceptée à l'intervention réalisée. */
export const recommendationApplySchema = z.object({
  phytoId: z.string().trim().max(40).optional().or(z.literal('')),
  fertilizationId: z.string().trim().max(40).optional().or(z.literal('')),
  operationId: z.string().trim().max(40).optional().or(z.literal('')),
});

export const recommendationQuerySchema = z.object({
  farmId: z.string().trim().max(40).optional(),
  parcelId: z.string().trim().max(40).optional(),
  statut: z
    .enum(['tous', 'attente', 'acceptees', 'ecartees', 'realisees', 'brouillons'])
    .default('tous'),
});

// ---------------------------------------------------------------------------
// Accès conseil
// ---------------------------------------------------------------------------

/** Code d'accès conseil délivré par une exploitation à un expert. */
export const advisoryCodeCreateSchema = z.object({
  email: emailSchema.optional().or(z.literal('')),
  note: optionalText(200),
  validityDays: z.coerce.number().int().min(1).max(90).default(14),
});

/** Redemption d'un code par un expert déjà connecté. */
export const advisoryRedeemSchema = z.object({
  code: invitationCodeSchema,
});

export const engagementRevokeSchema = z.object({
  engagementId: z.string().trim().min(1).max(40),
});

export type RecommendationCreateInput = z.infer<typeof recommendationCreateSchema>;
