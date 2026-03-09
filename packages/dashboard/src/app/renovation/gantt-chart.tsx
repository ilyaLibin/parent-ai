'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { RenovationJob, RenovationPhase } from './page';

type ZoomLevel = 'month' | 'week' | '3day' | 'day';
const ZOOM_LEVELS: ZoomLevel[] = ['month', 'week', '3day', 'day'];

interface Props {
  jobs: RenovationJob[];
  phases: RenovationPhase[];
  projectStart: string | null;
  projectEnd: string | null;
  hidePrices: boolean;
  onJobClick: (job: RenovationJob) => void;
  onJobDatesChange: (id: number, start: string, end: string) => void;
  onPhaseDatesChange: (phaseId: number, start: string, end: string) => void;
  onReorderJobs: (orderedIds: number[]) => void;
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

function fmtShort(s: string): string {
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}`;
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
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

interface Column { label: string; sublabel?: string; start: Date; end: Date; isWeekend?: boolean }
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

function buildColumns(zoom: ZoomLevel, rangeStart: Date, rangeEnd: Date): Column[] {
  const cols: Column[] = [];

  if (zoom === 'month') {
    let cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cur <= rangeEnd) {
      const end = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      cols.push({ label: MONTH_NAMES[cur.getMonth()], sublabel: String(cur.getFullYear()), start: new Date(cur), end });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  } else if (zoom === 'week') {
    let cur = startOfWeek(rangeStart);
    const stop = addDays(rangeEnd, 7);
    while (cur <= stop) {
      const end = addDays(cur, 6);
      cols.push({ label: `${cur.getDate()}`, sublabel: `${cur.getDate()}–${end.getDate()}`, start: new Date(cur), end });
      cur = addDays(cur, 7);
    }
  } else if (zoom === '3day') {
    let cur = new Date(rangeStart);
    const stop = addDays(rangeEnd, 3);
    while (cur <= stop) {
      const end = addDays(cur, 2);
      cols.push({
        label: `${cur.getDate()}`,
        sublabel: `${MONTH_NAMES[cur.getMonth()]} ${cur.getDate()}–${end.getDate()}`,
        start: new Date(cur),
        end,
      });
      cur = addDays(cur, 3);
    }
  } else {
    // day
    let cur = new Date(rangeStart);
    const stop = addDays(rangeEnd, 1);
    while (cur <= stop) {
      const dow = cur.getDay();
      cols.push({
        label: `${cur.getDate()}`,
        sublabel: DAY_NAMES[dow],
        start: new Date(cur),
        end: new Date(cur),
        isWeekend: dow === 0 || dow === 6,
      });
      cur = addDays(cur, 1);
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

function barPosition(start: string, end: string, columns: Column[]): { left: number; width: number; isSingleDay: boolean } | null {
  if (!columns.length) return null;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime();
  const span = t1 - t0;
  if (span <= 0) return null;
  const s = Math.max(parseDate(start).getTime(), t0);
  const e = Math.min(parseDate(end).getTime(), t1);
  if (s > e) return null;
  const isSingleDay = start === end;
  const rawWidth = ((e - s) / span) * 100;
  return { left: ((s - t0) / span) * 100, width: Math.max(rawWidth, 0.3), isSingleDay };
}

function todayPosition(columns: Column[]): number | null {
  if (!columns.length) return null;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime();
  const now = Date.now();
  if (now < t0 || now > t1) return null;
  return ((now - t0) / (t1 - t0)) * 100;
}

// Column width based on zoom level
function colMinWidth(zoom: ZoomLevel): number {
  switch (zoom) {
    case 'day': return 40;
    case '3day': return 60;
    case 'week': return 80;
    case 'month': return 100;
  }
}

// ── Bar component ──

interface BarProps {
  barPos: { left: number; width: number; isSingleDay: boolean };
  color: string;
  label: string;
  startDate: string;
  endDate: string;
  statusClasses?: { bg: string; border: string };
  isDragging: boolean;
  isActiveDrag: boolean;
  onMouseDownMove: (e: React.MouseEvent) => void;
  onMouseDownLeft: (e: React.MouseEvent) => void;
  onMouseDownRight: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

function GanttBar({ barPos, color, label, startDate, endDate, statusClasses, isDragging, isActiveDrag, onMouseDownMove, onMouseDownLeft, onMouseDownRight, onDoubleClick }: BarProps) {
  const [hover, setHover] = useState(false);
  const useCustomColor = !!color;
  const days = daysBetween(startDate, endDate);
  const isSingleDay = barPos.isSingleDay;

  return (
    <div
      className="absolute group/bar"
      style={{ left: `${barPos.left}%`, width: isSingleDay ? 12 : `${barPos.width}%`, minWidth: isSingleDay ? 12 : 20, top: 6, zIndex: 5 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {isSingleDay ? (
        <div
          className="w-3 h-3 rotate-45 rounded-sm border border-black/10 mx-auto"
          style={{ cursor: isDragging ? 'grabbing' : 'grab', backgroundColor: color || '#9ca3af' }}
          onMouseDown={onMouseDownMove}
          onDoubleClick={onDoubleClick}
        />
      ) : (
        <>
          <div
            className={`h-[18px] rounded-md overflow-hidden ${useCustomColor ? 'border border-black/10' : `${statusClasses?.bg || 'bg-gray-400/90'} border ${statusClasses?.border || 'border-gray-500'}`}`}
            style={{ cursor: isDragging ? 'grabbing' : 'grab', ...(useCustomColor ? { backgroundColor: color } : {}) }}
            onMouseDown={onMouseDownMove}
            onDoubleClick={onDoubleClick}
          />
          <div className="absolute left-0 top-0 h-[18px] w-3 cursor-ew-resize z-20 flex items-center justify-start" onMouseDown={onMouseDownLeft}>
            <div className="w-1 h-2.5 rounded-full bg-white/60 opacity-0 group-hover/bar:opacity-100 transition-opacity ml-0.5" />
          </div>
          <div className="absolute right-0 top-0 h-[18px] w-3 cursor-ew-resize z-20 flex items-center justify-end" onMouseDown={onMouseDownRight}>
            <div className="w-1 h-2.5 rounded-full bg-white/60 opacity-0 group-hover/bar:opacity-100 transition-opacity mr-0.5" />
          </div>
        </>
      )}

      {/* Connector line + label below */}
      <div className="flex flex-col items-start" style={{ marginLeft: isSingleDay ? 5 : 0 }}>
        <div className="w-px h-2 bg-fg-muted/40" />
        <span className="text-xs text-fg-secondary font-medium font-content select-none whitespace-nowrap leading-tight" dir="auto">
          {label}
        </span>
      </div>

      {/* Tooltip on hover */}
      {(hover || isActiveDrag) && (
        <div className="absolute z-[100] pointer-events-none bg-surface-secondary border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
          style={{ left: 0, bottom: '100%', marginBottom: 4 }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color || '#9ca3af' }} />
            <span className="font-semibold text-fg font-content" dir="auto">{label}</span>
          </div>
          <div className="text-fg-muted font-content">
            {fmtShort(startDate)}{startDate !== endDate && ` → ${fmtShort(endDate)}`} · {days === 0 ? '1 day' : `${days} day${days !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ── component ──

export function GanttChart({ jobs, phases, projectStart, projectEnd, hidePrices, onJobClick, onJobDatesChange, onPhaseDatesChange, onReorderJobs, onAddJob }: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const zoomIdx = ZOOM_LEVELS.indexOf(zoom);
  const canZoomIn = zoomIdx < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIdx > 0;

  const range = useMemo(() => computeRange(jobs, projectStart, projectEnd), [jobs, projectStart, projectEnd]);
  const columns = useMemo(() => buildColumns(zoom, range[0], range[1]), [zoom, range]);
  const showMonthStrip = zoom !== 'month';
  const monthSpans = useMemo(() => showMonthStrip ? buildMonthSpans(columns) : [], [showMonthStrip, columns]);

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

  // ── bar dragging (timeline) ──
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
  const [activeDragKey, setActiveDragKey] = useState<string | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent, type: 'job' | 'phase', id: number, startDate: string, endDate: string, edge: 'left' | 'right' | 'move') => {
    e.stopPropagation();
    e.preventDefault();
    if (!timelineRef.current || !columns.length) return;

    frozenCols.current = columns;
    const px = timelineRef.current.getBoundingClientRect().width;
    const t0 = columns[0].start.getTime();
    const t1 = columns[columns.length - 1].end.getTime();

    dragInfo.current = { type, id, edge, startX: e.clientX, origStart: startDate, origEnd: endDate, pxPerMs: px / (t1 - t0) };
    setActiveDragKey(`${type}-${id}`);
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
      if (d.edge === 'left') { ns = addDays(s0, daysDelta); ne = e0; if (ns > ne) ns = ne; }
      else if (d.edge === 'right') { ns = s0; ne = addDays(e0, daysDelta); if (ne < ns) ne = ns; }
      else { ns = addDays(s0, daysDelta); ne = addDays(e0, daysDelta); }
      if (d.type === 'job') jobCbRef.current(d.id, fmtDate(ns), fmtDate(ne));
      else phaseCbRef.current(d.id, fmtDate(ns), fmtDate(ne));
    };
    const onUp = () => { dragInfo.current = null; setDragging(false); setActiveDragKey(null); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  const displayCols = dragging ? frozenCols.current : columns;

  const todayColIdx = useMemo(() => {
    const now = Date.now();
    return displayCols.findIndex(c => now >= c.start.getTime() && now <= c.end.getTime() + 86400000 - 1);
  }, [displayCols]);

  // ── pan drag (on empty timeline areas) ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const panInfo = useRef<{ startX: number; scrollLeft: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const onPanStart = useCallback((e: React.MouseEvent) => {
    // Only start pan if clicking on the timeline background (not on a bar)
    if ((e.target as HTMLElement).closest('.group\\/bar')) return;
    if (!scrollRef.current) return;
    e.preventDefault();
    panInfo.current = { startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft };
    setPanning(true);
  }, []);

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      const p = panInfo.current;
      if (!p || !scrollRef.current) return;
      const dx = e.clientX - p.startX;
      scrollRef.current.scrollLeft = p.scrollLeft - dx;
    };
    const onUp = () => { panInfo.current = null; setPanning(false); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [panning]);

  // ── row reorder (HTML5 DnD) ──
  const [dragRowId, setDragRowId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const reorderCbRef = useRef(onReorderJobs);
  reorderCbRef.current = onReorderJobs;

  const onRowDragStart = useCallback((e: React.DragEvent, jobId: number) => {
    setDragRowId(jobId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(jobId));
  }, []);

  const onRowDragOver = useCallback((e: React.DragEvent, jobId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(jobId);
  }, []);

  const onRowDrop = useCallback((e: React.DragEvent, targetJobId: number) => {
    e.preventDefault();
    setDropTargetId(null);
    const sourceId = dragRowId;
    setDragRowId(null);
    if (sourceId === null || sourceId === targetJobId) return;
    const ids = jobs.map(j => j.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetJobId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, sourceId);
    reorderCbRef.current(ids);
  }, [dragRowId, jobs]);

  const minColW = colMinWidth(zoom);

  return (
    <div className="card-raised rounded-xl overflow-hidden">
      {/* Zoom controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-hover/20">
        <span className="text-xs text-fg-muted uppercase tracking-wider font-semibold">{zoom === '3day' ? '3-Day' : zoom}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => canZoomOut && setZoom(ZOOM_LEVELS[zoomIdx - 1])}
            disabled={!canZoomOut}
            className="btn-raised rounded-md w-7 h-7 flex items-center justify-center text-fg-secondary disabled:opacity-30 text-sm font-bold"
            title="Zoom out"
          >
            −
          </button>
          <button
            onClick={() => canZoomIn && setZoom(ZOOM_LEVELS[zoomIdx + 1])}
            disabled={!canZoomIn}
            className="btn-raised rounded-md w-7 h-7 flex items-center justify-center text-fg-secondary disabled:opacity-30 text-sm font-bold"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{ cursor: panning ? 'grabbing' : undefined }}
      >
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed', minWidth: displayCols.length * minColW + 260 }}>
          <colgroup>
            <col style={{ width: 260 }} />
            {displayCols.map((_, i) => <col key={i} style={{ minWidth: minColW }} />)}
          </colgroup>

          <thead>
            {/* Month strip */}
            {showMonthStrip && monthSpans.length > 0 && (
              <tr className="border-b border-border-subtle">
                <th className="sticky left-0 z-20 bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none" />
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
              <th className="sticky left-0 z-20 bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none text-left px-4 py-3 text-xs font-semibold text-fg-secondary uppercase tracking-wider">
                Task
              </th>
              {displayCols.map((col, i) => (
                <th key={i} className={`text-center px-1 py-2 text-xs border-l border-border-subtle font-normal ${col.isWeekend ? 'bg-surface-hover/40' : ''}`}>
                  <div className={`font-semibold ${i === todayColIdx ? 'text-error' : 'text-fg-secondary'}`}>{col.label}</div>
                  {col.sublabel && <div className={`text-[10px] ${i === todayColIdx ? 'text-error/70' : 'text-fg-muted'}`}>{col.sublabel}</div>}
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
                <tr
                  key={job.id}
                  className={`border-b border-border-subtle hover:bg-surface-hover/50 transition-colors ${dragRowId === job.id ? 'opacity-40' : ''} ${dropTargetId === job.id && dragRowId !== job.id ? 'border-t-2 border-t-accent' : ''}`}
                  onDragOver={e => onRowDragOver(e, job.id)}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={e => onRowDrop(e, job.id)}
                >
                  {/* Left info */}
                  <td className="sticky left-0 z-10 bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none px-4 py-3 align-middle">
                    <div className="group/row flex items-center gap-2">
                      <div
                        draggable
                        onDragStart={e => onRowDragStart(e, job.id)}
                        onDragEnd={() => { setDragRowId(null); setDropTargetId(null); }}
                        className="shrink-0 cursor-grab active:cursor-grabbing text-fg-muted/40 hover:text-fg-muted transition-colors"
                        title="Drag to reorder"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!job.has_accepted_worker && (
                            <span className="text-amber-500 text-sm shrink-0" title="No worker assigned">&#9888;</span>
                          )}
                          <span className="font-medium text-sm text-fg truncate" dir="auto">{job.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-fg-muted">
                          {job.accepted_worker_name && <span className="text-accent" dir="auto">{job.accepted_worker_name}</span>}
                          {!hidePrices && job.accepted_worker_price != null && (
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
                  <td
                    colSpan={totalCols}
                    className="relative p-0"
                    style={{ height: 56 }}
                    onMouseDown={onPanStart}
                  >
                    <div ref={timelineRef} className="absolute inset-0">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {displayCols.map((col, i) => (
                          <div key={i} className={`flex-1 border-l border-border-subtle ${col.isWeekend ? 'bg-surface-hover/30' : ''}`} />
                        ))}
                      </div>

                      {/* Today line */}
                      {todayPos !== null && (
                        <div className="absolute top-0 bottom-0 w-px bg-error/50 z-10 pointer-events-none" style={{ left: `${todayPos}%` }} />
                      )}

                      {/* Bars */}
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
                              isActiveDrag={activeDragKey === `phase-${phase.id}`}
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
                              isActiveDrag={activeDragKey === `job-${job.id}`}
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
              <td className="sticky left-0 z-10 bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none px-4 py-3">
                <button
                  onClick={onAddJob}
                  className="text-sm text-fg-muted hover:text-accent transition-colors font-medium"
                >
                  + Add Job
                </button>
              </td>
              <td colSpan={displayCols.length} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
