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
    <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-8rem)]">
      {/* Left panel — name + content */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
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

        <div className="flex-1 flex flex-col min-h-0">
          <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 w-full input-inset rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="Knowledge content (markdown supported)..."
          />
        </div>
      </div>

      {/* Right panel — actions */}
      <div className="w-full md:w-64 flex flex-col gap-4 shrink-0">
        <div className="flex flex-col gap-2 pt-3 border-t border-border md:border-t-0 md:pt-0">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !content.trim()}
            className="w-full btn-accent rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '...' : isEdit ? 'Save' : 'Create'}
          </button>
        </div>

        {isEdit && (
          <div className="mt-auto pt-4 border-t border-border">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="w-full px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-error rounded-lg text-sm disabled:opacity-50 transition-colors border border-red-500/20"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
