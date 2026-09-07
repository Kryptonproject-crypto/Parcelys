'use client';

import { Button } from '@/components/ui';
import { IconPrint } from '@/components/ui/icons';

export function PrintButton() {
  return (
    <Button type="button" icon={IconPrint} onClick={() => window.print()}>
      Imprimer
    </Button>
  );
}
