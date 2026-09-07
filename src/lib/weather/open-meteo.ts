import {
  WeatherUnavailableError,
  type CurrentWeather,
  type DailyForecast,
  type HourlyForecast,
  type WeatherBundle,
  type WeatherProvider,
} from '@/lib/weather/types';

/** Codes WMO renvoyés par Open-Meteo (documentation officielle du service). */
const WMO_LABELS: Record<number, string> = {
  0: 'Ciel dégagé',
  1: 'Principalement dégagé',
  2: 'Partiellement nuageux',
  3: 'Couvert',
  45: 'Brouillard',
  48: 'Brouillard givrant',
  51: 'Bruine légère',
  53: 'Bruine modérée',
  55: 'Bruine dense',
  56: 'Bruine verglaçante légère',
  57: 'Bruine verglaçante dense',
  61: 'Pluie faible',
  63: 'Pluie modérée',
  65: 'Pluie forte',
  66: 'Pluie verglaçante faible',
  67: 'Pluie verglaçante forte',
  71: 'Neige faible',
  73: 'Neige modérée',
  75: 'Neige forte',
  77: 'Grains de neige',
  80: 'Averses faibles',
  81: 'Averses modérées',
  82: 'Averses violentes',
  85: 'Averses de neige faibles',
  86: 'Averses de neige fortes',
  95: 'Orage',
  96: 'Orage avec grêle légère',
  99: 'Orage avec grêle forte',
};

export function describeWeatherCode(code: number | null | undefined): string {
  if (code === null || code === undefined) return 'Conditions inconnues';
  return WMO_LABELS[code] ?? 'Conditions inconnues';
}

type OpenMeteoResponse = {
  timezone?: string;
  current?: Record<string, number | string>;
  hourly?: Record<string, Array<number | string | null>>;
  daily?: Record<string, Array<number | string | null>>;
};

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Open-Meteo — API météo publique, sans clé, réutilisation libre.
 * Source : https://open-meteo.com/
 */
export class OpenMeteoProvider implements WeatherProvider {
  readonly name = 'open-meteo';

  async fetchBundle(latitude: number, longitude: number): Promise<WeatherBundle> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude.toFixed(4));
    url.searchParams.set('longitude', longitude.toFixed(4));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', '7');
    url.searchParams.set(
      'current',
      [
        'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
        'precipitation', 'weather_code', 'surface_pressure', 'cloud_cover',
        'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day',
      ].join(','),
    );
    url.searchParams.set(
      'hourly',
      [
        'temperature_2m', 'relative_humidity_2m', 'precipitation',
        'precipitation_probability', 'weather_code', 'wind_speed_10m',
      ].join(','),
    );
    url.searchParams.set(
      'daily',
      [
        'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
        'precipitation_probability_max', 'weather_code', 'wind_speed_10m_max',
      ].join(','),
    );

    let payload: OpenMeteoResponse;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: 600 },
      });
      if (!response.ok) {
        throw new WeatherUnavailableError(
          `Le service météo a répondu ${response.status}`,
        );
      }
      payload = (await response.json()) as OpenMeteoResponse;
    } catch (error) {
      if (error instanceof WeatherUnavailableError) throw error;
      throw new WeatherUnavailableError(
        'Service météo injoignable. Vérifiez la connexion réseau du serveur.',
      );
    }

    const c = payload.current ?? {};
    const current: CurrentWeather = {
      observedAt: String(c.time ?? new Date().toISOString()),
      temperatureC: num(c.temperature_2m),
      apparentTemperatureC: num(c.apparent_temperature),
      humidity: num(c.relative_humidity_2m),
      windKmh: num(c.wind_speed_10m),
      windDirectionDeg: num(c.wind_direction_10m),
      windGustKmh: num(c.wind_gusts_10m),
      precipitationMm: num(c.precipitation),
      pressureHpa: num(c.surface_pressure),
      cloudCoverPercent: num(c.cloud_cover),
      summary: describeWeatherCode(num(c.weather_code)),
      isDay: num(c.is_day) !== 0,
    };

    const h = payload.hourly ?? {};
    const times = (h.time ?? []) as Array<string>;
    const nowMs = Date.now();
    const hourly: HourlyForecast[] = times
      .map((time, i) => ({
        time,
        temperatureC: num(h.temperature_2m?.[i]),
        precipitationMm: num(h.precipitation?.[i]),
        precipitationProbability: num(h.precipitation_probability?.[i]),
        windKmh: num(h.wind_speed_10m?.[i]),
        humidity: num(h.relative_humidity_2m?.[i]),
        summary: describeWeatherCode(num(h.weather_code?.[i])),
      }))
      .filter((entry) => new Date(entry.time).getTime() >= nowMs - 3600_000)
      .slice(0, 48);

    const d = payload.daily ?? {};
    const days = (d.time ?? []) as Array<string>;
    const daily: DailyForecast[] = days.map((date, i) => ({
      date,
      temperatureMinC: num(d.temperature_2m_min?.[i]),
      temperatureMaxC: num(d.temperature_2m_max?.[i]),
      precipitationMm: num(d.precipitation_sum?.[i]),
      precipitationProbability: num(d.precipitation_probability_max?.[i]),
      windMaxKmh: num(d.wind_speed_10m_max?.[i]),
      summary: describeWeatherCode(num(d.weather_code?.[i])),
    }));

    return {
      provider: this.name,
      latitude,
      longitude,
      timezone: payload.timezone ?? 'UTC',
      fetchedAt: new Date().toISOString(),
      current,
      hourly,
      daily,
    };
  }
}
