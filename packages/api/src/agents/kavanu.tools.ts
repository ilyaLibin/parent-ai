import type { FunctionDeclaration } from '@google/genai';
import { randomUUID } from 'node:crypto';
import {
  KavanuLoginRequiredError,
  requestLoginCode,
  submitLoginCode,
  resolveEmployee,
  resolveService,
  getSlots,
  isSlotFree,
  listAppointments,
  holdSlot,
  bookAppointment,
  cancelAppointment,
} from '../services/kavanu.service.js';
import { createCalendarEvent as createGCalEvent } from '../services/google-calendar.service.js';

export interface ToolContext {
  runId?: number;
}

const SALON_LOCATION = 'מספרת רונן לוי, שדרות מוריה 52, חיפה';
const SALON_PHONE = '04-838-1793';

// Booking/cancelling is outward-facing, so it's a two-step handshake: a propose* tool
// returns a proposalId, and confirmBarberAction only accepts it from a LATER agent run —
// i.e. after the user has actually replied. The model can't propose and confirm in one go.
interface PendingAction {
  kind: 'book' | 'cancel';
  runId: number | undefined;
  createdAt: number;
  summary: string;
  execute: () => Promise<unknown>;
}

const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const pendingActions = new Map<string, PendingAction>();

function addPending(action: PendingAction): string {
  for (const [id, a] of pendingActions) {
    if (Date.now() - a.createdAt > PROPOSAL_TTL_MS) pendingActions.delete(id);
  }
  const id = randomUUID().slice(0, 8);
  pendingActions.set(id, action);
  return id;
}

function toolError(err: unknown) {
  if (!(err instanceof KavanuLoginRequiredError)) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  return {
    success: false,
    needsLogin: true,
    error:
      'Not logged in to Kavanu (the barbershop booking system). Ask the user whether to send a login code by SMS; ' +
      'if yes, call requestKavanuLoginCode, then ask them to reply with the code and call submitKavanuLoginCode.',
  };
}

export const kavanuToolDefinitions: FunctionDeclaration[] = [
  {
    name: 'getBarberSlots',
    description:
      'Find free appointment times at the barbershop (מספרת רונן לוי, booked via Kavanu). Defaults to the barber Ronen Levi (רונן לוי). Returns the first few days that have free slots, starting from fromDate. Each service is booked separately and has its own length, so when the user wants several services (e.g. a men\'s haircut and a kid\'s haircut) call this once per service. Times are Asia/Jerusalem.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        service: {
          type: 'string',
          description: 'Service name in Hebrew as the salon lists it, e.g. "תספורת גבר" (men\'s haircut, 20 min), "תספורת ילד/ה" (kid\'s haircut, 25 min), "עיצוב זקן" (beard). If the name is unknown the error lists all valid names.',
        },
        fromDate: { type: 'string', description: 'Optional first date to look at, YYYY-MM-DD. Defaults to today.' },
        daysWithSlots: { type: 'number', description: 'How many days with free slots to return. Default 3.' },
        barber: { type: 'string', description: 'Optional barber name. Omit for Ronen Levi.' },
      },
      required: ['service'],
    },
  },
  {
    name: 'listBarberAppointments',
    description: "List the user's upcoming barbershop appointments (Kavanu), including their uid (needed for cancelling).",
    parametersJsonSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'proposeBarberBooking',
    description:
      'Step 1 of booking a barbershop appointment: checks the slot is still free, holds it for ~7 minutes and returns a proposalId plus a summary. It does NOT book. Show the summary to the user and ask them to confirm; only after they reply yes, call confirmBarberAction with the proposalId. Only propose a date/time the user explicitly chose — never pick one yourself.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        service: { type: 'string', description: 'Service name in Hebrew, as in getBarberSlots.' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM (24h, Asia/Jerusalem), exactly as returned by getBarberSlots.' },
        barber: { type: 'string', description: 'Optional barber name. Omit for Ronen Levi.' },
      },
      required: ['service', 'date', 'time'],
    },
  },
  {
    name: 'proposeBarberCancellation',
    description:
      'Step 1 of cancelling a barbershop appointment: returns a proposalId and summary without cancelling. Ask the user to confirm; only after they reply yes, call confirmBarberAction. Get the appointmentUid from listBarberAppointments.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: { appointmentUid: { type: 'string', description: 'uid from listBarberAppointments.' } },
      required: ['appointmentUid'],
    },
  },
  {
    name: 'confirmBarberAction',
    description:
      'Step 2: executes a booking or cancellation previously proposed with proposeBarberBooking/proposeBarberCancellation. Call ONLY after the user explicitly confirmed in a new message. A successful booking is also added to Google Calendar automatically — do not call createCalendarEvent for it.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        proposalId: {
          type: 'string',
          description: 'The proposalId returned by the propose step. Omit it if you no longer have it (chat history keeps only text) — the most recent pending proposal is used.',
        },
      },
      required: [],
    },
  },
  {
    name: 'requestKavanuLoginCode',
    description:
      'Sends an SMS login code for Kavanu (the barbershop booking system) to the user\'s phone. Use only when a barber tool returned needsLogin and the user agreed. fullName/phone are needed only the first time (they are remembered).',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: {
        fullName: { type: 'string', description: 'Full name for the Kavanu account. Only needed the first time.' },
        phone: { type: 'string', description: 'Israeli mobile number, e.g. 0541234567. Only needed the first time.' },
      },
      required: [],
    },
  },
  {
    name: 'submitKavanuLoginCode',
    description: 'Completes the Kavanu login with the SMS code the user replied with.',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: { code: { type: 'string', description: 'The numeric code from the SMS.' } },
      required: ['code'],
    },
  },
];

export const kavanuToolImplementations: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>> = {
  async getBarberSlots(args) {
    try {
      const employee = await resolveEmployee(args.barber as string | undefined);
      const service = resolveService(employee, args.service as string);
      const days = await getSlots({
        employee,
        service,
        fromDate: args.fromDate as string | undefined,
        daysWithSlots: (args.daysWithSlots as number | undefined) ?? 3,
      });
      return { success: true, barber: employee.name, service: service.name, durationMinutes: service.minutes, days };
    } catch (err) {
      return toolError(err);
    }
  },

  async listBarberAppointments() {
    try {
      return { success: true, appointments: await listAppointments() };
    } catch (err) {
      return toolError(err);
    }
  },

  async proposeBarberBooking(args, ctx) {
    try {
      const employee = await resolveEmployee(args.barber as string | undefined);
      const service = resolveService(employee, args.service as string);
      const date = args.date as string;
      const time = args.time as string;

      if (!(await isSlotFree(employee, service, date, time))) {
        const nearby = await getSlots({ employee, service, fromDate: date, daysWithSlots: 1 });
        return { success: false, error: `${time} on ${date} is no longer free for ${service.name}.`, nearestFreeDay: nearby[0] ?? null };
      }
      await holdSlot(employee, service, date, time);

      const summary = `${service.name} (${service.minutes} min) with ${employee.name} on ${date} at ${time}`;
      const proposalId = addPending({
        kind: 'book',
        runId: ctx.runId,
        createdAt: Date.now(),
        summary,
        execute: async () => {
          const appt = await bookAppointment(employee, service, date, time);
          let calendar: unknown;
          try {
            const ev = await createGCalEvent({
              summary: `${service.name} – ${employee.name}`,
              description: `Booked via Kavanu. ${SALON_LOCATION}. Salon phone: ${SALON_PHONE}`,
              startDate: `${appt.date}T${appt.startTime}:00`,
              endDate: `${appt.date}T${appt.endTime}:00`,
              isAllDay: false,
            });
            calendar = { added: true, htmlLink: ev.htmlLink };
          } catch (err) {
            calendar = { added: false, error: err instanceof Error ? err.message : String(err) };
          }
          return { appointment: appt, calendar };
        },
      });
      return { success: true, proposalId, summary, note: 'Slot is held for ~7 minutes. Ask the user to confirm before calling confirmBarberAction.' };
    } catch (err) {
      return toolError(err);
    }
  },

  async proposeBarberCancellation(args, ctx) {
    try {
      const uid = args.appointmentUid as string;
      const appt = (await listAppointments()).find((a) => a.uid === uid);
      if (!appt) return { success: false, error: `No upcoming appointment with uid ${uid}.` };

      const summary = `Cancel ${appt.services.join(' + ')} with ${appt.barber} on ${appt.date} at ${appt.startTime}`;
      const proposalId = addPending({
        kind: 'cancel',
        runId: ctx.runId,
        createdAt: Date.now(),
        summary,
        execute: async () => {
          await cancelAppointment(uid);
          return { cancelled: appt, note: 'The matching Google Calendar event (if any) was not removed.' };
        },
      });
      return { success: true, proposalId, summary };
    } catch (err) {
      return toolError(err);
    }
  },

  async confirmBarberAction(args, ctx) {
    // Chat history only carries the model's reply text, so on the user's "yes" the next
    // run may not know the id — fall back to the newest proposal from an earlier run.
    let id = args.proposalId as string | undefined;
    if (!id) {
      const earlier = [...pendingActions.entries()].filter(([, a]) => a.runId === undefined || a.runId !== ctx.runId);
      id = earlier.sort((a, b) => b[1].createdAt - a[1].createdAt)[0]?.[0];
    }
    if (!id) return { success: false, error: 'Nothing is waiting for confirmation. Propose it again.' };
    const action = pendingActions.get(id);
    if (!action || Date.now() - action.createdAt > PROPOSAL_TTL_MS) {
      pendingActions.delete(id);
      return { success: false, error: 'Unknown or expired proposal. Propose it again.' };
    }
    if (action.runId !== undefined && action.runId === ctx.runId) {
      return { success: false, error: 'The user has not confirmed yet. Show them the summary and wait for their reply.' };
    }
    pendingActions.delete(id);
    try {
      return { success: true, kind: action.kind, summary: action.summary, ...(await action.execute() as object) };
    } catch (err) {
      if (err instanceof KavanuLoginRequiredError) return toolError(err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async requestKavanuLoginCode(args) {
    const { phone } = await requestLoginCode({ fullName: args.fullName as string | undefined, phone: args.phone as string | undefined });
    return { success: true, sentTo: phone, note: 'Ask the user to reply with the code from the SMS.' };
  },

  async submitKavanuLoginCode(args) {
    await submitLoginCode(String(args.code));
    return { success: true, note: 'Logged in to Kavanu. Retry what the user originally asked for.' };
  },
};
