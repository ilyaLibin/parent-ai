import type { FunctionDeclaration } from '@google/genai';
import {
  runHarelReport,
  loadSnapshots,
  buildHarelReport,
  depositAlerts,
  lastMonthReturn,
  previousSnapshot,
  type HarelSnapshot,
} from '../services/harel.service.js';
import type { ToolContext } from './kavanu.tools.js';

const FRESH_FOR_MS = 12 * 60 * 60 * 1000;

// The report is one line per product; give the model per-account numbers for follow-ups.
function accountDetails(snapshot: HarelSnapshot, previous?: HarelSnapshot) {
  return snapshot.accounts.map((a) => ({
    kind: a.kind,
    number: a.number,
    owner: a.owner ?? 'user',
    employer: a.employer,
    balance: Math.round(a.balance),
    ytdReturnPct: a.ytdReturnPct,
    lastMonthReturn: lastMonthReturn(a, snapshot.fetchedAt, previous),
    ytd: a.ytd,
    recentDeposits: a.deposits.slice(0, 3),
  }));
}

export const harelToolDefinitions: FunctionDeclaration[] = [
  {
    name: 'checkHarelSavings',
    description:
      "The user's long-term savings at Harel (הראל): ביטוח מנהלים, קרנות השתלמות, קופות גמל, גמל להשקעה, plus the kids' (Aviv, Gal) גמל להשקעה accounts the user manages as guardian — balances, year-to-date returns and gains, management fees, and whether the monthly employer deposits arrived. Use for questions like 'how are my savings / pension / keren hishtalmut doing', 'did my employer deposit this month'. Reuses a snapshot from the last 12 hours unless refresh is set. A refresh reuses the saved Harel session when it's still alive (no login, ~30s); only an expired session needs a new login (the code is read from email automatically, about a minute).",
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        refresh: { type: 'boolean', description: 'Force a fresh login even if a recent snapshot exists. Only when the user asks for up-to-date numbers.' },
      },
      required: [],
    },
  },
];

export const harelToolImplementations: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>> = {
  async checkHarelSavings(args) {
    const snapshots = loadSnapshots();
    const latest = snapshots.at(-1);
    if (latest && !args.refresh && Date.now() - new Date(latest.fetchedAt).getTime() < FRESH_FOR_MS) {
      const previous = previousSnapshot(latest, snapshots);
      return {
        success: true,
        fetchedAt: latest.fetchedAt,
        alerts: depositAlerts(latest),
        report: buildHarelReport(latest, previous),
        accounts: accountDetails(latest, previous),
      };
    }
    const { snapshot, report } = await runHarelReport();
    const previous = previousSnapshot(snapshot, snapshots);
    return { success: true, fetchedAt: snapshot.fetchedAt, alerts: depositAlerts(snapshot), report, accounts: accountDetails(snapshot, previous) };
  },
};
