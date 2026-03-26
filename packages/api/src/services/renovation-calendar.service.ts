/**
 * Renovation calendar service — weather (Open-Meteo) + Israeli holidays (Hebcal).
 * Results are cached in-memory for 1 hour.
 */

interface WeatherDay {
  date: string; // YYYY-MM-DD
  rain: boolean; // precipitation > 1mm
  wind: boolean; // wind speed > 40 km/h
  rainMm: number;
  windKmh: number;
}

interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  dayOff: boolean; // yomtov or shabbat — no work
}

export interface CalendarData {
  weather: WeatherDay[];
  holidays: Holiday[];
}

// Weather location — override via LOCATION_LAT / LOCATION_LON env vars
const LAT = parseFloat(process.env.LOCATION_LAT || '32.79');
const LON = parseFloat(process.env.LOCATION_LON || '34.99');

let cache: { data: CalendarData; ts: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchWeather(): Promise<WeatherDay[]> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=precipitation_sum,wind_speed_10m_max&timezone=Asia/Jerusalem&forecast_days=16`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('[renovation-calendar] Open-Meteo error:', res.status);
      return [];
    }
    const json = await res.json();
    const dates: string[] = json.daily?.time ?? [];
    const precip: number[] = json.daily?.precipitation_sum ?? [];
    const wind: number[] = json.daily?.wind_speed_10m_max ?? [];
    return dates.map((date, i) => ({
      date,
      rain: (precip[i] ?? 0) > 1,
      wind: (wind[i] ?? 0) > 40,
      rainMm: Math.round((precip[i] ?? 0) * 10) / 10,
      windKmh: Math.round(wind[i] ?? 0),
    }));
  } catch (err) {
    console.error('[renovation-calendar] Weather fetch failed:', err);
    return [];
  }
}

async function fetchHolidays(): Promise<Holiday[]> {
  try {
    const now = new Date();
    const year = now.getFullYear();
    // Fetch current and next year to cover near-future range
    const years = [year, year + 1];
    const all: Holiday[] = [];
    for (const y of years) {
      const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&nx=off&year=${y}&month=x&ss=off&mf=off&c=off&geo=none`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[renovation-calendar] Hebcal error for ${y}:`, res.status);
        continue;
      }
      const json = await res.json();
      for (const item of json.items ?? []) {
        if (item.category !== 'holiday') continue;
        const date = item.date?.substring(0, 10);
        if (!date) continue;
        all.push({
          date,
          name: item.title ?? '',
          dayOff: item.yomtov === true || item.subcat === 'shabbat',
        });
      }
    }
    return all;
  } catch (err) {
    console.error('[renovation-calendar] Holiday fetch failed:', err);
    return [];
  }
}

export async function getRenovationCalendar(): Promise<CalendarData> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return cache.data;
  }
  const [weather, holidays] = await Promise.all([fetchWeather(), fetchHolidays()]);
  const data = { weather, holidays };
  cache = { data, ts: Date.now() };
  return data;
}
