'use client';

import Link from 'next/link';
import type { KnowledgeEntry } from './page';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IL', { timeZone: 'Asia/Jerusalem' });
}

export function KnowledgeList({ entries }: { entries: KnowledgeEntry[] }) {
  return (
    <div>
      <div className="mb-4">
        <Link
          href="/knowledge/new"
          className="inline-block btn-accent rounded-lg px-4 py-2 text-sm font-medium"
        >
          + new entry
        </Link>
      </div>

      {entries.length === 0 ? (
        <p className="text-fg-muted">No knowledge entries.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href={`/knowledge/${entry.id}`}
              className="card-raised rounded-lg p-4 flex flex-col gap-2 hover:border-accent/40 transition-all cursor-pointer"
            >
              <span className="text-sm font-bold">{entry.name}</span>
              <span className="text-xs text-fg-muted">updated: {formatDate(entry.updated_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
