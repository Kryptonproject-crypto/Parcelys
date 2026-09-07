'use client';

import { useState, type FormEvent } from 'react';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

export function ForgotForm() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const result = await apiPost<{ message: string }>('/api/auth/forgot-password', {
        email: String(form.get('email') ?? ''),
      });
      setSent(result.message);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Impossible de contacter le serveur. Réessayez.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return <Alert tone="success" title="Demande enregistrée">{sent}</Alert>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field label="Adresse e-mail" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" autoFocus required />
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {submitting ? 'Envoi…' : 'Envoyer le lien'}
      </Button>
    </form>
  );
}
