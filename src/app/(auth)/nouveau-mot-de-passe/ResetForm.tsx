'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);

    try {
      const result = await apiPost<{ message: string }>('/api/auth/reset-password', {
        token,
        password: String(form.get('password') ?? ''),
        passwordConfirmation: String(form.get('passwordConfirmation') ?? ''),
      });
      setDone(result.message);
      setTimeout(() => router.push('/connexion'), 2500);
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

  if (done) {
    return (
      <Alert tone="success" title="Mot de passe modifié">
        {done} Redirection vers la page de connexion…
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field
        label="Nouveau mot de passe"
        htmlFor="password"
        required
        error={fieldErrors.password}
        hint="10 caractères minimum, avec majuscule, minuscule et chiffre."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
        />
      </Field>

      <Field
        label="Confirmation"
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

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {submitting ? 'Enregistrement…' : 'Enregistrer le nouveau mot de passe'}
      </Button>
    </form>
  );
}
