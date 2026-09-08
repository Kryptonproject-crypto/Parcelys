import { z } from 'zod';

/**
 * Validation stricte de la configuration. Les intégrations externes
 * (e-mail, météo, cartographie, E-Phy) sont toutes optionnelles : lorsqu'aucune
 * clé n'est fournie, l'abstraction correspondante bascule sur un mode dégradé
 * explicite plutôt que d'inventer des données.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_NAME: z.string().default('Parcelys'),

  SESSION_COOKIE_NAME: z.string().default('parcelys_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
  SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(24 * 7),
  PASSWORD_HASH_COST: z.coerce.number().int().min(10).max(15).default(12),

  // E-mail : `console` écrit le message dans les logs (développement).
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('Parcelys <no-reply@parcelys.local>'),
  EMAIL_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  WEATHER_PROVIDER: z.enum(['open-meteo', 'openweathermap']).default('open-meteo'),
  WEATHER_API_KEY: z.string().optional(),

  MAP_TILE_URL: z
    .string()
    .default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  MAP_TILE_ATTRIBUTION: z
    .string()
    .default('&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'),
  MAP_API_KEY: z.string().optional(),
  GEOCODER_URL: z.string().default('https://api-adresse.data.gouv.fr/search/'),

  /** URL de l'archive officielle E-Phy (data.gouv.fr). Aucune valeur par défaut :
   *  sans configuration explicite, aucune donnée réglementaire n'est importée. */
  EPHY_DATA_URL: z.string().optional(),
  EPHY_DATA_DIR: z.string().default('./data/ephy'),

  UPLOAD_DIR: z.string().default('./storage/documents'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * En-tête où lire l'adresse du visiteur, écrit par le proxy de confiance.
   *
   * `x-forwarded-for` convient derrière nginx ou Caddy. Derrière Cloudflare —
   * tunnel compris —, préférez `cf-connecting-ip` : Cloudflare l'écrase à
   * chaque requête, un visiteur ne peut donc pas le forger, alors qu'il peut
   * amorcer `X-Forwarded-For` avec la valeur de son choix.
   *
   * Cette adresse sert à la limitation de débit et au journal d'audit : une
   * valeur que le visiteur contrôlerait permettrait de contourner l'une et de
   * fausser l'autre.
   */
  CLIENT_IP_HEADER: z
    .string()
    .default('x-forwarded-for')
    .transform((v) => v.trim().toLowerCase()),

  /**
   * Origines autorisées à appeler l'API depuis une application native.
   *
   * Une application Capacitor ne s'exécute pas sur l'origine du serveur : la
   * WebView sert ses fichiers depuis `http://localhost` (Android) ou
   * `capacitor://localhost` (iOS). Ces origines sont donc autorisées en CORS,
   * et elles seules — la valeur reste modifiable pour un `androidScheme`
   * personnalisé.
   */
  MOBILE_APP_ORIGINS: z
    .string()
    .default('capacitor://localhost,http://localhost,https://localhost,ionic://localhost')
    .transform((v) =>
      v
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  /**
   * Dépôt GitHub surveillé pour les mises à jour, sous la forme
   * `proprietaire/depot`. Sans cette variable, aucune requête ne part et la
   * section d'administration indique simplement que la vérification est
   * désactivée : une instance isolée du réseau le reste.
   *
   * La détection n'installe jamais rien — voir `src/lib/updates/releases.ts`.
   */
  UPDATE_REPOSITORY: z
    .string()
    .regex(
      /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/,
      'UPDATE_REPOSITORY attend la forme « proprietaire/depot »',
    )
    .optional(),

  DEMO_SEED_EMAIL: z.string().default('demo@parcelys.local'),
  DEMO_SEED_PASSWORD: z.string().default('Demo1234!'),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Oublie la configuration mise en cache.
 *
 * La configuration est lue une fois pour toutes : c'est ce qu'on veut d'un
 * processus en production, où l'environnement ne bouge pas. Les tests qui
 * éprouvent plusieurs réglages ont besoin de la relire.
 */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = () => getEnv().NODE_ENV === 'production';
