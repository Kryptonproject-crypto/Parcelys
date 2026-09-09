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
     * Nature du compte créé.
     *
     *   FARMER      possède ou rejoint une exploitation ;
     *   AGRONOMIST  n'en a pas — il suit celles qui lui remettent un code ;
     *   ADMIN       n'en a pas non plus — il administre l'instance.
     */
    accountType: z.enum(['FARMER', 'AGRONOMIST', 'ADMIN']).default('FARMER'),
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
    (data) => data.accountType !== 'FARMER' || data.farmId || data.role === 'OWNER',
    {
      message:
        "Sans exploitation, la personne crée la sienne et en devient propriétaire",
      path: ['role'],
    },
  )
  .refine((data) => data.accountType === 'FARMER' || !data.farmId, {
    message:
      "Ce type de compte ne se rattache pas à une exploitation : l'expert suit " +
      "celles qui l'y invitent, l'administrateur n'en gère aucune",
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
  // Doit rester aligné sur `AdminUserFilter` (src/lib/admin/shared.ts) : c'est
  // cette liste que valident les requêtes derrière les onglets de filtrage.
  statut: z
    .enum(['tous', 'actifs', 'suspendus', 'non-verifies', 'experts', 'admins'])
    .default('tous'),
});

/**
 * Rattachement d'un expert à une exploitation, décidé depuis l'administration.
 *
 * Le chemin ordinaire reste celui de l'exploitation, qui délivre elle-même un
 * code d'accès conseil : c'est elle qui décide qui lit ses données. Ce
 * rattachement direct est la voie de l'administrateur d'instance, pour les cas
 * où il gère lui-même les deux côtés. Il est journalisé, et l'exploitation en
 * est avertie — un accès à des données d'exploitation ne s'ouvre pas en silence.
 */
export const advisoryGrantSchema = z.object({
  expertId: z.string().trim().min(1).max(40),
  farmId: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).optional().or(z.literal('')),
});

export const advisoryRevokeSchema = z.object({
  engagementId: z.string().trim().min(1).max(40),
});

export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;
export type UserActionInput = z.infer<typeof userActionSchema>;
export type AdvisoryGrantInput = z.infer<typeof advisoryGrantSchema>;
