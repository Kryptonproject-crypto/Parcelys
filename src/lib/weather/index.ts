import { Prisma } from '@prisma/client';
import { getEnv } from '@/lib/env';
import { OpenMeteoProvider } from '@/lib/weather/open-meteo';
import { OpenWeatherMapProvider } from '@/lib/weather/openweathermap';
import {
  WeatherUnavailableError,
  type WeatherBundle,
  type WeatherProvider,
} from '@/lib/weather/types';

export * from '@/lib/weather/types';
export { describeWeatherCode } from '@/lib/weather/open-meteo';

/**
 * Sélection du fournisseur météo. `preferred` permet à un utilisateur ou à une
 * exploitation de surcharger le réglage global sans changer le code appelant.
 */
export function getWeatherProvider(preferred?: string | null): WeatherProvider {
  const env = getEnv();
  const choice = preferred ?? env.WEATHER_PROVIDER;

  if (choice === 'openweathermap') {
    if (!env.WEATHER_API_KEY) {
      throw new WeatherUnavailableError(
        'WEATHER_API_KEY est requis pour le fournisseur OpenWeatherMap.',
      );
    }
    return new OpenWeatherMapProvider(env.WEATHER_API_KEY);
  }

  return new OpenMeteoProvider();
}

export async function fetchWeather(
  latitude: number,
  longitude: number,
  preferred?: string | null,
): Promise<WeatherBundle> {
  return getWeatherProvider(preferred).fetchBundle(latitude, longitude);
}

/**
 * Conditions instantanées destinées à documenter un traitement phytosanitaire.
 * Renvoie `null` en cas d'indisponibilité : la saisie ne doit jamais être
 * bloquée par un service tiers, et aucune valeur ne doit être inventée.
 */
export async function captureTreatmentConditions(
  latitude: number,
  longitude: number,
  preferred?: string | null,
): Promise<{
  temperatureC: number | null;
  windKmh: number | null;
  humidity: number | null;
  precipitationMm: number | null;
  summary: string;
  provider: string;
} | null> {
  try {
    const bundle = await fetchWeather(latitude, longitude, preferred);
    return {
      temperatureC: bundle.current.temperatureC,
      windKmh: bundle.current.windKmh,
      humidity: bundle.current.humidity,
      precipitationMm: bundle.current.precipitationMm,
      summary: bundle.current.summary,
      provider: bundle.provider,
    };
  } catch (error) {
    console.warn('[weather] conditions non capturées', error);
    return null;
  }
}

/** Fenêtre de traitement : vent modéré, pas de pluie, température clémente. */
export function assessSprayingWindow(bundle: WeatherBundle): {
  suitable: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const { windKmh, temperatureC, precipitationMm } = bundle.current;

  if (windKmh !== null && windKmh > 19) {
    reasons.push(`Vent de ${windKmh} km/h (au-delà de 19 km/h, la pulvérisation est interdite)`);
  }
  if (precipitationMm !== null && precipitationMm > 0.2) {
    reasons.push('Précipitations en cours');
  }
  if (temperatureC !== null && temperatureC > 25) {
    reasons.push(`Température de ${temperatureC} °C (risque d'évaporation)`);
  }
  const nextHours = bundle.hourly.slice(0, 6);
  const rainSoon = nextHours.reduce((sum, h) => sum + (h.precipitationMm ?? 0), 0);
  if (rainSoon > 1) {
    reasons.push(`Pluie annoncée dans les 6 h (${rainSoon.toFixed(1)} mm)`);
  }

  return { suitable: reasons.length === 0, reasons };
}

/**
 * Conditions à enregistrer avec une intervention — traitement, apport, travail.
 *
 * Trois sources possibles, dans cet ordre :
 *
 *  1. les valeurs transmises par l'appelant. L'application de terrain les relève
 *     au moment de la saisie : c'est la seule météo juste, puisqu'une file
 *     d'attente peut partir des heures plus tard ;
 *  2. un relevé fait ici, si `captureWeather` le demande et que la parcelle est
 *     localisée — c'est le chemin du formulaire web, saisi sur le moment ;
 *  3. rien. Aucune valeur n'est déduite, aucune moyenne inventée : une donnée
 *     réglementaire absente reste absente, et `weatherSource` reste nul.
 */
export type InterventionWeather = {
  weatherTempC: number | null;
  weatherWindKmh: number | null;
  weatherHumidity: number | null;
  weatherRainMm: number | null;
  weatherSummary: string | null;
  weatherSource: string | null;
};

export async function resolveInterventionWeather(
  input: {
    captureWeather?: boolean;
    weatherTempC?: number | undefined;
    weatherWindKmh?: number | undefined;
    weatherHumidity?: number | undefined;
    weatherRainMm?: number | undefined;
    weatherSummary?: string | undefined;
    weatherSource?: string | undefined;
  },
  location: { latitude: number | null; longitude: number | null } | null,
  preferredProvider?: string | null,
): Promise<InterventionWeather> {
  const fourni: InterventionWeather = {
    weatherTempC: input.weatherTempC ?? null,
    weatherWindKmh: input.weatherWindKmh ?? null,
    weatherHumidity: input.weatherHumidity ?? null,
    weatherRainMm: input.weatherRainMm ?? null,
    weatherSummary: input.weatherSummary ?? null,
    // Une valeur transmise sans provenance déclarée vient de l'appareil.
    weatherSource:
      input.weatherSource ??
      (input.weatherTempC !== undefined || input.weatherSummary !== undefined
        ? 'appareil'
        : null),
  };

  const aDesValeurs =
    fourni.weatherTempC !== null ||
    fourni.weatherWindKmh !== null ||
    fourni.weatherHumidity !== null ||
    fourni.weatherRainMm !== null ||
    fourni.weatherSummary !== null;

  // Ce qui a été relevé au champ prime sur ce qu'on irait chercher maintenant.
  if (aDesValeurs || !input.captureWeather) return fourni;

  if (location?.latitude == null || location.longitude == null) return fourni;

  const releve = await captureTreatmentConditions(
    location.latitude,
    location.longitude,
    preferredProvider,
  );
  if (!releve) return fourni;

  return {
    weatherTempC: releve.temperatureC,
    weatherWindKmh: releve.windKmh,
    weatherHumidity: releve.humidity,
    weatherRainMm: releve.precipitationMm,
    weatherSummary: releve.summary,
    weatherSource: releve.provider,
  };
}

/**
 * Traduit les conditions en colonnes Prisma.
 *
 * Les trois tables — traitements, apports, travaux — portent exactement les
 * mêmes six colonnes : autant les écrire au même endroit, sinon la prochaine
 * en oubliera une et personne ne le verra avant de lire un registre incomplet.
 */
export function decimalWeather(weather: InterventionWeather): {
  weatherTempC: Prisma.Decimal | null;
  weatherWindKmh: Prisma.Decimal | null;
  weatherHumidity: Prisma.Decimal | null;
  weatherRainMm: Prisma.Decimal | null;
  weatherSummary: string | null;
  weatherSource: string | null;
} {
  const dec = (v: number | null) => (v !== null ? new Prisma.Decimal(v) : null);
  return {
    weatherTempC: dec(weather.weatherTempC),
    weatherWindKmh: dec(weather.weatherWindKmh),
    weatherHumidity: dec(weather.weatherHumidity),
    weatherRainMm: dec(weather.weatherRainMm),
    weatherSummary: weather.weatherSummary,
    weatherSource: weather.weatherSource,
  };
}
