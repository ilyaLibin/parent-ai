'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface KnowledgeFormProps {
  initial?: {
    id: number;
    name: string;
    content: string;
  };
}

export function KnowledgeForm({ initial }: KnowledgeFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name || '');
  const [content, setContent] = useState(initial?.content || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);

    const payload = { name: name.trim(), content: content };

    try {
      if (isEdit) {
        await fetch(`/api/knowledge/${initial.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      router.push('/knowledge');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit || !confirm(`Delete "${name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/knowledge/${initial.id}`, { method: 'DELETE' });
      router.push('/knowledge');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <label className="block text-sm text-zinc-400 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
          placeholder="e.g. aviv_school_schedule"
        />
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600 resize-y"
          placeholder="Knowledge content (markdown supported)..."
        />
      </div>

      <div className="flex gap-3 pt-4 border-t border-zinc-800">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !content.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : isEdit ? 'Save' : 'Create'}
        </button>
        <button
          onClick={() => router.push('/knowledge')}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
        >
          Back
        </button>
        {isEdit && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 bg-red-900/50 hover:bg-red-800/50 text-red-400 rounded-lg text-sm ml-auto disabled:opacity-50 transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
