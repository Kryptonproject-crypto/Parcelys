'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPatch } from '@/lib/client/api';
import { Button, Spinner } from '@/components/ui';

export function MarkAllRead() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function markAll(): Promise<void> {
    setSubmitting(true);
    try {
      await apiPatch('/api/notifications', {});
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button variant="outline" onClick={() => void markAll()} disabled={submitting}>
      {submitting ? <Spinner /> : null}
      Tout marquer comme lu
    </Button>
  );
}
