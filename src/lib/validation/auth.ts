import { z } from 'zod';

/** Politique de mot de passe : longueur d'abord, puis diversité de caractères. */
export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères')
  .max(200, 'Mot de passe trop long')
  .refine((v) => /[a-z]/.test(v), 'Ajoutez au moins une minuscule')
  .refine((v) => /[A-Z]/.test(v), 'Ajoutez au moins une majuscule')
  .refine((v) => /[0-9]/.test(v), 'Ajoutez au moins un chiffre');

export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Adresse e-mail requise')
  .max(254, 'Adresse e-mail trop longue')
  .email('Adresse e-mail invalide');

/** SIRET (14 chiffres) ou SIREN (9 chiffres), espaces tolérés. */
export const siretSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ''))
  .refine(
    (v) => v.length === 0 || /^\d{9}$/.test(v) || /^\d{14}$/.test(v),
    'Le SIRET doit comporter 14 chiffres et le SIREN 9 chiffres',
  );

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Prénom requis').max(80),
    lastName: z.string().trim().min(1, 'Nom requis').max(80),
    email: emailSchema,
    password: passwordSchema,
    passwordConfirmation: z.string(),
    farmName: z.string().trim().min(1, "Nom de l'exploitation requis").max(150),
    siret: siretSchema.optional().or(z.literal('')),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: 'Vous devez accepter les CGU' }),
    }),
    acceptPrivacy: z.literal(true, {
      errorMap: () => ({
        message: 'Vous devez accepter la politique de confidentialité',
      }),
    }),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['passwordConfirmation'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Mot de passe requis').max(200),
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Le code doit contenir 6 chiffres'),
});

export const resendCodeSchema = z.object({ email: emailSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, 'Lien invalide'),
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['passwordConfirmation'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: passwordSchema,
    newPasswordConfirmation: z.string(),
  })
  .refine((d) => d.newPassword === d.newPasswordConfirmation, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['newPasswordConfirmation'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
