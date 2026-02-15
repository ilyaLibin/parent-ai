import { ActionItemsView } from './action-items-view';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface ActionItem {
  id: number;
  description: string;
  date: string;
  source_group_id: string | null;
  source_group_name: string | null;
  summary: string | null;
  created_at: string;
  dismissed: boolean;
}

async function getActionItems(): Promise<ActionItem[]> {
  const res = await fetch(`${API_URL}/action-items`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function ActionItemsPage() {
  const items = await getActionItems();
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Action Items</h2>
      <ActionItemsView initialItems={items} />
    </div>
  );
}
