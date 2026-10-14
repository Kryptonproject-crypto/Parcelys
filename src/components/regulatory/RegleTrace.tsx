import type { Trace } from '@/lib/regulatory/regles';

/**
 * La règle appliquée, telle qu'on la présente en contrôle.
 *
 * Tout ce qu'il faut pour discuter un constat sans rouvrir l'arrêté : le texte
 * et l'article, la version du référentiel, le territoire, la période de
 * validité — et, repliée, la citation du texte, mot pour mot.
 *
 * Composant serveur, sans JavaScript : `<details>` replie la citation.
 */
export function RegleTrace({ trace }: { trace: Trace }) {
  const date = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  return (
    <div className="mt-1.5 border-t border-line pt-1.5 text-[11.5px] leading-snug text-ink-3">
      <p>
        <span className="font-medium text-ink-2">Règle :</span> {trace.regle.libelle}
      </p>
      {trace.texte ? (
        <p>
          <span className="font-medium text-ink-2">Texte :</span> {trace.texte}
        </p>
      ) : null}
      <p>
        <span className="font-medium text-ink-2">Référentiel :</span> {trace.referentiel.code}, version{' '}
        {trace.referentiel.version} — territoire {trace.territoire} — en vigueur depuis le{' '}
        {date(trace.validite.du)}
        {trace.validite.au ? ` jusqu’au ${date(trace.validite.au)}` : ''}
      </p>
      {trace.citation ? (
        <details className="mt-0.5">
          <summary className="cursor-pointer select-none text-ink-2">Ce que dit le texte</summary>
          <blockquote className="mt-1 border-l-2 border-line pl-2 italic">{trace.citation}</blockquote>
        </details>
      ) : null}
    </div>
  );
}
