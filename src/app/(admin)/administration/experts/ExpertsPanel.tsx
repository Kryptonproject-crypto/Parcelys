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
  EmptyState,
  Field,
  Input,
  Select,
  formatDateFr,
} from '@/components/ui';
import { IconDelete, IconPlus, IconUsers } from '@/components/ui/icons';

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
  const [farmId, setFarmId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    if (!expertId || !farmId) {
      setError('Choisissez un expert et une exploitation.');
      return;
    }

    setBusy(true);
    try {
      const response = await apiPost<{ message: string }>('/api/admin/experts', {
        expertId,
        farmId,
        note,
      });
      toast.success(response.message);
      setFarmId('');
      setNote('');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError ? cause.message : "L'accès n'a pas pu être ouvert.",
      );
    } finally {
      setBusy(false);
    }
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

  return (
    <div className="space-y-6">
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
                  setFarmId('');
                }}
              >
                <option value="">Choisir un expert…</option>
                {selectable.map((expert) => (
                  <option key={expert.id} value={expert.id}>
                    {expert.lastName} {expert.firstName}
                    {expert.organization ? ` — ${expert.organization}` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Exploitation suivie" required>
              <Select
                value={farmId}
                onChange={(event) => setFarmId(event.target.value)}
                disabled={!expertId}
              >
                <option value="">
                  {expertId ? 'Choisir une exploitation…' : "Choisissez d'abord un expert"}
                </option>
                {assignableFarms.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.name}
                  </option>
                ))}
              </Select>
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
            {busy ? 'Ouverture…' : "Ouvrir l'accès"}
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader
          icon={IconUsers}
          title="Experts agronomiques"
          description={`${experts.length} compte(s) expert sur cette instance.`}
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
