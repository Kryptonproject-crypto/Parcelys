'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

export function LoginForm() {
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
    const email = String(form.get('email') ?? '');

    try {
      await apiPost('/api/auth/login', {
        email,
        password: String(form.get('password') ?? ''),
      });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // Compte non vérifié : on redirige vers la saisie du code.
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          router.push(`/verification-email?email=${encodeURIComponent(email)}`);
          return;
        }
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

      <Field label="Adresse e-mail" htmlFor="email" required error={fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
        />
      </Field>

      <Field label="Mot de passe" htmlFor="password" required error={fieldErrors.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="flex justify-end">
        <Link
          href="/mot-de-passe-oublie"
          className="text-sm text-champ-700 hover:underline"
        >
          Mot de passe oublié ?
        </Link>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {submitting ? 'Connexion…' : 'Se connecter'}
      </Button>
    </form>
  );
}
