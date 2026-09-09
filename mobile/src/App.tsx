import { useCallback, useEffect, useMemo, useState } from 'react';
import { Network } from '@capacitor/network';
import { clearCache, clearOutbox, outboxCount, readSnapshot } from './lib/db';
import {
  clearSession,
  forgetLegacyServerUrl,
  loadActiveFarmId,
  loadSession,
  saveActiveFarmId,
  saveSession,
} from './lib/storage';
import { SERVER_URL } from './lib/config';
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
import { PortfolioScreen } from './screens/Portfolio';
import { RecommendationsScreen } from './screens/Recommendations';
import { RecommendationScreen } from './screens/Recommendation';
import { NewRecommendationScreen } from './screens/NewRecommendation';

/**
 * Coque de l'application.
 *
 * Navigation par état plutôt que par routeur : une dizaine d'écrans, aucune URL
 * à partager, aucun historique à restaurer. Un routeur ajouterait une
 * dépendance et un poids d'APK pour un besoin qui tient en une union de types.
 *
 * Deux métiers cohabitent. L'exploitant ouvre son parcellaire ; l'expert
 * agronomique ouvre son portefeuille, y choisit un domaine, et l'application
 * recharge alors l'instantané de ce domaine. C'est le serveur qui décide de
 * l'un ou l'autre — l'application ne fait qu'obéir à `accountType`.
 */

export type Screen =
  | { name: 'portfolio' }
  | { name: 'parcels' }
  | { name: 'new-parcel' }
  | { name: 'parcel'; parcelId: string }
  | { name: 'entry'; kind: EntryKind; parcelId: string }
  | { name: 'recommendations' }
  | { name: 'recommendation'; recommendationId: string }
  | { name: 'new-recommendation'; parcelId?: string }
  | { name: 'queue' }
  | { name: 'settings' };

export type AppContext = {
  session: Session;
  snapshot: Snapshot | null;
  online: boolean;
  pending: number;
  /** Exploitation ouverte ; `null` tant que rien n'a été téléchargé. */
  activeFarmId: string | null;
  /** `true` si le compte est un expert agronomique. */
  isExpert: boolean;
  /** `true` si l'exploitation ouverte est suivie et non détenue : lecture seule. */
  readOnly: boolean;
  refreshPending: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  selectFarm: (farmId: string) => Promise<void>;
  navigate: (screen: Screen) => void;
  back: () => void;
  logout: () => Promise<void>;
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [activeFarmId, setActiveFarmId] = useState<string | null>(null);
  const [stack, setStack] = useState<Screen[]>([{ name: 'parcels' }]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [booting, setBooting] = useState(true);

  const isExpert = session?.accountType === 'AGRONOMIST';
  const homeScreen: Screen = isExpert ? { name: 'portfolio' } : { name: 'parcels' };

  // --- Démarrage : session et cache local, avant tout appel réseau ---------
  useEffect(() => {
    void (async () => {
      const [stored, cached, count, farmId] = await Promise.all([
        loadSession(),
        readSnapshot(),
        outboxCount(),
        loadActiveFarmId(),
      ]);
      // Une version antérieure laissait saisir l'adresse du serveur. Une
      // session gardée pour une autre instance porte un jeton que celle-ci ne
      // reconnaîtra pas : mieux vaut redemander la connexion tout de suite que
      // laisser l'application échouer à chaque appel sans dire pourquoi.
      const valide = stored && stored.serverUrl === SERVER_URL ? stored : null;
      if (stored && !valide) await clearSession();
      await forgetLegacyServerUrl();

      setSession(valide);
      setSnapshot(cached);
      setPending(count);
      setActiveFarmId(farmId ?? cached?.farm.id ?? null);
      setStack([
        valide?.accountType === 'AGRONOMIST' ? { name: 'portfolio' } : { name: 'parcels' },
      ]);
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
      const fresh = await fetchSnapshot(session, activeFarmId);
      await writeSnapshot(fresh);
      setSnapshot(fresh);
      setActiveFarmId(fresh.farm.id);
      await saveActiveFarmId(fresh.farm.id);
    } catch (error) {
      // Hors ligne : le cache précédent reste affiché, c'est tout l'intérêt.
      if (!(error instanceof OfflineError)) throw error;
    }
  }, [session, activeFarmId]);

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

  /**
   * Ouvre un domaine du portefeuille.
   *
   * Le cache est celui d'une seule exploitation à la fois : changer de domaine
   * le remplace. C'est assumé — embarquer tout un portefeuille remplirait le
   * téléphone, et l'expert travaille sur une exploitation à la fois.
   */
  const selectFarm = useCallback(
    async (farmId: string) => {
      if (!session) return;
      setActiveFarmId(farmId);
      await saveActiveFarmId(farmId);
      try {
        const fresh = await fetchSnapshot(session, farmId);
        await writeSnapshot(fresh);
        setSnapshot(fresh);
        setStack((current) => [...current, { name: 'parcels' }]);
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error;
        // Hors réseau : seul le domaine déjà en cache reste consultable.
        if (snapshot?.farm.id === farmId) {
          setStack((current) => [...current, { name: 'parcels' }]);
        } else {
          throw error;
        }
      }
    },
    [session, snapshot],
  );

  const logout = useCallback(async () => {
    if (session) await apiLogout(session);
    await Promise.all([
      clearSession(),
      clearCache(),
      clearOutbox(),
      saveActiveFarmId(null),
    ]);
    setSession(null);
    setSnapshot(null);
    setActiveFarmId(null);
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
          setStack([
            next.accountType === 'AGRONOMIST' ? { name: 'portfolio' } : { name: 'parcels' },
          ]);
        }}
      />
    );
  }

  const context: AppContext = {
    session,
    snapshot,
    online,
    pending,
    activeFarmId,
    isExpert,
    // La lecture seule vient du serveur, pas d'une déduction locale : c'est lui
    // qui sait si l'accès relève d'une mission de conseil.
    readOnly: snapshot?.advisory ?? false,
    refreshPending,
    refreshSnapshot,
    selectFarm,
    navigate,
    back,
    logout,
  };

  const current = stack[stack.length - 1] ?? homeScreen;

  switch (current.name) {
    case 'portfolio':
      return <PortfolioScreen context={context} />;

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

    case 'recommendations':
      return <RecommendationsScreen context={context} />;

    case 'recommendation': {
      const recommendation = (snapshot?.recommendations ?? []).find(
        (item) => item.id === current.recommendationId,
      );
      if (!recommendation) {
        back();
        return null;
      }
      return (
        <RecommendationScreen context={context} recommendation={recommendation} />
      );
    }

    case 'new-recommendation':
      return (
        <NewRecommendationScreen
          context={context}
          {...(current.parcelId ? { parcelId: current.parcelId } : {})}
        />
      );

    case 'queue':
      return <QueueScreen context={context} />;

    case 'settings':
      return <SettingsScreen context={context} />;

    default:
      return <ParcelsScreen context={context} />;
  }
}
