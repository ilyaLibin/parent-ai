'use client';

import { useState, useCallback } from 'react';
import type { RenovationJob, RenovationSettings } from './page';
import { GanttChart } from './gantt-chart';
import { JobModal } from './job-modal';

const DERIVED_STATUS: Record<string, { dot: string; label: string }> = {
  new: { dot: 'bg-gray-400', label: 'New (no workers)' },
  searching: { dot: 'bg-blue-400', label: 'Searching' },
  quoted: { dot: 'bg-amber-400', label: 'Offer / Quote' },
  assigned: { dot: 'bg-emerald-400', label: 'Worker Assigned' },
};

function deriveStatus(job: RenovationJob): string {
  if (!job.max_worker_stage) return 'new';
  if (job.max_worker_stage === 'accepted') return 'assigned';
  if (job.max_worker_stage === 'offer') return 'quoted';
  return 'searching';
}

interface Props {
  initialJobs: RenovationJob[];
  initialSettings: RenovationSettings;
}

export function RenovationView({ initialJobs, initialSettings }: Props) {
  const [jobs, setJobs] = useState(initialJobs);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<RenovationJob | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [settingsForm, setSettingsForm] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);

  const refreshJobs = useCallback(async () => {
    const res = await fetch('/api/renovation/jobs');
    if (res.ok) setJobs(await res.json());
  }, []);

  const handleOpenNew = () => { setEditingJob(null); setModalOpen(true); };
  const handleOpenEdit = (job: RenovationJob) => { setEditingJob(job); setModalOpen(true); };

  const handleJobDatesChange = async (id: number, start_date: string, end_date: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, start_date, end_date } : j));
    await fetch(`/api/renovation/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date, end_date }),
    });
  };

  const handleClose = () => { setModalOpen(false); setEditingJob(null); refreshJobs(); };

  const handleDelete = async (id: number) => {
    await fetch(`/api/renovation/jobs/${id}`, { method: 'DELETE' });
    setModalOpen(false);
    setEditingJob(null);
    refreshJobs();
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    const res = await fetch('/api/renovation/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsForm),
    });
    if (res.ok) {
      const saved = await res.json();
      setSettings(saved);
      setShowSettings(false);
    }
    setSavingSettings(false);
  };

  // Stats
  const totalTasks = jobs.length;
  const assigned = jobs.filter(j => deriveStatus(j) === 'assigned').length;
  const searching = jobs.filter(j => ['searching', 'quoted'].includes(deriveStatus(j))).length;
  const totalBudget = jobs.reduce((sum, j) => sum + (j.accepted_worker_price ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between max-w-[1400px]">
        <div>
          <h1 className="text-lg font-bold tracking-wide" dir="auto">
            {settings.project_name || '/renovation'}
          </h1>
          {(settings.project_start || settings.project_end) && (
            <div className="text-xs text-fg-muted mt-0.5">
              {settings.project_start && <span>{settings.project_start}</span>}
              {settings.project_start && settings.project_end && <span> — </span>}
              {settings.project_end && <span>{settings.project_end}</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setSettingsForm(settings); setShowSettings(!showSettings); }}
            className="btn-raised rounded-lg px-3 py-2 text-sm text-fg-secondary"
            title="Project settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="card-raised rounded-lg p-4 space-y-3 max-w-[1400px]">
          <div className="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-2">Project Settings</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-fg-muted mb-1 block">Project Name</label>
              <input
                value={settingsForm.project_name ?? ''}
                onChange={e => setSettingsForm(s => ({ ...s, project_name: e.target.value || null }))}
                className="input-inset w-full rounded-lg px-3 py-2 text-sm font-content"
                placeholder="My Renovation"
                dir="auto"
              />
            </div>
            <div>
              <label className="text-xs text-fg-muted mb-1 block">Project Start</label>
              <input
                type="date"
                value={settingsForm.project_start ?? ''}
                onChange={e => setSettingsForm(s => ({ ...s, project_start: e.target.value || null }))}
                className="input-inset w-full rounded-lg px-3 py-2 text-sm font-content"
              />
            </div>
            <div>
              <label className="text-xs text-fg-muted mb-1 block">Project End</label>
              <input
                type="date"
                value={settingsForm.project_end ?? ''}
                onChange={e => setSettingsForm(s => ({ ...s, project_end: e.target.value || null }))}
                className="input-inset w-full rounded-lg px-3 py-2 text-sm font-content"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowSettings(false)} className="btn-raised rounded-lg px-3 py-1.5 text-xs">
              Cancel
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="btn-accent rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {savingSettings ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-[1400px]">
        <StatCard label="Total Jobs" value={totalTasks} />
        <StatCard label="Assigned" value={assigned} accent="text-emerald-500" />
        <StatCard label="Searching" value={searching} accent="text-blue-400" />
        <StatCard
          label="Total Budget"
          value={`\u20AA${totalBudget.toLocaleString()}`}
          accent="text-accent"
        />
      </div>

      {/* Legend + View Toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3 max-w-[1400px]">
        <div className="flex items-center gap-4 text-xs text-fg-secondary flex-wrap">
          {Object.values(DERIVED_STATUS).map(s => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="text-amber-500 text-sm">&#9888;</span>
            No worker accepted
          </span>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-border text-sm">
          <button
            onClick={() => setView('week')}
            className={`px-4 py-1.5 transition-colors ${view === 'week' ? 'bg-accent text-white font-medium' : 'bg-surface-secondary text-fg-secondary hover:bg-surface-hover'}`}
          >
            Week
          </button>
          <button
            onClick={() => setView('month')}
            className={`px-4 py-1.5 transition-colors ${view === 'month' ? 'bg-accent text-white font-medium' : 'bg-surface-secondary text-fg-secondary hover:bg-surface-hover'}`}
          >
            Month
          </button>
        </div>
      </div>

      {/* Gantt — full width */}
      <GanttChart
        jobs={jobs}
        view={view}
        projectStart={settings.project_start}
        projectEnd={settings.project_end}
        onJobClick={handleOpenEdit}
        onJobDatesChange={handleJobDatesChange}
        onAddJob={handleOpenNew}
      />

      {jobs.length === 0 && (
        <div className="text-center py-16 text-fg-muted text-sm">
          No renovation jobs yet. Click <strong>+ Add Job</strong> to get started.
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <JobModal
          job={editingJob}
          onClose={handleClose}
          onDelete={editingJob ? () => handleDelete(editingJob.id) : undefined}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="card-raised rounded-lg px-4 py-3">
      <div className="text-xs text-fg-muted mb-1">{label}</div>
      <div className={`text-xl font-bold ${accent || 'text-fg'}`}>{value}</div>
    </div>
  );
}
