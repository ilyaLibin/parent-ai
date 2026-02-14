'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScheduleInput } from '../../components/schedule-input';

interface TaskFormProps {
  initial?: {
    id: number;
    name: string;
    schedule: string;
    prompt: string | null;
    model: string | null;
    enabled: boolean;
    endpoint: string;
    method: string;
    body: string | null;
  };
}

export function TaskForm({ initial }: TaskFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name || '');
  const [schedule, setSchedule] = useState(initial?.schedule || '0 * * * *');
  const [prompt, setPrompt] = useState(initial?.prompt || '');
  const [model, setModel] = useState(initial?.model || 'sonnet');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!name.trim() || !schedule.trim()) return;
    setSaving(true);

    const payload = {
      name: name.trim(),
      schedule,
      prompt: prompt.trim() || null,
      model: prompt.trim() ? model : null,
      enabled,
      endpoint: initial?.endpoint || '',
      method: initial?.method || 'POST',
      body: initial?.body ?? null,
    };

    try {
      if (isEdit) {
        await fetch(`/api/cron-jobs/${initial.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/cron-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      router.push('/tasks');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit || !confirm(`Delete "${name}"?`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/cron-jobs/${initial.id}`, { method: 'DELETE' });
      router.push('/tasks');
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Name */}
      <div>
        <label className="block text-sm text-zinc-400 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
          placeholder="e.g. aviv-daily-report"
        />
      </div>

      {/* Schedule */}
      <div>
        <label className="block text-sm text-zinc-400 mb-1">Schedule</label>
        <ScheduleInput value={schedule} onChange={setSchedule} />
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-sm text-zinc-400 mb-1">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={14}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600 resize-y"
          placeholder="Define what the agent should do — role, instructions, and task..."
        />
        <p className="text-xs text-zinc-500 mt-1">
          {'Supports template variables: {{today}}, {{tomorrow}}, {{date}}, {{datetime}}'}
        </p>
      </div>

      {/* Model */}
      {prompt.trim() && (
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-zinc-600"
          >
            <option value="haiku">Haiku</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
        </div>
      )}

      {/* Enabled */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-zinc-400">Enabled</label>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`w-10 h-5 rounded-full relative transition-colors ${
            enabled ? 'bg-green-600' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4 border-t border-zinc-800">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !schedule.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : isEdit ? 'Save' : 'Create'}
        </button>
        <button
          onClick={() => router.push('/tasks')}
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
