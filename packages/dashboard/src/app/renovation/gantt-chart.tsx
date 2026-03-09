'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { RenovationJob, RenovationPhase } from './page';

interface Props {
  jobs: RenovationJob[];
  phases: RenovationPhase[];
  view: 'week' | 'month';
  projectStart: string | null;
  projectEnd: string | null;
  onJobClick: (job: RenovationJob) => void;
  onJobDatesChange: (id: number, start: string, end: string) => void;
  onPhaseDatesChange: (phaseId: number, start: string, end: string) => void;
  onAddJob: () => void;
}

// ── helpers ──

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / 86400000);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function deriveStatus(job: RenovationJob): string {
  if (!job.max_worker_stage) return 'new';
  if (job.max_worker_stage === 'accepted') return 'assigned';
  if (job.max_worker_stage === 'offer') return 'quoted';
  return 'searching';
}

const BAR_COLORS: Record<string, { bg: string; border: string }> = {
  new: { bg: 'bg-gray-400/90', border: 'border-gray-500' },
  searching: { bg: 'bg-blue-400/90', border: 'border-blue-500' },
  quoted: { bg: 'bg-amber-400/90', border: 'border-amber-500' },
  assigned: { bg: 'bg-emerald-400/90', border: 'border-emerald-500' },
};

// ── column building ──

interface Column { label: string; sublabel?: string; start: Date; end: Date }
interface MonthSpan { label: string; colSpan: number }

function computeRange(jobs: RenovationJob[], projectStart: string | null, projectEnd: string | null): [Date, Date] {
  const now = new Date();

  if (projectStart && projectEnd) return [parseDate(projectStart), parseDate(projectEnd)];

  const jobDates = jobs.flatMap(j => [parseDate(j.start_date), parseDate(j.end_date)]);
  const allTimes = [...jobDates.map(d => d.getTime()), now.getTime()];

  let lo: Date, hi: Date;
  if (projectStart) {
    lo = parseDate(projectStart);
  } else {
    const min = new Date(Math.min(...allTimes));
    lo = new Date(min.getFullYear(), min.getMonth() - 1, 1);
  }
  if (projectEnd) {
    hi = parseDate(projectEnd);
  } else {
    const max = new Date(Math.max(...allTimes));
    hi = new Date(max.getFullYear(), max.getMonth() + 2, 0);
  }
  return [lo, hi];
}

function buildColumns(view: 'week' | 'month', rangeStart: Date, rangeEnd: Date): Column[] {
  const cols: Column[] = [];
  if (view === 'month') {
    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cur <= rangeEnd) {
      const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      cols.push({ label: MONTH_NAMES[cur.getMonth()], sublabel: String(cur.getFullYear()), start: new Date(cur), end });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  } else {
    let cur = startOfWeek(rangeStart);
    const stop = addDays(rangeEnd, 7);
    while (cur <= stop) {
      const end = addDays(cur, 6);
      cols.push({ label: `${cur.getDate()}`, sublabel: `${cur.getDate()}–${end.getDate()}`, start: new Date(cur), end });
      cur = addDays(cur, 7);
    }
  }
  return cols;
}

function buildMonthSpans(columns: Column[]): MonthSpan[] {
  const spans: MonthSpan[] = [];
  for (const col of columns) {
    const label = `${MONTH_NAMES[col.start.getMonth()]} ${col.start.getFullYear()}`;
    if (spans.length && spans[spans.length - 1].label === label) spans[spans.length - 1].colSpan++;
    else spans.push({ label, colSpan: 1 });
  }
  return spans;
}

function barPosition(start: string, end: string, columns: Column[]): { left: number; width: number } | null {
  if (!columns.length) return null;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime();
  const span = t1 - t0;
  if (span <= 0) return null;
  const s = Math.max(parseDate(start).getTime(), t0);
  const e = Math.min(parseDate(end).getTime(), t1);
  if (s >= e) return null;
  return { left: ((s - t0) / span) * 100, width: Math.max(((e - s) / span) * 100, 0.5) };
}

function todayPosition(columns: Column[]): number | null {
  if (!columns.length) return null;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime();
  const now = Date.now();
  if (now < t0 || now > t1) return null;
  return ((now - t0) / (t1 - t0)) * 100;
}

// ── Tooltip ──

function Tooltip({ name, startDate, endDate, color, style }: {
  name: string; startDate: string; endDate: string; color: string;
  style: React.CSSProperties;
}) {
  const days = daysBetween(startDate, endDate);
  return (
    <div
      className="absolute z-50 pointer-events-none bg-surface-secondary border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
      style={style}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="font-semibold text-fg font-content" dir="auto">{name}</span>
      </div>
      <div className="text-fg-muted font-content">
        {startDate} → {endDate} · {days} day{days !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

// ── Bar component (shared between job bars and phase bars) ──

interface BarProps {
  barPos: { left: number; width: number };
  color: string;
  label: string;
  startDate: string;
  endDate: string;
  statusClasses?: { bg: string; border: string };
  isDragging: boolean;
  onMouseDownMove: (e: React.MouseEvent) => void;
  onMouseDownLeft: (e: React.MouseEvent) => void;
  onMouseDownRight: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

function GanttBar({ barPos, color, label, startDate, endDate, statusClasses, isDragging, onMouseDownMove, onMouseDownLeft, onMouseDownRight, onDoubleClick }: BarProps) {
  const [hover, setHover] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const useCustomColor = !!color;

  useEffect(() => {
    if (hover && barRef.current) {
      const rect = barRef.current.getBoundingClientRect();
      const parentRect = barRef.current.offsetParent?.getBoundingClientRect();
      if (parentRect) {
        setTooltipStyle({
          left: rect.left - parentRect.left + rect.width / 2,
          bottom: parentRect.bottom - rect.top + 4,
          transform: 'translateX(-50%)',
        });
      }
    }
  }, [hover]);

  return (
    <div
      ref={barRef}
      className="absolute top-3 h-[28px] group/bar"
      style={{ left: `${barPos.left}%`, width: `${barPos.width}%`, minWidth: 20, zIndex: 5 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Body */}
      <div
        className={`absolute inset-0 rounded-md flex items-center overflow-hidden ${useCustomColor ? 'border border-black/10' : `${statusClasses?.bg || 'bg-gray-400/90'} border ${statusClasses?.border || 'border-gray-500'}`}`}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          ...(useCustomColor ? { backgroundColor: color } : {}),
        }}
        onMouseDown={onMouseDownMove}
        onDoubleClick={onDoubleClick}
      >
        <span className="px-2.5 text-[11px] font-medium text-white truncate select-none drop-shadow-sm flex-1 text-center font-content" dir="auto">
          {label}
        </span>
      </div>
      {/* Left handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-start"
        onMouseDown={onMouseDownLeft}
      >
        <div className="w-1 h-3 rounded-full bg-white/60 opacity-0 group-hover/bar:opacity-100 transition-opacity ml-0.5" />
      </div>
      {/* Right handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-end"
        onMouseDown={onMouseDownRight}
      >
        <div className="w-1 h-3 rounded-full bg-white/60 opacity-0 group-hover/bar:opacity-100 transition-opacity mr-0.5" />
      </div>
      {/* Tooltip */}
      {hover && !isDragging && (
        <Tooltip name={label} startDate={startDate} endDate={endDate} color={color || '#9ca3af'} style={tooltipStyle} />
      )}
    </div>
  );
}

// ── component ──

export function GanttChart({ jobs, phases, view, projectStart, projectEnd, onJobClick, onJobDatesChange, onPhaseDatesChange, onAddJob }: Props) {
  const range = useMemo(() => computeRange(jobs, projectStart, projectEnd), [jobs, projectStart, projectEnd]);
  const columns = useMemo(() => buildColumns(view, range[0], range[1]), [view, range]);
  const monthSpans = useMemo(() => view === 'week' ? buildMonthSpans(columns) : [], [view, columns]);

  // Index phases by job_id
  const phasesByJob = useMemo(() => {
    const map = new Map<number, RenovationPhase[]>();
    for (const p of phases) {
      if (!map.has(p.job_id)) map.set(p.job_id, []);
      map.get(p.job_id)!.push(p);
    }
    return map;
  }, [phases]);

  const [todayPos, setTodayPos] = useState<number | null>(null);
  useEffect(() => { setTodayPos(todayPosition(columns)); }, [columns]);

  // ── dragging ──
  const timelineRef = useRef<HTMLDivElement>(null);
  const jobCbRef = useRef(onJobDatesChange);
  jobCbRef.current = onJobDatesChange;
  const phaseCbRef = useRef(onPhaseDatesChange);
  phaseCbRef.current = onPhaseDatesChange;

  const frozenCols = useRef(columns);
  const dragInfo = useRef<{
    type: 'job' | 'phase';
    id: number;
    edge: 'left' | 'right' | 'move';
    startX: number;
    origStart: string;
    origEnd: string;
    pxPerMs: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent, type: 'job' | 'phase', id: number, startDate: string, endDate: string, edge: 'left' | 'right' | 'move') => {
    e.stopPropagation();
    e.preventDefault();
    if (!timelineRef.current || !columns.length) return;

    frozenCols.current = columns;
    const px = timelineRef.current.getBoundingClientRect().width;
    const t0 = columns[0].start.getTime();
    const t1 = columns[columns.length - 1].end.getTime();

    dragInfo.current = {
      type,
      id,
      edge,
      startX: e.clientX,
      origStart: startDate,
      origEnd: endDate,
      pxPerMs: px / (t1 - t0),
    };
    setDragging(true);
  }, [columns]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const d = dragInfo.current;
      if (!d) return;
      const dxMs = (e.clientX - d.startX) / d.pxPerMs;
      const daysDelta = Math.round(dxMs / 86400000);
      if (daysDelta === 0) return;

      const s0 = parseDate(d.origStart);
      const e0 = parseDate(d.origEnd);
      let ns: Date, ne: Date;

      if (d.edge === 'left') {
        ns = addDays(s0, daysDelta);
        ne = e0;
        if (ns >= ne) ns = addDays(ne, -1);
      } else if (d.edge === 'right') {
        ns = s0;
        ne = addDays(e0, daysDelta);
        if (ne <= ns) ne = addDays(ns, 1);
      } else {
        ns = addDays(s0, daysDelta);
        ne = addDays(e0, daysDelta);
      }

      if (d.type === 'job') {
        jobCbRef.current(d.id, fmtDate(ns), fmtDate(ne));
      } else {
        phaseCbRef.current(d.id, fmtDate(ns), fmtDate(ne));
      }
    };

    const onUp = () => { dragInfo.current = null; setDragging(false); };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  const displayCols = dragging ? frozenCols.current : columns;

  return (
    <div className="card-raised rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 260 }} />
            {displayCols.map((_, i) => <col key={i} />)}
          </colgroup>

          <thead>
            {/* Month strip — week view */}
            {view === 'week' && monthSpans.length > 0 && (
              <tr className="border-b border-border-subtle">
                <th />
                {monthSpans.map((span, i) => (
                  <th
                    key={i}
                    colSpan={span.colSpan}
                    className="text-center py-1.5 text-[10px] font-semibold text-fg-secondary uppercase tracking-wider border-l border-border-subtle bg-surface-hover/30"
                  >
                    {span.label}
                  </th>
                ))}
              </tr>
            )}

            {/* Column headers */}
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-fg-secondary uppercase tracking-wider">
                Task
              </th>
              {displayCols.map((col, i) => (
                <th key={i} className="text-center px-1 py-2 text-xs border-l border-border-subtle font-normal">
                  <div className="font-semibold text-fg-secondary">{col.label}</div>
                  {col.sublabel && <div className="text-fg-muted text-[10px]">{col.sublabel}</div>}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {jobs.map((job) => {
              const jobPhases = phasesByJob.get(job.id) || [];
              const hasPhases = jobPhases.length > 0;
              const colors = BAR_COLORS[deriveStatus(job)] || BAR_COLORS.new;
              const totalCols = displayCols.length;

              return (
                <tr key={job.id} className="border-b border-border-subtle hover:bg-surface-hover/50 transition-colors">
                  {/* Left info */}
                  <td className="px-4 py-3 align-middle">
                    <div className="group/row flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!job.has_accepted_worker && (
                            <span className="text-amber-500 text-sm shrink-0" title="No worker assigned">&#9888;</span>
                          )}
                          <span className="font-medium text-sm text-fg truncate" dir="auto">{job.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-fg-muted">
                          {job.accepted_worker_name && <span className="text-accent" dir="auto">{job.accepted_worker_name}</span>}
                          {job.accepted_worker_price != null && (
                            <>
                              {job.accepted_worker_name && <span>·</span>}
                              <span>{'\u20AA'}{job.accepted_worker_price.toLocaleString()}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onJobClick(job)}
                        className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity btn-raised rounded-md p-1.5 text-fg-muted hover:text-fg"
                        title="Edit job"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  </td>

                  {/* Timeline */}
                  <td colSpan={totalCols} className="relative p-0" style={{ height: 52 }}>
                    <div ref={timelineRef} className="absolute inset-0">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {displayCols.map((_, i) => (
                          <div key={i} className="flex-1 border-l border-border-subtle" />
                        ))}
                      </div>

                      {/* Today line */}
                      {todayPos !== null && (
                        <div className="absolute top-0 bottom-0 w-px bg-error/50 z-10 pointer-events-none" style={{ left: `${todayPos}%` }} />
                      )}

                      {/* Bars: either phases or single job bar */}
                      {hasPhases ? (
                        jobPhases.map(phase => {
                          const pos = barPosition(phase.start_date, phase.end_date, displayCols);
                          if (!pos) return null;
                          return (
                            <GanttBar
                              key={`phase-${phase.id}`}
                              barPos={pos}
                              color={phase.color}
                              label={phase.name}
                              startDate={phase.start_date}
                              endDate={phase.end_date}
                              isDragging={dragging}
                              onMouseDownMove={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'move')}
                              onMouseDownLeft={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'left')}
                              onMouseDownRight={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'right')}
                              onDoubleClick={() => onJobClick(job)}
                            />
                          );
                        })
                      ) : (
                        (() => {
                          const pos = barPosition(job.start_date, job.end_date, displayCols);
                          if (!pos) return null;
                          return (
                            <GanttBar
                              barPos={pos}
                              color={job.color}
                              label={job.name}
                              startDate={job.start_date}
                              endDate={job.end_date}
                              statusClasses={!job.color ? colors : undefined}
                              isDragging={dragging}
                              onMouseDownMove={e => onMouseDown(e, 'job', job.id, job.start_date, job.end_date, 'move')}
                              onMouseDownLeft={e => onMouseDown(e, 'job', job.id, job.start_date, job.end_date, 'left')}
                              onMouseDownRight={e => onMouseDown(e, 'job', job.id, job.start_date, job.end_date, 'right')}
                              onDoubleClick={() => onJobClick(job)}
                            />
                          );
                        })()
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* Add Job row */}
            <tr>
              <td className="px-4 py-3" colSpan={displayCols.length + 1}>
                <button
                  onClick={onAddJob}
                  className="text-sm text-fg-muted hover:text-accent transition-colors font-medium"
                >
                  + Add Job
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
