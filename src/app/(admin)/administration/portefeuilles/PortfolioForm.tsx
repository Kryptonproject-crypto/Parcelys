'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiDelete, apiPatch, apiPost, ApiRequestError } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { Alert, Button, Field, Input } from '@/components/ui';
import { IconDelete, IconPlus } from '@/components/ui/icons';

/** Créer un portefeuille, ou en renommer / supprimer un existant (`initial`). */
export function PortfolioForm({
  initial,
}: {
  initial?: { id: string; name: string; description: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setErreur(null);
    try {
      const result = initial
        ? await apiPatch<{ message: string }>(`/api/admin/portefeuilles/${initial.id}`, { name, description })
        : await apiPost<{ message: string }>('/api/admin/portefeuilles', { name, description });
      toast.success(result.message);
      if (!initial) {
        setName('');
        setDescription('');
      }
      router.refresh();
    } catch (error) {
      setErreur(error instanceof ApiRequestError ? error.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  function supprimer(): void {
    if (!initial) return;
    confirm.ask({
      title: 'Supprimer ce portefeuille ?',
      message: `« ${initial.name} » sera supprimé. Seul un portefeuille vide peut l'être.`,
      detail: 'Ses administrateurs secondaires perdent ce périmètre.',
      confirmLabel: 'Supprimer',
      onConfirm: async () => {
        try {
          const result = await apiDelete<{ message: string }>(`/api/admin/portefeuilles/${initial.id}`);
          toast.success(result.message);
          router.push('/administration/portefeuilles');
          router.refresh();
        } catch (error) {
          toast.error(error instanceof ApiRequestError ? error.message : 'Suppression impossible.');
          throw error;
        }
      },
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Nom" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
      </Field>
      <Field label="Description" hint="Facultatif : secteur, structure, consignes.">
        <Input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} />
      </Field>
      {erreur ? <Alert tone="danger">{erreur}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" icon={initial ? undefined : IconPlus} loading={busy} disabled={name.trim().length < 2}>
          {initial ? 'Enregistrer' : 'Créer le portefeuille'}
        </Button>
        {initial ? (
          <Button type="button" variant="ghost" icon={IconDelete} onClick={supprimer}>
            Supprimer
          </Button>
        ) : null}
      </div>
      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </form>
  );
}
