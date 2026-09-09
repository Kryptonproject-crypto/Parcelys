'use client';

import { useState } from 'react';
import { Modal } from '@/components/forms/Modal';
import { Alert, Button } from '@/components/ui';
import { IconWarning } from '@/components/ui/icons';

export type ConfirmRequest = {
  title: string;
  /** Message principal ; il doit nommer précisément ce qui va disparaître. */
  message: string;
  /** Précision rassurante ou avertissement complémentaire. */
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
};

/**
 * Confirmation d'une action destructive.
 *
 * Remplace `window.confirm`, dont l'apparence dépend du navigateur, ne peut ni
 * être stylée ni détailler les conséquences, et bloque le fil d'exécution.
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: (seulement?: ConfirmRequest) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    if (!request) return;
    setSubmitting(true);
    setError(null);
    try {
      await request.onConfirm();
      // On ne ferme que *cette* confirmation-ci. Une action peut en ouvrir une
      // seconde — « ce compte possède des exploitations, faut-il les supprimer
      // aussi ? » — et fermer aveuglément effacerait la question à peine posée,
      // laissant l'utilisateur devant un bouton qui ne fait rien.
      onClose(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La suppression a échoué.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={request !== null}
      onClose={submitting ? () => undefined : onClose}
      title={request?.title ?? ''}
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <p className="text-sm leading-relaxed text-ink-2">{request?.message}</p>

        {request?.detail ? (
          <Alert tone="warning" icon={IconWarning}>
            {request.detail}
          </Alert>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onClose()} disabled={submitting}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={submitting}>
            {request?.confirmLabel ?? 'Supprimer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** État partagé par les pages qui déclenchent des confirmations. */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return {
    request,
    ask: setRequest,
    /**
     * Ferme la confirmation. Avec `seulement`, ne ferme que celle-là : si une
     * autre a pris sa place entre-temps, elle reste affichée.
     */
    close: (seulement?: ConfirmRequest) =>
      setRequest((courante) => (seulement && courante !== seulement ? courante : null)),
  };
}
