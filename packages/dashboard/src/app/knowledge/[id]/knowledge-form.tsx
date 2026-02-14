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
        <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full input-inset rounded-lg px-3 py-2 text-sm"
          placeholder="e.g. aviv_school_schedule"
        />
      </div>

      <div>
        <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={20}
          className="w-full input-inset rounded-lg px-3 py-2 text-sm resize-y"
          placeholder="Knowledge content (markdown supported)..."
        />
      </div>

      <div className="flex gap-3 pt-4 border-t border-border">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !content.trim()}
          className="btn-accent rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? '...' : isEdit ? 'Save' : 'Create'}
        </button>
        <button
          onClick={() => router.push('/knowledge')}
          className="btn-raised rounded-lg px-4 py-2 text-sm"
        >
          Back
        </button>
        {isEdit && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 bg-error/10 hover:bg-error/20 text-error rounded-lg text-sm ml-auto disabled:opacity-50 transition-colors border border-error/20"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
