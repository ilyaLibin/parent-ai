import { RenovationView } from './renovation-view';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface RenovationJob {
  id: number;
  name: string;
  category: string;
  start_date: string;
  end_date: string;
  color: string;
  sort_order: number;
  notes: string | null;
  accepted_worker_name: string | null;
  accepted_worker_price: number | null;
  worker_count: number;
  contact_count: number;
  contacted_count: number;
  offer_count: number;
  has_accepted_worker: boolean;
  max_worker_stage: string | null;
  created_at: number;
  updated_at: number;
}

export interface RenovationWorker {
  id: number;
  job_id: number;
  name: string;
  phone: string | null;
  offer_price: number | null;
  stage: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface RenovationPhase {
  id: number;
  job_id: number;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface PhaseDependency {
  id: number;
  phase_id: number;
  depends_on_id: number;
  created_at: number;
}

export interface RenovationSettings {
  project_start: string | null;
  project_end: string | null;
  project_name: string | null;
  hide_prices: boolean;
}

export interface WeatherDay {
  date: string;
  rain: boolean;
  wind: boolean;
  rainMm: number;
  windKmh: number;
}

export interface HolidayDay {
  date: string;
  name: string;
  dayOff: boolean;
}

export interface CalendarData {
  weather: WeatherDay[];
  holidays: HolidayDay[];
}

async function getJobs(): Promise<RenovationJob[]> {
  const res = await fetch(`${API_URL}/renovation/jobs`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getPhases(): Promise<RenovationPhase[]> {
  const res = await fetch(`${API_URL}/renovation/phases`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getDependencies(): Promise<PhaseDependency[]> {
  const res = await fetch(`${API_URL}/renovation/phase-deps`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function getSettings(): Promise<RenovationSettings> {
  const res = await fetch(`${API_URL}/renovation/settings`, { cache: 'no-store' });
  if (!res.ok) return { project_start: null, project_end: null, project_name: null, hide_prices: false };
  return res.json();
}

async function getCalendar(): Promise<CalendarData> {
  const res = await fetch(`${API_URL}/renovation/calendar`, { cache: 'no-store' });
  if (!res.ok) return { weather: [], holidays: [] };
  return res.json();
}

export default async function RenovationPage() {
  const [jobs, phases, deps, settings, calendar] = await Promise.all([getJobs(), getPhases(), getDependencies(), getSettings(), getCalendar()]);
  return <RenovationView initialJobs={jobs} initialPhases={phases} initialDeps={deps} initialSettings={settings} initialCalendar={calendar} />;
}
