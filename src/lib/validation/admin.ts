import { z } from 'zod';
import { emailSchema } from '@/lib/validation/auth';
import {
  DEFAULT_VALIDITY_DAYS,
  MAX_VALIDITY_DAYS,
} from '@/lib/auth/invitations.shared';

/** Création d'un code d'invitation par un administrateur. */
export const invitationCreateSchema = z
  .object({
    email: emailSchema.optional().or(z.literal('')),
    /**
     * Nature du compte créé. Un expert agronomique n'a pas d'exploitation :
     * il suit celles qui lui remettront un code d'accès conseil.
     */
    accountType: z.enum(['FARMER', 'AGRONOMIST']).default('FARMER'),
    /** Exploitation rejointe ; vide = la personne crée la sienne. */
    farmId: z.string().trim().max(40).optional().or(z.literal('')),
    /**
     * Rôle dans l'exploitation rejointe. Sans exploitation, la personne crée la
     * sienne et en devient propriétaire ; pour un compte expert, le champ n'a
     * pas de sens du tout — d'où la valeur par défaut plutôt qu'une obligation
     * de renseigner un rôle qui ne servira jamais.
     */
    role: z.enum(['OWNER', 'ADMIN', 'EMPLOYEE', 'VIEWER']).default('OWNER'),
    grantsPlatformAdmin: z.boolean().optional().default(false),
    note: z.string().trim().max(200).optional().or(z.literal('')),
    validityDays: z.coerce
      .number()
      .int()
      .min(1, 'Au moins un jour')
      .max(MAX_VALIDITY_DAYS, `${MAX_VALIDITY_DAYS} jours au maximum`)
      .default(DEFAULT_VALIDITY_DAYS),
  })
  // Champ absent et champ vide veulent dire la même chose — « pas
  // d'exploitation ». Les distinguer ferait dépendre la validation de la façon
  // dont l'appelant construit son corps de requête, ce qui n'a aucun sens ici.
  .refine(
    (data) => data.accountType === 'AGRONOMIST' || data.farmId || data.role === 'OWNER',
    {
      message:
        "Sans exploitation, la personne crée la sienne et en devient propriétaire",
      path: ['role'],
    },
  )
  .refine((data) => data.accountType !== 'AGRONOMIST' || !data.farmId, {
    message: "Un compte expert ne se rattache pas à une exploitation à l'inscription",
    path: ['farmId'],
  });

/**
 * Actions d'administration sur un compte. Chacune est explicite : pas de PATCH
 * générique qui laisserait modifier n'importe quel champ.
 */
export const userActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suspend'),
    reason: z.string().trim().max(200).optional().or(z.literal('')),
  }),
  z.object({ action: z.literal('restore') }),
  z.object({ action: z.literal('unlock') }),
  z.object({ action: z.literal('verify-email') }),
  z.object({ action: z.literal('revoke-sessions') }),
  z.object({
    action: z.literal('set-platform-admin'),
    value: z.boolean(),
  }),
]);

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(400).optional().or(z.literal('')),
});

export const cleanupSchema = z.object({
  targets: z
    .array(z.enum(['sessions', 'rate-limits', 'invitations', 'audit']))
    .min(1, 'Sélectionnez au moins une opération'),
  /** Rétention du journal d'audit, en jours (RGPD : limitation de conservation). */
  auditRetentionDays: z.coerce.number().int().min(30).max(3650).default(365),
});

export const adminUserQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  statut: z.enum(['tous', 'actifs', 'suspendus', 'non-verifies', 'admins']).default('tous'),
});

export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type UserActionInput = z.infer<typeof userActionSchema>;
