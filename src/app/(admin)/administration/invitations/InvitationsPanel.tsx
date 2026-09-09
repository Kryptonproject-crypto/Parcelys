'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiDelete, apiPost, ApiRequestError } from '@/lib/client/api';
import type { AdminFarmOption, AdminInvitationRow } from '@/lib/admin/shared';
import {
  DEFAULT_VALIDITY_DAYS,
  INVITATION_STATUS_LABELS,
  MAX_VALIDITY_DAYS,
  type InvitationStatus,
} from '@/lib/auth/invitations.shared';
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
  TableWrapper,
  Td,
  Th,
  Tr,
  formatDateFr,
} from '@/components/ui';
import {
  IconCopy,
  IconDelete,
  IconInvitation,
  IconPlus,
  IconSecurity,
  IconSuccess,
} from '@/components/ui/icons';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EMPLOYEE: 'Salarié',
  VIEWER: 'Lecture seule',
};

const STATUS_TONES: Record<InvitationStatus, 'green' | 'neutral' | 'red' | 'amber'> = {
  ACTIVE: 'green',
  USED: 'neutral',
  REVOKED: 'red',
  EXPIRED: 'amber',
};

/**
 * Délivrance et suivi des codes d'invitation.
 *
 * Le code en clair n'existe qu'une fois, dans la réponse de création : il est
 * affiché ici pour être copié, puis disparaît définitivement. La base ne
 * conserve que son empreinte.
 */
export function InvitationsPanel({
  invitations,
  farms,
}: {
  invitations: AdminInvitationRow[];
  farms: AdminFarmOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<{ code: string; summary: string } | null>(null);
  const [farmId, setFarmId] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = event.currentTarget;
    const data = new FormData(form);
    const selectedFarm = String(data.get('farmId') ?? '');
    const role = String(data.get('role') ?? 'OWNER');

    try {
      const result = await apiPost<{ code: string; invitation: { expiresAt: string } }>(
        '/api/admin/invitations',
        {
          email: String(data.get('email') ?? ''),
          farmId: selectedFarm,
          role,
          grantsPlatformAdmin: data.get('grantsPlatformAdmin') === 'on',
          note: String(data.get('note') ?? ''),
          validityDays: Number(data.get('validityDays') ?? DEFAULT_VALIDITY_DAYS),
        },
      );

      const farmName = farms.find((f) => f.id === selectedFarm)?.name;
      setIssued({
        code: result.code,
        summary: farmName
          ? `Rejoint « ${farmName} » comme ${ROLE_LABELS[role] ?? role}, valable jusqu'au ${formatDateFr(result.invitation.expiresAt)}.`
          : `Crée sa propre exploitation, valable jusqu'au ${formatDateFr(result.invitation.expiresAt)}.`,
      });
      form.reset();
      setFarmId('');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError('Impossible de contacter le serveur.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function copy(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Code copié dans le presse-papiers.');
    } catch {
      toast.error('Copie impossible : sélectionnez le code à la main.');
    }
  }

  function askRevoke(invitation: AdminInvitationRow): void {
    confirm.ask({
      title: 'Révoquer ce code ?',
      message: `Le code ${invitation.codeHint}-•••• ne pourra plus servir à créer un compte.`,
      detail: 'La trace de son émission reste dans le journal d’audit.',
      confirmLabel: 'Révoquer',
      onConfirm: async () => {
        const result = await apiDelete<{ message: string }>(
          `/api/admin/invitations/${invitation.id}`,
        );
        toast.success(result.message);
        router.refresh();
      },
    });
  }

  return (
    <div className="space-y-5">
      {/* Code fraîchement créé */}
      {issued ? (
        <Card className="border-champ-500/40 bg-champ-50/60 dark:bg-champ-900/25">
          <CardHeader
            icon={IconSuccess}
            title="Code créé — notez-le maintenant"
            description="Il n'est affiché qu'une fois : seule son empreinte est conservée en base."
          />
          <div className="flex flex-wrap items-center gap-3">
            <code className="select-all rounded-lg border border-line bg-surface px-4 py-2.5 font-mono text-[17px] font-semibold tracking-[0.12em] text-ink">
              {issued.code}
            </code>
            <Button variant="outline" icon={IconCopy} onClick={() => void copy(issued.code)}>
              Copier
            </Button>
            <Button variant="ghost" onClick={() => setIssued(null)}>
              J&apos;ai noté le code
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-2">{issued.summary}</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Transmettez-le à la personne concernée par un canal sûr. Parcelys ne l&apos;envoie
            pas automatiquement par e-mail.
          </p>
        </Card>
      ) : null}

      {/* Création */}
      <Card>
        <CardHeader
          icon={IconPlus}
          title="Délivrer un code d'invitation"
          description="Sans code, personne ne peut créer de compte sur cette instance."
        />

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Exploitation rejointe"
              htmlFor="farmId"
              hint="Laissez vide pour que la personne crée sa propre exploitation."
              error={fieldErrors.farmId}
            >
              <Select
                id="farmId"
                name="farmId"
                value={farmId}
                onChange={(event) => setFarmId(event.target.value)}
              >
                <option value="">— Nouvelle exploitation —</option>
                {farms.map((farm) => (
                  <option key={farm.id} value={farm.id}>
                    {farm.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Rôle accordé"
              htmlFor="role"
              required
              error={fieldErrors.role}
              hint={
                farmId === ''
                  ? 'Sans exploitation, la personne en devient propriétaire.'
                  : "Rôle dans l'exploitation choisie."
              }
            >
              <Select
                id="role"
                name="role"
                defaultValue="OWNER"
                key={farmId === '' ? 'new-farm' : 'existing-farm'}
                disabled={farmId === ''}
              >
                {(farmId === ''
                  ? (['OWNER'] as const)
                  : (['ADMIN', 'EMPLOYEE', 'VIEWER'] as const)
                ).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Réserver à une adresse e-mail"
              htmlFor="email"
              hint="Facultatif — le code ne fonctionnera alors que pour cette adresse."
              error={fieldErrors.email}
            >
              <Input id="email" name="email" type="email" autoComplete="off" />
            </Field>

            <Field
              label="Validité (jours)"
              htmlFor="validityDays"
              hint={`De 1 à ${MAX_VALIDITY_DAYS} jours.`}
              error={fieldErrors.validityDays}
            >
              <Input
                id="validityDays"
                name="validityDays"
                type="number"
                min={1}
                max={MAX_VALIDITY_DAYS}
                defaultValue={DEFAULT_VALIDITY_DAYS}
              />
            </Field>
          </div>

          <Field
            label="Note interne"
            htmlFor="note"
            hint="Pour vous souvenir à qui ce code était destiné."
            error={fieldErrors.note}
          >
            <Input id="note" name="note" placeholder="Nouveau salarié — atelier céréales" />
          </Field>

          <label className="flex items-start gap-2.5 rounded-lg bg-surface-2 p-3 text-sm text-ink-2">
            <Checkbox name="grantsPlatformAdmin" className="mt-0.5" />
            <span>
              <span className="font-medium text-ink">
                Faire de cette personne un administrateur de l&apos;instance
              </span>
              <span className="mt-0.5 block text-[12.5px] text-ink-3">
                Elle pourra gérer les comptes, délivrer des invitations et activer la
                maintenance. À réserver aux personnes de confiance.
              </span>
            </span>
          </label>

          <div className="flex justify-end">
            <Button type="submit" icon={IconInvitation} loading={submitting}>
              Créer le code
            </Button>
          </div>
        </form>
      </Card>

      {/* Liste */}
      {invitations.length === 0 ? (
        <EmptyState
          icon={IconInvitation}
          title="Aucun code délivré"
          description="Créez un code ci-dessus, puis transmettez-le à la personne à inscrire."
        />
      ) : (
        <TableWrapper>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Destination</Th>
              <Th>État</Th>
              <Th align="right">Échéance</Th>
              <Th align="right">Action</Th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((invitation) => (
              <Tr key={invitation.id}>
                <Td>
                  <code className="font-mono text-[13px] text-ink">
                    {invitation.codeHint}-••••-••••
                  </code>
                  <span className="block text-[12.5px] sm:text-[11.5px] text-ink-3">
                    Créé par {invitation.createdBy} le {formatDateFr(invitation.createdAt)}
                  </span>
                  {invitation.note ? (
                    <span className="block text-[12.5px] sm:text-[11.5px] text-ink-3">{invitation.note}</span>
                  ) : null}
                </Td>

                <Td>
                  <span className="block text-ink">
                    {invitation.farmName ?? 'Nouvelle exploitation'}
                  </span>
                  <span className="block text-[12.5px] text-ink-3">
                    {ROLE_LABELS[invitation.role] ?? invitation.role}
                    {invitation.email ? ` · ${invitation.email}` : ''}
                  </span>
                  {invitation.grantsPlatformAdmin ? (
                    <Badge tone="blue" icon={IconSecurity} className="mt-1">
                      Administrateur d&apos;instance
                    </Badge>
                  ) : null}
                </Td>

                <Td>
                  <Badge tone={STATUS_TONES[invitation.status]}>
                    {INVITATION_STATUS_LABELS[invitation.status]}
                  </Badge>
                  {invitation.usedByEmail ? (
                    <span className="mt-1 block text-[12.5px] sm:text-[11.5px] text-ink-3">
                      par {invitation.usedByEmail}
                    </span>
                  ) : null}
                </Td>

                <Td align="right">
                  <span className="text-[12.5px] text-ink-3">
                    {invitation.usedAt
                      ? `Utilisé le ${formatDateFr(invitation.usedAt)}`
                      : formatDateFr(invitation.expiresAt)}
                  </span>
                </Td>

                <Td align="right">
                  {invitation.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={IconDelete}
                      onClick={() => askRevoke(invitation)}
                    >
                      Révoquer
                    </Button>
                  ) : (
                    <span className="text-[12.5px] text-ink-3">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrapper>
      )}

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
