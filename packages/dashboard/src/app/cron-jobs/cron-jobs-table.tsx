'use client';

import { useState } from 'react';
import cronstrue from 'cronstrue';
import { CronExpressionParser } from 'cron-parser';
import type { CronJob } from './page';

function describeSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule, { use24HourTimeFormat: false });
  } catch {
    return schedule;
  }
}

function nextRun(schedule: string): string | null {
  try {
    const interval = CronExpressionParser.parse(schedule, { tz: 'Asia/Jerusalem' });
    const next = interval.next().toDate();
    const now = new Date();
    const diffMs = next.getTime() - now.getTime();
    const diffH = Math.floor(diffMs / 3600000);
    const diffM = Math.floor((diffMs % 3600000) / 60000);
    const time = next.toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    if (diffH < 1) return `in ${diffM}m (${time})`;
    if (diffH < 24) return `in ${diffH}h ${diffM}m (${time})`;
    return time;
  } catch {
    return null;
  }
}

export function CronJobsTable({ initialJobs }: { initialJobs: CronJob[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInput, setEditInput] = useState('');
  const [translatedCron, setTranslatedCron] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function toggleEnabled(job: CronJob) {
    const res = await fetch(`/api/cron-jobs/${job.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    if (res.ok) {
      const updated = await res.json();
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setTranslatedCron(null);
    setAiError(null);
  }

  async function translateInput() {
    setAiError(null);
    setTranslating(true);
    try {
      const res = await fetch('/api/cron-jobs/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || 'Translation failed');
      } else {
        setTranslatedCron(data.expression);
      }
    } catch {
      setAiError('Network error');
    } finally {
      setTranslating(false);
    }
  }

  async function saveSchedule(job: CronJob) {
    const schedule = translatedCron;
    if (!schedule) return;
    const res = await fetch(`/api/cron-jobs/${job.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule }),
    });
    if (res.ok) {
      const updated = await res.json();
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    }
    cancelEdit();
  }

  async function deleteJob(job: CronJob) {
    if (!confirm(`Delete "${job.name}"?`)) return;
    const res = await fetch(`/api/cron-jobs/${job.id}`, { method: 'DELETE' });
    if (res.ok) {
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    }
  }

  if (jobs.length === 0) {
    return <p className="text-fg-muted">No cron jobs found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-fg-secondary">
            <th className="py-3 px-4">Name</th>
            <th className="py-3 px-4">Schedule</th>
            <th className="py-3 px-4">Endpoint</th>
            <th className="py-3 px-4">Method</th>
            <th className="py-3 px-4">Enabled</th>
            <th className="py-3 px-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b border-border-subtle hover:bg-surface-secondary">
              <td className="py-3 px-4 font-medium">{job.name}</td>
              <td className="py-3 px-4">
                {editingId === job.id ? (
                  <div className="space-y-2">
                    {translatedCron ? (
                      <div className="flex gap-2 items-center">
                        <code className="text-success bg-surface-hover px-2 py-1 rounded text-xs">
                          {translatedCron}
                        </code>
                        <span className="text-xs text-fg-muted">{describeSchedule(translatedCron)}</span>
                        <button
                          onClick={() => saveSchedule(job)}
                          className="text-success hover:opacity-80 text-xs"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setTranslatedCron(null)}
                          className="text-accent hover:text-accent-hover text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-fg-muted hover:text-fg-secondary text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={editInput}
                          onChange={(e) => setEditInput(e.target.value)}
                          placeholder="e.g. Every weekday at 5 AM"
                          className="bg-surface-hover border border-border rounded px-2 py-1 text-sm w-56"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !translating) translateInput();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          disabled={translating}
                          autoFocus
                        />
                        {translating ? (
                          <span className="text-xs text-fg-muted animate-pulse">Translating...</span>
                        ) : (
                          <>
                            <button
                              onClick={translateInput}
                              className="text-accent hover:text-accent-hover text-xs"
                            >
                              Go
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-fg-muted hover:text-fg-secondary text-xs"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {aiError && <span className="text-xs text-error">{aiError}</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="group/schedule">
                    <div className="flex gap-2 items-center">
                      <code className="text-fg-secondary bg-surface-hover px-2 py-0.5 rounded text-xs">
                        {job.schedule}
                      </code>
                      <button
                        onClick={() => {
                          setEditingId(job.id);
                          setEditInput(job.schedule);
                          setTranslatedCron(null);
                          setAiError(null);
                        }}
                        className="text-xs text-accent hover:text-accent-hover opacity-0 group-hover/schedule:opacity-100 transition-opacity"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="text-xs text-fg-secondary mt-1">{describeSchedule(job.schedule)}</div>
                    {job.enabled && nextRun(job.schedule) && (
                      <div className="text-xs text-success/70 mt-0.5">Next: {nextRun(job.schedule)}</div>
                    )}
                  </div>
                )}
              </td>
              <td className="py-3 px-4 text-fg-secondary">{job.endpoint}</td>
              <td className="py-3 px-4">
                <span className="text-xs bg-surface-hover px-2 py-0.5 rounded">{job.method}</span>
              </td>
              <td className="py-3 px-4">
                <button
                  onClick={() => toggleEnabled(job)}
                  className={`w-10 h-5 rounded-full relative transition-colors ${
                    job.enabled ? 'bg-success' : 'bg-surface-hover'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      job.enabled ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </td>
              <td className="py-3 px-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingId(job.id);
                      setEditInput(job.schedule);
                      setTranslatedCron(null);
                      setAiError(null);
                    }}
                    className="text-xs text-accent hover:text-accent-hover"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteJob(job)}
                    className="text-xs text-error hover:opacity-80"
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
