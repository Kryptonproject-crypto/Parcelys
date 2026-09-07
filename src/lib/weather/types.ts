export type CurrentWeather = {
  observedAt: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  humidity: number | null;
  windKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  precipitationMm: number | null;
  pressureHpa: number | null;
  cloudCoverPercent: number | null;
  summary: string;
  isDay: boolean;
};

export type HourlyForecast = {
  time: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windKmh: number | null;
  humidity: number | null;
  summary: string;
};

export type DailyForecast = {
  date: string;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windMaxKmh: number | null;
  summary: string;
};

export type WeatherBundle = {
  provider: string;
  latitude: number;
  longitude: number;
  timezone: string;
  fetchedAt: string;
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
};

export interface WeatherProvider {
  readonly name: string;
  /** Toutes les données en un appel (actuel + horaire + journalier). */
  fetchBundle(latitude: number, longitude: number): Promise<WeatherBundle>;
}

export class WeatherUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherUnavailableError';
  }
}
