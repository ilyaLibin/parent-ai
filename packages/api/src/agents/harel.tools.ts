import type { FunctionDeclaration } from '@google/genai';
import { runHarelReport, loadSnapshots, buildHarelReport, depositAlerts } from '../services/harel.service.js';
import type { ToolContext } from './kavanu.tools.js';

const FRESH_FOR_MS = 12 * 60 * 60 * 1000;

export const harelToolDefinitions: FunctionDeclaration[] = [
  {
    name: 'checkHarelSavings',
    description:
      "The user's long-term savings at Harel (הראל): ביטוח מנהלים, קרנות השתלמות, קופות גמל, גמל להשקעה, plus the kids' (Aviv, Gal) גמל להשקעה accounts the user manages as guardian — balances, year-to-date returns and gains, management fees, and whether the monthly employer deposits arrived. Use for questions like 'how are my savings / pension / keren hishtalmut doing', 'did my employer deposit this month'. Reuses a snapshot from the last 12 hours; otherwise logs in to Harel (takes about a minute, the login code is read from email automatically).",
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
      return { success: true, fetchedAt: latest.fetchedAt, alerts: depositAlerts(latest), report: buildHarelReport(latest, snapshots.at(-2)) };
    }
    const { snapshot, report } = await runHarelReport();
    return { success: true, fetchedAt: snapshot.fetchedAt, alerts: depositAlerts(snapshot), report };
  },
};
