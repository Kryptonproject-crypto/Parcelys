'use client';

/**
 * Le dernier filet : une erreur dans la mise en page racine elle-même.
 *
 * `error.tsx` s'affiche **à l'intérieur** de la mise en page. Si c'est la mise
 * en page qui casse — la police, le fournisseur de thème, les notices —, elle
 * ne peut rien rattraper : il ne reste plus de coque où s'afficher. Next.js
 * bascule alors sur `global-error.tsx`, qui remplace le document entier et doit
 * donc porter lui-même ses balises `<html>` et `<body>`.
 *
 * Aucune feuille de style ne peut être supposée chargée à ce stade : tout est
 * en style en ligne, volontairement. Une page de secours qui dépendrait de ce
 * qui vient de casser ne serait pas une page de secours.
 */
export default function ErreurGlobale({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1rem',
          background: '#f6f7f4',
          color: '#1b1f18',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.75rem' }}>
            Parcelys n’a pas pu démarrer
          </h1>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
            Une erreur est survenue avant même l’affichage de la page. Vos données ne
            sont pas touchées.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: '2.5rem',
              padding: '0 1rem',
              border: 0,
              borderRadius: '0.5rem',
              background: '#3f6f35',
              color: '#fff',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.78rem', color: '#5b6155' }}>
              Référence de l’incident : <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
