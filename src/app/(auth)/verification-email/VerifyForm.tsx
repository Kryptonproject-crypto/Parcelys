'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

/** Délai avant de pouvoir redemander un code, en secondes. */
const RESEND_COOLDOWN = 60;

export function VerifyForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (initialEmail) codeRef.current?.focus();
  }, [initialEmail]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);

    try {
      await apiPost('/api/auth/verify-email', { email, code });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Impossible de contacter le serveur. Réessayez.',
      );
      setSubmitting(false);
    }
  }

  async function resend(): Promise<void> {
    setResending(true);
    setError(null);
    setInfo(null);

    try {
      const result = await apiPost<{ message: string }>('/api/auth/resend-code', {
        email,
      });
      setInfo(result.message);
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Envoi impossible pour le moment.',
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {info ? <Alert tone="success">{info}</Alert> : null}

      <Field label="Adresse e-mail" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </Field>

      <Field
        label="Code de vérification"
        htmlFor="code"
        required
        hint="Code à 6 chiffres reçu par e-mail, valable 15 minutes."
      >
        <Input
          id="code"
          ref={codeRef}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className="text-center text-2xl font-semibold tracking-[0.5em]"
          placeholder="······"
          required
        />
      </Field>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={submitting || code.length !== 6}
      >
        {submitting ? <Spinner /> : null}
        {submitting ? 'Vérification…' : 'Vérifier mon adresse'}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={resend}
          disabled={resending || cooldown > 0 || email.length < 3}
          className="text-sm text-champ-700 hover:underline disabled:cursor-not-allowed disabled:text-ardoise-400 disabled:no-underline"
        >
          {cooldown > 0
            ? `Renvoyer un code dans ${cooldown} s`
            : resending
              ? 'Envoi en cours…'
              : 'Renvoyer un code'}
        </button>
      </div>
    </form>
  );
}
