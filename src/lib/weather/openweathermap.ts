import {
  WeatherUnavailableError,
  type DailyForecast,
  type HourlyForecast,
  type WeatherBundle,
  type WeatherProvider,
} from '@/lib/weather/types';

type OwmCurrent = {
  dt: number;
  main?: { temp?: number; feels_like?: number; humidity?: number; pressure?: number };
  wind?: { speed?: number; deg?: number; gust?: number };
  clouds?: { all?: number };
  rain?: { '1h'?: number };
  weather?: Array<{ description?: string; icon?: string }>;
};

type OwmForecastEntry = {
  dt: number;
  dt_txt: string;
  main?: { temp?: number; temp_min?: number; temp_max?: number; humidity?: number };
  wind?: { speed?: number };
  pop?: number;
  rain?: { '3h'?: number };
  weather?: Array<{ description?: string }>;
};

const msToKmh = (v: number | undefined): number | null =>
  typeof v === 'number' ? Math.round(v * 3.6 * 10) / 10 : null;

const nullable = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * OpenWeatherMap — nécessite `WEATHER_API_KEY`.
 * Utilise les endpoints gratuits `weather` et `forecast` (pas de One Call 3.0),
 * ce qui limite les prévisions journalières à 5 jours par pas de 3 h.
 */
export class OpenWeatherMapProvider implements WeatherProvider {
  readonly name = 'openweathermap';

  constructor(private readonly apiKey: string) {}

  private async call<T>(path: string, lat: number, lon: number): Promise<T> {
    const url = new URL(`https://api.openweathermap.org/data/2.5/${path}`);
    url.searchParams.set('lat', lat.toFixed(4));
    url.searchParams.set('lon', lon.toFixed(4));
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'fr');
    url.searchParams.set('appid', this.apiKey);

    const response = await fetch(url, { next: { revalidate: 600 } });
    if (!response.ok) {
      throw new WeatherUnavailableError(
        response.status === 401
          ? 'Clé WEATHER_API_KEY refusée par OpenWeatherMap'
          : `OpenWeatherMap a répondu ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }

  async fetchBundle(latitude: number, longitude: number): Promise<WeatherBundle> {
    const [now, forecast] = await Promise.all([
      this.call<OwmCurrent>('weather', latitude, longitude),
      this.call<{ list?: OwmForecastEntry[]; city?: { timezone?: number } }>(
        'forecast',
        latitude,
        longitude,
      ),
    ]);

    const entries = forecast.list ?? [];

    const hourly: HourlyForecast[] = entries.slice(0, 16).map((e) => ({
      time: new Date(e.dt * 1000).toISOString(),
      temperatureC: nullable(e.main?.temp),
      precipitationMm: nullable(e.rain?.['3h']),
      precipitationProbability:
        typeof e.pop === 'number' ? Math.round(e.pop * 100) : null,
      windKmh: msToKmh(e.wind?.speed),
      humidity: nullable(e.main?.humidity),
      summary: capitalize(e.weather?.[0]?.description ?? 'Conditions inconnues'),
    }));

    // Agrégation des pas de 3 h en journées.
    const byDay = new Map<string, OwmForecastEntry[]>();
    for (const entry of entries) {
      const day = entry.dt_txt?.slice(0, 10) ?? '';
      if (!day) continue;
      const bucket = byDay.get(day);
      if (bucket) bucket.push(entry);
      else byDay.set(day, [entry]);
    }

    const daily: DailyForecast[] = [...byDay.entries()].map(([date, list]) => {
      const temps = list.map((e) => e.main?.temp).filter((v): v is number => v !== undefined);
      const winds = list.map((e) => e.wind?.speed).filter((v): v is number => v !== undefined);
      const pops = list.map((e) => e.pop).filter((v): v is number => v !== undefined);
      const rain = list.reduce((sum, e) => sum + (e.rain?.['3h'] ?? 0), 0);
      return {
        date,
        temperatureMinC: temps.length ? Math.min(...temps) : null,
        temperatureMaxC: temps.length ? Math.max(...temps) : null,
        precipitationMm: Math.round(rain * 10) / 10,
        precipitationProbability: pops.length ? Math.round(Math.max(...pops) * 100) : null,
        windMaxKmh: winds.length ? msToKmh(Math.max(...winds)) : null,
        summary: capitalize(list[0]?.weather?.[0]?.description ?? 'Conditions inconnues'),
      };
    });

    return {
      provider: this.name,
      latitude,
      longitude,
      timezone: 'auto',
      fetchedAt: new Date().toISOString(),
      current: {
        observedAt: new Date((now.dt ?? Date.now() / 1000) * 1000).toISOString(),
        temperatureC: nullable(now.main?.temp),
        apparentTemperatureC: nullable(now.main?.feels_like),
        humidity: nullable(now.main?.humidity),
        windKmh: msToKmh(now.wind?.speed),
        windDirectionDeg: nullable(now.wind?.deg),
        windGustKmh: msToKmh(now.wind?.gust),
        precipitationMm: nullable(now.rain?.['1h']),
        pressureHpa: nullable(now.main?.pressure),
        cloudCoverPercent: nullable(now.clouds?.all),
        summary: capitalize(now.weather?.[0]?.description ?? 'Conditions inconnues'),
        isDay: true,
      },
      hourly,
      daily,
    };
  }
}
