'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScheduleInput } from '../../components/schedule-input';
import { MentionInput } from '../../components/mention-input';
import { FullscreenEditor } from '../../components/fullscreen-editor';
import { RunModal } from '../../components/run-modal';
import { ImproveModal } from '../../components/improve-modal';
import { useIsMobile } from '../../hooks/use-is-mobile';

interface TaskFormProps {
  initial?: {
    id?: number;
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

const MODELS = ['haiku', 'sonnet', 'opus'] as const;

export function TaskForm({ initial }: TaskFormProps) {
  const router = useRouter();
  const isEdit = !!initial?.id;

  const [name, setName] = useState(initial?.name || '');
  const [schedule, setSchedule] = useState(initial?.schedule || '0 * * * *');
  const [prompt, setPrompt] = useState(initial?.prompt || '');
  const [model, setModel] = useState(initial?.model || 'sonnet');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [showImproveModal, setShowImproveModal] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const isMobile = useIsMobile();

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
    <div className="flex flex-col md:flex-row gap-6 h-[calc(100vh-8rem)]">
      {/* Left panel — form fields */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div>
          <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full input-inset rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. aviv-daily-report"
          />
        </div>

        <div>
          <label className="block text-xs text-fg-muted mb-1 uppercase tracking-wider">Schedule</label>
          <ScheduleInput value={schedule} onChange={setSchedule} />
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-fg-muted uppercase tracking-wider">Prompt</label>
            {prompt.trim() && (
              <button
                onClick={() => setShowImproveModal(true)}
                className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Improve
              </button>
            )}
          </div>
          <MentionInput
            value={prompt}
            onChange={setPrompt}
            onFocus={() => isMobile && setFullscreen(true)}
            className="flex-1 w-full input-inset rounded-lg px-3 py-2 text-sm resize-none font-content"
            placeholder="Define what the agent should do — type @ to reference groups or knowledge..."
          />
          <p className="text-xs text-fg-muted mt-1">
            {'Supports: {{today}}, {{tomorrow}}, {{date}}, {{datetime}}, @mentions'}
          </p>
        </div>
      </div>

      {/* Right panel — settings + actions */}
      <div className="w-full md:w-64 flex flex-col gap-4 shrink-0">
        {/* Model pills */}
        {prompt.trim() && (
          <div>
            <label className="block text-xs text-fg-muted mb-1.5 uppercase tracking-wider">Model</label>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {MODELS.map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className={`flex-1 py-1.5 text-xs font-medium transition-all ${
                    model === m
                      ? 'bg-accent text-white shadow-sm'
                      : 'bg-raised text-fg-secondary hover:bg-surface-hover'
                  } ${m !== 'haiku' ? 'border-l border-border' : ''}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Enabled toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-fg-muted uppercase tracking-wider">Enabled</label>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-10 h-5 rounded-full relative transition-colors ${
              enabled ? 'bg-success' : 'bg-surface-hover'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                enabled ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 pt-3 border-t border-border">
          <div className="flex gap-2">
            {isEdit && !!initial.prompt && (
              <button
                onClick={() => setShowRunModal(true)}
                className="flex-1 btn-raised rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Test run
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !schedule.trim()}
              className="flex-1 btn-accent rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '...' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
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

      {isEdit && showRunModal && (
        <RunModal
          taskId={initial.id!}
          taskName={name}
          open={showRunModal}
          onClose={() => setShowRunModal(false)}
        />
      )}

      {showImproveModal && (
        <ImproveModal
          open={showImproveModal}
          onClose={() => setShowImproveModal(false)}
          onApply={(text) => setPrompt(text)}
          type="improve-prompt"
          currentContent={prompt}
        />
      )}

      {fullscreen && (
        <FullscreenEditor
          value={prompt}
          onChange={setPrompt}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}
