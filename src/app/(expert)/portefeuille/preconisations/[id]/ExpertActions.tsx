'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiDelete, apiPut } from '@/lib/client/api';
import type { RecommendationView } from '@/lib/services/advisory.shared';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Card } from '@/components/ui';
import { IconDelete, IconSuccess } from '@/components/ui/icons';

/**
 * Actions de l'expert sur sa préconisation.
 *
 * Transmettre un brouillon, ou retirer une préconisation. Un retrait n'efface
 * rien une fois la préconisation transmise : l'exploitation l'a vue, la trace
 * reste — seul un brouillon jamais envoyé peut disparaître.
 */
export function ExpertActions({
  recommendation,
}: {
  recommendation: RecommendationView;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const isDraft = recommendation.status === 'DRAFT';
  const canWithdraw = isDraft || recommendation.status === 'PROPOSED';
  const decided = ['ACCEPTED', 'DECLINED', 'APPLIED'].includes(recommendation.status);

  async function send(): Promise<void> {
    setBusy(true);
    try {
      await apiPut(`/api/recommendations/${recommendation.id}`, {
        parcelId: recommendation.parcelId ?? '',
        kind: recommendation.kind,
        priority: recommendation.priority,
        title: recommendation.title,
        rationale: recommendation.rationale,
        productName: recommendation.productName ?? '',
        amm: recommendation.amm ?? '',
        ...(recommendation.dose !== null ? { dose: recommendation.dose } : {}),
        ...(recommendation.doseUnit ? { doseUnit: recommendation.doseUnit } : {}),
        targetLabel: recommendation.targetLabel ?? '',
        windowStart: recommendation.windowStart?.slice(0, 10) ?? '',
        windowEnd: recommendation.windowEnd?.slice(0, 10) ?? '',
        send: true,
      });
      toast.success("Préconisation transmise à l'exploitation.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Envoi impossible.',
      );
    } finally {
      setBusy(false);
    }
  }

  function askWithdraw(): void {
    confirm.ask({
      title: isDraft ? 'Supprimer ce brouillon ?' : 'Retirer cette préconisation ?',
      message: isDraft
        ? `Le brouillon « ${recommendation.title} » sera supprimé.`
        : `« ${recommendation.title} » ne sera plus proposée à ${recommendation.farmName}.`,
      detail: isDraft
        ? "Ce brouillon n'a jamais été transmis : sa suppression est sans conséquence."
        : "L'exploitation l'a déjà reçue : elle restera visible dans son historique, marquée comme retirée.",
      confirmLabel: isDraft ? 'Supprimer' : 'Retirer',
      onConfirm: async () => {
        const result = await apiDelete<{ message: string }>(
          `/api/recommendations/${recommendation.id}`,
        );
        toast.success(result.message);
        if (isDraft) router.push('/portefeuille/preconisations');
        else router.refresh();
      },
    });
  }

  if (decided) {
    return (
      <>
        <Alert tone="info" icon={IconSuccess}>
          L&apos;exploitation s&apos;est prononcée : cette préconisation n&apos;est
          plus modifiable. Rédigez-en une nouvelle si votre conseil évolue.
        </Alert>
        <ConfirmDialog request={confirm.request} onClose={confirm.close} />
      </>
    );
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            {isDraft
              ? "Ce brouillon n'a pas encore été transmis."
              : recommendation.status === 'WITHDRAWN'
                ? 'Cette préconisation a été retirée.'
                : "En attente de la décision de l'exploitation."}
          </p>
          <div className="flex flex-wrap gap-2">
            {isDraft || recommendation.status === 'WITHDRAWN' ? (
              <Button onClick={() => void send()} loading={busy}>
                Transmettre à l&apos;exploitation
              </Button>
            ) : null}
            {canWithdraw ? (
              <Button variant="ghost" icon={IconDelete} onClick={askWithdraw}>
                {isDraft ? 'Supprimer' : 'Retirer'}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </>
  );
}
