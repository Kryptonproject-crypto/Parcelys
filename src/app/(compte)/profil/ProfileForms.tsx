'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiDelete, apiFetch, apiPost, apiPut } from '@/lib/client/api';
import { Modal } from '@/components/forms/Modal';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Spinner,
  formatDateFr,
} from '@/components/ui';
import { IconExport } from '@/components/ui/icons';
import { EmailChangeCard } from './EmailChangeCard';

type ProfileUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locale: string;
  unitSystem: string;
  weatherProvider: string | null;
  notifyByEmail: boolean;
  emailVerifiedAt: string | null;
};

type SessionRow = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

/** Résumé lisible d'un agent utilisateur, sans dépendance externe. */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu';
  const browser = /Firefox\/\d/.test(userAgent)
    ? 'Firefox'
    : /Edg\/\d/.test(userAgent)
      ? 'Edge'
      : /Chrome\/\d/.test(userAgent)
        ? 'Chrome'
        : /Safari\/\d/.test(userAgent)
          ? 'Safari'
          : 'Navigateur';
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Système inconnu';
  return `${browser} · ${os}`;
}

export function ProfileForms({
  user,
  sessions,
}: {
  user: ProfileUser;
  sessions: SessionRow[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const confirmation = useConfirm();

  function report(err: unknown): void {
    setError(err instanceof ApiRequestError ? err.message : 'Une erreur est survenue.');
    setMessage(null);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('profile');
    setError(null);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    try {
      const result = await apiPut<{ message: string }>('/api/profile', {
        profile: {
          firstName: String(form.get('firstName') ?? ''),
          lastName: String(form.get('lastName') ?? ''),
          phone: String(form.get('phone') ?? ''),
        },
      });
      setMessage(result.message);
      router.refresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('preferences');
    setError(null);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    try {
      const result = await apiPut<{ message: string }>('/api/profile', {
        preferences: {
          notifyByEmail: form.get('notifyByEmail') === 'on',
          weatherProvider: String(form.get('weatherProvider') ?? 'open-meteo'),
        },
      });
      setMessage(result.message);
      router.refresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('password');
    setError(null);
    setMessage(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await apiPut<{ message: string }>('/api/profile/password', {
        currentPassword: String(form.get('currentPassword') ?? ''),
        newPassword: String(form.get('newPassword') ?? ''),
        newPasswordConfirmation: String(form.get('newPasswordConfirmation') ?? ''),
      });
      setMessage(result.message);
      formElement.reset();
      router.refresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function revokeSession(sessionId: string): Promise<void> {
    setBusy(sessionId);
    setError(null);
    try {
      await apiDelete('/api/profile/sessions', { sessionId });
      setMessage('Session révoquée.');
      router.refresh();
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  function askLogoutEverywhere(): void {
    confirmation.ask({
      title: 'Déconnexion de tous les appareils',
      message:
        'Toutes vos sessions seront fermées, y compris celle en cours sur cet appareil.',
      detail: 'Vous devrez vous reconnecter avec votre mot de passe.',
      confirmLabel: 'Tout déconnecter',
      onConfirm: async () => {
        await apiPost('/api/auth/logout-all', {});
        router.push('/connexion');
        router.refresh();
      },
    });
  }

  async function exportData(): Promise<void> {
    setBusy('export');
    setError(null);
    try {
      // Téléchargement via un lien : la réponse est un fichier, pas du JSON d'API.
      window.location.href = '/api/account/export';
      setMessage('Export en cours de téléchargement…');
    } finally {
      setTimeout(() => setBusy(null), 1500);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('delete');
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      await apiFetch('/api/account', {
        method: 'DELETE',
        body: JSON.stringify({
          password: String(form.get('password') ?? ''),
          confirmation: String(form.get('confirmation') ?? ''),
        }),
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      report(err);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* Informations personnelles */}
      <Card>
        <CardHeader title="Informations personnelles" />
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="firstName" required>
              <Input id="firstName" name="firstName" defaultValue={user.firstName} required />
            </Field>
            <Field label="Nom" htmlFor="lastName" required>
              <Input id="lastName" name="lastName" defaultValue={user.lastName} required />
            </Field>
            <Field
              label="Adresse e-mail"
              htmlFor="email"
              // Un champ grisé sans explication laisse chercher. Celui-ci dit
              // maintenant où se fait la modification, plus bas sur la page.
              hint={
                (user.emailVerifiedAt
                  ? `Vérifiée le ${formatDateFr(user.emailVerifiedAt)}. `
                  : 'Non vérifiée. ') + 'Se modifie plus bas, section « Adresse e-mail ».'
              }
            >
              <Input id="email" value={user.email} disabled />
            </Field>
            <Field label="Téléphone" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ''} />
            </Field>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy === 'profile'}>
              {busy === 'profile' ? <Spinner /> : null}
              Enregistrer
            </Button>
          </div>
        </form>
      </Card>

      {/* Préférences */}
      <Card>
        <CardHeader
          title="Préférences"
          description="Unités et langue : le système métrique et le français sont les seuls réglages disponibles pour l'instant."
        />
        <form onSubmit={savePreferences} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Système d'unités" htmlFor="unitSystem">
              <Select id="unitSystem" defaultValue={user.unitSystem} disabled>
                <option value="metric">Métrique (ha, kg, L)</option>
              </Select>
            </Field>
            <Field label="Langue" htmlFor="locale">
              <Select id="locale" defaultValue={user.locale} disabled>
                <option value="fr">Français</option>
              </Select>
            </Field>
            <Field
              label="Fournisseur météo"
              htmlFor="weatherProvider"
              hint="OpenWeatherMap nécessite une clé WEATHER_API_KEY côté serveur."
            >
              <Select
                id="weatherProvider"
                name="weatherProvider"
                defaultValue={user.weatherProvider ?? 'open-meteo'}
              >
                <option value="open-meteo">Open-Meteo (sans clé)</option>
                <option value="openweathermap">OpenWeatherMap</option>
              </Select>
            </Field>
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="notifyByEmail"
              defaultChecked={user.notifyByEmail}
              className="mt-0.5 h-5 w-5 rounded border-line-strong text-champ-600 focus:ring-champ-500 sm:h-4 sm:w-4"
            />
            <span>
              <span className="font-medium text-ink">Notifications par e-mail</span>
              <span className="block text-xs text-ink-3">
                Rappels d&apos;intervention, alertes de registre et alertes de sécurité.
              </span>
            </span>
          </label>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy === 'preferences'}>
              {busy === 'preferences' ? <Spinner /> : null}
              Enregistrer les préférences
            </Button>
          </div>
        </form>
      </Card>

      {/* Sécurité */}
      <EmailChangeCard email={user.email} />

      <Card>
        <CardHeader
          title="Changer de mot de passe"
          description="Vos autres appareils seront déconnectés."
        />
        <form onSubmit={changePassword} className="space-y-4">
          <Field label="Mot de passe actuel" htmlFor="currentPassword" required>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nouveau mot de passe"
              htmlFor="newPassword"
              required
              hint="10 caractères minimum, majuscule, minuscule et chiffre."
            >
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Confirmation" htmlFor="newPasswordConfirmation" required>
              <Input
                id="newPasswordConfirmation"
                name="newPasswordConfirmation"
                type="password"
                autoComplete="new-password"
                required
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy === 'password'}>
              {busy === 'password' ? <Spinner /> : null}
              Changer le mot de passe
            </Button>
          </div>
        </form>
      </Card>

      {/* Sessions */}
      <Card>
        <CardHeader
          title="Sessions actives"
          description={`${sessions.length} appareil(s) connecté(s)`}
          action={
            <Button
              variant="outline"
              onClick={askLogoutEverywhere}
            >
              Déconnexion de tous les appareils
            </Button>
          }
        />
        <ul className="divide-y divide-line">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {describeAgent(session.userAgent)}
                  {session.current ? (
                    <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-champ-800 dark:text-champ-300">
                      Session actuelle
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-ink-3">
                  {session.ipAddress ?? 'IP inconnue'} · dernière activité le{' '}
                  {formatDateFr(session.lastUsedAt)}
                </p>
              </div>

              {!session.current ? (
                <button
                  type="button"
                  onClick={() => void revokeSession(session.id)}
                  disabled={busy === session.id}
                  className="-my-2 shrink-0 px-2 py-2 text-sm text-brique-500 hover:underline min-h-11 sm:min-h-0 sm:px-0"
                >
                  Révoquer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {/* RGPD */}
      <Card>
        <CardHeader
          title="Vos données personnelles"
          description="Conformément au RGPD, vous pouvez exporter ou supprimer vos données à tout moment."
        />
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            icon={IconExport}
            onClick={() => void exportData()}
            loading={busy === 'export'}
          >
            Exporter mes données (JSON)
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            Supprimer mon compte
          </Button>
        </div>
      </Card>

      <ConfirmDialog request={confirmation.request} onClose={confirmation.close} />

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Supprimer définitivement mon compte"
      >
        <form onSubmit={deleteAccount} className="space-y-4">
          <Alert tone="danger" title="Cette action est irréversible">
            Vos exploitations dont vous êtes le seul membre seront supprimées avec toutes
            leurs parcelles, interventions et documents. Les exploitations partagées avec
            d&apos;autres utilisateurs seront conservées : seule votre appartenance sera
            retirée. Exportez vos données avant de continuer.
          </Alert>

          <Field label="Votre mot de passe" htmlFor="password" required>
            <Input id="password" name="password" type="password" required />
          </Field>

          <Field
            label="Confirmation"
            htmlFor="confirmation"
            required
            hint="Saisissez SUPPRIMER en majuscules."
          >
            <Input id="confirmation" name="confirmation" required placeholder="SUPPRIMER" />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" variant="danger" disabled={busy === 'delete'}>
              {busy === 'delete' ? <Spinner /> : null}
              Supprimer définitivement
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
