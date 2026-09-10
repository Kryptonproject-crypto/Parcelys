'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiDelete, apiPost, ApiRequestError } from '@/lib/client/api';
import type { AdminExpertRow, AdminFarmOption } from '@/lib/admin/shared';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  formatDateFr,
} from '@/components/ui';
import { IconCheck, IconDelete, IconPlus, IconUsers } from '@/components/ui/icons';

/**
 * Rattachement des experts agronomiques aux exploitations.
 *
 * Un expert n'a pas d'exploitation à lui : il suit celles qui lui ont ouvert
 * l'accès. Cet écran donne à l'administrateur d'instance la vue d'ensemble qui
 * manquait — qui suit quoi — et permet d'ouvrir ou de retirer un accès sans
 * passer par chaque exploitation.
 *
 * Ouvrir un accès depuis ici court-circuite le consentement de l'exploitation.
 * C'est assumé pour un administrateur qui gère les deux côtés, mais l'écran le
 * dit, l'exploitation reçoit une notification, et le journal d'audit distingue
 * ces rattachements de ceux décidés par l'exploitation elle-même.
 */
export function ExpertsPanel({
  experts,
  farms,
}: {
  experts: AdminExpertRow[];
  farms: AdminFarmOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [expertId, setExpertId] = useState('');
  const [farmIds, setFarmIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErreur, setInviteErreur] = useState<string | null>(null);
  const [codeDelivre, setCodeDelivre] = useState<string | null>(null);

  const selectable = useMemo(
    () => experts.filter((expert) => !expert.suspended),
    [experts],
  );

  // Une exploitation déjà suivie par l'expert choisi n'a pas à figurer dans la
  // liste : la proposer ne mènerait qu'à un refus « il la suit déjà ».
  const assignableFarms = useMemo(() => {
    const current = experts.find((expert) => expert.id === expertId);
    if (!current) return farms;
    const active = new Set(
      current.engagements.filter((e) => e.status === 'ACTIVE').map((e) => e.farmId),
    );
    return farms.filter((farm) => !active.has(farm.id));
  }, [experts, expertId, farms]);

  async function grant(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!expertId || farmIds.length === 0) {
      setError('Choisissez un expert et au moins une exploitation.');
      return;
    }

    setBusy(true);
    // Une ouverture par exploitation : chacune est un accès distinct, notifiée
    // à son exploitant et inscrite au journal. Un échec sur l'une ne doit pas
    // annuler les autres — on rapporte donc ce qui a réussi et ce qui a échoué.
    const echecs: string[] = [];
    let ouvertes = 0;
    for (const id of farmIds) {
      try {
        await apiPost<{ message: string }>('/api/admin/experts', {
          expertId,
          farmId: id,
          note,
        });
        ouvertes += 1;
      } catch (cause) {
        const nom = farms.find((f) => f.id === id)?.name ?? id;
        echecs.push(
          `${nom} : ${cause instanceof ApiRequestError ? cause.message : 'échec'}`,
        );
      }
    }
    setBusy(false);

    if (ouvertes > 0) {
      toast.success(
        `${ouvertes} exploitation(s) confiée(s). L'exploitant en est averti.`,
      );
      setFarmIds([]);
      setNote('');
      router.refresh();
    }
    if (echecs.length > 0) setError(echecs.join(' — '));
  }

  function askRevoke(engagementId: string, expertName: string, farmName: string): void {
    confirm.ask({
      title: "Retirer l'accès ?",
      message: `${expertName} n'aura plus accès aux parcelles ni aux registres de « ${farmName} ».`,
      detail:
        "Les préconisations déjà transmises sont conservées : elles font partie de " +
        "l'historique de l'exploitation.",
      confirmLabel: "Retirer l'accès",
      onConfirm: async () => {
        const response = await apiDelete<{ message: string }>('/api/admin/experts', {
          engagementId,
        });
        toast.success(response.message);
        router.refresh();
      },
    });
  }

  async function inviterExpert(event: FormEvent) {
    event.preventDefault();
    setInviteErreur(null);
    setInviteBusy(true);
    try {
      const reponse = await apiPost<{ code: string; expiresAt: string }>(
        '/api/admin/invitations',
        {
          accountType: 'AGRONOMIST',
          email: inviteEmail,
          note: inviteNote,
          validityDays: 14,
        },
      );
      // Le code n'existe qu'une fois : la base n'en garde que l'empreinte.
      setCodeDelivre(reponse.code);
      setInviteEmail('');
      setInviteNote('');
      router.refresh();
    } catch (cause) {
      setInviteErreur(
        cause instanceof ApiRequestError ? cause.message : "Le code n'a pas pu être créé.",
      );
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Code fraîchement délivré */}
      {codeDelivre ? (
        <Card className="border-champ-500/40 bg-champ-50/60 dark:bg-champ-900/25">
          <CardHeader
            icon={IconCheck}
            title="Code d’inscription expert — notez-le maintenant"
            description="Il n’est affiché qu’une fois : seule son empreinte est conservée."
          />
          <div className="flex flex-wrap items-center gap-3">
            <code className="select-all rounded-lg border border-line bg-surface px-4 py-2.5 font-mono text-[17px] font-semibold tracking-[0.12em] text-ink">
              {codeDelivre}
            </code>
            <Button variant="ghost" onClick={() => setCodeDelivre(null)}>
              J&apos;ai noté le code
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-2">
            Transmettez-le par un canal sûr. L’expert crée son compte sur
            <strong> /inscription</strong>, puis vous lui confiez des exploitations
            ci-dessous.
          </p>
        </Card>
      ) : null}

      {/* Inviter un expert */}
      <Card>
        <CardHeader
          icon={IconPlus}
          title="Inviter un expert agronomique"
          description="Délivre un code d’inscription. Le compte créé n’aura aucune exploitation : c’est vous qui les lui confierez."
        />
        <form onSubmit={inviterExpert} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Adresse e-mail"
              htmlFor="invite-email"
              hint="Facultatif. Renseignée, le code ne pourra servir qu’à cette adresse."
            >
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="expert@cabinet-agro.fr"
              />
            </Field>
            <Field label="Note interne" htmlFor="invite-note">
              <Input
                id="invite-note"
                value={inviteNote}
                onChange={(event) => setInviteNote(event.target.value)}
                maxLength={200}
                placeholder="Cabinet Agro — suivi céréales"
              />
            </Field>
          </div>
          {inviteErreur ? <Alert tone="danger">{inviteErreur}</Alert> : null}
          <Button type="submit" loading={inviteBusy} disabled={inviteBusy}>
            Délivrer un code d’inscription
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader
          icon={IconPlus}
          title="Confier une exploitation à un expert"
          description="L'expert accède aux parcelles, aux registres et peut transmettre des préconisations."
        />

        <form onSubmit={grant} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expert agronomique" required>
              <Select
                value={expertId}
                onChange={(event) => {
                  setExpertId(event.target.value);
                  setFarmIds([]);
                }}
              >
                <option value="">Choisir un expert…</option>
                {/*
                  L'adresse figure toujours : deux experts peuvent porter le
                  même nom, et la structure de rattachement n'est pas
                  obligatoire. Sans elle, le choix se ferait à l'aveugle.
                */}
                {selectable.map((expert) => (
                  <option key={expert.id} value={expert.id}>
                    {expert.lastName} {expert.firstName}
                    {expert.organization ? ` — ${expert.organization}` : ''}
                    {` (${expert.email})`}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Exploitations suivies"
              hint="Un expert peut en suivre plusieurs : cochez-les toutes."
            >
              {!expertId ? (
                <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-3">
                  Choisissez d&apos;abord un expert.
                </p>
              ) : assignableFarms.length === 0 ? (
                <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-3">
                  Cet expert suit déjà toutes les exploitations.
                </p>
              ) : (
                <ul className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                  {assignableFarms.map((farm) => (
                    <li key={farm.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2 sm:min-h-0">
                        <Checkbox
                          checked={farmIds.includes(farm.id)}
                          onChange={(event) =>
                            setFarmIds((actuels) =>
                              event.target.checked
                                ? [...actuels, farm.id]
                                : actuels.filter((id) => id !== farm.id),
                            )
                          }
                        />
                        <span>{farm.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          </div>

          <Field label="Note interne" hint="Objet de la mission, par exemple. Visible des administrateurs seuls.">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="Suivi fongicide céréales 2026"
            />
          </Field>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Alert tone="info">
            L&apos;exploitation sera prévenue de cette ouverture d&apos;accès et pourra y
            mettre fin elle-même. La voie ordinaire reste qu&apos;elle délivre son propre
            code depuis « Paramètres → Experts agronomiques ».
          </Alert>

          <Button type="submit" disabled={busy || selectable.length === 0}>
            {busy
              ? 'Ouverture…'
              : farmIds.length > 1
                ? `Confier ${farmIds.length} exploitations`
                : "Confier l'exploitation"}
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader
          icon={IconUsers}
          title="Experts agronomiques"
          description={`${experts.length} compte(s) expert.`}
        />

        {experts.length === 0 ? (
          <EmptyState
            icon={IconUsers}
            title="Aucun compte expert"
            description="Invitez un expert depuis « Invitations » en choisissant le type de compte « Expert agronomique »."
          />
        ) : (
          <ul className="space-y-4">
            {experts.map((expert) => {
              const active = expert.engagements.filter((e) => e.status === 'ACTIVE');
              return (
                <li
                  key={expert.id}
                  className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {expert.firstName} {expert.lastName}
                      </p>
                      <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                        {expert.email}
                        {expert.organization ? ` · ${expert.organization}` : ''}
                      </p>
                      {expert.advisorCertificate ? (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Certiphyto conseil : {expert.advisorCertificate}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                          Aucun numéro de certificat renseigné
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {expert.suspended ? <Badge tone="red">Suspendu</Badge> : null}
                      {!expert.emailVerified ? (
                        <Badge tone="amber">E-mail non vérifié</Badge>
                      ) : null}
                      <Badge tone={active.length > 0 ? 'green' : 'neutral'}>
                        {active.length} exploitation{active.length > 1 ? 's' : ''}
                      </Badge>
                    </div>
                  </div>

                  {active.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {active.map((engagement) => (
                        <li
                          key={engagement.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-800/60"
                        >
                          <span className="min-w-0 text-sm">
                            <span className="font-medium">{engagement.farmName}</span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {' '}
                              · depuis le {formatDateFr(engagement.startedAt)}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={IconDelete}
                            onClick={() =>
                              askRevoke(
                                engagement.id,
                                `${expert.firstName} ${expert.lastName}`,
                                engagement.farmName,
                              )
                            }
                          >
                            Retirer
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                      Ne suit aucune exploitation pour le moment.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
