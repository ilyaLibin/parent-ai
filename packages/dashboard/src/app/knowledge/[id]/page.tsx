import { KnowledgeForm } from './knowledge-form';

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
      <div className="flex items-center gap-2 mb-6">
        <a href="/knowledge" className="text-fg-muted hover:text-fg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </a>
        <h2 className="text-xl font-bold">{entry.name}</h2>
      </div>
      <KnowledgeForm initial={entry} />
    </div>
  );
}
