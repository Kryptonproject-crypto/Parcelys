import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppContext } from '../App';
import {
  estimateAreaHa,
  formatAreaHa,
  formatDistance,
  perimeterMeters,
  shouldRecordPoint,
  toPolygon,
} from '../lib/geo';
import {
  accuracyLabel,
  currentPosition,
  GeolocationDenied,
  watchPosition,
} from '../lib/geolocation';
import { enqueue } from '../lib/db';
import type { Position } from '../lib/types';
import {
  ActionBar,
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Header,
  Input,
  cn,
} from '../components/ui';
import { ContourPreview } from '../components/ContourPreview';

/**
 * Relevé d'une parcelle au GPS.
 *
 * Deux façons de faire, parce que les deux servent :
 *
 *  - **Marcher le contour** : le téléphone enregistre un point tous les dix
 *    mètres pendant qu'on longe la limite. C'est la méthode rapide pour une
 *    parcelle irrégulière.
 *  - **Poser les sommets** : on se place à chaque angle et on appuie. Plus
 *    lent, mais bien plus précis sur une parcelle rectangulaire, et ça évite
 *    des contours à deux cents points.
 *
 * Les points trop imprécis sont écartés : un point à ±40 m déforme le contour
 * davantage qu'il ne l'informe.
 */

/** Distance minimale entre deux points retenus, en marche automatique. */
const MIN_DISTANCE_M = 10;
/** Au-delà de cette imprécision annoncée, le point est ignoré. */
const MAX_ACCURACY_M = 25;

export function NewParcelScreen({ context }: { context: AppContext }) {
  const { back, refreshPending } = context;

  const [points, setPoints] = useState<Position[]>([]);
  const [walking, setWalking] = useState(false);
  const [live, setLive] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [commune, setCommune] = useState('');
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'survey' | 'details'>('survey');

  const stopRef = useRef<(() => void) | null>(null);
  // Le suivi GPS est une ressource système : il doit être coupé au démontage,
  // sinon il continue de tourner et vide la batterie.
  useEffect(() => () => stopRef.current?.(), []);

  const areaHa = estimateAreaHa(points);
  const perimeter = perimeterMeters(points);
  const accuracy = accuracyLabel(live?.accuracy);

  const handleError = useCallback((caught: unknown) => {
    if (caught instanceof GeolocationDenied) setError(caught.message);
    else if (caught instanceof Error) setError(caught.message);
    else setError('Position indisponible.');
  }, []);

  async function toggleWalk(): Promise<void> {
    setError(null);

    if (walking) {
      stopRef.current?.();
      stopRef.current = null;
      setWalking(false);
      return;
    }

    try {
      const stop = await watchPosition(
        (position) => {
          setLive(position);
          setPoints((current) => {
            const last = current[current.length - 1];
            if (
              !shouldRecordPoint(last, position, {
                minDistanceM: MIN_DISTANCE_M,
                maxAccuracyM: MAX_ACCURACY_M,
              })
            ) {
              return current;
            }
            return [...current, position];
          });
        },
        (message) => setError(message),
      );
      stopRef.current = stop;
      setWalking(true);
    } catch (caught) {
      handleError(caught);
    }
  }

  async function addVertex(): Promise<void> {
    setError(null);
    try {
      const position = await currentPosition();
      setLive(position);
      if (position.accuracy !== undefined && position.accuracy > MAX_ACCURACY_M) {
        setError(
          `Position trop imprécise (±${Math.round(position.accuracy)} m). Attendez que le GPS se stabilise.`,
        );
        return;
      }
      setPoints((current) => [...current, position]);
    } catch (caught) {
      handleError(caught);
    }
  }

  function undo(): void {
    setPoints((current) => current.slice(0, -1));
  }

  async function save(): Promise<void> {
    const geometry = toPolygon(points);
    if (!geometry) {
      setError('Il faut au moins trois points pour fermer un contour.');
      return;
    }
    if (!name.trim()) {
      setError('Donnez un nom à la parcelle.');
      return;
    }

    setSaving(true);
    try {
      // La saisie part systématiquement par la file d'attente, y compris avec
      // du réseau : un seul chemin de code, donc un seul comportement à
      // vérifier, et aucune saisie perdue si la connexion lâche à l'envoi.
      await enqueue({
        clientId: crypto.randomUUID(),
        kind: 'parcel.create',
        label: `Parcelle « ${name.trim()} »`,
        capturedAt: new Date().toISOString(),
        attempts: 0,
        payload: {
          name: name.trim(),
          ...(commune.trim() ? { commune: commune.trim() } : {}),
          geometry,
        },
      });
      await refreshPending();
      back();
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Étape 2 : nommer la parcelle
  // -------------------------------------------------------------------------
  if (step === 'details') {
    return (
      <div className="flex min-h-full flex-col bg-canvas">
        <Header
          title="Nommer la parcelle"
          subtitle={`${points.length} points · environ ${formatAreaHa(areaHa)}`}
          onBack={() => setStep('survey')}
        />

        <div className="flex-1 space-y-4 px-4 py-4">
          {error ? <Banner tone="danger">{error}</Banner> : null}

          <ContourPreview points={points} />

          <Field label="Nom de la parcelle" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Les Grandes Pièces"
              autoFocus
            />
          </Field>

          <Field label="Commune">
            <Input
              value={commune}
              onChange={(event) => setCommune(event.target.value)}
              placeholder="Artenay"
            />
          </Field>

          <Banner tone="info">
            La superficie affichée ici est une estimation calculée sur le
            téléphone. La valeur retenue sera celle que le serveur calcule avec
            PostGIS à l&apos;enregistrement.
          </Banner>
        </div>

        <ActionBar>
          <Button full onClick={() => void save()} loading={saving}>
            Enregistrer la parcelle
          </Button>
        </ActionBar>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Étape 1 : relever le contour
  // -------------------------------------------------------------------------
  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Relever une parcelle"
        subtitle={walking ? 'Enregistrement en cours' : 'Contour au GPS'}
        onBack={back}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {/* Compteurs du relevé */}
        <Card>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Points
              </p>
              <p className="mt-0.5 text-[22px] font-bold tabular-nums text-ink">
                {points.length}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Surface
              </p>
              <p className="mt-0.5 text-[22px] font-bold tabular-nums text-ink">
                {areaHa > 0 ? areaHa.toFixed(2) : '—'}
              </p>
              <p className="text-[11px] text-ink-3">hectares (estimé)</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Contour
              </p>
              <p className="mt-0.5 text-[22px] font-bold tabular-nums text-ink">
                {perimeter > 0 ? formatDistance(perimeter) : '—'}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-center gap-2 border-t border-line pt-3">
            <span
              aria-hidden
              className={cn(
                'relative h-2.5 w-2.5 rounded-full',
                walking && 'gps-ring',
                accuracy.tone === 'good'
                  ? 'bg-champ-500 text-champ-500'
                  : accuracy.tone === 'fair'
                    ? 'bg-ble-500 text-ble-500'
                    : 'bg-brique-500 text-brique-500',
              )}
            />
            <span className="text-[13px] text-ink-3">
              GPS {accuracy.text}
              {live ? ` · ${live.lat.toFixed(5)}, ${live.lng.toFixed(5)}` : ''}
            </span>
          </div>
        </Card>

        <ContourPreview points={points} live={live} />

        {points.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={points.length >= 3 ? 'green' : 'amber'}>
              {points.length >= 3
                ? 'Contour fermable'
                : `Encore ${3 - points.length} point(s)`}
            </Badge>
            <button
              type="button"
              onClick={undo}
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-2 active:bg-surface-2"
            >
              Annuler le dernier point
            </button>
            <button
              type="button"
              onClick={() => setPoints([])}
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brique-500 active:bg-surface-2"
            >
              Tout effacer
            </button>
          </div>
        ) : (
          <Banner tone="info">
            Deux méthodes : <strong>marcher le contour</strong> en longeant la
            limite, ou <strong>poser un sommet</strong> à chaque angle. La
            seconde est plus précise sur une parcelle régulière.
          </Banner>
        )}
      </div>

      <ActionBar>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={walking ? 'danger' : 'secondary'}
              onClick={() => void toggleWalk()}
            >
              {walking ? 'Arrêter la marche' : 'Marcher le contour'}
            </Button>
            <Button variant="secondary" onClick={() => void addVertex()}>
              Poser un sommet
            </Button>
          </div>
          <Button
            full
            disabled={points.length < 3}
            onClick={() => {
              setError(null);
              setStep('details');
            }}
          >
            Continuer ({points.length} points)
          </Button>
        </div>
      </ActionBar>
    </div>
  );
}
