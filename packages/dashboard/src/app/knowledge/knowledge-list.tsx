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
          className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
        >
          + New Entry
        </Link>
      </div>

      {entries.length === 0 ? (
        <p className="text-zinc-400">No knowledge entries.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-2 hover:border-zinc-700 transition-colors"
            >
              <Link href={`/knowledge/${entry.id}`} className="text-lg font-semibold hover:text-blue-400 transition-colors">
                {entry.name}
              </Link>
              <div className="text-xs text-zinc-500">Updated: {formatDate(entry.updated_at)}</div>
              <div className="flex gap-2 mt-auto pt-2 border-t border-zinc-800/50">
                <Link
                  href={`/knowledge/${entry.id}`}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Edit
                </Link>
                <button
                  onClick={() => handleDelete(entry)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
