import { MessagesView } from './messages-view';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface Group {
  id: string;
  name: string;
  updated_at: number;
  messageCount: number;
}

async function getGroups(): Promise<Group[]> {
  const res = await fetch(`${API_URL}/groups`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return data.groups ?? [];
}

export default async function MessagesPage() {
  const groups = await getGroups();
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Messages</h2>
      <MessagesView groups={groups} />
    </div>
  );
}
