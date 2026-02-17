import { ActionItemsView } from './action-items-view';
import { PageHeader } from '../components/page-header';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface ActionItem {
  id: number;
  description: string;
  date: string;
  source_group_id: string | null;
  source_group_name: string | null;
  summary: string | null;
  color: string | null;
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
      <PageHeader title="Action Items" />
      <ActionItemsView initialItems={items} />
    </div>
  );
}
