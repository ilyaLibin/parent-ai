'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { KnowledgeEntry } from './page';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IL', { timeZone: 'Asia/Jerusalem' });
}

export function KnowledgeList({ initialEntries }: { initialEntries: KnowledgeEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);

  async function handleDelete(entry: KnowledgeEntry) {
    if (!confirm(`Delete "${entry.name}"?`)) return;
    const res = await fetch(`/api/knowledge/${entry.id}`, { method: 'DELETE' });
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    }
  }

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
            <div
              key={entry.id}
              className="card-raised rounded-lg p-4 flex flex-col gap-2 hover:border-accent/40 transition-all"
            >
              <Link href={`/knowledge/${entry.id}`} className="text-sm font-bold hover:text-accent transition-colors">
                {entry.name}
              </Link>
              <div className="text-xs text-fg-muted">updated: {formatDate(entry.updated_at)}</div>
              <div className="flex gap-2 mt-auto pt-2 border-t border-border-subtle">
                <Link
                  href={`/knowledge/${entry.id}`}
                  className="text-xs text-accent hover:text-accent-hover font-medium"
                >
                  edit
                </Link>
                <button
                  onClick={() => handleDelete(entry)}
                  className="text-xs text-error hover:opacity-80"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
