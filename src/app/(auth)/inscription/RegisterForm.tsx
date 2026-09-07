'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

type RegisterResponse = { email: string; message: string };

export function RegisterForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      passwordConfirmation: String(form.get('passwordConfirmation') ?? ''),
      farmName: String(form.get('farmName') ?? ''),
      siret: String(form.get('siret') ?? ''),
      acceptTerms: form.get('acceptTerms') === 'on',
      acceptPrivacy: form.get('acceptPrivacy') === 'on',
    };

    try {
      const result = await apiPost<RegisterResponse>('/api/auth/register', payload);
      router.push(`/verification-email?email=${encodeURIComponent(result.email)}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Impossible de contacter le serveur. Réessayez.');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" htmlFor="firstName" required error={fieldErrors.firstName}>
          <Input id="firstName" name="firstName" autoComplete="given-name" required />
        </Field>
        <Field label="Nom" htmlFor="lastName" required error={fieldErrors.lastName}>
          <Input id="lastName" name="lastName" autoComplete="family-name" required />
        </Field>
      </div>

      <Field label="Adresse e-mail" htmlFor="email" required error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <Field
        label="Mot de passe"
        htmlFor="password"
        required
        error={fieldErrors.password}
        hint="10 caractères minimum, avec au moins une majuscule, une minuscule et un chiffre."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <Field
        label="Confirmation du mot de passe"
        htmlFor="passwordConfirmation"
        required
        error={fieldErrors.passwordConfirmation}
      >
        <Input
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>

      <hr className="border-line" />

      <Field
        label="Nom de l'exploitation"
        htmlFor="farmName"
        required
        error={fieldErrors.farmName}
      >
        <Input id="farmName" name="farmName" placeholder="EARL des Trois Chênes" required />
      </Field>

      <Field
        label="SIRET / SIREN"
        htmlFor="siret"
        hint="Facultatif — 14 chiffres (SIRET) ou 9 chiffres (SIREN)."
        error={fieldErrors.siret}
      >
        <Input id="siret" name="siret" inputMode="numeric" />
      </Field>

      <div className="space-y-2 rounded-lg bg-surface-2 p-3">
        <label className="flex items-start gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            name="acceptTerms"
            required
            className="mt-0.5 h-4 w-4 rounded border-line-strong text-champ-600 focus:ring-champ-500"
          />
          <span>
            J&apos;accepte les{' '}
            <Link href="/cgu" target="_blank" className="text-champ-700 dark:text-champ-400 underline">
              conditions générales d&apos;utilisation
            </Link>
          </span>
        </label>
        {fieldErrors.acceptTerms ? (
          <p className="text-xs font-medium text-brique-500">{fieldErrors.acceptTerms}</p>
        ) : null}

        <label className="flex items-start gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            name="acceptPrivacy"
            required
            className="mt-0.5 h-4 w-4 rounded border-line-strong text-champ-600 focus:ring-champ-500"
          />
          <span>
            J&apos;accepte la{' '}
            <Link href="/confidentialite" target="_blank" className="text-champ-700 dark:text-champ-400 underline">
              politique de confidentialité
            </Link>
          </span>
        </label>
        {fieldErrors.acceptPrivacy ? (
          <p className="text-xs font-medium text-brique-500">{fieldErrors.acceptPrivacy}</p>
        ) : null}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {submitting ? 'Création…' : 'Créer mon compte'}
      </Button>
    </form>
  );
}
