import { useCallback, useEffect, useMemo, useState } from 'react';
import { Network } from '@capacitor/network';
import { clearCache, clearOutbox, outboxCount, readSnapshot } from './lib/db';
import { clearSession, loadSession, saveSession } from './lib/storage';
import { fetchSnapshot, logout as apiLogout, OfflineError } from './lib/api';
import { writeSnapshot } from './lib/db';
import type { CachedParcel, Session, Snapshot } from './lib/types';
import { LoginScreen } from './screens/Login';
import { ParcelsScreen } from './screens/Parcels';
import { NewParcelScreen } from './screens/NewParcel';
import { ParcelScreen } from './screens/Parcel';
import { EntryScreen, type EntryKind } from './screens/Entry';
import { QueueScreen } from './screens/Queue';
import { SettingsScreen } from './screens/Settings';

/**
 * Coque de l'application.
 *
 * Navigation par état plutôt que par routeur : six écrans, aucune URL à
 * partager, aucun historique à restaurer. Un routeur ajouterait une dépendance
 * et un poids d'APK pour un besoin qui tient en une union de types.
 */

export type Screen =
  | { name: 'parcels' }
  | { name: 'new-parcel' }
  | { name: 'parcel'; parcelId: string }
  | { name: 'entry'; kind: EntryKind; parcelId: string }
  | { name: 'queue' }
  | { name: 'settings' };

export type AppContext = {
  session: Session;
  snapshot: Snapshot | null;
  online: boolean;
  pending: number;
  refreshPending: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  navigate: (screen: Screen) => void;
  back: () => void;
  logout: () => Promise<void>;
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [stack, setStack] = useState<Screen[]>([{ name: 'parcels' }]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [booting, setBooting] = useState(true);

  // --- Démarrage : session et cache local, avant tout appel réseau ---------
  useEffect(() => {
    void (async () => {
      const [stored, cached, count] = await Promise.all([
        loadSession(),
        readSnapshot(),
        outboxCount(),
      ]);
      setSession(stored);
      setSnapshot(cached);
      setPending(count);
      setBooting(false);
    })();
  }, []);

  // --- État du réseau ------------------------------------------------------
  useEffect(() => {
    let detach: (() => void) | undefined;

    void (async () => {
      const status = await Network.getStatus();
      setOnline(status.connected);
      const handle = await Network.addListener('networkStatusChange', (next) => {
        setOnline(next.connected);
      });
      detach = () => void handle.remove();
    })();

    return () => detach?.();
  }, []);

  const refreshPending = useCallback(async () => {
    setPending(await outboxCount());
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!session) return;
    try {
      const fresh = await fetchSnapshot(session);
      await writeSnapshot(fresh);
      setSnapshot(fresh);
    } catch (error) {
      // Hors ligne : le cache précédent reste affiché, c'est tout l'intérêt.
      if (!(error instanceof OfflineError)) throw error;
    }
  }, [session]);

  // Instantané rafraîchi à la connexion, puis à chaque retour du réseau.
  useEffect(() => {
    if (session && online) void refreshSnapshot();
  }, [session, online, refreshSnapshot]);

  const navigate = useCallback((screen: Screen) => {
    setStack((current) => [...current, screen]);
  }, []);

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  const logout = useCallback(async () => {
    if (session) await apiLogout(session);
    await Promise.all([clearSession(), clearCache(), clearOutbox()]);
    setSession(null);
    setSnapshot(null);
    setPending(0);
    setStack([{ name: 'parcels' }]);
  }, [session]);

  const parcels: CachedParcel[] = useMemo(
    () => snapshot?.parcels ?? [],
    [snapshot],
  );

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onAuthenticated={async (next) => {
          await saveSession(next);
          setSession(next);
        }}
      />
    );
  }

  const context: AppContext = {
    session,
    snapshot,
    online,
    pending,
    refreshPending,
    refreshSnapshot,
    navigate,
    back,
    logout,
  };

  const current = stack[stack.length - 1] ?? { name: 'parcels' };

  switch (current.name) {
    case 'new-parcel':
      return <NewParcelScreen context={context} />;

    case 'parcel': {
      const parcel = parcels.find((item) => item.id === current.parcelId);
      if (!parcel) {
        back();
        return null;
      }
      return <ParcelScreen context={context} parcel={parcel} />;
    }

    case 'entry': {
      const parcel = parcels.find((item) => item.id === current.parcelId);
      if (!parcel) {
        back();
        return null;
      }
      return <EntryScreen context={context} parcel={parcel} kind={current.kind} />;
    }

    case 'queue':
      return <QueueScreen context={context} />;

    case 'settings':
      return <SettingsScreen context={context} />;

    default:
      return <ParcelsScreen context={context} />;
  }
}
