import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Binaire Next local : évite la couche `npx`, qui masquerait les signaux. */
const NEXT_BIN = path.resolve('node_modules/.bin/next');

/**
 * Démarre le serveur Next compilé pour les tests d'API.
 *
 * Les tests passent ainsi par la vraie chaîne HTTP : cookies de session,
 * vérification d'origine, contrôle des permissions et sérialisation des
 * réponses — et non par des appels de fonctions isolés.
 */
let server: ChildProcess | null = null;
let baseUrl = '';

const PORT = Number(process.env.TEST_PORT ?? 3111);

export function getBaseUrl(): string {
  if (!baseUrl) throw new Error('Le serveur de test n’est pas démarré.');
  return baseUrl;
}

export async function startServer(): Promise<string> {
  if (server) return baseUrl;

  const buildDir = path.resolve('.next');
  if (!existsSync(buildDir)) {
    throw new Error(
      'Build introuvable. Lancez « npm run build » avant les tests d’API.',
    );
  }

  baseUrl = `http://127.0.0.1:${PORT}`;

  // `detached` place le serveur dans son propre groupe de processus : à l'arrêt,
  // on peut tuer le groupe entier. Sans cela, `next start` laisse derrière lui un
  // `next-server` qui garde le port occupé et fait échouer la suite suivante.
  server = spawn(NEXT_BIN, ['start', '--port', String(PORT), '--hostname', '127.0.0.1'], {
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_URL: baseUrl,
      DATABASE_URL: process.env.DATABASE_URL,
      // La limitation de débit fausserait des tests exécutés en rafale ;
      // elle est vérifiée séparément par un test dédié qui la réactive.
      RATE_LIMIT_ENABLED: 'false',
      EMAIL_PROVIDER: 'console',
      // Coût de hachage minimal : les tests vérifient le comportement, pas la
      // résistance au calcul (la valeur de production reste celle de .env).
      PASSWORD_HASH_COST: '10',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes('Error') || text.includes('error')) {
      console.error('[next]', text.trim());
    }
  });

  await waitForReady(baseUrl, 45_000);
  return baseUrl;
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  const child = server;
  const pid = child.pid;
  server = null;

  const killGroup = (signal: NodeJS.Signals): void => {
    try {
      // Le pid négatif cible le groupe de processus (serveur + enfants).
      if (pid) process.kill(-pid, signal);
      else child.kill(signal);
    } catch {
      // le processus est déjà terminé
    }
  };

  killGroup('SIGTERM');

  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(() => {
      killGroup('SIGKILL');
      resolve(null);
    }, 5000);
  });

  // Laisse le port se libérer avant la suite de tests suivante.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/auth/session`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // le serveur n'écoute pas encore
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Le serveur de test n’a pas démarré en ${timeoutMs} ms.`);
}

// ---------------------------------------------------------------------------
// Client HTTP avec gestion du cookie de session
// ---------------------------------------------------------------------------

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  headers: Headers;
};

export class TestClient {
  private cookie: string | null = null;

  constructor(private readonly base = getBaseUrl()) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // Origine identique : sans elle, la protection CSRF rejetterait les
      // requêtes mutantes.
      Origin: this.base,
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...extra,
    };
  }

  private captureCookie(response: Response): void {
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      if (pair?.startsWith('parcelys_session=')) {
        this.cookie = pair.split('=')[1] ? pair : null;
      }
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(extraHeaders),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    this.captureCookie(response);

    const contentType = response.headers.get('content-type') ?? '';
    const parsed = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body ?? {});
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body ?? {});
  }
  delete<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, body);
  }

  /** Télécharge une réponse binaire (PDF, XLSX) avec la session courante. */
  async download(path: string): Promise<{ status: number; contentType: string; bytes: Buffer }> {
    const response = await fetch(`${this.base}${path}`, {
      headers: this.cookie ? { Cookie: this.cookie } : {},
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }

  /** Connexion : le cookie de session est conservé pour les appels suivants. */
  async login(email: string, password: string): Promise<ApiResponse> {
    return this.post('/api/auth/login', { email, password });
  }

  hasSession(): boolean {
    return this.cookie !== null;
  }

  clearSession(): void {
    this.cookie = null;
  }
}
