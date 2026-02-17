import { KnowledgeForm } from './knowledge-form';
import { PageHeader } from '../../components/page-header';

const API_URL = process.env.API_URL || 'http://localhost:3033';

export const dynamic = 'force-dynamic';

async function getKnowledge(id: string) {
  const res = await fetch(`${API_URL}/knowledge/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function EditKnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await getKnowledge(id);

  if (!entry) {
    return <p className="text-fg-muted">Knowledge entry not found.</p>;
  }

  return (
    <div>
      <PageHeader title="Knowledge" backHref="/knowledge" />
      <KnowledgeForm initial={entry} />
    </div>
  );
}
