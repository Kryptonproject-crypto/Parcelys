import { Card, Skeleton } from '@/components/ui';

/**
 * État de chargement des pages authentifiées.
 *
 * Next l'affiche pendant le rendu serveur de la page demandée. Le gabarit
 * reprend la structure d'une page type (titre, indicateurs, contenu) pour que
 * la mise en page ne saute pas à l'arrivée des données.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-7xl animate-fade-in">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-28" />
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Card className="space-y-3 lg:col-span-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-[320px] w-full" />
        </Card>
        <Card className="space-y-3">
          <Skeleton className="h-4 w-36" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </Card>
      </div>
    </div>
  );
}
