'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { Button, Select } from '@/components/ui';
import { IconTransfer } from '@/components/ui/icons';

/**
 * Attribuer un client à un portefeuille, ou le transférer — administrateur
 * général seul (le serveur le revérifie). Le geste est confirmé : il change
 * qui voit ce client, et ses demandes de support le suivent.
 */
export function AssignPortfolio({
  kind,
  ids,
  label,
  current,
  portfolios,
}: {
  kind: 'farm' | 'technician';
  ids: string[];
  /** Ce qu'on déplace, pour la confirmation (« GAEC des Prés », « 3 exploitations »). */
  label: string;
  current: string | null;
  portfolios: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [cible, setCible] = useState<string>(current ?? '');
  const [busy, setBusy] = useState(false);

  const nomCible = portfolios.find((p) => p.id === cible)?.name ?? null;

  function demander(): void {
    confirm.ask({
      title: nomCible ? `Transférer vers « ${nomCible} » ?` : 'Retirer du portefeuille ?',
      message: nomCible
        ? `${label} passera sous la responsabilité des administrateurs de « ${nomCible} ».`
        : `${label} ne relèvera plus que de l'administrateur général.`,
      detail:
        'Les demandes de support du client le suivent. Le précédent administrateur n’y aura plus accès. Le geste est inscrit au journal.',
      confirmLabel: 'Confirmer',
      onConfirm: async () => {
        setBusy(true);
        try {
          const result = await apiPost<{ message: string }>('/api/admin/portefeuilles/affectations', {
            kind,
            ids,
            portfolioId: cible || null,
          });
          toast.success(result.message);
          router.refresh();
        } catch (error) {
          toast.error(error instanceof ApiRequestError ? error.message : 'Transfert impossible.');
          throw error;
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select
        value={cible}
        onChange={(event) => setCible(event.target.value)}
        aria-label="Portefeuille de destination"
        className="sm:w-60"
      >
        <option value="">Aucun portefeuille (général)</option>
        {portfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="outline"
        icon={IconTransfer}
        disabled={busy || (cible || null) === current || ids.length === 0}
        loading={busy}
        onClick={demander}
      >
        {current ? 'Transférer' : 'Attribuer'}
      </Button>
      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
