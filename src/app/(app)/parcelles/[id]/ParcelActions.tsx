'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiDelete } from '@/lib/client/api';
import { Modal } from '@/components/forms/Modal';
import { Alert, Button, Spinner } from '@/components/ui';

/** Suppression d'une parcelle, avec confirmation explicite. */
export function ParcelActions({
  parcelId,
  parcelName,
}: {
  parcelId: string;
  parcelName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await apiDelete(`/api/parcels/${parcelId}`);
      router.push('/parcelles');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : 'Suppression impossible.',
      );
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Supprimer
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Supprimer la parcelle"
        description={parcelName}
      >
        <div className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Alert tone="warning" title="Cette action retire la parcelle de votre parcellaire">
            Ses interventions (apports, traitements, travaux) restent conservées en base
            afin que vos registres et exports antérieurs demeurent complets et
            consultables.
          </Alert>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} disabled={submitting}>
              {submitting ? <Spinner /> : null}
              {submitting ? 'Suppression…' : 'Confirmer la suppression'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
