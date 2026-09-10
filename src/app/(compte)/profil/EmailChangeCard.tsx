'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiDelete, apiFetch, apiPost, apiPut } from '@/lib/client/api';
import { Alert, Button, Card, CardHeader, Field, Input, Spinner } from '@/components/ui';

/**
 * Changement de l'adresse e-mail du compte.
 *
 * L'écran suit exactement ce que fait le serveur, et le dit à chaque étape :
 * tant que le code n'est pas saisi, **l'adresse n'a pas changé**. C'est le point
 * qui doit rester lisible du début à la fin — sans quoi l'utilisateur croit
 * avoir modifié son identifiant de connexion alors qu'il n'en est rien, et
 * s'aperçoit du malentendu à la prochaine connexion.
 *
 * La demande en cours est relue à l'ouverture : quelqu'un qui ferme l'onglet
 * pour aller chercher son code dans sa boîte doit retrouver l'écran là où il
 * l'a laissé, pas revenir à zéro.
 */

type Pending = { newEmail: string; expiresAt: string };

export function EmailChangeCard({ email }: { email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renvoiDans, setRenvoiDans] = useState(0);
  const [derniereDemande, setDerniereDemande] = useState<{
    newEmail: string;
    currentPassword: string;
  } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof ApiRequestError ? cause.message : 'Une erreur est survenue.');
    setMessage(null);
  }, []);

  // Une demande peut être en cours depuis une autre visite : on la relit plutôt
  // que de repartir d'un écran vierge qui la ferait croire perdue.
  useEffect(() => {
    let vivant = true;
    apiFetch<{ email: string; pending: Pending | null }>('/api/profile/email')
      .then((etat) => {
        if (!vivant) return;
        setPending(etat.pending);
        if (etat.pending) setOuvert(true);
      })
      .catch(() => {
        // Un échec ici n'empêche pas de faire une demande : on n'affiche donc
        // pas d'erreur pour un état qu'on saura de toute façon au premier envoi.
      });
    return () => {
      vivant = false;
    };
  }, []);

  // Compte à rebours du renvoi. Le serveur reste seul juge — il refuse un
  // renvoi trop tôt quoi qu'affiche l'écran —, mais un bouton actif qui échoue
  // systématiquement est une invitation à cliquer pour rien.
  useEffect(() => {
    if (renvoiDans <= 0) return;
    const t = setTimeout(() => setRenvoiDans((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoiDans]);

  async function demander(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newEmail = String(form.get('newEmail') ?? '').trim();
    const currentPassword = String(form.get('currentPassword') ?? '');

    setBusy('demande');
    setError(null);
    setMessage(null);
    try {
      const res = await apiPost<{
        newEmail: string;
        expiresInSeconds: number;
        resendInSeconds: number;
        message: string;
      }>('/api/profile/email', { newEmail, currentPassword });

      setPending({
        newEmail: res.newEmail,
        expiresAt: new Date(Date.now() + res.expiresInSeconds * 1000).toISOString(),
      });
      // Le mot de passe est gardé en mémoire de l'onglet, le temps du renvoi
      // éventuel. Il n'est ni stocké ni transmis ailleurs : le redemander à
      // chaque renvoi n'ajouterait aucune sécurité — la demande est déjà faite
      // — et ferait ressaisir un mot de passe long sur un téléphone, au champ.
      setDerniereDemande({ newEmail: res.newEmail, currentPassword });
      setRenvoiDans(res.resendInSeconds);
      setMessage(res.message);
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(null);
    }
  }

  async function renvoyer(): Promise<void> {
    if (!derniereDemande) return;
    setBusy('renvoi');
    setError(null);
    try {
      const res = await apiPost<{ resendInSeconds: number; message: string }>(
        '/api/profile/email',
        derniereDemande,
      );
      setRenvoiDans(res.resendInSeconds);
      setMessage(res.message);
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(null);
    }
  }

  async function confirmer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy('confirmation');
    setError(null);
    setMessage(null);
    try {
      const res = await apiPut<{ email: string; message: string }>('/api/profile/email', {
        code: String(form.get('code') ?? '').trim(),
      });
      setPending(null);
      setOuvert(false);
      setDerniereDemande(null);
      setMessage(res.message);
      router.refresh();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(null);
    }
  }

  async function annuler(): Promise<void> {
    setBusy('annulation');
    setError(null);
    try {
      await apiDelete('/api/profile/email');
      setPending(null);
      setDerniereDemande(null);
      setOuvert(false);
      setMessage('Demande annulée. Votre adresse n’a pas changé.');
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Adresse e-mail"
        description="C’est votre identifiant de connexion, et l’adresse où arrivent les liens de réinitialisation."
        action={
          !ouvert ? (
            <Button variant="secondary" onClick={() => setOuvert(true)}>
              Modifier
            </Button>
          ) : null
        }
      />

      <p className="text-sm text-ink-2">
        Adresse actuelle : <strong className="break-all">{email}</strong>
      </p>

      {message ? (
        <Alert tone="success" className="mt-3">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {ouvert && !pending ? (
        <form onSubmit={demander} className="mt-4 space-y-4">
          <Field
            label="Nouvelle adresse"
            htmlFor="newEmail"
            required
            hint="Un code y sera envoyé. Votre adresse actuelle reste active tant qu’il n’est pas saisi."
          >
            <Input id="newEmail" name="newEmail" type="email" autoComplete="email" required />
          </Field>

          <Field
            label="Votre mot de passe"
            htmlFor="emailChangePassword"
            required
            hint="Redemandé parce qu’une session ouverte ne prouve pas que c’est bien vous."
          >
            <Input
              id="emailChangePassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy === 'demande'}>
              {busy === 'demande' ? <Spinner /> : null}
              Envoyer le code
            </Button>
          </div>
        </form>
      ) : null}

      {pending ? (
        <div className="mt-4 space-y-4">
          <Alert tone="info">
            Un code à 6 chiffres a été envoyé à <strong>{pending.newEmail}</strong>. Votre
            adresse de connexion reste <strong>{email}</strong> tant que ce code n’a pas été
            saisi.
          </Alert>

          <form onSubmit={confirmer} className="space-y-4">
            <Field label="Code reçu" htmlFor="code" required>
              <Input
                id="code"
                name="code"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                required
              />
            </Field>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={annuler}
                disabled={busy === 'annulation'}
              >
                Abandonner
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={renvoyer}
                disabled={busy === 'renvoi' || renvoiDans > 0 || !derniereDemande}
              >
                {busy === 'renvoi' ? <Spinner /> : null}
                {renvoiDans > 0 ? `Renvoyer dans ${renvoiDans} s` : 'Renvoyer le code'}
              </Button>
              <Button type="submit" disabled={busy === 'confirmation'}>
                {busy === 'confirmation' ? <Spinner /> : null}
                Confirmer la nouvelle adresse
              </Button>
            </div>
          </form>

          {!derniereDemande ? (
            <p className="text-sm text-ink-3">
              Cette demande a été faite lors d’une visite précédente. Pour recevoir un nouveau
              code, abandonnez-la et recommencez : votre mot de passe sera redemandé.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
