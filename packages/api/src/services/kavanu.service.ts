import { randomBytes } from 'node:crypto';
import {
  getIntegration,
  saveIntegration,
  getIntegrationToken,
  saveIntegrationToken,
} from '@parent-ai/shared';

// Client for Kavanu (kavanu.co), the booking system the barbershop uses. There is no
// public API — these are the endpoints the customer web app (customers.kavanu.co)
// calls, captured from its traffic/JS bundle. See ~/.claude/skills/kavanu-booking/API.md.
const WEB_API = 'https://api.kavanu.co/api';
const AUTH_SERVER = 'https://auth.kavanu.co';
const CLIENT_ID = '2'; // userTypeEnum.Customer in the web app
const INTEGRATION_TYPE = 'kavanu';
const FAMILY_TIMEZONE = 'Asia/Jerusalem';

interface KavanuConfig {
  companyId: number;
  companyUid: string;
  defaultEmployeeId: number;
  fullName?: string;
  phone?: string;
  // Account password we set ourselves during SMS login (RegisterCustomerToCompany always
  // sets a new one). Lets us re-login without SMS until the user logs in via the Kavanu
  // app/site again, which overwrites it.
  password?: string;
  customerUid?: string;
}

// מספרת רונן לוי, Haifa — Ronen Levi as the default barber.
const DEFAULT_CONFIG: KavanuConfig = {
  companyId: 898,
  companyUid: '01da99eff28b4b8a8b5fb639e8ec012a',
  defaultEmployeeId: 1986,
};

// Thrown when no stored credential works anymore and the user has to log in via SMS again.
export class KavanuLoginRequiredError extends Error {
  constructor(message = 'Kavanu login required') {
    super(message);
    this.name = 'KavanuLoginRequiredError';
  }
}

function getConfig(): KavanuConfig {
  const integration = getIntegration(INTEGRATION_TYPE);
  const stored = integration ? (JSON.parse(integration.config_json) as Partial<KavanuConfig>) : {};
  return { ...DEFAULT_CONFIG, ...stored };
}

function updateConfig(patch: Partial<KavanuConfig>): KavanuConfig {
  const next = { ...getConfig(), ...patch };
  saveIntegration(INTEGRATION_TYPE, JSON.stringify(next));
  return next;
}

// Kavanu expects E.164 (+972...). Accept the local "05x..." form people actually type.
export function normalizeIsraeliPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('972')) return `+${digits}`;
  if (digits.startsWith('0')) return `+972${digits.slice(1)}`;
  return `+972${digits}`;
}

// ---------- time helpers ----------

// Same approach as parseFamilyLocalDateTime in tool-registry: attach the real
// Asia/Jerusalem offset for that moment instead of trusting the runtime timezone.
function familyLocalToDate(date: string, time: string): Date {
  const naive = `${date}T${time}:00`;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FAMILY_TIMEZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${naive}Z`));
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const offset = tzName.replace('GMT', '') || '+00:00';
  return new Date(`${naive}${offset}`);
}

function toFamilyLocal(isoUtc: string | Date): { date: string; time: string; weekday: string } {
  const d = typeof isoUtc === 'string' ? new Date(isoUtc) : isoUtc;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: FAMILY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: FAMILY_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: FAMILY_TIMEZONE, weekday: 'long' }).format(d);
  return { date, time, weekday };
}

function todayInFamilyTz(): string {
  return toFamilyLocal(new Date()).date;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- auth ----------

async function requestToken(form: Record<string, string>): Promise<string> {
  const res = await fetch(`${AUTH_SERVER}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`Kavanu token request failed (${res.status}): ${body.error || 'no access_token'}`);
  }
  // Refresh tokens rotate on every use — always persist the new one.
  saveIntegrationToken(INTEGRATION_TYPE, {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? null,
    token_type: 'Bearer',
    expiry_date: Date.now() + (body.expires_in ?? 7200) * 1000,
  });
  return body.access_token;
}

function passwordGrant(config: KavanuConfig): Promise<string> {
  return requestToken({
    client_Id: CLIENT_ID,
    grant_type: 'password',
    Username: config.phone!,
    Password: config.password!,
    UserType: CLIENT_ID,
    ProductId: '1',
    Channel: 'Web',
    SubChannel: 'parent-ai',
  });
}

// Prefer the cached access token, then the refresh token, then the stored password.
// Only when all three fail does the user need a new SMS code.
async function getAccessToken(forceRenew = false): Promise<string> {
  const token = getIntegrationToken(INTEGRATION_TYPE);
  if (!forceRenew && token?.access_token && token.expiry_date && token.expiry_date - 60_000 > Date.now()) {
    return token.access_token;
  }

  if (token?.refresh_token) {
    try {
      return await requestToken({ client_Id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: token.refresh_token });
    } catch (err) {
      console.warn('[kavanu] Refresh failed, falling back to password:', err instanceof Error ? err.message : err);
    }
  }

  const config = getConfig();
  if (config.phone && config.password) {
    try {
      return await passwordGrant(config);
    } catch (err) {
      console.warn('[kavanu] Password login failed:', err instanceof Error ? err.message : err);
    }
  }

  throw new KavanuLoginRequiredError();
}

async function kavanuFetch<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = init;

  const send = async (forceRenew: boolean) => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) headers.Authorization = `Bearer ${await getAccessToken(forceRenew)}`;
    return fetch(`${WEB_API}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };

  let res = await send(false);
  if (res.status === 401 && auth) res = await send(true);

  const text = await res.text();
  if (!res.ok) throw new Error(`Kavanu ${method} ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------- SMS login ----------

export async function requestLoginCode(params: { fullName?: string; phone?: string }): Promise<{ phone: string }> {
  const patch: Partial<KavanuConfig> = {};
  if (params.fullName) patch.fullName = params.fullName;
  if (params.phone) patch.phone = normalizeIsraeliPhone(params.phone);
  const config = Object.keys(patch).length ? updateConfig(patch) : getConfig();
  if (!config.phone || !config.fullName) {
    throw new Error('Need the full name and phone number used for Kavanu before a login code can be sent.');
  }

  const result = await kavanuFetch<{ success?: boolean }>('OTP/RequestOTPForAddCustomer', {
    method: 'POST',
    auth: false,
    body: { phoneNumber: config.phone, companyUid: config.companyUid },
  });
  if (!result.success) throw new Error('Kavanu did not accept the login code request.');
  return { phone: config.phone };
}

export async function submitLoginCode(code: string): Promise<{ customerUid: string }> {
  const config = getConfig();
  if (!config.phone || !config.fullName) throw new Error('Call requestLoginCode first.');

  // Same as the web app's "continue with pin code" path: registering with the pin sets a
  // fresh account password, which we then keep for SMS-free logins later.
  const password = randomBytes(12).toString('base64url');
  const result = await kavanuFetch<{ success?: boolean }>('CustomerBase/RegisterCustomerToCompany', {
    method: 'POST',
    auth: false,
    body: { pinCode: code.trim(), fullName: config.fullName, phone: config.phone, password, companyUid: config.companyUid },
  });
  if (!result.success) throw new Error('Kavanu rejected the code — it may be wrong or expired.');

  const withPassword = updateConfig({ password });
  await passwordGrant(withPassword);

  const base = await kavanuFetch<{ customer: { customers: { uid: string; company?: { id: number } }[] } }>(
    'CustomerBase/GetCustomerBaseData'
  );
  const match = base.customer.customers.find((c) => c.company?.id === config.companyId) ?? base.customer.customers[0];
  if (!match) throw new Error('Logged in, but no customer record was found for this salon.');
  updateConfig({ customerUid: match.uid });
  return { customerUid: match.uid };
}

async function getCustomerUid(): Promise<string> {
  const config = getConfig();
  if (config.customerUid) return config.customerUid;
  // Logged in some other way (or config was reset) — look it up once.
  const base = await kavanuFetch<{ customer: { customers: { uid: string; company?: { id: number } }[] } }>(
    'CustomerBase/GetCustomerBaseData'
  );
  const match = base.customer.customers.find((c) => c.company?.id === config.companyId);
  if (!match) throw new KavanuLoginRequiredError('No Kavanu customer record for this salon');
  updateConfig({ customerUid: match.uid });
  return match.uid;
}

// ---------- catalog ----------

export interface KavanuService {
  id: number;
  name: string;
  minutes: number;
  autoApprove: boolean;
}

export interface KavanuEmployee {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  profileImageUrl: string;
  services: KavanuService[];
}

let employeesCache: { at: number; employees: KavanuEmployee[] } | null = null;

export async function getEmployees(): Promise<KavanuEmployee[]> {
  if (employeesCache && Date.now() - employeesCache.at < 60 * 60 * 1000) return employeesCache.employees;
  const { companyId } = getConfig();
  const data = await kavanuFetch<{
    employees: {
      employeeId: number;
      firstName: string;
      lastName: string;
      profileImageUrl: string;
      appointmentTypes: { id: number; name: string; averageTimeMinutes: number; isActive: boolean; isAllowOnlineAppointment: boolean; isAutoApprove: boolean }[];
    }[];
  }>(`Company/GetCompanyEmployeesDetails?companyId=${companyId}`);

  const employees = data.employees.map((e) => ({
    id: e.employeeId,
    name: `${e.firstName} ${e.lastName}`.trim(),
    firstName: e.firstName,
    lastName: e.lastName,
    profileImageUrl: e.profileImageUrl,
    services: e.appointmentTypes
      .filter((t) => t.isActive && t.isAllowOnlineAppointment)
      .map((t) => ({ id: t.id, name: t.name, minutes: Math.round(t.averageTimeMinutes), autoApprove: t.isAutoApprove })),
  }));
  employeesCache = { at: Date.now(), employees };
  return employees;
}

export async function resolveEmployee(barber?: string): Promise<KavanuEmployee> {
  const employees = await getEmployees();
  if (!barber) {
    const { defaultEmployeeId } = getConfig();
    const fallback = employees.find((e) => e.id === defaultEmployeeId);
    if (!fallback) throw new Error(`Default barber ${defaultEmployeeId} not found at this salon`);
    return fallback;
  }
  const q = barber.trim().toLowerCase();
  const hit = employees.find((e) => String(e.id) === q || e.name.toLowerCase().includes(q) || e.firstName.toLowerCase() === q);
  if (!hit) throw new Error(`Unknown barber "${barber}". Available: ${employees.map((e) => e.name).join(', ')}`);
  return hit;
}

export function resolveService(employee: KavanuEmployee, service: string): KavanuService {
  const q = service.trim();
  const exact = employee.services.find((s) => s.name === q || String(s.id) === q);
  if (exact) return exact;
  const partial = employee.services.filter((s) => s.name.includes(q));
  if (partial.length === 1) return partial[0];
  throw new Error(
    `Unknown or ambiguous service "${service}" for ${employee.name}. Available: ${employee.services.map((s) => s.name).join(', ')}`
  );
}

// ---------- availability ----------

export interface DaySlots {
  date: string;
  weekday: string;
  times: string[];
}

export async function getSlots(params: {
  employee: KavanuEmployee;
  service: KavanuService;
  fromDate?: string;
  daysWithSlots?: number;
  maxDaysToScan?: number;
}): Promise<DaySlots[]> {
  const { companyId } = getConfig();
  const customerUid = await getCustomerUid();
  const daysWithSlots = params.daysWithSlots ?? 3;
  const maxDaysToScan = params.maxDaysToScan ?? 45;

  const result: DaySlots[] = [];
  let cursor = params.fromDate || todayInFamilyTz();
  let scanned = 0;

  while (result.length < daysWithSlots && scanned < maxDaysToScan) {
    const week = await kavanuFetch<{ dates: { date: string; isOpen: boolean; freeHours: { startTime: string }[] }[] }>(
      `Appointment/GetCalendarWeekOccupancy?companyId=${companyId}&customerUid=${customerUid}` +
        `&date=${cursor}&employeeId=${params.employee.id}&sumAppointmentMinutes=${params.service.minutes}`
    );
    if (!week.dates.length) break;

    for (const day of week.dates) {
      if (result.length >= daysWithSlots) break;
      if (!day.isOpen || day.freeHours.length === 0) continue;
      const date = day.date.slice(0, 10);
      result.push({
        date,
        weekday: toFamilyLocal(familyLocalToDate(date, '12:00')).weekday,
        times: day.freeHours.map((h) => toFamilyLocal(h.startTime).time),
      });
    }

    scanned += week.dates.length;
    cursor = addDays(week.dates[week.dates.length - 1].date.slice(0, 10), 1);
  }
  return result;
}

export async function isSlotFree(employee: KavanuEmployee, service: KavanuService, date: string, time: string): Promise<boolean> {
  const days = await getSlots({ employee, service, fromDate: date, daysWithSlots: 1, maxDaysToScan: 1 });
  return days.some((d) => d.date === date && d.times.includes(time));
}

// ---------- appointments ----------

export interface KavanuAppointment {
  uid: string;
  date: string;
  weekday: string;
  startTime: string;
  endTime: string;
  services: string[];
  barber: string;
}

export async function listAppointments(): Promise<KavanuAppointment[]> {
  const { companyId } = getConfig();
  const customerUid = await getCustomerUid();
  const data = await kavanuFetch<{
    appointments: {
      uid: string;
      scheduledStart: string;
      scheduledEnd: string;
      employeeFirstName: string;
      employeeLastName: string;
      appointmentTypes: { name: string }[];
    }[];
  }>(`Appointment/GetCustomerFutureActiveAppointments?companyId=${companyId}&customerUid=${customerUid}&limit=20&offset=1`);

  return data.appointments.map((a) => {
    const start = toFamilyLocal(a.scheduledStart);
    return {
      uid: a.uid,
      date: start.date,
      weekday: start.weekday,
      startTime: start.time,
      endTime: toFamilyLocal(a.scheduledEnd).time,
      services: a.appointmentTypes.map((t) => t.name),
      barber: `${a.employeeFirstName} ${a.employeeLastName}`.trim(),
    };
  });
}

// Reserves the slot for ~7 minutes, exactly like the web app does before its summary
// screen — keeps it from being taken while we wait for the user's confirmation.
export async function holdSlot(employee: KavanuEmployee, service: KavanuService, date: string, time: string): Promise<void> {
  const { companyId } = getConfig();
  await kavanuFetch('Appointment/AddAppointmentTimeBlock', {
    method: 'POST',
    body: { companyId, employeeId: employee.id, sumAppointmentMinutes: service.minutes, date, startTime: time },
  });
}

export async function bookAppointment(
  employee: KavanuEmployee,
  service: KavanuService,
  date: string,
  time: string
): Promise<KavanuAppointment> {
  const { companyId } = getConfig();
  const customerUid = await getCustomerUid();
  const start = familyLocalToDate(date, time);
  const end = new Date(start.getTime() + service.minutes * 60_000);

  // Body mirrors what the web app sends (captured 2026-10-20). Services that need the
  // salon's manual approval go through AddPendingAppointment instead.
  const endpoint = service.autoApprove ? 'Appointment/AddAppointmentAutoApprove' : 'Appointment/AddPendingAppointment';
  await kavanuFetch(endpoint, {
    method: 'POST',
    body: {
      scheduledStart: start.toISOString().replace('.000Z', 'Z'),
      scheduledEnd: end.toISOString().replace('.000Z', 'Z'),
      employeeId: employee.id,
      appointmentStatus: 4,
      employeeFirstName: employee.firstName,
      employeeLastName: employee.lastName,
      employeeProfileImage: employee.profileImageUrl,
      appointmentTypeIds: [service.id],
      customerUid,
      companyId,
    },
  });

  // The booking response shape was never observed (captured request was blocked), so
  // treat the appointments list as the source of truth.
  const booked = (await listAppointments()).find(
    (a) => a.date === date && a.startTime === time && a.services.includes(service.name)
  );
  if (!booked) {
    throw new Error(
      service.autoApprove
        ? 'Kavanu accepted the request but the appointment is not in the list — check the Kavanu app.'
        : 'Sent as a pending request — the salon has to approve it before it shows up.'
    );
  }
  return booked;
}

export async function cancelAppointment(appointmentUid: string): Promise<void> {
  const { companyId } = getConfig();
  await kavanuFetch('Appointment/DeleteAppointmentCustomer', {
    method: 'POST',
    body: { appointmentUid, companyId },
  });
  const stillThere = (await listAppointments()).some((a) => a.uid === appointmentUid);
  if (stillThere) throw new Error('Kavanu did not cancel the appointment (it may be too close to its start time).');
}
