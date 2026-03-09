'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RenovationJob, RenovationWorker, RenovationPhase } from './page';

const STAGES = ['contact', 'contacted', 'offer', 'accepted'] as const;
const STAGE_LABELS: Record<string, string> = {
  contact: 'Contact',
  contacted: 'Contacted',
  offer: 'Offer',
  accepted: 'Accepted',
};
const PRESET_COLORS = ['#4f46e5', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280'];

interface Props {
  job: RenovationJob | null;
  onClose: () => void;
  onDelete?: () => void;
}

export function JobModal({ job, onClose, onDelete }: Props) {
  const isNew = !job;

  const [name, setName] = useState(job?.name ?? '');
  const [startDate, setStartDate] = useState(job?.start_date ?? new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(job?.end_date ?? addDaysStr(new Date().toISOString().split('T')[0], 14));
  const [color, setColor] = useState(job?.color ?? '#4f46e5');
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [saving, setSaving] = useState(false);

  // Phases
  const [phases, setPhases] = useState<RenovationPhase[]>([]);
  const hasPhases = phases.length > 0;

  const fetchPhases = useCallback(async () => {
    if (!job) return;
    const res = await fetch(`/api/renovation/jobs/${job.id}/phases`);
    if (res.ok) setPhases(await res.json());
  }, [job]);

  useEffect(() => { fetchPhases(); }, [fetchPhases]);

  // Update local dates when phases change (auto-computed)
  useEffect(() => {
    if (hasPhases) {
      const starts = phases.map(p => p.start_date).sort();
      const ends = phases.map(p => p.end_date).sort();
      setStartDate(starts[0]);
      setEndDate(ends[ends.length - 1]);
    }
  }, [phases, hasPhases]);

  // Workers
  const [workers, setWorkers] = useState<RenovationWorker[]>([]);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerPhone, setNewWorkerPhone] = useState('');
  const [editingWorkerId, setEditingWorkerId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [dragWorker, setDragWorker] = useState<number | null>(null);

  const fetchWorkers = useCallback(async () => {
    if (!job) return;
    const res = await fetch(`/api/renovation/jobs/${job.id}/workers`);
    if (res.ok) setWorkers(await res.json());
  }, [job]);

  useEffect(() => {
    fetchWorkers();
  }, [fetchWorkers]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        await fetch('/api/renovation/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category: 'Other', start_date: startDate, end_date: endDate, color, notes: notes || null }),
        });
      } else {
        await fetch(`/api/renovation/jobs/${job.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, start_date: startDate, end_date: endDate, color, notes: notes || null }),
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // ── Phase handlers ──

  const handleAddPhase = async () => {
    if (!job) return;
    // Default: use job dates for first phase, or last phase end → +14 days
    let pStart = startDate;
    let pEnd = endDate;
    if (phases.length > 0) {
      const lastEnd = phases.map(p => p.end_date).sort().pop()!;
      pStart = lastEnd;
      pEnd = addDaysStr(lastEnd, 14);
    }
    await fetch(`/api/renovation/jobs/${job.id}/phases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Phase', start_date: pStart, end_date: pEnd, color: color, sort_order: phases.length }),
    });
    fetchPhases();
  };

  const handleUpdatePhase = async (phaseId: number, updates: Partial<RenovationPhase>) => {
    await fetch(`/api/renovation/phases/${phaseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    fetchPhases();
  };

  const handleDeletePhase = async (phaseId: number) => {
    await fetch(`/api/renovation/phases/${phaseId}`, { method: 'DELETE' });
    fetchPhases();
  };

  // ── Worker handlers ──

  const handleAddWorker = async () => {
    if (!newWorkerName.trim() || !job) return;
    await fetch(`/api/renovation/jobs/${job.id}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newWorkerName, phone: newWorkerPhone || null }),
    });
    setNewWorkerName('');
    setNewWorkerPhone('');
    setShowAddWorker(false);
    fetchWorkers();
  };

  const handleMoveWorker = async (workerId: number, newStage: string) => {
    await fetch(`/api/renovation/workers/${workerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage }),
    });
    fetchWorkers();
  };

  const handleUpdatePrice = async (workerId: number) => {
    await fetch(`/api/renovation/workers/${workerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer_price: parseFloat(editPrice) || null }),
    });
    setEditingWorkerId(null);
    setEditPrice('');
    fetchWorkers();
  };

  const handleDeleteWorker = async (workerId: number) => {
    await fetch(`/api/renovation/workers/${workerId}`, { method: 'DELETE' });
    fetchWorkers();
  };

  const handleDrop = (stage: string) => {
    if (dragWorker !== null) {
      handleMoveWorker(dragWorker, stage);
      setDragWorker(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-6 md:pt-10 px-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-secondary border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col z-10">
        {/* Header */}
        <div className="shrink-0 border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{isNew ? 'New Job' : 'Edit Job'}</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-xl leading-none">&times;</button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Name + Color picker inline */}
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-xs text-fg-muted mb-1 block">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                className="input-inset w-full rounded-lg px-3 py-2 text-sm font-content"
                placeholder="e.g. Replace bedroom windows"
                dir="auto"
              />
            </div>
            <div className="shrink-0">
              <label className="text-xs text-fg-muted mb-1 block">Color</label>
              <div className="flex gap-1.5">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      color === c ? 'border-fg scale-110' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-fg-muted mb-1 block">
                Start Date{hasPhases && <span className="text-fg-muted/60 ml-1">(auto)</span>}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="input-inset w-full rounded-lg px-3 py-2 text-sm font-content disabled:opacity-50"
                disabled={hasPhases}
              />
            </div>
            <div>
              <label className="text-xs text-fg-muted mb-1 block">
                End Date{hasPhases && <span className="text-fg-muted/60 ml-1">(auto)</span>}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="input-inset w-full rounded-lg px-3 py-2 text-sm font-content disabled:opacity-50"
                disabled={hasPhases}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-fg-muted mb-1 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="input-inset w-full rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y font-content"
              placeholder="Additional notes..."
              dir="auto"
            />
          </div>

          {/* Phases — only for existing jobs */}
          {!isNew && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-fg-muted font-semibold uppercase tracking-wider">Phases</label>
                <button
                  onClick={handleAddPhase}
                  className="btn-raised rounded-lg px-3 py-1 text-xs"
                >
                  + Add Phase
                </button>
              </div>

              {phases.length === 0 ? (
                <div className="text-xs text-fg-muted py-3 text-center border border-dashed border-border-subtle rounded-lg">
                  No phases — the job appears as a single bar on the timeline.
                </div>
              ) : (
                <div className="space-y-2">
                  {phases.map(phase => (
                    <PhaseRow
                      key={phase.id}
                      phase={phase}
                      onUpdate={handleUpdatePhase}
                      onDelete={handleDeletePhase}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Workers Kanban — only for existing jobs */}
          {!isNew && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-fg-muted font-semibold uppercase tracking-wider">Workers</label>
                <button
                  onClick={() => setShowAddWorker(!showAddWorker)}
                  className="btn-raised rounded-lg px-3 py-1 text-xs"
                >
                  + Add Worker
                </button>
              </div>

              {/* Add worker form */}
              {showAddWorker && (
                <div className="card-raised rounded-lg p-3 mb-3 flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-[10px] text-fg-muted mb-0.5 block">Name</label>
                    <input
                      value={newWorkerName}
                      onChange={e => setNewWorkerName(e.target.value)}
                      className="input-inset w-full rounded px-2 py-1.5 text-xs font-content"
                      placeholder="Worker name"
                      dir="auto"
                      onKeyDown={e => e.key === 'Enter' && handleAddWorker()}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-fg-muted mb-0.5 block">Phone</label>
                    <input
                      value={newWorkerPhone}
                      onChange={e => setNewWorkerPhone(e.target.value)}
                      className="input-inset w-full rounded px-2 py-1.5 text-xs font-content"
                      placeholder="Phone number"
                      onKeyDown={e => e.key === 'Enter' && handleAddWorker()}
                    />
                  </div>
                  <button onClick={handleAddWorker} className="btn-accent rounded px-3 py-1.5 text-xs shrink-0">
                    Add
                  </button>
                </div>
              )}

              {/* Kanban columns */}
              <div className="grid grid-cols-4 gap-2">
                {STAGES.map(stage => {
                  const stageWorkers = workers.filter(w => w.stage === stage);
                  return (
                    <div
                      key={stage}
                      className="bg-surface rounded-lg border border-border-subtle min-h-[120px]"
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-accent/40'); }}
                      onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-accent/40'); }}
                      onDrop={e => { e.currentTarget.classList.remove('ring-2', 'ring-accent/40'); handleDrop(stage); }}
                    >
                      <div className="px-2 py-2 border-b border-border-subtle">
                        <span className="text-[10px] font-semibold text-fg-secondary uppercase tracking-wider">
                          {STAGE_LABELS[stage]}
                        </span>
                        <span className="text-[10px] text-fg-muted ml-1">({stageWorkers.length})</span>
                      </div>
                      <div className="p-1.5 space-y-1.5">
                        {stageWorkers.map(w => (
                          <div
                            key={w.id}
                            draggable
                            onDragStart={() => setDragWorker(w.id)}
                            onDragEnd={() => setDragWorker(null)}
                            className={`group/card bg-surface-secondary rounded-md border border-border p-2 cursor-grab active:cursor-grabbing text-xs transition-shadow hover:shadow-md ${
                              dragWorker === w.id ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-fg truncate font-content" dir="auto">{w.name}</span>
                              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/card:opacity-100 transition-opacity">
                                <button
                                  onClick={() => { setEditingWorkerId(w.id); setEditPrice(String(w.offer_price ?? '')); }}
                                  className="text-fg-muted hover:text-accent p-0.5 rounded"
                                  title="Edit price"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => handleDeleteWorker(w.id)}
                                  className="text-fg-muted hover:text-error p-0.5 rounded"
                                  title="Remove"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            {w.phone && (
                              <a href={`tel:${w.phone}`} className="text-accent text-[10px] hover:underline block truncate font-content">
                                {w.phone}
                              </a>
                            )}
                            {/* Price display/edit */}
                            {editingWorkerId === w.id ? (
                              <div className="flex gap-1 mt-1">
                                <input
                                  value={editPrice}
                                  onChange={e => setEditPrice(e.target.value)}
                                  className="input-inset w-full rounded px-1.5 py-0.5 text-[10px] font-content"
                                  placeholder="Price"
                                  type="number"
                                  autoFocus
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleUpdatePrice(w.id);
                                    if (e.key === 'Escape') { setEditingWorkerId(null); setEditPrice(''); }
                                  }}
                                  onBlur={() => handleUpdatePrice(w.id)}
                                />
                              </div>
                            ) : (
                              w.offer_price != null && (
                                <div className="mt-1 text-[10px] text-fg-muted font-content">
                                  {'\u20AA'}{w.offer_price.toLocaleString()}
                                </div>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between bg-surface-secondary rounded-b-xl">
          <div>
            {onDelete && (
              <button onClick={onDelete} className="text-error text-xs hover:underline">
                Delete job
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-raised rounded-lg px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="btn-accent rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Phase row component ──

function PhaseRow({ phase, onUpdate, onDelete }: {
  phase: RenovationPhase;
  onUpdate: (id: number, updates: Partial<RenovationPhase>) => void;
  onDelete: (id: number) => void;
}) {
  const [name, setName] = useState(phase.name);
  const [startDate, setStartDate] = useState(phase.start_date);
  const [endDate, setEndDate] = useState(phase.end_date);

  // Sync from props if server data changes
  useEffect(() => { setName(phase.name); }, [phase.name]);
  useEffect(() => { setStartDate(phase.start_date); }, [phase.start_date]);
  useEffect(() => { setEndDate(phase.end_date); }, [phase.end_date]);

  return (
    <div className="card-raised rounded-lg p-3 flex items-center gap-3">
      {/* Color dot */}
      <div className="shrink-0 relative group/color">
        <span className="w-4 h-4 rounded-full block border border-black/10" style={{ backgroundColor: phase.color }} />
        <div className="absolute left-0 top-6 hidden group-hover/color:flex gap-1 bg-surface-secondary border border-border rounded-lg p-1.5 shadow-lg z-10">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onUpdate(phase.id, { color: c })}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                phase.color === c ? 'border-fg scale-110' : 'border-transparent hover:scale-105'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Name */}
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        onBlur={() => { if (name !== phase.name) onUpdate(phase.id, { name }); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
        className="input-inset flex-1 rounded px-2 py-1 text-xs font-content min-w-0"
        dir="auto"
      />

      {/* Dates */}
      <input
        type="date"
        value={startDate}
        onChange={e => { setStartDate(e.target.value); onUpdate(phase.id, { start_date: e.target.value }); }}
        className="input-inset rounded px-2 py-1 text-xs font-content w-[130px] shrink-0"
      />
      <span className="text-fg-muted text-xs">→</span>
      <input
        type="date"
        value={endDate}
        onChange={e => { setEndDate(e.target.value); onUpdate(phase.id, { end_date: e.target.value }); }}
        className="input-inset rounded px-2 py-1 text-xs font-content w-[130px] shrink-0"
      />

      {/* Delete */}
      <button
        onClick={() => onDelete(phase.id)}
        className="shrink-0 text-fg-muted hover:text-error p-1 rounded transition-colors"
        title="Remove phase"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
