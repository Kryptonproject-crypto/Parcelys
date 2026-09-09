'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiDelete, apiPatch, ApiRequestError } from '@/lib/client/api';
import type { AdminUserFilter, AdminUserRow } from '@/lib/admin/shared';
import { USER_FILTER_LABELS } from '@/lib/admin/shared';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Td,
  Th,
  TableWrapper,
  Tr,
  cn,
  formatDateFr,
} from '@/components/ui';
import {
  IconAdmin,
  IconAdvisor,
  IconDelete,
  IconMailCheck,
  IconRestore,
  IconSearch,
  IconSecurity,
  IconSuspend,
  IconUnlock,
  IconUsers,
} from '@/components/ui/icons';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EMPLOYEE: 'Salarié',
  VIEWER: 'Lecture seule',
};

type Action =
  | { action: 'suspend'; reason?: string }
  | { action: 'restore' }
  | { action: 'unlock' }
  | { action: 'verify-email' }
  | { action: 'revoke-sessions' }
  | { action: 'set-platform-admin'; value: boolean };

/**
 * Gestion des comptes.
 *
 * Chaque bouton déclenche une action nommée côté serveur ; l'interface ne
 * modifie jamais un champ directement. Les deux actions irréversibles
 * (suspension, suppression) passent par une confirmation qui nomme le compte
 * concerné.
 */
export function UsersTable({
  users,
  filter,
  search,
  currentUserId,
}: {
  users: AdminUserRow[];
  filter: AdminUserFilter;
  search: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [query, setQuery] = useState(search);

  function href(next: { statut?: AdminUserFilter; q?: string }): string {
    const params = new URLSearchParams();
    const statut = next.statut ?? filter;
    const q = next.q ?? query;
    if (statut !== 'tous') params.set('statut', statut);
    if (q.trim().length > 0) params.set('q', q.trim());
    const suffix = params.toString();
    return suffix ? `/administration/utilisateurs?${suffix}` : '/administration/utilisateurs';
  }

  async function run(user: AdminUserRow, body: Action): Promise<void> {
    setPendingId(user.id);
    try {
      const result = await apiPatch<{ message: string }>(
        `/api/admin/users/${user.id}`,
        body,
      );
      toast.success(result.message);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Action impossible.',
      );
    } finally {
      setPendingId(null);
    }
  }

  function askSuspend(user: AdminUserRow): void {
    confirm.ask({
      title: 'Suspendre ce compte ?',
      message: `${user.firstName} ${user.lastName} (${user.email}) ne pourra plus se connecter et ses sessions ouvertes seront fermées.`,
      detail:
        'Les données de ses exploitations restent intactes. La suspension est réversible à tout moment.',
      confirmLabel: 'Suspendre',
      onConfirm: async () => {
        await run(user, { action: 'suspend' });
      },
    });
  }

  function askDelete(user: AdminUserRow): void {
    confirm.ask({
      title: 'Supprimer ce compte ?',
      message: `Le compte de ${user.firstName} ${user.lastName} (${user.email}) sera supprimé et ses accès révoqués.`,
      detail:
        "Les enregistrements réglementaires qu'il a saisis restent attachés à leur exploitation : ce sont des documents que l'exploitant doit conserver.",
      confirmLabel: 'Supprimer le compte',
      onConfirm: async () => {
        setPendingId(user.id);
        try {
          const result = await apiDelete<{ message: string }>(
            `/api/admin/users/${user.id}`,
          );
          toast.success(result.message);
          router.refresh();
        } catch (error) {
          toast.error(
            error instanceof ApiRequestError ? error.message : 'Suppression impossible.',
          );
          throw error;
        } finally {
          setPendingId(null);
        }
      },
    });
  }

  function onSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    router.push(href({ q: query }));
  }

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ul className="flex flex-wrap gap-1">
          {(Object.keys(USER_FILTER_LABELS) as AdminUserFilter[]).map((key) => (
            <li key={key}>
              <Link
                href={href({ statut: key })}
                aria-current={key === filter ? 'page' : undefined}
                className={cn(
                  'inline-flex rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  key === filter
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
                )}
              >
                {USER_FILTER_LABELS[key]}
              </Link>
            </li>
          ))}
        </ul>

        <form onSubmit={onSearch} className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom ou adresse e-mail"
            aria-label="Rechercher un compte"
            className="sm:w-64"
          />
          <Button type="submit" variant="outline" icon={IconSearch}>
            Chercher
          </Button>
        </form>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={IconUsers}
          title="Aucun compte ne correspond"
          description="Modifiez le filtre ou la recherche. Les nouveaux comptes n'apparaissent qu'après utilisation d'un code d'invitation."
        />
      ) : (
        <TableWrapper>
          <thead>
            <tr>
              <Th>Compte</Th>
              <Th>Exploitations</Th>
              <Th>État</Th>
              <Th align="right">Dernière connexion</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const busy = pendingId === user.id;
              const isSelf = user.id === currentUserId;

              return (
                <Tr key={user.id}>
                  {/* Le nom ne se coupe pas : la colonne d'actions, large,
                      lui prendrait sinon toute la place. */}
                  <Td className="whitespace-nowrap">
                    <span className="block font-medium text-ink">
                      {user.firstName} {user.lastName}
                      {isSelf ? (
                        <span className="ml-1.5 text-[12.5px] sm:text-[11px] font-normal text-ink-3">
                          (vous)
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[12.5px] text-ink-3">{user.email}</span>
                    <span className="block text-[12.5px] sm:text-[11.5px] text-ink-3">
                      Inscrit le {formatDateFr(user.createdAt)}
                      {user.organization ? ` · ${user.organization}` : ''}
                    </span>
                  </Td>

                  {/* Un expert n'est membre d'aucune exploitation : sans cette
                      distinction, son compte se lirait comme un compte
                      d'exploitation resté vide. */}
                  <Td>
                    {user.accountType === 'AGRONOMIST' ? (
                      user.advisedFarms.length === 0 ? (
                        <span className="text-[12.5px] text-ink-3">
                          Aucun domaine suivi
                        </span>
                      ) : (
                        <ul className="space-y-0.5">
                          {user.advisedFarms.map((farm) => (
                            <li key={farm.farmId} className="text-[12.5px]">
                              <span className="text-ink">{farm.farmName}</span>{' '}
                              <span className="text-ink-3">· conseil</span>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : user.memberships.length === 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {user.memberships.map((m) => (
                          <li key={m.farmId} className="text-[12.5px]">
                            <span className="text-ink">{m.farmName}</span>{' '}
                            <span className="text-ink-3">
                              · {ROLE_LABELS[m.role] ?? m.role}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>

                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {user.isPlatformAdmin ? (
                        <Badge tone="blue" icon={IconAdmin}>
                          Administrateur
                        </Badge>
                      ) : null}
                      {user.accountType === 'AGRONOMIST' ? (
                        <Badge tone="blue" icon={IconAdvisor}>
                          Expert agronomique
                        </Badge>
                      ) : null}
                      {user.suspendedAt ? (
                        <Badge tone="red" icon={IconSuspend}>
                          Suspendu
                        </Badge>
                      ) : (
                        <Badge tone="green">Actif</Badge>
                      )}
                      {!user.emailVerified ? (
                        <Badge tone="amber">Adresse non vérifiée</Badge>
                      ) : null}
                      {user.lockedUntil ? <Badge tone="amber">Verrouillé</Badge> : null}
                      {user.isDemo ? <Badge tone="neutral">Démo</Badge> : null}
                      {user.activeSessions > 0 ? (
                        <Badge tone="neutral">
                          {user.activeSessions} session(s)
                        </Badge>
                      ) : null}
                    </div>
                    {user.suspendedReason ? (
                      <p className="mt-1 text-[12.5px] sm:text-[11.5px] text-ink-3">
                        Motif : {user.suspendedReason}
                      </p>
                    ) : null}
                  </Td>

                  <Td align="right">
                    <span className="text-[12.5px] text-ink-3">
                      {user.lastLoginAt ? formatDateFr(user.lastLoginAt) : 'Jamais'}
                    </span>
                  </Td>

                  <Td align="right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {user.suspendedAt ? (
                        <Button
                          size="sm"
                          variant="outline"
                          icon={IconRestore}
                          disabled={busy}
                          onClick={() => void run(user, { action: 'restore' })}
                        >
                          Réactiver
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={IconSuspend}
                          disabled={busy || isSelf}
                          title={
                            isSelf ? 'Vous ne pouvez pas vous suspendre vous-même' : undefined
                          }
                          onClick={() => askSuspend(user)}
                        >
                          Suspendre
                        </Button>
                      )}

                      {!user.emailVerified ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={IconMailCheck}
                          disabled={busy}
                          onClick={() => void run(user, { action: 'verify-email' })}
                        >
                          Valider l&apos;adresse
                        </Button>
                      ) : null}

                      {user.lockedUntil ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={IconUnlock}
                          disabled={busy}
                          onClick={() => void run(user, { action: 'unlock' })}
                        >
                          Déverrouiller
                        </Button>
                      ) : null}

                      {user.activeSessions > 0 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={IconSecurity}
                          disabled={busy}
                          onClick={() => void run(user, { action: 'revoke-sessions' })}
                        >
                          Fermer les sessions
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="ghost"
                        icon={IconAdmin}
                        disabled={busy || (isSelf && user.isPlatformAdmin)}
                        title={
                          isSelf && user.isPlatformAdmin
                            ? 'Vous ne pouvez pas retirer votre propre rôle'
                            : undefined
                        }
                        onClick={() =>
                          void run(user, {
                            action: 'set-platform-admin',
                            value: !user.isPlatformAdmin,
                          })
                        }
                      >
                        {user.isPlatformAdmin ? 'Retirer admin' : 'Nommer admin'}
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        icon={IconDelete}
                        disabled={busy || isSelf}
                        onClick={() => askDelete(user)}
                        className="text-brique-600 hover:bg-brique-50 dark:text-brique-300 dark:hover:bg-brique-700/20"
                      >
                        Supprimer
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrapper>
      )}

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
