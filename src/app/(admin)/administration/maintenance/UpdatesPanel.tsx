'use client';

import { useState } from 'react';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  formatDateLongFr,
} from '@/components/ui';
import { IconExternal, IconServer, IconSuccess } from '@/components/ui/icons';

export type UpdateStatusView = {
  current: string;
  latest: {
    version: string;
    name: string;
    url: string;
    publishedAt: string;
    notes: string;
    apkUrl: string | null;
  } | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  repository: string | null;
  error: string | null;
};

/**
 * Mises à jour disponibles.
 *
 * Le panneau informe, il n'installe rien : la mise à jour d'une instance
 * auto-hébergée reste une opération délibérée, faite par son exploitant, avec
 * une sauvegarde préalable. Un bouton « installer » qui exécuterait du code
 * téléchargé sur la foi d'une réponse HTTP serait une porte d'entrée, pas un
 * confort.
 */
export function UpdatesPanel({ initial }: { initial: UpdateStatusView }) {
  const toast = useToast();
  const [status, setStatus] = useState(initial);
  const [checking, setChecking] = useState(false);

  async function check(): Promise<void> {
    setChecking(true);
    try {
      const fresh = await apiPost<UpdateStatusView>('/api/admin/updates', {});
      setStatus(fresh);
      toast.success(
        fresh.updateAvailable
          ? `Version ${fresh.latest?.version} disponible.`
          : 'Cette instance est à jour.',
      );
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Vérification impossible.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={IconServer}
        title="Mises à jour"
        description="Parcelys regarde si une version plus récente a été publiée. Rien ne s'installe automatiquement."
      />

      <dl className="divide-y divide-line text-sm">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-ink-3">Version installée</dt>
          <dd className="font-mono text-ink">{status.current}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-ink-3">Dépôt surveillé</dt>
          <dd className="truncate text-right text-ink">
            {status.repository ?? (
              <Badge tone="amber">vérification désactivée</Badge>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-ink-3">Dernière vérification</dt>
          <dd className="text-right text-ink">
            {status.checkedAt ? formatDateLongFr(status.checkedAt) : '—'}
          </dd>
        </div>
      </dl>

      {!status.repository ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
          Renseignez <code className="font-mono">UPDATE_REPOSITORY</code> dans
          l&apos;environnement du serveur (par exemple{' '}
          <code className="font-mono">kryptonproject-crypto/parcelys</code>) pour
          être averti des nouvelles versions. Tant que la variable est absente,
          aucune requête ne sort de votre instance.
        </p>
      ) : status.error ? (
        <div className="mt-4">
          <Alert tone="warning">
            Dernière vérification en échec : {status.error} La version installée
            reste affichée telle quelle — Parcelys ne conclut pas « à jour »
            faute de réponse.
          </Alert>
        </div>
      ) : status.updateAvailable && status.latest ? (
        <div className="mt-4 rounded-lg border border-ble-500/40 bg-ble-500/10 p-3.5">
          <p className="font-medium text-ink">
            Version {status.latest.version} disponible
          </p>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {status.latest.name} · publiée le{' '}
            {formatDateLongFr(status.latest.publishedAt)}
          </p>
          {status.latest.notes ? (
            <pre className="mt-2.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-[12.5px] leading-relaxed text-ink-2">
              {status.latest.notes}
            </pre>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={status.latest.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink transition hover:bg-surface-2"
            >
              <IconExternal size={15} aria-hidden />
              Voir les notes de version
            </a>
            {status.latest.apkUrl ? (
              <a
                href={status.latest.apkUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3.5 text-[13.5px] font-medium text-ink transition hover:bg-surface-2"
              >
                <IconExternal size={15} aria-hidden />
                Télécharger l&apos;APK
              </a>
            ) : null}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            La mise à jour se fait depuis le serveur, sauvegarde faite :
            <code className="ml-1 font-mono">
              git pull &amp;&amp; npm ci &amp;&amp; npm run db:deploy &amp;&amp; npm run build
            </code>
            . La marche à suivre complète est dans{' '}
            <code className="font-mono">docs/DEPLOIEMENT.md</code>.
          </p>
        </div>
      ) : status.latest ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-champ-700 dark:text-champ-400">
          <IconSuccess size={16} aria-hidden />
          Cette instance exécute la dernière version publiée.
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          loading={checking}
          disabled={!status.repository}
          onClick={() => void check()}
        >
          Vérifier maintenant
        </Button>
      </div>
    </Card>
  );
}
