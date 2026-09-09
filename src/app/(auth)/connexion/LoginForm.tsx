'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

/** Porte d'entrée utilisée : exploitation ou expert agronomique. */
export type LoginSpace = 'farm' | 'expert';

type LoginResponse = {
  redirectTo: string;
  user: { accountType: 'FARMER' | 'AGRONOMIST' | 'ADMIN' };
};

/**
 * Connexion.
 *
 * Une seule mécanique d'authentification pour les deux métiers — en dupliquer
 * une serait une faiblesse de sécurité, pas une fonctionnalité. La porte
 * d'entrée ne sert qu'à orienter : si le compte n'est pas du type attendu, on
 * le dit clairement et on l'emmène quand même au bon endroit, plutôt que de le
 * laisser buter sur une redirection silencieuse.
 */
export function LoginForm({ space = 'farm' }: { space?: LoginSpace }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');

    try {
      const result = await apiPost<LoginResponse>('/api/auth/login', {
        email,
        password: String(form.get('password') ?? ''),
      });

      // Se tromper d'entrée n'est pas une erreur : on ouvre le bon espace en
      // le disant, plutôt que de renvoyer la personne d'où elle vient.
      const expected = space === 'expert' ? 'AGRONOMIST' : 'FARMER';
      if (result.user.accountType !== expected) {
        setNotice(
          {
            FARMER: 'Ce compte est un compte d’exploitation : ouverture de votre tableau de bord.',
            AGRONOMIST: 'Ce compte est un compte expert : ouverture de votre portefeuille.',
            ADMIN: 'Ce compte est un compte d’administration : ouverture de l’espace de gestion.',
          }[result.user.accountType],
        );
      }

      router.push(result.redirectTo);
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
      {notice ? <Alert tone="info">{notice}</Alert> : null}

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
          className="text-sm text-champ-700 dark:text-champ-400 hover:underline"
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
