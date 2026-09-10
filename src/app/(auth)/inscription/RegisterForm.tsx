'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import {
  CODE_PLACEHOLDER,
  formatInvitationCode,
} from '@/lib/auth/invitations.shared';
import { Alert, Badge, Button, Field, Input } from '@/components/ui';
import { IconInvitation, IconSecurity } from '@/components/ui/icons';

type RegisterResponse = { email: string; message: string };

type InvitationScope = {
  /**
   * `NEW_FARM` : la personne crée son exploitation.
   * `EXISTING_FARM` : elle en rejoint une comme membre.
   * `EXPERT_ACCOUNT` : compte expert agronomique, sans exploitation.
   * `ADMIN_ACCOUNT` : compte d'administration, sans exploitation non plus.
   * `ADVISORY_ACCESS` : le code n'est pas fait pour s'inscrire — il s'active
   * depuis le portefeuille d'un compte expert existant.
   */
  scope:
    | 'NEW_FARM'
    | 'EXISTING_FARM'
    | 'EXPERT_ACCOUNT'
    | 'ADMIN_ACCOUNT'
    | 'ADVISORY_ACCESS';
  accountType?: 'FARMER' | 'AGRONOMIST' | 'ADMIN';
  farmName: string | null;
  role: string;
  roleLabel: string;
  email: string | null;
  grantsPlatformAdmin: boolean;
  expiresAt: string;
};

/**
 * Inscription en deux temps.
 *
 * L'instance est fermée : le code d'invitation est vérifié d'abord, ce qui
 * permet ensuite d'afficher précisément ce qu'il donne — rejoindre une
 * exploitation existante ou en créer une — plutôt que de demander à l'aveugle
 * un nom d'exploitation dont l'invité n'a parfois pas besoin.
 *
 * Le premier compte d'une instance vierge (`bootstrap`) n'a pas de code à
 * fournir : personne ne peut encore lui en délivrer.
 */
export function RegisterForm({ bootstrap }: { bootstrap: boolean }) {
  const router = useRouter();

  const [code, setCode] = useState('');
  const [invitation, setInvitation] = useState<InvitationScope | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isAdvisoryCode = invitation?.scope === 'ADVISORY_ACCESS';
  const isExpertAccount = invitation?.scope === 'EXPERT_ACCOUNT';
  const step = bootstrap || (invitation && !isAdvisoryCode) ? 'account' : 'code';
  const needsFarmName = bootstrap || invitation?.scope === 'NEW_FARM';

  async function checkCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setChecking(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await apiPost<InvitationScope>('/api/auth/invitation/check', {
        code,
      });
      setInvitation(result);
      if (result.scope === 'ADVISORY_ACCESS') {
        setError(
          `Ce code ouvre l'accès conseil à « ${result.farmName ?? 'une exploitation'} ». ` +
            "Il ne crée pas de compte : connectez-vous à votre compte expert, puis activez-le depuis votre portefeuille.",
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Impossible de contacter le serveur. Réessayez.',
      );
    } finally {
      setChecking(false);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      invitationCode: bootstrap ? '' : code,
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      passwordConfirmation: String(form.get('passwordConfirmation') ?? ''),
      farmName: String(form.get('farmName') ?? ''),
      organization: String(form.get('organization') ?? ''),
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
        // Le code a expiré ou vient d'être utilisé : on revient à l'étape 1.
        if (err.code.startsWith('INVITATION')) setInvitation(null);
      } else {
        setError('Impossible de contacter le serveur. Réessayez.');
      }
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------
  // Étape 1 — le code
  // ---------------------------------------------------------------------
  if (step === 'code') {
    return (
      <form onSubmit={checkCode} className="space-y-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Alert tone="info" icon={IconSecurity}>
          Les inscriptions libres sont fermées. Un code délivré par un administrateur
          est nécessaire pour créer un compte.
        </Alert>

        <Field
          label="Code d'invitation"
          htmlFor="code"
          required
          hint="Il vous a été transmis par l'administrateur de votre exploitation."
        >
          <Input
            id="code"
            name="code"
            value={code}
            onChange={(event) => setCode(formatInvitationCode(event.target.value))}
            placeholder={CODE_PLACEHOLDER}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="font-mono tracking-[0.12em]"
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          icon={IconInvitation}
          className="w-full"
          loading={checking}
        >
          Vérifier le code
        </Button>
      </form>
    );
  }

  // ---------------------------------------------------------------------
  // Étape 2 — le compte
  // ---------------------------------------------------------------------
  return (
    <form onSubmit={register} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {bootstrap ? (
        <Alert tone="warning" icon={IconSecurity} title="Premier compte">
          Aucun compte n&apos;existe encore : celui-ci sera administrateur et pourra
          ensuite inviter les autres utilisateurs.
        </Alert>
      ) : invitation ? (
        <div className="rounded-lg border border-champ-500/40 bg-champ-50/70 p-3.5 text-sm dark:bg-champ-900/25">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-ink">Code valide</p>
              <p className="mt-0.5 text-ink-2">
                {invitation.scope === 'EXPERT_ACCOUNT' ? (
                  <>
                    Vous créerez un compte <strong>expert agronomique</strong>.
                    Les exploitations que vous suivez vous remettront ensuite
                    leur propre code d&apos;accès.
                  </>
                ) : invitation.scope === 'ADMIN_ACCOUNT' ? (
                  <>
                    Vous créerez un compte d&apos;<strong>administration</strong>.
                    Il gère les comptes, les experts et les données de référence,
                    et ne suit aucune exploitation.
                  </>
                ) : invitation.scope === 'EXISTING_FARM' ? (
                  <>
                    Vous rejoindrez «&nbsp;{invitation.farmName}&nbsp;» comme{' '}
                    <strong>{invitation.roleLabel.toLowerCase()}</strong>.
                  </>
                ) : (
                  <>
                    Vous créerez votre propre exploitation et en serez{' '}
                    <strong>propriétaire</strong>.
                  </>
                )}
              </p>
              {invitation.grantsPlatformAdmin ? (
                <Badge tone="blue" icon={IconSecurity} className="mt-2">
                  Administrateur
                </Badge>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setInvitation(null)}
              className="shrink-0 text-[12.5px] text-champ-700 underline dark:text-champ-400"
            >
              Changer
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" htmlFor="firstName" required error={fieldErrors.firstName}>
          <Input id="firstName" name="firstName" autoComplete="given-name" required />
        </Field>
        <Field label="Nom" htmlFor="lastName" required error={fieldErrors.lastName}>
          <Input id="lastName" name="lastName" autoComplete="family-name" required />
        </Field>
      </div>

      <Field
        label="Adresse e-mail"
        htmlFor="email"
        required
        error={fieldErrors.email}
        hint={
          invitation?.email
            ? 'Ce code est réservé à l’adresse indiquée ci-dessous.'
            : undefined
        }
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={invitation?.email ?? ''}
          readOnly={Boolean(invitation?.email)}
        />
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

      {isExpertAccount ? (
        <Field
          label="Structure de rattachement"
          htmlFor="organization"
          hint="Coopérative, chambre d'agriculture, cabinet indépendant… Affichée aux exploitations que vous conseillez."
          error={fieldErrors.organization}
        >
          <Input
            id="organization"
            name="organization"
            placeholder="Chambre d'agriculture du Loiret"
          />
        </Field>
      ) : null}

      {needsFarmName ? (
        <>
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
        </>
      ) : null}

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

      <Button type="submit" size="lg" className="w-full" loading={submitting}>
        {submitting ? 'Création…' : 'Créer mon compte'}
      </Button>
    </form>
  );
}
