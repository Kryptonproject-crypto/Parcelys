'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, apiPost } from '@/lib/client/api';
import {
  CODE_PLACEHOLDER,
  formatInvitationCode,
} from '@/lib/auth/invitations.shared';
import { useToast } from '@/components/ui/Toast';
import { Alert, Button, Card, CardHeader, Field, Input } from '@/components/ui';
import { IconInvitation } from '@/components/ui/icons';

/**
 * Activation d'un code d'accès conseil.
 *
 * C'est l'exploitation qui décide qui la conseille : elle délivre le code
 * depuis ses paramètres, l'expert l'active ici. Aucun expert ne peut s'inviter
 * lui-même dans une exploitation.
 */
export function JoinFarmCard() {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await apiPost<{ message: string }>('/api/portfolio/join', {
        code,
      });
      toast.success(result.message);
      setCode('');
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Impossible de contacter le serveur.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={IconInvitation}
        title="Ajouter une exploitation"
        description="Saisissez le code d'accès que l'exploitation vous a remis."
      />

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Code d'accès conseil" htmlFor="advisory-code" required>
              <Input
                id="advisory-code"
                value={code}
                onChange={(event) => setCode(formatInvitationCode(event.target.value))}
                placeholder={CODE_PLACEHOLDER}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
                className="font-mono tracking-[0.12em]"
              />
            </Field>
          </div>
          <Button type="submit" loading={submitting} className="sm:mb-0">
            Activer
          </Button>
        </div>
      </form>
    </Card>
  );
}
