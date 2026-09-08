'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiDelete, apiFetch, apiPost } from '@/lib/client/api';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Spinner,
  formatDateFr,
} from '@/components/ui';
import { IconCopy, IconDelete, IconEngagement, IconSuccess } from '@/components/ui/icons';

type Engagement = {
  id: string;
  status: 'ACTIVE' | 'ENDED';
  startedAt: string;
  endedAt: string | null;
  note: string | null;
  grantedBy: string | null;
  expert: {
    id: string;
    name: string;
    email: string;
    organization: string | null;
    certificate: string | null;
  };
};

type PendingCode = {
  id: string;
  codeHint: string;
  email: string | null;
  note: string | null;
  expiresAt: string;
};

/**
 * Experts agronomiques suivant l'exploitation.
 *
 * C'est l'exploitation qui décide qui la conseille, et qui peut retirer cet
 * accès à tout moment. Un expert ne s'invite jamais lui-même : il lui faut un
 * code délivré ici.
 */
export function AdvisorsPanel({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [pendingCodes, setPendingCodes] = useState<PendingCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const data = await apiFetch<{
        engagements: Engagement[];
        pendingCodes: PendingCode[];
      }>('/api/farms/advisors');
      setEngagements(data.engagements);
      setPendingCodes(data.pendingCodes);
    } catch {
      setError('Impossible de charger la liste des experts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage]);

  async function createCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const result = await apiPost<{ code: string }>('/api/farms/advisors', {
        email: String(form.get('email') ?? ''),
        note: String(form.get('note') ?? ''),
        validityDays: Number(form.get('validityDays') ?? 14),
      });
      setIssued(result.code);
      event.currentTarget.reset();
      await load();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Création impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function askRevoke(engagement: Engagement): void {
    confirm.ask({
      title: 'Retirer cet accès ?',
      message: `${engagement.expert.name} n'aura plus accès à votre parcellaire ni à vos registres.`,
      detail:
        'Ses préconisations passées restent dans votre historique : elles font partie de la traçabilité de vos décisions.',
      confirmLabel: "Retirer l'accès",
      onConfirm: async () => {
        const result = await apiDelete<{ message: string }>('/api/farms/advisors', {
          engagementId: engagement.id,
        });
        toast.success(result.message);
        await load();
        router.refresh();
      },
    });
  }

  if (!canManage) return null;

  const active = engagements.filter((e) => e.status === 'ACTIVE');
  const ended = engagements.filter((e) => e.status === 'ENDED');

  return (
    <Card>
      <CardHeader
        icon={IconEngagement}
        title="Experts agronomiques"
        description="Ouvrez l'accès à un conseiller : il verra votre parcellaire et vos registres, et pourra vous transmettre des préconisations."
      />

      {error ? (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {issued ? (
        <div className="mb-4 rounded-lg border border-champ-500/40 bg-champ-50/60 p-3.5 dark:bg-champ-900/25">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <IconSuccess size={16} aria-hidden />
            Code créé — notez-le maintenant
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <code className="select-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[15px] font-semibold tracking-[0.12em] text-ink">
              {issued}
            </code>
            <Button
              size="sm"
              variant="outline"
              icon={IconCopy}
              onClick={() => {
                void navigator.clipboard
                  .writeText(issued)
                  .then(() => toast.success('Code copié.'))
                  .catch(() => toast.error('Copie impossible.'));
              }}
            >
              Copier
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              J&apos;ai noté
            </Button>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-3">
            Il n&apos;est affiché qu&apos;une fois : seule son empreinte est
            conservée. Transmettez-le à votre expert par un canal sûr.
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="mb-4 text-sm text-ink-3">
              Aucun expert ne suit actuellement votre exploitation.
            </p>
          ) : (
            <ul className="mb-4 divide-y divide-line">
              {active.map((engagement) => (
                <li
                  key={engagement.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{engagement.expert.name}</p>
                    <p className="truncate text-[13px] text-ink-3">
                      {engagement.expert.email}
                      {engagement.expert.organization
                        ? ` · ${engagement.expert.organization}`
                        : ''}
                    </p>
                    <p className="text-[12px] text-ink-3">
                      Accès ouvert le {formatDateFr(engagement.startedAt)}
                      {engagement.grantedBy ? ` par ${engagement.grantedBy}` : ''}
                      {engagement.expert.certificate
                        ? ` · certificat déclaré : ${engagement.expert.certificate}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={IconDelete}
                    onClick={() => askRevoke(engagement)}
                    className="text-brique-600 dark:text-brique-300"
                  >
                    Retirer l&apos;accès
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {pendingCodes.length > 0 ? (
            <div className="mb-4 rounded-lg bg-surface-2 p-3">
              <p className="text-[13px] font-medium text-ink">
                Codes délivrés, pas encore activés
              </p>
              <ul className="mt-2 space-y-1.5 text-[12.5px] text-ink-3">
                {pendingCodes.map((code) => (
                  <li key={code.id} className="flex flex-wrap items-center gap-2">
                    <code className="font-mono">{code.codeHint}-••••-••••</code>
                    {code.email ? <span>· réservé à {code.email}</span> : null}
                    <span>· expire le {formatDateFr(code.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {ended.length > 0 ? (
            <details className="mb-4">
              <summary className="cursor-pointer text-[13px] text-ink-3">
                {ended.length} accès terminé(s)
              </summary>
              <ul className="mt-2 space-y-1 text-[12.5px] text-ink-3">
                {ended.map((engagement) => (
                  <li key={engagement.id}>
                    {engagement.expert.name} — jusqu&apos;au{' '}
                    {engagement.endedAt ? formatDateFr(engagement.endedAt) : '—'}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <form onSubmit={createCode} className="space-y-3 border-t border-line pt-4">
            <p className="text-[13px] font-medium text-ink">
              Délivrer un code d&apos;accès
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Réserver à une adresse"
                htmlFor="advisor-email"
                hint="Facultatif — le code ne fonctionnera que pour cette adresse."
              >
                <Input id="advisor-email" name="email" type="email" autoComplete="off" />
              </Field>
              <Field label="Validité (jours)" htmlFor="advisor-validity">
                <Input
                  id="advisor-validity"
                  name="validityDays"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={14}
                />
              </Field>
            </div>

            <Field label="Note interne" htmlFor="advisor-note">
              <Input
                id="advisor-note"
                name="note"
                placeholder="Conseiller coopérative — campagne 2027"
              />
            </Field>

            <div className="flex justify-end">
              <Button type="submit" loading={submitting}>
                Créer le code
              </Button>
            </div>
          </form>
        </>
      )}

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </Card>
  );
}
