import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { getIntegration } from '@parent-ai/shared';
import { waitForEmailCode } from './gmail.service.js';

// Reads the user's long-term savings (keren hishtalmut, kupot gemel, gemel lehashkaa,
// bituach menahalim) from Harel's personal area. There is no API: the site's report
// pages POST XML queries to a SharePoint proxy (HTTP_Proxy_Script.aspx?Action=ExecSQL)
// that only answers inside a logged-in browser session, and the site sits behind F5 bot
// protection. So we log in with headless Chromium (ID + phone, one-time code by email,
// read from Gmail) and run the same queries from inside the page.
const LOGIN_URL =
  'https://www.harel-group.co.il/Pages/login-page/Login.aspx?LoginOriginatingAction=PersonalInfoPage&isshowlogin=true&Source=%2fpersonal-info&Type=PortalOTP';
const REPORT_URL =
  'https://www.harel-group.co.il/_layouts/15/HarelWebSite/HarelReports/ApplicationPages/HTTP_Proxy_Script.aspx?Action=ExecSQL';
const OTP_SENDER = 'DoNotReply@harel-ins.co.il';
const INTEGRATION_TYPE = 'harel';
const FAMILY_TIMEZONE = 'Asia/Jerusalem';

const SNAPSHOT_DIR = join(dirname(process.env.DB_PATH || './data/messages.db'), 'harel');

interface HarelConfig {
  userId: string; // ת.ז.
  phone: string; // 05XXXXXXXX
}

function getConfig(): HarelConfig {
  const integration = getIntegration(INTEGRATION_TYPE);
  const config = integration ? (JSON.parse(integration.config_json) as Partial<HarelConfig>) : {};
  if (!config.userId || !config.phone) {
    throw new Error('Harel not configured — POST /integrations/harel with {"config":{"userId":"…","phone":"05…"}}');
  }
  return config as HarelConfig;
}

// ---------- snapshot model ----------

type AccountKind = 'hishtalmut' | 'gemel' | 'gemel_invest' | 'executive';

const KIND_LABELS: Record<AccountKind, string> = {
  executive: 'ביטוח מנהלים',
  hishtalmut: 'קרן השתלמות',
  gemel: 'קופת גמל',
  gemel_invest: 'גמל להשקעה',
};

// kod_sug_Kupa_Otzar values the provident-fund reports filter on.
const KUPA_TYPES: { kind: AccountKind; code: number }[] = [
  { kind: 'hishtalmut', code: 5 },
  { kind: 'gemel', code: 1 },
  { kind: 'gemel_invest', code: 4 },
];

export interface HarelDeposit {
  valueDate: string; // YYYY-MM-DD, when the money arrived
  salaryMonth: string; // YYYY-MM as Harel labels it
  employer: string;
  employee: number;
  employerPart: number;
  severance: number;
  total: number;
}

export interface HarelAccount {
  kind: AccountKind;
  number: string;
  owner?: string; // child's first name for accounts the user manages as guardian; unset = the user's own
  employer: string;
  balance: number;
  ytd: { deposits: number; transfersIn: number; withdrawals: number; transfersOut: number; gains: number; fees: number } | null;
  ytdReturnPct: number | null;
  returnAsOf: string | null; // YYYY-MM the YTD return runs through, when Harel says
  track: string | null;
  deposits: HarelDeposit[]; // newest first
  balanceHistory?: { month: string; balance: number; ytdReturnPct: number }[];
}

export interface HarelSnapshot {
  fetchedAt: string;
  total: number;
  accounts: HarelAccount[];
}

// ---------- report queries ----------

type Filter = [field: string, dataType: string, value: string | number];

function xmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function filters(list: Filter[]): string {
  return `<Filters>${list.map(([f, t, v]) => `<Filter FieldName="${f}" FilterOP="=" DataType="${t}" FilterValue="${v}"/>`).join('')}</Filters>`;
}

function query(key: number, reportId: string, d: number, params: [string, string | number][]): string {
  const ps = params.map(([u, v]) => `<Parameter U="${u}" V="${xmlAttr(String(v))}"/>`).join('');
  return `<Query KEY="${key}" R="${reportId}" D="${d}" DataSource="52"><Parameters>${ps}</Parameters></Query>`;
}

// The parameter sets below are copied from what the site's own report pages send.
const FUND_LOBBY = { key: 884, rid: '1EE0BBCB-28E3-47CB-96BE-1446D26A8299' };
const FUND_ACCOUNT = { key: 2, rid: '4D0CB82A-6C1F-4168-9B1D-52905745DF79' };
const FUND_DEPOSITS = { key: 286, rid: '474F6A98-41C0-45E1-8C09-FE3C18D1B9DF' };
const EXEC_POLICY = { key: 483, rid: '25390ED0-182F-43E2-B304-8D1BA5389F08' };
const CHILD_ACCOUNT = { key: 218, rid: 'E5413411-BAB6-490C-B82B-CA24A7D67CE7' };
const TOFES = [['Tofes_Name', 'DF42_menifadirectdebitgemel'], ['Tofes_Name_2', 'StandingOrder_Gemel']] as [string, string][];

function lobbyQuery(kupa: number): string {
  return query(FUND_LOBBY.key, FUND_LOBBY.rid, 2, [
    ['XMLFILTERS', filters([['kod_sug_Kupa_Otzar', 'Number', kupa]])],
    ['HCUN', -999],
    ['_REPORTID', FUND_LOBBY.rid],
    ['kod_sug_Kupa_Otzar', kupa],
    ...TOFES,
  ]);
}

// D=10: yearly movements (deposits, transfers, gains, fees, closing balance). D=13: track return YTD.
function accountQuery(d: 10 | 13, account: string, kupa: number): string {
  return query(FUND_ACCOUNT.key, FUND_ACCOUNT.rid, d, [
    ['XMLFILTERS', filters([['Mispar_heshbon', 'Number', account], ['kod_Sug_Kupa_Otzar', 'Number', kupa]])],
    ['HCUN', -999],
    ['XMLFILTERS2', filters([['PLSMKR', 'number', -456]])],
    ['_REPORTID', FUND_ACCOUNT.rid],
    ['kod_Sug_Kupa_Otzar', kupa],
    ['policySubjectId', account],
    ...TOFES,
  ]);
}

function depositsQuery(account: string, kupa: number): string {
  return query(FUND_DEPOSITS.key, FUND_DEPOSITS.rid, 1, [
    ['XMLFILTERS', filters([['Mispar_heshbon', 'number', account], ['kod_sug_Kupa_Otzar', 'Number', kupa]])],
    ['policySubjectId', account],
    ['Year_For_Filter', 'NULL'],
    ['_REPORTID', FUND_DEPOSITS.rid],
    ['kod_sug_Kupa_Otzar', kupa],
  ]);
}

// D=13: balance + YTD return, D=19: recent deposits, D=5: monthly balance for the last 13 months.
function executiveQuery(d: 5 | 13 | 19, policy: string): string {
  const vector: Filter[] = [['MISPAR_POLISA', 'number', policy], ['Vector_Type', 'number', 1], ['QOD_MASLUL', 'number', 0]];
  return query(EXEC_POLICY.key, EXEC_POLICY.rid, d, [
    ['XMLFILTERS', filters([['MISPAR_POLISA', 'number', policy]])],
    ['XMLFILTERS_Tsuaa', filters([...vector, ['Is_For_Tsuaa', 'number', 1]])],
    ['policySubjectId', policy],
    ['XMLFILTERS_Zvira', filters(vector)],
    ['Is_For_Tsuaa', 1],
    ['QOD_MASLUL_Zvira', 0],
    ['QOD_MASLUL', 0],
    ['HCUN', -999],
    ['Vector_Type_Zvira', 1],
    ['Vector_Type_Tsuaa', 1],
    ['Koteret', 'פוליסת ביטוח חיים עם חסכון שלי'],
    ['_REPORTID', EXEC_POLICY.rid],
  ]);
}

// Accounts held for a child (the user is the guardian). D=2: balance, personal YTD return and
// yearly movements in one row. D=4: recent deposits.
function childAccountQuery(d: 2 | 4, account: string, childId: string, kupa: number): string {
  return query(CHILD_ACCOUNT.key, CHILD_ACCOUNT.rid, d, [
    ['policySubjectId', account],
    ['XMLFILTERS', filters([['Mispar_heshbon', 'number', account], ['kod_sug_Kupa_Otzar', 'number', kupa]])],
    ['HCUN', -999],
    ['_REPORTID', CHILD_ACCOUNT.rid],
    ['kod_sug_Kupa_Otzar', kupa],
    ['SUG_KEREN', 21],
    ['ChildId', childId],
  ]);
}

type Row = Record<string, string>;

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function parseRows(xml: string): Row[] {
  return [...xml.matchAll(/<Row ([^>]*?)\/>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, unescapeXml(v).trim()])),
  );
}

async function runQuery(page: Page, body: string): Promise<Row[]> {
  const { status, text } = await page.evaluate(
    async ({ url, body }) => {
      const sid = Date.now();
      const res = await fetch(`${url}&Sid=${sid}&QSID=${sid}`, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'include',
      });
      return { status: res.status, text: await res.text() };
    },
    { url: REPORT_URL, body },
  );
  if (status !== 200 || !text.includes('<Table')) {
    throw new Error(`Harel report query failed (${status}): ${text.slice(0, 200)}`);
  }
  return parseRows(text);
}

// ---------- parsing helpers ----------

const num = (v: string | undefined) => (v ? Number(v.replace(/[,%₪\s]/g, '')) || 0 : 0);
const isoDate = (v: string | undefined) => (v ?? '').slice(0, 10); // "2026-06-18 00:00:00"
function dmyToIso(v: string): string {
  const [d, m, y] = v.split(/[/.]/);
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
function myToIso(v: string): string {
  const [m, y] = v.split('/');
  return `${y}-${m.padStart(2, '0')}`;
}

// ---------- login ----------

// Where the one-time code comes from. Defaults to reading Harel's email via Gmail.
export type HarelCodeSource = (sentAtMs: number) => Promise<string>;

const codeFromGmail: HarelCodeSource = (sentAtMs) =>
  waitForEmailCode({ from: OTP_SENDER, sinceMs: sentAtMs, codePattern: /\b(\d{6})\b/ });

interface ChildAccountRef {
  childId: string;
  name: string;
  account: string;
  kupa: number;
}

interface CustomerProducts {
  topicsList?: Record<string, { url: string; policySubjectId: string | null }[]>;
  // Accounts the user manages for others (here: their kids), keyed by the account holder's ID.
  mursheList?: Record<string, { userId: number; policyNumber: number; firstName: string; xtopicId: number }[]>;
}

// xtopicId (product sub-type in customer-products) → kod_sug_Kupa_Otzar for the report queries.
const XTOPIC_TO_KUPA: Record<number, number> = { 63: 4 }; // גמל להשקעה

async function login(
  page: Page,
  config: HarelConfig,
  getCode: HarelCodeSource,
): Promise<{ executivePolicies: string[]; children: ChildAccountRef[] }> {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#uid', config.userId);
  await page.fill('#phone', config.phone);
  await page.click('label[for=otp-channel-email]');

  const sentAt = Date.now();
  const [startRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/PostAuthenticate/StartProcess')),
    page.getByRole('button', { name: 'המשך' }).click(),
  ]);
  const start = (await startRes.json()) as { Status: number; Details?: { ProcessSuccess?: string; UserInputError?: string } };
  if (start.Details?.ProcessSuccess !== 'OTPWasSent') {
    throw new Error(`Harel didn't send a login code: ${JSON.stringify(start.Details ?? start)}`);
  }

  await page.waitForSelector('#otp');
  const code = await getCode(sentAt);
  await page.fill('#otp', code);

  // The landing page lists the customer's products; bituach menahalim policies and the kids'
  // accounts are only discoverable from there (the fund lobbies cover the user's own gemel/hishtalmut).
  const productsJson = page
    .waitForResponse((r) => r.url().includes('/client-view/customer-products'), { timeout: 60_000 })
    .then((r) => r.json() as Promise<CustomerProducts>);
  productsJson.catch(() => {}); // awaited below; don't let it go unhandled if we bail out first

  // A good code navigates straight to the personal area, so the SCValidateOTP response
  // body is gone by then — success is "we left the login page"; a bad code stays put.
  await page.getByRole('button', { name: 'המשך' }).click();
  try {
    await page.waitForURL(/\/personal-info\//, { timeout: 30_000 });
  } catch {
    throw new Error('Harel did not accept the login code (still on the login page)');
  }

  const products = await productsJson;
  const executivePolicies = Object.values(products.topicsList ?? {})
    .flat()
    .filter((t) => t.url.includes('/executives/') && t.policySubjectId)
    .map((t) => t.policySubjectId!);
  const children: ChildAccountRef[] = [];
  for (const [childId, entries] of Object.entries(products.mursheList ?? {})) {
    for (const e of entries) {
      const kupa = XTOPIC_TO_KUPA[e.xtopicId];
      if (kupa === undefined) {
        console.warn(`[harel] skipping ${e.firstName}'s account ${e.policyNumber}: unknown product type ${e.xtopicId}`);
        continue;
      }
      children.push({ childId, name: e.firstName, account: String(e.policyNumber), kupa });
    }
  }
  return { executivePolicies, children };
}

// ---------- fetch ----------

// Provident-fund deposit rows (own and kids' accounts share these columns).
function fundDeposits(rows: Row[]): HarelDeposit[] {
  return rows
    .map((d) => ({
      valueDate: isoDate(d.TAARICH_ERECH),
      salaryMonth: isoDate(d.TAARICH_TOKEF).slice(0, 7),
      employer: d.SHEM_MAAVID_MESHALEM,
      employee: num(d.TOTAL_HAFKADOT_OVED),
      employerPart: num(d.TOTAL_HAFKADOT_MAAVID),
      severance: num(d.TOTAL_HAFKADOT_PITZUIM),
      total: num(d.TOTAL_HAFKADOT),
    }))
    .sort((a, b) => b.valueDate.localeCompare(a.valueDate));
}

function yearlyMovements(row: Row | undefined): HarelAccount['ytd'] {
  if (!row) return null;
  return {
    deposits: num(row.SAX_HAFKADOT_SHANA),
    transfersIn: num(row.SAX_HAAVAROT_MEKRANOT_SHANA),
    withdrawals: num(row.SAX_MESHIHOT_SHANA),
    transfersOut: num(row.SAX_HAAVAROT_LEKRANOT_SHANA),
    gains: num(row.SAX_REVAHIM_SHANA),
    fees: num(row.SAX_DMEI_NIHUL_SHANA),
  };
}

async function fetchFundAccounts(page: Page): Promise<HarelAccount[]> {
  const accounts: HarelAccount[] = [];
  for (const { kind, code } of KUPA_TYPES) {
    for (const row of await runQuery(page, lobbyQuery(code))) {
      const number = row.Mispar_heshbon;
      const [year] = await runQuery(page, accountQuery(10, number, code));
      const tracks = await runQuery(page, accountQuery(13, number, code));
      const deposits = fundDeposits(await runQuery(page, depositsQuery(number, code)));

      accounts.push({
        kind,
        number,
        employer: row.SHEM_MIFAL,
        balance: num(year?.ITRA_SGIRA ?? row.ITRA_SGIRA),
        ytd: yearlyMovements(year),
        // One row per investment track; accounts here have a single track, multi-track ones show the first.
        ytdReturnPct: tracks[0] ? num(tracks[0].TSUA) : null,
        returnAsOf: tracks[0]?.TAARICH_TSUA ? dmyToIso(tracks[0].TAARICH_TSUA).slice(0, 7) : null, // "30.9.2026"
        track: tracks.map((t) => t.TEUR_MASLUL_HASHKAA).join(' + ') || null,
        deposits,
      });
    }
  }
  return accounts;
}

async function fetchChildAccount(page: Page, child: ChildAccountRef): Promise<HarelAccount> {
  const [summary] = await runQuery(page, childAccountQuery(2, child.account, child.childId, child.kupa));
  const deposits = fundDeposits(await runQuery(page, childAccountQuery(4, child.account, child.childId, child.kupa)));
  return {
    kind: KUPA_TYPES.find((k) => k.code === child.kupa)?.kind ?? 'gemel_invest',
    number: child.account,
    owner: child.name,
    employer: summary?.SHEM_MIFAL ?? '',
    balance: num(summary?.ITRA_SGIRA),
    ytd: yearlyMovements(summary),
    // The account's own return (money-weighted), not the track's — the only one this report has.
    ytdReturnPct: summary?.TSUA_ISHIT ? num(summary.TSUA_ISHIT) : null,
    returnAsOf: null,
    track: null,
    deposits,
  };
}

async function fetchExecutivePolicy(page: Page, policy: string): Promise<HarelAccount> {
  const [summary] = await runQuery(page, executiveQuery(13, policy));
  const deposits = (await runQuery(page, executiveQuery(19, policy)))
    .map((d) => ({
      valueDate: dmyToIso(d.TRXTASHLUM),
      salaryMonth: myToIso(d.MMSAXAR),
      employer: d.SHMMSQMSHL.replace(/\s+/g, ' '),
      employee: num(d.TGMLMEV),
      employerPart: num(d.TGMLMSQ),
      severance: num(d.PICUIM),
      total: num(d.SAXSXUM),
    }))
    .sort((a, b) => b.valueDate.localeCompare(a.valueDate));
  const history = (await runQuery(page, executiveQuery(5, policy)))
    .map((h) => ({ month: `${h.YYYYMM.slice(0, 4)}-${h.YYYYMM.slice(4)}`, balance: num(h.SXUM_HISAXON), ytdReturnPct: num(h.AHUZ_TSUA) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    kind: 'executive',
    number: policy,
    employer: deposits[0]?.employer ?? '',
    balance: num(summary?.ZVIRA),
    ytd: null,
    ytdReturnPct: summary ? num(summary.AHUZ_TSUA_CUR_YEAR) : null,
    returnAsOf: history.at(-1)?.month ?? null,
    track: summary?.SHEMMUCAR ?? null,
    deposits,
    balanceHistory: history,
  };
}

let running: Promise<HarelSnapshot> | null = null;

// Logs in and pulls everything. Takes about a minute; concurrent callers share one run.
export function fetchHarelSnapshot(getCode: HarelCodeSource = codeFromGmail): Promise<HarelSnapshot> {
  running ??= (async () => {
    const config = getConfig();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'he-IL', timezoneId: FAMILY_TIMEZONE });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    try {
      const { executivePolicies, children } = await login(page, config, getCode);
      const accounts = [
        ...(await Promise.all(executivePolicies.map((p) => fetchExecutivePolicy(page, p)))),
        ...(await fetchFundAccounts(page)),
        ...(await Promise.all(children.map((c) => fetchChildAccount(page, c)))),
      ];
      const snapshot: HarelSnapshot = {
        fetchedAt: new Date().toISOString(),
        total: Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100,
        accounts,
      };
      saveSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(SNAPSHOT_DIR, 'last-error.png'), fullPage: true }).catch(() => {});
      console.error(`[harel] run failed at ${page.url()}:`, err);
      throw err;
    } finally {
      await browser.close();
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

// ---------- snapshots on disk ----------

function saveSnapshot(snapshot: HarelSnapshot): void {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const name = snapshot.fetchedAt.replace(/[:.]/g, '-');
  writeFileSync(join(SNAPSHOT_DIR, `${name}.json`), JSON.stringify(snapshot, null, 1));
}

// What a report compares against: the newest snapshot at least ~3 weeks older, so an extra
// on-demand check mid-month doesn't turn "since last month" into "since this morning".
const COMPARE_MIN_AGE_MS = 20 * 86_400_000;

export function previousSnapshot(snapshot: HarelSnapshot | undefined, snapshots: HarelSnapshot[]): HarelSnapshot | undefined {
  const cutoff = new Date(snapshot?.fetchedAt ?? Date.now()).getTime() - COMPARE_MIN_AGE_MS;
  return snapshots.filter((s) => new Date(s.fetchedAt).getTime() <= cutoff).at(-1);
}

export function loadSnapshots(): HarelSnapshot[] {
  try {
    return readdirSync(SNAPSHOT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(SNAPSHOT_DIR, f), 'utf8')) as HarelSnapshot);
  } catch {
    return [];
  }
}

// ---------- report ----------

const DAY_MS = 86_400_000;
// A fund counts as receiving regular deposits if money came in within this window...
const ACTIVE_WINDOW_DAYS = 75;
// ...and is flagged when the newest deposit is older than this (they usually land by the 10th).
const LATE_AFTER_DAYS = 38;

const ils = (n: number) => `₪${Math.round(n).toLocaleString('en-US')}`;
const signedIls = (n: number) => `${n >= 0 ? '+' : '−'}${ils(Math.abs(n))}`;
const pct = (n: number | null) => (n === null ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function familyDate(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: FAMILY_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export interface DepositAlert {
  account: string;
  message: string;
}

export function depositAlerts(snapshot: HarelSnapshot): DepositAlert[] {
  const now = new Date(snapshot.fetchedAt).getTime();
  const alerts: DepositAlert[] = [];
  for (const a of snapshot.accounts) {
    const [last, prev] = a.deposits;
    if (!last) continue;
    const age = Math.floor((now - new Date(last.valueDate).getTime()) / DAY_MS);
    if (age > ACTIVE_WINDOW_DAYS) continue;
    const label = `${KIND_LABELS[a.kind]} ${a.number} (${a.owner ?? a.employer})`;
    if (age > LATE_AFTER_DAYS) {
      alerts.push({ account: a.number, message: `${label}: no deposit for ${age} days — last was ${ils(last.total)} on ${ddmm(last.valueDate)}` });
    }
    if (prev && prev.employer === last.employer && Math.abs(last.total - prev.total) > Math.max(1, prev.total * 0.03)) {
      alerts.push({ account: a.number, message: `${label}: deposit changed ${ils(prev.total)} → ${ils(last.total)} (${ddmm(last.valueDate)})` });
    }
  }
  return alerts;
}

// Compounds two YTD returns into the return of the period between them.
const periodReturn = (ytdNow: number, ytdBefore: number) => ((1 + ytdNow / 100) / (1 + ytdBefore / 100) - 1) * 100;

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Last completed month's return for an account: from Harel's monthly history when there is
// one (bituach menahalim; its entry for the current month is month-to-date, so it's skipped),
// otherwise by comparing this YTD figure with the previous snapshot's.
export function lastMonthReturn(a: HarelAccount, fetchedAt: string, previous?: HarelSnapshot): { month: string; pct: number } | null {
  const currentMonth = fetchedAt.slice(0, 7);
  const h = a.balanceHistory?.filter((p) => p.month < currentMonth);
  if (h && h.length >= 2) {
    const [before, last] = h.slice(-2);
    // Each point is the YTD return through that month; January starts a new year from zero.
    const value = last.month.endsWith('-01') ? last.ytdReturnPct : periodReturn(last.ytdReturnPct, before.ytdReturnPct);
    return { month: last.month, pct: value };
  }
  const prev = previous?.accounts.find((p) => p.number === a.number);
  if (a.ytdReturnPct === null || !a.returnAsOf || prev?.ytdReturnPct == null || !prev.returnAsOf) return null;
  if (prev.returnAsOf !== previousMonth(a.returnAsOf)) return null;
  const value = a.returnAsOf.endsWith('-01') ? a.ytdReturnPct : periodReturn(a.ytdReturnPct, prev.ytdReturnPct);
  return { month: a.returnAsOf, pct: value };
}

const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-15T00:00:00Z`));

// One line per product: total, newest deposit (summed across the group's accounts on that
// date) and last month's return weighted by balance.
function groupLine(label: string, group: HarelAccount[], fetchedAt: string, previous?: HarelSnapshot): string {
  const total = group.reduce((s, a) => s + a.balance, 0);
  const parts = [`<b>${label}</b>: ${ils(total)}`];

  const lastDate = group.flatMap((a) => a.deposits.map((d) => d.valueDate)).sort().at(-1);
  if (lastDate) {
    const amount = group.flatMap((a) => a.deposits.filter((d) => d.valueDate === lastDate)).reduce((s, d) => s + d.total, 0);
    parts.push(`last deposit ${ddmm(lastDate)} ${ils(amount)}`);
  }

  const returns = group.map((a) => ({ a, r: lastMonthReturn(a, fetchedAt, previous) })).filter((x) => x.r);
  if (returns.length) {
    const weight = returns.reduce((s, x) => s + x.a.balance, 0);
    const avg = returns.reduce((s, x) => s + x.r!.pct * x.a.balance, 0) / (weight || 1);
    parts.push(`${monthName(returns[0].r!.month)} ${pct(avg)}`);
  }
  return parts.join(' · ');
}

export function buildHarelReport(snapshot: HarelSnapshot, previous?: HarelSnapshot): string {
  const own = snapshot.accounts.filter((a) => !a.owner);
  const kids = snapshot.accounts.filter((a) => a.owner);

  let header = `<b>Harel — ${familyDate(new Date(snapshot.fetchedAt))}</b>\nTotal ${ils(snapshot.total)}`;
  if (previous) header += ` (${signedIls(snapshot.total - previous.total)} since ${familyDate(new Date(previous.fetchedAt))})`;
  const lines = [header, ''];

  for (const kind of ['executive', 'hishtalmut', 'gemel', 'gemel_invest'] as AccountKind[]) {
    const group = own.filter((a) => a.kind === kind);
    if (group.length) lines.push(groupLine(KIND_LABELS[kind], group, snapshot.fetchedAt, previous));
  }
  for (const owner of new Set(kids.map((a) => a.owner!))) {
    lines.push(groupLine(owner, kids.filter((a) => a.owner === owner), snapshot.fetchedAt, previous));
  }

  const alerts = depositAlerts(snapshot);
  lines.push('');
  lines.push(alerts.length ? `⚠️ ${alerts.map((a) => esc(a.message)).join('\n⚠️ ')}` : '✅ Deposits on time');
  return lines.join('\n');
}

export async function runHarelReport(getCode?: HarelCodeSource): Promise<{ snapshot: HarelSnapshot; report: string }> {
  const snapshots = loadSnapshots();
  const snapshot = await fetchHarelSnapshot(getCode);
  const previous = previousSnapshot(snapshot, snapshots);
  return { snapshot, report: buildHarelReport(snapshot, previous) };
}
