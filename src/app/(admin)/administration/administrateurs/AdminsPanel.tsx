'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiPatch, apiPost, ApiRequestError } from '@/lib/client/api';
import type { AdminAccount, PendingAdminInvitation } from '@/lib/admin/administrateurs';
import type { AdminPortfolioOption } from '@/lib/admin/shared';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  formatDateFr,
} from '@/components/ui';
import {
  IconAdmins,
  IconCopy,
  IconDelete,
  IconInvitation,
  IconPlus,
  IconPortfolio,
  IconRestore,
  IconSuccess,
  IconSuspend,
} from '@/components/ui/icons';

type Action =
  | { action: 'promote'; portfolioId: string }
  | { action: 'add-portfolio'; portfolioId: string }
  | { action: 'remove-portfolio'; portfolioId: string }
  | { action: 'deactivate'; reason?: string }
  | { action: 'reactivate' }
  | { action: 'revoke' };

/**
 * Gestion des administrateurs secondaires.
 *
 * Toutes les actions passent par `/api/admin/administrateurs/:id`, qui
 * revérifie que l'on est administrateur général. Les gestes qui retirent un
 * accès sont confirmés et nomment la personne concernée.
 */
export function AdminsPanel({
  general,
  secondary,
  withoutRole,
  pending,
  portfolios,
  currentUserId,
}: {
  general: AdminAccount[];
  secondary: AdminAccount[];
  withoutRole: AdminAccount[];
  pending: PendingAdminInvitation[];
  portfolios: AdminPortfolioOption[];
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [ajout, setAjout] = useState<Record<string, string>>({});

  // Invitation
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'existant' | 'nouveau'>(portfolios.length > 0 ? 'existant' : 'nouveau');
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? '');
  const [nouveauNom, setNouveauNom] = useState('');
  const [note, setNote] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErreur, setInviteErreur] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; message: string } | null>(null);

  async function run(admin: AdminAccount, body: Action): Promise<void> {
    setBusy(admin.id);
    try {
      const result = await apiPatch<{ message: string }>(`/api/admin/administrateurs/${admin.id}`, body);
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Action impossible.');
      throw error;
    } finally {
      setBusy(null);
    }
  }

  function demander(admin: AdminAccount, body: Action, titre: string, message: string, detail: string): void {
    confirm.ask({
      title: titre,
      message,
      detail,
      confirmLabel: 'Confirmer',
      onConfirm: () => run(admin, body),
    });
  }

  async function inviter(event: FormEvent): Promise<void> {
    event.preventDefault();
    setInviteErreur(null);
    setInviteBusy(true);
    try {
      const result = await apiPost<{ code: string; message: string }>('/api/admin/administrateurs', {
        email,
        note,
        portfolioId: mode === 'existant' ? portfolioId : '',
        newPortfolioName: mode === 'nouveau' ? nouveauNom : '',
      });
      setCode({ code: result.code, message: result.message });
      setEmail('');
      setNote('');
      setNouveauNom('');
      router.refresh();
    } catch (error) {
      setInviteErreur(error instanceof ApiRequestError ? error.message : 'Le code n’a pas pu être créé.');
    } finally {
      setInviteBusy(false);
    }
  }

  const ligne = (admin: AdminAccount, children: React.ReactNode, badges?: React.ReactNode) => (
    <li key={admin.id} className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {admin.firstName} {admin.lastName}
            {admin.id === currentUserId ? <span className="ml-1.5 text-[12.5px] text-ink-3">(vous)</span> : null}
          </p>
          <p className="break-all text-[13px] text-ink-3">{admin.email}</p>
          <p className="text-[12.5px] text-ink-3">
            Dernière connexion : {admin.lastLoginAt ? formatDateFr(admin.lastLoginAt) : 'jamais'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {admin.suspended ? <Badge tone="red">Désactivé</Badge> : <Badge tone="green">Actif</Badge>}
          {badges}
        </div>
      </div>
      {children}
    </li>
  );

  return (
    <div className="space-y-6">
      {code ? (
        <Card className="border-champ-500/40 bg-champ-50/60 dark:bg-champ-900/25">
          <CardHeader icon={IconSuccess} title="Code créé — notez-le maintenant" description={code.message} />
          <div className="flex flex-wrap items-center gap-3">
            <code className="select-all rounded-lg border border-line bg-surface px-4 py-2.5 font-mono text-[17px] font-semibold tracking-[0.12em] text-ink">
              {code.code}
            </code>
            <Button
              variant="outline"
              icon={IconCopy}
              onClick={() => void navigator.clipboard?.writeText(code.code).then(() => toast.success('Code copié.'))}
            >
              Copier
            </Button>
            <Button variant="ghost" onClick={() => setCode(null)}>
              J&apos;ai noté le code
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          icon={IconPlus}
          title="Inviter un administrateur secondaire"
          description="La personne crée son compte avec ce code ; elle gérera le portefeuille choisi, et lui seul."
        />
        <form onSubmit={inviter} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Portefeuille" required>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === 'existant'}
                    onChange={() => setMode('existant')}
                    disabled={portfolios.length === 0}
                  />
                  Existant
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="mode" checked={mode === 'nouveau'} onChange={() => setMode('nouveau')} />
                  Nouveau
                </label>
              </div>
              {mode === 'existant' ? (
                <Select
                  className="mt-2"
                  value={portfolioId}
                  onChange={(event) => setPortfolioId(event.target.value)}
                  aria-label="Portefeuille existant"
                >
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  className="mt-2"
                  value={nouveauNom}
                  onChange={(event) => setNouveauNom(event.target.value)}
                  placeholder="Nord Allier"
                  aria-label="Nom du nouveau portefeuille"
                  maxLength={80}
                />
              )}
            </Field>
            <Field label="Réserver à une adresse e-mail" hint="Facultatif — recommandé pour un code d’administration.">
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Note interne">
            <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
          </Field>
          {inviteErreur ? <Alert tone="danger">{inviteErreur}</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" icon={IconInvitation} loading={inviteBusy}>
              Créer le code
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          icon={IconAdmins}
          title="Administrateurs secondaires"
          description={`${secondary.length} compte(s). Chacun ne voit que ses portefeuilles.`}
        />
        {secondary.length === 0 ? (
          <EmptyState icon={IconAdmins} title="Aucun administrateur secondaire" description="Invitez-en un ci-dessus." />
        ) : (
          <ul className="space-y-3">
            {secondary.map((admin) =>
              ligne(
                admin,
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      Périmètre
                    </p>
                    {admin.portfolios.length === 0 ? (
                      <p className="text-sm text-brique-600 dark:text-brique-300">
                        Aucun portefeuille : il ne voit aucun client.
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {admin.portfolios.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-[13px]"
                          >
                            <IconPortfolio size={14} aria-hidden className="text-ink-3" />
                            {p.name}
                            <button
                              type="button"
                              className="rounded p-1 text-ink-3 hover:bg-line hover:text-ink"
                              aria-label={`Retirer le portefeuille ${p.name}`}
                              disabled={busy === admin.id}
                              onClick={() =>
                                demander(
                                  admin,
                                  { action: 'remove-portfolio', portfolioId: p.id },
                                  'Retirer ce portefeuille ?',
                                  `${admin.firstName} ${admin.lastName} ne verra plus les clients de « ${p.name} ».`,
                                  'Les demandes qui lui étaient attribuées dans ce portefeuille repassent sans responsable.',
                                )
                              }
                            >
                              <IconDelete size={13} aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={ajout[admin.id] ?? ''}
                      onChange={(event) => setAjout({ ...ajout, [admin.id]: event.target.value })}
                      aria-label="Portefeuille à ajouter"
                      className="sm:w-56"
                    >
                      <option value="">Ajouter un portefeuille…</option>
                      {portfolios
                        .filter((p) => !admin.portfolios.some((a) => a.id === p.id))
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={IconPlus}
                      disabled={!ajout[admin.id] || busy === admin.id}
                      onClick={() =>
                        void run(admin, { action: 'add-portfolio', portfolioId: ajout[admin.id] ?? '' }).catch(() => undefined)
                      }
                    >
                      Ajouter
                    </Button>
                    <span className="flex-1" />
                    {admin.suspended ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={IconRestore}
                        disabled={busy === admin.id}
                        onClick={() => void run(admin, { action: 'reactivate' }).catch(() => undefined)}
                      >
                        Réactiver
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={IconSuspend}
                        disabled={busy === admin.id}
                        onClick={() =>
                          demander(
                            admin,
                            { action: 'deactivate' },
                            'Désactiver cet administrateur ?',
                            `${admin.firstName} ${admin.lastName} ne pourra plus se connecter ; ses sessions sont fermées.`,
                            'Son périmètre est conservé : la réactivation le lui rend tel quel.',
                          )
                        }
                      >
                        Désactiver
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={IconDelete}
                      disabled={busy === admin.id}
                      className="text-brique-600 hover:bg-brique-50 dark:text-brique-300 dark:hover:bg-brique-700/20"
                      onClick={() =>
                        demander(
                          admin,
                          { action: 'revoke' },
                          'Révoquer ses accès d’administration ?',
                          `${admin.firstName} ${admin.lastName} perd son rôle et tous ses portefeuilles ; ses sessions sont fermées.`,
                          'Le compte subsiste, sans aucun droit. Les clients restent dans leurs portefeuilles.',
                        )
                      }
                    >
                      Révoquer
                    </Button>
                  </div>
                </div>,
                <Badge tone="amber">Secondaire</Badge>,
              ),
            )}
          </ul>
        )}
      </Card>

      {pending.length > 0 ? (
        <Card>
          <CardHeader
            icon={IconInvitation}
            title="Invitations en attente"
            description="Codes d'administrateur secondaire non encore utilisés. Révocables depuis « Invitations »."
          />
          <ul className="divide-y divide-line text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-mono text-[13px] text-ink">{p.codeHint}-••••-••••</span>
                <span className="text-[12.5px] text-ink-3">
                  {p.portfolioName ?? '—'} · {p.email ?? 'toute adresse'} · jusqu&apos;au {formatDateFr(p.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {withoutRole.length > 0 ? (
        <Card>
          <CardHeader
            icon={IconAdmins}
            title="Comptes d'administration sans rôle"
            description="Un secondaire révoqué, par exemple. On peut lui confier à nouveau un portefeuille."
          />
          <ul className="space-y-3">
            {withoutRole.map((admin) =>
              ligne(
                admin,
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Select
                    value={ajout[admin.id] ?? ''}
                    onChange={(event) => setAjout({ ...ajout, [admin.id]: event.target.value })}
                    aria-label="Portefeuille à confier"
                    className="sm:w-56"
                  >
                    <option value="">Choisir un portefeuille…</option>
                    {portfolios.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ajout[admin.id] || busy === admin.id}
                    onClick={() =>
                      void run(admin, { action: 'promote', portfolioId: ajout[admin.id] ?? '' }).catch(() => undefined)
                    }
                  >
                    Nommer administrateur secondaire
                  </Button>
                </div>,
                <Badge tone="neutral">Sans rôle</Badge>,
              ),
            )}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          icon={IconAdmins}
          title="Administrateurs généraux"
          description="Tout Parcelys. On les nomme ou les retire depuis « Comptes »."
        />
        <ul className="space-y-3">
          {general.map((admin) => ligne(admin, null, <Badge tone="blue">Général</Badge>))}
        </ul>
      </Card>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
