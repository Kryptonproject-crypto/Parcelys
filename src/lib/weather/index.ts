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
