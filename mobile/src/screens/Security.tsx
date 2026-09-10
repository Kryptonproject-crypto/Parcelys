import { useEffect, useState } from 'react';
import type { AppContext } from '../App';
import {
  ApiError,
  OfflineError,
  cancelEmailChange,
  changePassword,
  confirmEmailChange,
  fetchEmailChange,
  requestEmailChange,
} from '../lib/api';
import { Banner, Button, Card, Field, Header, Input } from '../components/ui';

/**
 * Compte et sécurité, au champ.
 *
 * Deux opérations que l'application ne savait pas faire, et pour lesquelles il
 * fallait jusqu'ici ouvrir un ordinateur : changer d'adresse e-mail, changer de
 * mot de passe. Ce sont les mêmes routes que le web — mêmes règles, mêmes
 * délais, mêmes messages.
 *
 * Rien de tout cela ne fonctionne hors connexion, et c'est délibéré : un
 * changement d'identifiant mis en file d'attente serait appliqué plus tard, à
 * un moment que l'utilisateur ne choisit pas, sans qu'il puisse lire le code
 * qu'on lui a envoyé entre-temps. L'écran le dit plutôt que de faire semblant.
 */
export function SecurityScreen({ context }: { context: AppContext }) {
  const { back, session, online } = context;

  const [pending, setPending] = useState<{ newEmail: string } | null>(null);
  const [adresseCourante, setAdresseCourante] = useState(session.email);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const [nouvelleAdresse, setNouvelleAdresse] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [renvoiDans, setRenvoiDans] = useState(0);

  const [ancienMdp, setAncienMdp] = useState('');
  const [nouveauMdp, setNouveauMdp] = useState('');

  function rapporter(cause: unknown): void {
    setMessage(null);
    if (cause instanceof OfflineError) {
      setErreur('Pas de réseau. Ces opérations demandent une connexion.');
      return;
    }
    setErreur(cause instanceof ApiError ? cause.message : 'Une erreur est survenue.');
  }

  // Une demande peut être en cours depuis une autre session : on la relit.
  useEffect(() => {
    if (!online) return;
    let vivant = true;
    void fetchEmailChange(session)
      .then((etat) => {
        if (!vivant) return;
        setAdresseCourante(etat.email);
        setPending(etat.pending ? { newEmail: etat.pending.newEmail } : null);
      })
      .catch(() => {
        // Silencieux : on le saura au premier envoi.
      });
    return () => {
      vivant = false;
    };
  }, [session, online]);

  useEffect(() => {
    if (renvoiDans <= 0) return;
    const t = setTimeout(() => setRenvoiDans((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoiDans]);

  async function demander(): Promise<void> {
    setBusy('demande');
    setErreur(null);
    setMessage(null);
    try {
      const res = await requestEmailChange(session, nouvelleAdresse.trim(), motDePasse);
      setPending({ newEmail: res.newEmail });
      setRenvoiDans(res.resendInSeconds);
      setMessage(res.message);
    } catch (cause) {
      rapporter(cause);
    } finally {
      setBusy(null);
    }
  }

  async function renvoyer(): Promise<void> {
    setBusy('renvoi');
    setErreur(null);
    try {
      const res = await requestEmailChange(session, nouvelleAdresse.trim(), motDePasse);
      setRenvoiDans(res.resendInSeconds);
      setMessage(res.message);
    } catch (cause) {
      rapporter(cause);
    } finally {
      setBusy(null);
    }
  }

  async function confirmer(): Promise<void> {
    setBusy('confirmation');
    setErreur(null);
    setMessage(null);
    try {
      const res = await confirmEmailChange(session, code.trim());
      setAdresseCourante(res.email);
      setPending(null);
      setNouvelleAdresse('');
      setMotDePasse('');
      setCode('');
      setMessage(
        `${res.message} Reconnectez-vous avec ${res.email} lors de la prochaine ouverture.`,
      );
    } catch (cause) {
      rapporter(cause);
    } finally {
      setBusy(null);
    }
  }

  async function abandonner(): Promise<void> {
    setBusy('abandon');
    setErreur(null);
    try {
      await cancelEmailChange(session);
      setPending(null);
      setCode('');
      setMessage('Demande annulée. Votre adresse n’a pas changé.');
    } catch (cause) {
      rapporter(cause);
    } finally {
      setBusy(null);
    }
  }

  async function changerMotDePasse(): Promise<void> {
    setBusy('mdp');
    setErreur(null);
    setMessage(null);
    try {
      const res = await changePassword(session, ancienMdp, nouveauMdp);
      setAncienMdp('');
      setNouveauMdp('');
      setMessage(res.message);
    } catch (cause) {
      rapporter(cause);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header title="Compte et sécurité" onBack={back} />

      <div className="flex-1 space-y-4 px-4 py-4">
        {!online ? (
          <Banner tone="warning">
            Hors connexion. Changer d’adresse ou de mot de passe demande le réseau : ces
            opérations ne se mettent pas en file d’attente, elles s’appliqueraient plus tard,
            à un moment que vous ne choisiriez pas.
          </Banner>
        ) : null}

        {message ? <Banner tone="success">{message}</Banner> : null}
        {erreur ? <Banner tone="danger">{erreur}</Banner> : null}

        {/* ---- Adresse e-mail ---- */}
        <Card>
          <p className="font-semibold text-ink">Adresse e-mail</p>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-3">
            C’est votre identifiant de connexion. Elle ne changera qu’une fois le code saisi.
          </p>
          <p className="mt-2 break-all text-[13.5px] text-ink">{adresseCourante}</p>

          {!pending ? (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <Field label="Nouvelle adresse">
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={nouvelleAdresse}
                  onChange={(e) => setNouvelleAdresse(e.target.value)}
                  placeholder="nouvelle@exemple.fr"
                />
              </Field>
              <Field
                label="Votre mot de passe"
                hint="Redemandé : une session ouverte ne prouve pas que c’est bien vous."
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                />
              </Field>
              <Button
                full
                loading={busy === 'demande'}
                disabled={!online || !nouvelleAdresse.trim() || !motDePasse}
                onClick={() => void demander()}
              >
                Envoyer le code
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <Banner tone="info">
                Code envoyé à <strong>{pending.newEmail}</strong>. Vous restez connecté avec{' '}
                <strong>{adresseCourante}</strong> tant qu’il n’est pas saisi.
              </Banner>
              <Field label="Code reçu">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
              <Button
                full
                loading={busy === 'confirmation'}
                disabled={!online || code.length !== 6}
                onClick={() => void confirmer()}
              >
                Confirmer la nouvelle adresse
              </Button>
              <Button
                variant="secondary"
                full
                loading={busy === 'renvoi'}
                disabled={!online || renvoiDans > 0 || !motDePasse}
                onClick={() => void renvoyer()}
              >
                {renvoiDans > 0 ? `Renvoyer dans ${renvoiDans} s` : 'Renvoyer le code'}
              </Button>
              <Button
                variant="secondary"
                full
                loading={busy === 'abandon'}
                disabled={!online}
                onClick={() => void abandonner()}
              >
                Abandonner la demande
              </Button>
            </div>
          )}
        </Card>

        {/* ---- Mot de passe ---- */}
        <Card>
          <p className="font-semibold text-ink">Mot de passe</p>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-3">
            Vos autres appareils seront déconnectés. Celui-ci reste connecté.
          </p>

          <div className="mt-3 space-y-3 border-t border-line pt-3">
            <Field label="Mot de passe actuel">
              <Input
                type="password"
                autoComplete="current-password"
                value={ancienMdp}
                onChange={(e) => setAncienMdp(e.target.value)}
              />
            </Field>
            <Field
              label="Nouveau mot de passe"
              hint="10 caractères minimum, majuscule, minuscule et chiffre."
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={nouveauMdp}
                onChange={(e) => setNouveauMdp(e.target.value)}
              />
            </Field>
            <Button
              full
              loading={busy === 'mdp'}
              disabled={!online || !ancienMdp || !nouveauMdp}
              onClick={() => void changerMotDePasse()}
            >
              Changer le mot de passe
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
