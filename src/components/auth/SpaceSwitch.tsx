import Link from 'next/link';

/**
 * Bascule entre les deux portes d'entrée.
 *
 * Un exploitant et un expert agronomique ne font pas le même métier et
 * n'ouvrent pas le même espace de travail. Le dire dès la page de connexion
 * évite la question « pourquoi je ne vois pas mes exploitations ? » — et
 * l'authentification reste unique derrière, avec un seul chemin à sécuriser.
 */
export function SpaceSwitch({ active }: { active: 'farm' | 'expert' }) {
  const entries = [
    { key: 'farm' as const, href: '/connexion', label: 'Exploitation' },
    { key: 'expert' as const, href: '/connexion-expert', label: 'Expert agronomique' },
  ];

  return (
    <div
      role="tablist"
      aria-label="Type de compte"
      className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1"
    >
      {entries.map((entry) => {
        const selected = entry.key === active;
        return (
          <Link
            key={entry.key}
            href={entry.href}
            role="tab"
            aria-selected={selected}
            className={[
              'rounded-lg px-3 py-2 text-center text-[13.5px] font-medium transition-colors',
              selected
                ? 'bg-surface text-ink shadow-card'
                : 'text-ink-3 hover:text-ink',
            ].join(' ')}
          >
            {entry.label}
          </Link>
        );
      })}
    </div>
  );
}
