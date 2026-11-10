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
  employer: string;
  balance: number;
  ytd: { deposits: number; transfersIn: number; withdrawals: number; transfersOut: number; gains: number; fees: number } | null;
  ytdReturnPct: number | null;
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
  const [d, m, y] = v.split('/');
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

async function login(page: Page, config: HarelConfig, getCode: HarelCodeSource): Promise<string[]> {
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

  // The landing page lists the customer's products; bituach menahalim policies are only
  // discoverable from there (the fund lobbies cover gemel/hishtalmut).
  const productsJson = page
    .waitForResponse((r) => r.url().includes('/client-view/customer-products'), { timeout: 60_000 })
    .then((r) => r.json() as Promise<{ topicsList?: Record<string, { url: string; policySubjectId: string | null }[]> }>);
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
  return Object.values(products.topicsList ?? {})
    .flat()
    .filter((t) => t.url.includes('/executives/') && t.policySubjectId)
    .map((t) => t.policySubjectId!);
}

// ---------- fetch ----------

async function fetchFundAccounts(page: Page): Promise<HarelAccount[]> {
  const accounts: HarelAccount[] = [];
  for (const { kind, code } of KUPA_TYPES) {
    for (const row of await runQuery(page, lobbyQuery(code))) {
      const number = row.Mispar_heshbon;
      const [year] = await runQuery(page, accountQuery(10, number, code));
      const tracks = await runQuery(page, accountQuery(13, number, code));
      const deposits = (await runQuery(page, depositsQuery(number, code)))
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

      accounts.push({
        kind,
        number,
        employer: row.SHEM_MIFAL,
        balance: num(year?.ITRA_SGIRA ?? row.ITRA_SGIRA),
        ytd: year
          ? {
              deposits: num(year.SAX_HAFKADOT_SHANA),
              transfersIn: num(year.SAX_HAAVAROT_MEKRANOT_SHANA),
              withdrawals: num(year.SAX_MESHIHOT_SHANA),
              transfersOut: num(year.SAX_HAAVAROT_LEKRANOT_SHANA),
              gains: num(year.SAX_REVAHIM_SHANA),
              fees: num(year.SAX_DMEI_NIHUL_SHANA),
            }
          : null,
        // One row per investment track; accounts here have a single track, multi-track ones show the first.
        ytdReturnPct: tracks[0] ? num(tracks[0].TSUA) : null,
        track: tracks.map((t) => t.TEUR_MASLUL_HASHKAA).join(' + ') || null,
        deposits,
      });
    }
  }
  return accounts;
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
      const executivePolicies = await login(page, config, getCode);
      const accounts = [
        ...(await Promise.all(executivePolicies.map((p) => fetchExecutivePolicy(page, p)))),
        ...(await fetchFundAccounts(page)),
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
    const label = `${KIND_LABELS[a.kind]} ${a.number} (${a.employer})`;
    if (age > LATE_AFTER_DAYS) {
      alerts.push({ account: a.number, message: `${label}: no deposit for ${age} days — last was ${ils(last.total)} on ${ddmm(last.valueDate)}` });
    }
    if (prev && prev.employer === last.employer && Math.abs(last.total - prev.total) > Math.max(1, prev.total * 0.03)) {
      alerts.push({ account: a.number, message: `${label}: deposit changed ${ils(prev.total)} → ${ils(last.total)} (${ddmm(last.valueDate)})` });
    }
  }
  return alerts;
}

export function buildHarelReport(snapshot: HarelSnapshot, previous?: HarelSnapshot): string {
  const prevBalance = new Map(previous?.accounts.map((a) => [a.number, a.balance]));
  const lines: string[] = [];
  const asOf = new Date(snapshot.fetchedAt);

  let header = `<b>Harel savings — ${familyDate(asOf)}</b>\nTotal: <b>${ils(snapshot.total)}</b>`;
  if (previous) header += ` (${signedIls(snapshot.total - previous.total)} since ${familyDate(new Date(previous.fetchedAt))})`;
  lines.push(header);

  const alerts = depositAlerts(snapshot);
  lines.push('');
  lines.push(alerts.length ? `⚠️ <b>Deposits to check</b>\n${alerts.map((a) => `• ${esc(a.message)}`).join('\n')}` : '✅ All regular deposits arrived on time.');

  for (const kind of ['executive', 'hishtalmut', 'gemel', 'gemel_invest'] as AccountKind[]) {
    const group = snapshot.accounts.filter((a) => a.kind === kind).sort((a, b) => b.balance - a.balance);
    if (!group.length) continue;
    const sum = group.reduce((s, a) => s + a.balance, 0);
    lines.push('');
    lines.push(`<b>${KIND_LABELS[kind]}</b> — ${ils(sum)}`);
    for (const a of group) {
      let line = `• ${a.number} ${esc(a.employer)}: ${ils(a.balance)}`;
      const before = prevBalance.get(a.number);
      if (before !== undefined && Math.round(before) !== Math.round(a.balance)) line += ` (${signedIls(a.balance - before)})`;
      if (a.ytdReturnPct !== null) line += ` · YTD ${pct(a.ytdReturnPct)}`;
      const last = a.deposits[0];
      if (last && (new Date(snapshot.fetchedAt).getTime() - new Date(last.valueDate).getTime()) / DAY_MS <= ACTIVE_WINDOW_DAYS) {
        line += ` · last deposit ${ils(last.total)} on ${ddmm(last.valueDate)}`;
      }
      lines.push(line);
    }
  }

  const funds = snapshot.accounts.filter((a) => a.ytd);
  if (funds.length) {
    const gains = funds.reduce((s, a) => s + a.ytd!.gains, 0);
    const fees = funds.reduce((s, a) => s + a.ytd!.fees, 0);
    const deposits = funds.reduce((s, a) => s + a.ytd!.deposits, 0);
    lines.push('');
    lines.push(`<b>This year (hishtalmut + gemel)</b>: gains ${signedIls(gains)} before fees, fees ${ils(fees)}, new deposits ${ils(deposits)}`);
  }
  for (const a of snapshot.accounts.filter((x) => x.balanceHistory?.length)) {
    const h = a.balanceHistory!;
    const yearAgo = h[0];
    lines.push(`<b>${KIND_LABELS[a.kind]}</b>: ${ils(yearAgo.balance)} in ${yearAgo.month} → ${ils(a.balance)} now`);
  }
  lines.push('');
  lines.push('<i>Returns are year-to-date for the investment track, before management fees.</i>');
  return lines.join('\n');
}

export async function runHarelReport(getCode?: HarelCodeSource): Promise<{ snapshot: HarelSnapshot; report: string }> {
  const previous = loadSnapshots().at(-1);
  const snapshot = await fetchHarelSnapshot(getCode);
  return { snapshot, report: buildHarelReport(snapshot, previous) };
}
