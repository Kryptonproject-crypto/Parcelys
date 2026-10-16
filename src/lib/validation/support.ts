import { z } from 'zod';
import { emailSchema } from '@/lib/validation/auth';
import { LIMITES_TEXTE, RUBRIQUES_SUPPORT, STATUTS_DEMANDE } from '@/lib/shared/support';

const rubriques = RUBRIQUES_SUPPORT.map((r) => r.value) as [string, ...string[]];

/**
 * Une demande de support.
 *
 * Le numéro client n'est lu que pour un visiteur **non connecté** — et
 * seulement comme une déclaration. Pour un compte, le serveur le retrouve
 * lui-même depuis la session ; ce que le navigateur enverrait est ignoré.
 */
export const ticketCreateSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, 'Un sujet de quelques mots')
    .max(LIMITES_TEXTE.sujet, `${LIMITES_TEXTE.sujet} caractères au maximum`),
  description: z
    .string()
    .trim()
    .min(10, 'Décrivez le problème en quelques phrases')
    .max(LIMITES_TEXTE.description, `${LIMITES_TEXTE.description} caractères au maximum`),
  area: z.enum(rubriques).optional().or(z.literal('')),
  /** Exploitation concernée, parmi celles du compte connecté. */
  farmId: z.string().trim().max(40).optional().or(z.literal('')),
  /** Visiteur non connecté seulement. */
  name: z.string().trim().max(120).optional().or(z.literal('')),
  email: emailSchema.optional().or(z.literal('')),
  customerNumber: z.string().trim().max(24).optional().or(z.literal('')),
  /**
   * Champ piège, invisible pour un humain : un robot qui remplit tout le
   * renseigne. Une valeur non vide fait échouer la demande sans bruit.
   */
  website: z.string().max(200).optional().or(z.literal('')),
});

export const anonymousRequesterSchema = z.object({
  name: z.string().trim().min(2, 'Votre nom').max(120),
  email: emailSchema,
});

export const ticketMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Message vide')
    .max(LIMITES_TEXTE.message, `${LIMITES_TEXTE.message} caractères au maximum`),
  /** Note interne entre administrateurs : ignorée côté demandeur. */
  internal: z.union([z.boolean(), z.enum(['true', 'false', 'on', ''])]).optional(),
});

export const staffTicketActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), status: z.enum(STATUTS_DEMANDE as [string, ...string[]]) }),
  z.object({ action: z.literal('assign'), assigneeId: z.string().trim().max(40).nullable() }),
  z.object({ action: z.literal('transfer'), portfolioId: z.string().trim().max(40).nullable() }),
]);

export const adminTicketQuerySchema = z.object({
  statut: z
    .enum(['ouvertes', 'toutes', ...(STATUTS_DEMANDE as string[])] as [string, ...string[]])
    .default('ouvertes'),
  q: z.string().trim().max(120).optional(),
  moi: z.enum(['1', '0']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/** Suivi d'une demande anonyme par le lien reçu par e-mail. */
export const followUpSchema = z.object({
  token: z.string().trim().min(20).max(200),
  action: z.enum(['confirmer', 'repondre']),
  body: z.string().trim().max(LIMITES_TEXTE.message).optional(),
});
