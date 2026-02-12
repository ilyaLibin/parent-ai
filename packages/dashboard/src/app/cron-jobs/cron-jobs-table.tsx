'use client';

import { useState } from 'react';
import type { CronJob } from './page';

export function CronJobsTable({ initialJobs }: { initialJobs: CronJob[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSchedule, setEditSchedule] = useState('');

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

  async function saveSchedule(job: CronJob) {
    const res = await fetch(`/api/cron-jobs/${job.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: editSchedule }),
    });
    if (res.ok) {
      const updated = await res.json();
      setJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
    }
    setEditingId(null);
  }

  async function deleteJob(job: CronJob) {
    if (!confirm(`Delete "${job.name}"?`)) return;
    const res = await fetch(`/api/cron-jobs/${job.id}`, { method: 'DELETE' });
    if (res.ok) {
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    }
  }

  if (jobs.length === 0) {
    return <p className="text-zinc-400">No cron jobs found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-400">
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
            <tr key={job.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
              <td className="py-3 px-4 font-medium">{job.name}</td>
              <td className="py-3 px-4">
                {editingId === job.id ? (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={editSchedule}
                      onChange={(e) => setEditSchedule(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm w-40"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveSchedule(job);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                    />
                    <button
                      onClick={() => saveSchedule(job)}
                      className="text-green-400 hover:text-green-300 text-xs"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-zinc-500 hover:text-zinc-300 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <code className="text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded text-xs">
                    {job.schedule}
                  </code>
                )}
              </td>
              <td className="py-3 px-4 text-zinc-400">{job.endpoint}</td>
              <td className="py-3 px-4">
                <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded">{job.method}</span>
              </td>
              <td className="py-3 px-4">
                <button
                  onClick={() => toggleEnabled(job)}
                  className={`w-10 h-5 rounded-full relative transition-colors ${
                    job.enabled ? 'bg-green-600' : 'bg-zinc-700'
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
                      setEditSchedule(job.schedule);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteJob(job)}
                    className="text-xs text-red-400 hover:text-red-300"
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
