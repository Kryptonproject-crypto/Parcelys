'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/client/api';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Textarea,
  formatDateLongFr,
} from '@/components/ui';
import { IconMaintenance, IconPower, IconPurge } from '@/components/ui/icons';

type CleanupTarget = 'sessions' | 'rate-limits' | 'invitations' | 'audit';

const TARGETS: Array<{
  key: CleanupTarget;
  label: string;
  description: string;
  countKey: keyof Purgeable;
}> = [
  {
    key: 'sessions',
    label: 'Sessions expirées ou révoquées',
    description: 'Sessions déjà inutilisables ; aucune connexion en cours n’est fermée.',
    countKey: 'sessions',
  },
  {
    key: 'rate-limits',
    label: 'Compteurs de limitation de débit',
    description: 'Fenêtres de comptage terminées.',
    countKey: 'rateLimits',
  },
  {
    key: 'invitations',
    label: 'Codes d’invitation caducs',
    description: 'Codes expirés ou révoqués et jamais utilisés. L’historique des codes consommés est conservé.',
    countKey: 'invitations',
  },
  {
    key: 'audit',
    label: 'Journal d’audit ancien',
    description: 'Au-delà de la durée de conservation choisie (RGPD : limitation de conservation).',
    countKey: 'auditLogs',
  },
];

type Purgeable = {
  sessions: number;
  rateLimits: number;
  invitations: number;
  auditLogs: number;
};

/**
 * Mode maintenance et purges.
 *
 * Les purges ne suppriment que des données déjà périmées ; la seule qui touche
 * à des données encore lisibles — le journal d'audit — passe par une
 * confirmation nommant le nombre d'entrées concernées.
 */
export function MaintenancePanel({
  initialEnabled,
  initialMessage,
  updatedAt,
  purgeable,
}: {
  initialEnabled: boolean;
  initialMessage: string;
  updatedAt: string | null;
  purgeable: Purgeable;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState(initialMessage);
  const [savingMode, setSavingMode] = useState(false);

  const [targets, setTargets] = useState<CleanupTarget[]>(['sessions', 'rate-limits']);
  const [retentionDays, setRetentionDays] = useState(365);
  const [purging, setPurging] = useState(false);

  async function toggleMaintenance(next: boolean): Promise<void> {
    setSavingMode(true);
    try {
      const result = await apiPost<{ message: string; enabled: boolean }>(
        '/api/admin/maintenance',
        { enabled: next, message },
      );
      setEnabled(result.enabled);
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Modification impossible.',
      );
    } finally {
      setSavingMode(false);
    }
  }

  async function runCleanup(): Promise<void> {
    setPurging(true);
    try {
      const result = await apiPost<{ message: string }>('/api/admin/cleanup', {
        targets,
        auditRetentionDays: retentionDays,
      });
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Purge impossible.',
      );
    } finally {
      setPurging(false);
    }
  }

  function askCleanup(): void {
    if (targets.length === 0) {
      toast.error('Sélectionnez au moins une opération.');
      return;
    }

    if (!targets.includes('audit')) {
      void runCleanup();
      return;
    }

    confirm.ask({
      title: 'Purger le journal d’audit ?',
      message: `Les entrées de plus de ${retentionDays} jours seront supprimées définitivement (${purgeable.auditLogs} entrée(s) concernée(s) aujourd'hui).`,
      detail:
        'Le journal est la seule trace des accès et des modifications : une purge ne se rattrape pas.',
      confirmLabel: 'Purger',
      onConfirm: runCleanup,
    });
  }

  function toggleTarget(target: CleanupTarget): void {
    setTargets((current) =>
      current.includes(target)
        ? current.filter((t) => t !== target)
        : [...current, target],
    );
  }

  return (
    <div className="space-y-5">
      {/* Mode maintenance */}
      <Card>
        <CardHeader
          icon={IconMaintenance}
          title="Mode maintenance"
          description="Coupe l'accès à l'application pour tous, sauf les administrateurs."
        />

        {enabled ? (
          <Alert tone="warning" title="Maintenance active">
            Les utilisateurs sont redirigés vers une page d&apos;information et les écritures
            sont refusées. Vous conservez l&apos;accès complet.
            {updatedAt ? ` Activée le ${formatDateLongFr(updatedAt)}.` : ''}
          </Alert>
        ) : (
          <Alert tone="success">L&apos;application est accessible normalement.</Alert>
        )}

        <div className="mt-4 space-y-4">
          <Field
            label="Message affiché aux utilisateurs"
            htmlFor="maintenance-message"
            hint="Dites ce qui se passe et, si possible, quand le service revient."
          >
            <Textarea
              id="maintenance-message"
              value={message}
              rows={3}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={400}
            />
          </Field>

          <div className="flex justify-end">
            <Button
              variant={enabled ? 'secondary' : 'danger'}
              icon={IconPower}
              loading={savingMode}
              onClick={() => void toggleMaintenance(!enabled)}
            >
              {enabled ? 'Lever la maintenance' : 'Activer la maintenance'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Purges */}
      <Card>
        <CardHeader
          icon={IconPurge}
          title="Purge des données périmées"
          description="Opérations sûres et rejouables, à lancer de temps à autre."
        />

        <ul className="space-y-2">
          {TARGETS.map((target) => (
            <li key={target.key}>
              <label className="flex items-start gap-2.5 rounded-lg bg-surface-2 p-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={targets.includes(target.key)}
                  onChange={() => toggleTarget(target.key)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{target.label}</span>
                    <span className="shrink-0 tabular-nums text-[12.5px] text-ink-3">
                      {purgeable[target.countKey]} à purger
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-3">
                    {target.description}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        {targets.includes('audit') ? (
          <div className="mt-4">
            <Field
              label="Conservation du journal (jours)"
              htmlFor="retention"
              hint="Entre 30 et 3650 jours. Les entrées plus anciennes sont supprimées."
            >
              <Input
                id="retention"
                type="number"
                min={30}
                max={3650}
                value={retentionDays}
                onChange={(event) => setRetentionDays(Number(event.target.value))}
                className="sm:w-40"
              />
            </Field>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            icon={IconPurge}
            loading={purging}
            onClick={askCleanup}
          >
            Lancer la purge
          </Button>
        </div>
      </Card>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
