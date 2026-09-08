import { useEffect, useState, type FormEvent } from 'react';
import { Device } from '@capacitor/device';
import { login, ApiError, OfflineError } from '../lib/api';
import { loadServerUrl, normalizeServerUrl, saveServerUrl } from '../lib/storage';
import type { AccountType, Session } from '../lib/types';
import { Banner, Button, Field, Input, cn } from '../components/ui';

/**
 * Connexion.
 *
 * Parcelys s'auto-héberge : chaque exploitation a sa propre instance, et
 * l'application ne peut donc pas connaître l'adresse du serveur à l'avance.
 * Elle est demandée une fois, puis conservée.
 *
 * Deux portes, comme sur l'application web : l'exploitation et l'expert
 * agronomique. Ce n'est qu'une orientation — la porte choisie ne donne aucun
 * droit. C'est le serveur qui dit à quel espace le compte appartient, et
 * l'application s'y range, en le signalant si l'utilisateur s'est trompé.
 *
 * La création de compte est absente à dessein : l'inscription se fait par code
 * d'invitation depuis l'application web, et la dupliquer ici ajouterait une
 * porte d'entrée à surveiller sans rien apporter au travail de terrain.
 */

const SPACES: Array<{
  value: AccountType;
  label: string;
  tagline: string;
}> = [
  {
    value: 'FARMER',
    label: 'Exploitation',
    tagline: 'Relevé de parcelles, traitements et apports — même sans réseau.',
  },
  {
    value: 'AGRONOMIST',
    label: 'Expert agronomique',
    tagline: 'Votre portefeuille de domaines et vos préconisations, au champ.',
  },
];

export function LoginScreen({
  onAuthenticated,
}: {
  onAuthenticated: (session: Session) => Promise<void>;
}) {
  const [space, setSpace] = useState<AccountType>('FARMER');
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const current = SPACES.find((item) => item.value === space) ?? SPACES[0]!;

  useEffect(() => {
    void loadServerUrl().then(setServerUrl);
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const url = normalizeServerUrl(serverUrl);
    if (!url) {
      setFieldErrors({ serverUrl: "Indiquez l'adresse de votre serveur Parcelys." });
      setSubmitting(false);
      return;
    }

    try {
      // Le nom d'appareil apparaît dans la liste des sessions du profil web :
      // on doit pouvoir reconnaître et révoquer un téléphone perdu.
      const info = await Device.getInfo().catch(() => null);
      const deviceName = info
        ? `${info.manufacturer ?? ''} ${info.model ?? ''}`.trim() || 'Téléphone'
        : 'Téléphone';

      const session = await login(url, email, password, deviceName);
      await saveServerUrl(url);

      // Le compte ne correspond pas à la porte choisie : on ouvre le bon
      // espace et on le dit, plutôt que de refuser une connexion valide.
      if (session.accountType !== space) {
        setNotice(
          session.accountType === 'AGRONOMIST'
            ? 'Ce compte est un compte expert agronomique : votre portefeuille s’ouvre.'
            : 'Ce compte est un compte d’exploitation : votre parcellaire s’ouvre.',
        );
      }

      await onAuthenticated(session);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setError(
          "Serveur injoignable. Vérifiez l'adresse et votre connexion — la première connexion nécessite du réseau.",
        );
      } else if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Connexion impossible.');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="safe-top safe-bottom flex min-h-full flex-col justify-center bg-canvas px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <span
            aria-hidden
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-3xl"
          >
            🌾
          </span>
          <h1 className="text-[24px] font-bold tracking-tight text-ink">
            Parcelys au champ
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">
            {current.tagline}
          </p>
        </div>

        {/* Deux portes : l'exploitation et l'expert agronomique. */}
        <div
          role="tablist"
          aria-label="Type de compte"
          className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
        >
          {SPACES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={space === item.value}
              onClick={() => {
                setSpace(item.value);
                setNotice(null);
              }}
              className={cn(
                'min-h-[44px] rounded-lg px-3 text-[14px] font-semibold transition',
                space === item.value
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-ink-3 active:bg-surface',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {notice ? <Banner tone="info">{notice}</Banner> : null}

          <Field
            label="Adresse du serveur"
            required
            hint="Celle de votre instance Parcelys, par exemple parcelys.mon-domaine.fr"
            error={fieldErrors.serverUrl}
          >
            <Input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="parcelys.mon-domaine.fr"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </Field>

          <Field label="Adresse e-mail" required error={fieldErrors.email}>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </Field>

          <Field label="Mot de passe" required error={fieldErrors.password}>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" full loading={submitting}>
            {submitting ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>

        <p className="mt-6 text-center text-[13px] leading-relaxed text-ink-3">
          {space === 'AGRONOMIST'
            ? 'Un compte expert se crée avec un code délivré par un administrateur, depuis l’application web. Les accès à un domaine sont ouverts par l’exploitation elle-même.'
            : 'Pas encore de compte ? Les inscriptions se font sur invitation, depuis l’application web de votre exploitation.'}
        </p>
      </div>
    </div>
  );
}
