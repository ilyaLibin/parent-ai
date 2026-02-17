import { KnowledgeList } from './knowledge-list';
import { PageHeader } from '../components/page-header';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

export interface KnowledgeEntry {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

async function getKnowledge(): Promise<KnowledgeEntry[]> {
  const res = await fetch(`${API_URL}/knowledge`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function KnowledgePage() {
  const entries = await getKnowledge();
  return (
    <div>
      <PageHeader title="Knowledge" />
      <KnowledgeList entries={entries} />
    </div>
  );
}
