'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_ROLE_LABELS, type AdminRole } from '@/lib/admin/roles';
import { Badge, Button, Input } from '@/components/ui';
import { IconAdmins, IconNumber, IconPortfolio } from '@/components/ui/icons';

/**
 * Qui est connecté, avec quel rôle, sur quel périmètre — toujours visible en
 * tête de l'administration. Un administrateur secondaire doit savoir d'un
 * coup d'œil qu'il ne voit qu'une partie de l'instance, et laquelle.
 *
 * La recherche par numéro (EXP-…, TEC-…, DEM-…) mène à la fiche quand elle
 * est dans le périmètre ; sinon, à une page qui dit seulement « aucun
 * résultat ».
 */
export function AdminScopeBar({
  role,
  email,
  portfolios,
}: {
  role: AdminRole;
  email: string;
  portfolios: string[];
}) {
  const router = useRouter();
  const [numero, setNumero] = useState('');

  function chercher(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const q = numero.trim();
    if (!q) return;
    router.push(`/administration/recherche?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between no-print">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={role === 'GENERAL' ? 'blue' : 'amber'} icon={IconAdmins}>
            {ADMIN_ROLE_LABELS[role]}
          </Badge>
          <span className="truncate text-[13px] text-ink-3">{email}</span>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
          <IconPortfolio size={14} aria-hidden className="shrink-0 text-ink-3" />
          {role === 'GENERAL' ? (
            <span>Périmètre : tout Parcelys</span>
          ) : portfolios.length === 0 ? (
            <span className="text-brique-600 dark:text-brique-300">
              Aucun portefeuille confié : vous ne voyez aucun client.
            </span>
          ) : (
            <span>
              Périmètre : {portfolios.length > 1 ? 'portefeuilles' : 'portefeuille'}{' '}
              <strong className="font-medium text-ink">{portfolios.join(', ')}</strong>
            </span>
          )}
        </p>
      </div>
      <form onSubmit={chercher} className="flex gap-2" role="search">
        <Input
          value={numero}
          onChange={(event) => setNumero(event.target.value)}
          placeholder="EXP-…, TEC-… ou DEM-…"
          aria-label="Rechercher par numéro"
          className="sm:w-52"
        />
        <Button type="submit" variant="outline" icon={IconNumber}>
          Ouvrir
        </Button>
      </form>
    </div>
  );
}
