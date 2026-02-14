import { MessagesView } from './messages-view';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface Group {
  id: string;
  name: string;
  updated_at: number;
  messageCount: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

async function getGroups(): Promise<Group[]> {
  const res = await fetch(`${API_URL}/groups`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.groups ?? [];
}

async function getDailyCounts(): Promise<DailyCount[]> {
  const res = await fetch(`${API_URL}/messages/daily-counts?days=30`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.counts ?? [];
}

export default async function MessagesPage() {
  const [groups, dailyCounts] = await Promise.all([getGroups(), getDailyCounts()]);
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Messages</h2>
      <MessagesView groups={groups} dailyCounts={dailyCounts} />
    </div>
  );
}
