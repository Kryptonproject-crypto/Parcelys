import { formatBytes } from '@/lib/storage/format';
import { Badge, cn, formatDateLongFr } from '@/components/ui';
import { IconAttachment, IconNote } from '@/components/ui/icons';

/**
 * Fil d'une demande de support : la description initiale, puis chaque
 * message. Partagé par l'administration (notes internes comprises) et par la
 * page du demandeur (qui ne les reçoit jamais : le serveur les a retirées).
 *
 * Le texte est affiché tel quel, en `whitespace-pre-wrap` : aucun HTML n'est
 * interprété, quel que soit ce que le demandeur a tapé.
 */
export type ElementConversation = {
  id: string;
  authorKind: 'REQUESTER' | 'STAFF';
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
  attachments: Array<{ id: string; fileName: string; sizeBytes: number }>;
};

export function Conversation({
  elements,
  pieceHref,
}: {
  elements: ElementConversation[];
  /** Adresse de téléchargement d'une pièce jointe, selon qui regarde. */
  pieceHref: (pieceId: string) => string;
}) {
  return (
    <ol className="space-y-3">
      {elements.map((m) => (
        <li
          key={m.id}
          className={cn(
            'rounded-xl border p-4',
            m.internal
              ? 'border-ble-500/35 bg-ble-50 dark:border-ble-600/40 dark:bg-ble-700/15'
              : m.authorKind === 'STAFF'
                ? 'border-ciel-500/25 bg-ciel-50/70 dark:border-ciel-600/40 dark:bg-ciel-700/15'
                : 'border-line bg-surface',
          )}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
              {m.authorName}
              {m.internal ? (
                <Badge tone="amber" icon={IconNote}>
                  Note interne
                </Badge>
              ) : null}
            </span>
            <span className="text-[12px] text-ink-3">{formatDateLongFr(m.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{m.body}</p>
          {m.attachments.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={pieceHref(a.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2"
                  >
                    <IconAttachment size={14} aria-hidden />
                    <span className="max-w-[16rem] truncate">{a.fileName}</span>
                    <span className="text-ink-3">· {formatBytes(a.sizeBytes)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
