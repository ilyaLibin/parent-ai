'use client';

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import type { RenovationJob, RenovationPhase } from './page';

type ZoomLevel = 'month' | 'week' | '3day' | 'day';
type LabelPosition = 'outside' | 'inside';
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
  filters: Set<string>;
  onToggleFilter: (f: string) => void;
  onClearFilters: () => void;
  totalJobCount: number;
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

// ── lane assignment for stacked inside labels ──

interface LaneAssignment { phase: RenovationPhase; lane: number }

function assignLanes(phases: RenovationPhase[]): { assignments: LaneAssignment[]; laneCount: number } {
  if (phases.length === 0) return { assignments: [], laneCount: 0 };
  const sorted = [...phases].sort((a, b) => {
    const cmp = a.start_date.localeCompare(b.start_date);
    return cmp !== 0 ? cmp : a.end_date.localeCompare(b.end_date);
  });
  const laneEnds: string[] = [];
  const assignments: LaneAssignment[] = [];
  for (const phase of sorted) {
    let lane = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] < phase.start_date) { lane = i; break; }
    }
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(phase.end_date); }
    else { laneEnds[lane] = phase.end_date; }
    assignments.push({ phase, lane });
  }
  return { assignments, laneCount: laneEnds.length };
}

const LANE_HEIGHT = 22; // bar height + gap per lane
const LANE_BAR_H = 18;
const OUTSIDE_LABEL_LANE_H = 18;

// ── lane assignment for outside (below-bar) labels ──

function assignOutsideLabelLanes(
  labels: { key: string; leftPx: number; widthPx: number }[]
): { lanes: Map<string, number>; laneCount: number } {
  if (labels.length === 0) return { lanes: new Map(), laneCount: 0 };
  const sorted = [...labels].sort((a, b) => a.leftPx - b.leftPx);
  const laneRightEdges: number[] = [];
  const lanes = new Map<string, number>();
  for (const label of sorted) {
    let assignedLane = -1;
    for (let i = 0; i < laneRightEdges.length; i++) {
      if (laneRightEdges[i] <= label.leftPx) { assignedLane = i; break; }
    }
    if (assignedLane === -1) { assignedLane = laneRightEdges.length; laneRightEdges.push(label.leftPx + label.widthPx); }
    else { laneRightEdges[assignedLane] = label.leftPx + label.widthPx; }
    lanes.set(label.key, assignedLane);
  }
  return { lanes, laneCount: laneRightEdges.length };
}

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
  labelPosition: LabelPosition;
  lane?: number;
  onMouseDownMove: (e: React.MouseEvent) => void;
  onMouseDownLeft: (e: React.MouseEvent) => void;
  onMouseDownRight: (e: React.MouseEvent) => void;
  outsideLane?: number;
  barKey?: string;
  onDoubleClick: () => void;
}

function GanttBar({ barPos, color, label, startDate, endDate, statusClasses, isDragging, isActiveDrag, labelPosition, lane = 0, outsideLane = 0, barKey, onMouseDownMove, onMouseDownLeft, onMouseDownRight, onDoubleClick }: BarProps) {
  const [hover, setHover] = useState(false);
  const useCustomColor = !!color;
  const days = daysBetween(startDate, endDate);
  const isSingleDay = barPos.isSingleDay;
  const showInside = labelPosition === 'inside' && !isSingleDay;
  const topOffset = labelPosition === 'inside' ? 6 + lane * LANE_HEIGHT : 6;

  return (
    <div
      className="absolute group/bar"
      style={{ left: `${barPos.left}%`, width: isSingleDay ? 12 : `${barPos.width}%`, minWidth: isSingleDay ? 12 : 20, top: topOffset, zIndex: 5 }}
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
            className={`h-[18px] rounded-md ${showInside ? 'flex items-center' : ''} overflow-hidden ${useCustomColor ? 'border border-black/10' : `${statusClasses?.bg || 'bg-gray-400/90'} border ${statusClasses?.border || 'border-gray-500'}`}`}
            style={{ cursor: isDragging ? 'grabbing' : 'grab', ...(useCustomColor ? { backgroundColor: color } : {}) }}
            onMouseDown={onMouseDownMove}
            onDoubleClick={onDoubleClick}
          >
            {showInside && (
              <span
                className="text-[10px] font-medium font-content select-none truncate leading-none px-1.5 pointer-events-none"
                style={{ color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                dir="auto"
              >
                {label}
              </span>
            )}
          </div>
          <div className="absolute left-0 top-0 h-[18px] w-3 cursor-ew-resize z-20 flex items-center justify-start" onMouseDown={e => e.metaKey ? onMouseDownMove(e) : onMouseDownLeft(e)}>
            <div className="w-1 h-2.5 rounded-full bg-white/60 opacity-0 group-hover/bar:opacity-100 transition-opacity ml-0.5" />
          </div>
          <div className="absolute right-0 top-0 h-[18px] w-3 cursor-ew-resize z-20 flex items-center justify-end" onMouseDown={e => e.metaKey ? onMouseDownMove(e) : onMouseDownRight(e)}>
            <div className="w-1 h-2.5 rounded-full bg-white/60 opacity-0 group-hover/bar:opacity-100 transition-opacity mr-0.5" />
          </div>
        </>
      )}

      {/* Connector line + label below (outside mode or single-day fallback) */}
      {(!showInside) && (
        <div className="flex flex-col items-start" style={{ marginLeft: isSingleDay ? 5 : 0 }}>
          <div className="w-px bg-fg-muted/40" style={{ height: 8 + outsideLane * OUTSIDE_LABEL_LANE_H }} />
          <div data-label-key={barKey} className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-fg-muted/60 font-content select-none whitespace-nowrap leading-tight">{fmtShort(startDate)}</span>
            <span className="text-xs text-fg-secondary font-medium font-content select-none whitespace-nowrap leading-tight" dir="auto">
              {label}
            </span>
          </div>
        </div>
      )}

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

// ── row timeline (handles outside label lane measurement) ──

function RowTimeline({
  job,
  jobPhases,
  insideLaneInfo,
  columns,
  labelPosition,
  dragging,
  activeDragKey,
  todayPos,
  colors,
  onMouseDown,
  onJobClick,
  onPanStart,
  totalCols,
  timelineRef: parentTimelineRef,
}: {
  job: RenovationJob;
  jobPhases: RenovationPhase[];
  insideLaneInfo: { assignments: LaneAssignment[]; laneCount: number } | undefined;
  columns: Column[];
  labelPosition: LabelPosition;
  dragging: boolean;
  activeDragKey: string | null;
  todayPos: number | null;
  colors: { bg: string; border: string };
  onMouseDown: (e: React.MouseEvent, type: 'job' | 'phase', id: number, start: string, end: string, edge: 'left' | 'right' | 'move') => void;
  onJobClick: (job: RenovationJob) => void;
  onPanStart: (e: React.MouseEvent) => void;
  totalCols: number;
  timelineRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [outsideLanes, setOutsideLanes] = useState<Map<string, number>>(new Map());
  const [outsideLaneCount, setOutsideLaneCount] = useState(0);

  const hasPhases = jobPhases.length > 0;
  const insideLaneCount = insideLaneInfo?.laneCount || 1;

  const measureKey = useMemo(() => {
    if (hasPhases) {
      return jobPhases.map(p => `${p.id}:${p.start_date}:${p.end_date}:${p.name}`).join('|');
    }
    return `${job.id}:${job.start_date}:${job.end_date}:${job.name}`;
  }, [hasPhases, jobPhases, job]);

  // Measure outside labels and compute stacking lanes (runs before paint)
  useLayoutEffect(() => {
    if (dragging) return;
    const container = containerRef.current;
    if (!container) return;

    const els = container.querySelectorAll<HTMLElement>('[data-label-key]');
    if (els.length === 0) { setOutsideLaneCount(0); return; }

    const containerRect = container.getBoundingClientRect();
    const items: { key: string; leftPx: number; widthPx: number }[] = [];
    els.forEach(el => {
      const key = el.getAttribute('data-label-key')!;
      const rect = el.getBoundingClientRect();
      items.push({ key, leftPx: rect.left - containerRect.left, widthPx: rect.width + 6 });
    });

    const result = assignOutsideLabelLanes(items);
    setOutsideLanes(result.lanes);
    setOutsideLaneCount(result.laneCount);
  }, [labelPosition, columns, measureKey, dragging]);

  const baseH = labelPosition === 'inside'
    ? Math.max(56, insideLaneCount * LANE_HEIGHT + 12)
    : 56;
  const rowH = baseH + Math.max(0, outsideLaneCount - 1) * OUTSIDE_LABEL_LANE_H;

  const setRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    parentTimelineRef.current = el;
  }, [parentTimelineRef]);

  return (
    <td
      colSpan={totalCols}
      className="relative p-0"
      style={{ height: rowH }}
      onMouseDown={onPanStart}
    >
      <div ref={setRef} className="absolute inset-0">
        {/* Grid lines */}
        <div className="absolute inset-0 flex pointer-events-none">
          {columns.map((col, i) => (
            <div key={i} className={`flex-1 border-l border-border-subtle ${col.isWeekend ? 'bg-surface-hover/30' : ''}`} />
          ))}
        </div>

        {/* Today line */}
        {todayPos !== null && (
          <div className="absolute top-0 bottom-0 w-px bg-error/50 z-10 pointer-events-none" style={{ left: `${todayPos}%` }} />
        )}

        {/* Bars */}
        {hasPhases ? (
          (insideLaneInfo?.assignments || jobPhases.map(p => ({ phase: p, lane: 0 }))).map(({ phase, lane }) => {
            const pos = barPosition(phase.start_date, phase.end_date, columns);
            if (!pos) return null;
            const key = `phase-${phase.id}`;
            return (
              <GanttBar
                key={key}
                barKey={key}
                barPos={pos}
                color={phase.color}
                label={phase.name}
                startDate={phase.start_date}
                endDate={phase.end_date}
                labelPosition={labelPosition}
                lane={lane}
                outsideLane={outsideLanes.get(key) || 0}
                isDragging={dragging}
                isActiveDrag={activeDragKey === key}
                onMouseDownMove={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'move')}
                onMouseDownLeft={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'left')}
                onMouseDownRight={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'right')}
                onDoubleClick={() => onJobClick(job)}
              />
            );
          })
        ) : (
          (() => {
            const pos = barPosition(job.start_date, job.end_date, columns);
            if (!pos) return null;
            const key = `job-${job.id}`;
            return (
              <GanttBar
                barKey={key}
                barPos={pos}
                color={job.color}
                label={job.name}
                startDate={job.start_date}
                endDate={job.end_date}
                statusClasses={!job.color ? colors : undefined}
                labelPosition={labelPosition}
                lane={0}
                outsideLane={outsideLanes.get(key) || 0}
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
  );
}

// ── component ──

export function GanttChart({ jobs, phases, projectStart, projectEnd, hidePrices, onJobClick, onJobDatesChange, onPhaseDatesChange, onReorderJobs, onAddJob, filters, onToggleFilter, onClearFilters, totalJobCount }: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [labelPosition, setLabelPosition] = useState<LabelPosition>('inside');
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

  const lanesByJob = useMemo(() => {
    const map = new Map<number, { assignments: LaneAssignment[]; laneCount: number }>();
    for (const [jobId, jobPhases] of phasesByJob.entries()) {
      map.set(jobId, assignLanes(jobPhases));
    }
    return map;
  }, [phasesByJob]);

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

  const [fullscreen, setFullscreen] = useState(false);

  // Keyboard shortcuts: [ zoom out, ] zoom in, Escape exits fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape' && fullscreen) { setFullscreen(false); return; }
      if (e.key === '[') { const i = ZOOM_LEVELS.indexOf(zoom); if (i > 0) setZoom(ZOOM_LEVELS[i - 1]); }
      if (e.key === ']') { const i = ZOOM_LEVELS.indexOf(zoom); if (i < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[i + 1]); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [zoom, fullscreen]);

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
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-surface flex flex-col overflow-hidden' : 'card-raised rounded-xl overflow-hidden'}>
      {/* Zoom controls */}
      <div className="gantt-print-toolbar flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-hover/20">
        <div className="flex items-center gap-3">
          {/* Filters */}
          <div className="flex items-center gap-2 ml-2 gantt-print-toolbar">
            <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Filter</span>
            {[
              { key: 'no-contacts', label: 'No contacts' },
              { key: 'no-assigned', label: 'No assigned' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => onToggleFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  filters.has(f.key)
                    ? 'bg-accent/15 border-accent text-accent'
                    : 'bg-surface border-border-subtle text-fg-muted hover:text-fg-secondary hover:border-border'
                }`}
              >
                {f.label}
              </button>
            ))}
            {filters.size > 0 && (
              <>
                <span className="text-[10px] text-fg-muted">({jobs.length}/{totalJobCount})</span>
                <button onClick={onClearFilters} className="text-[10px] text-fg-muted hover:text-fg">
                  Clear
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => setLabelPosition(labelPosition === 'outside' ? 'inside' : 'outside')}
            className="btn-raised rounded-md px-2 py-1 text-[10px] text-fg-secondary flex items-center gap-1"
            title={`Labels: ${labelPosition}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {labelPosition === 'outside' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
            {labelPosition === 'outside' ? 'Labels ↓' : 'Labels ←'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="btn-raised rounded-md px-2 py-1 text-[10px] text-fg-secondary flex items-center gap-1 gantt-print-toolbar"
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {fullscreen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0h5M4 4v5m11-1l5-5m0 0h-5m5 0v5M9 15l-5 5m0 0h5m-5 0v-5m11 1l5 5m0 0h-5m5 0v-5" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5-5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 0l-5 5" />
              )}
            </svg>
          </button>
          <button
            onClick={() => window.print()}
            className="btn-raised rounded-md px-2 py-1 text-[10px] text-fg-secondary flex items-center gap-1 gantt-print-toolbar"
            title="Print / Export PDF"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => canZoomOut && setZoom(ZOOM_LEVELS[zoomIdx - 1])}
              disabled={!canZoomOut}
              className="btn-raised rounded-md w-7 h-7 flex items-center justify-center text-fg-secondary disabled:opacity-30 text-sm font-bold"
              title="Zoom out"
            >
              −
            </button>
            <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold w-10 text-center">{zoom === '3day' ? '3d' : zoom}</span>
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
      </div>

      <div
        ref={scrollRef}
        className={`overflow-x-auto gantt-print-container ${fullscreen ? 'flex-1 overflow-y-auto' : ''}`}
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
                  <td className="sticky left-0 z-[11] bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none px-4 py-3 align-middle">
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
                      <div className="flex-1 min-w-0" dir="auto">
                        <div className="flex items-center gap-2">
                          {!job.has_accepted_worker && (
                            <span className="text-amber-500 text-sm shrink-0" title="No worker assigned">&#9888;</span>
                          )}
                          <span className="font-medium text-sm text-fg truncate font-content" dir="auto">{job.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-fg-muted font-content">
                          {job.accepted_worker_name && <span className="text-accent" dir="auto">{job.accepted_worker_name}</span>}
                          {!hidePrices && job.accepted_worker_price != null && (
                            <>
                              {job.accepted_worker_name && <span>·</span>}
                              <span>{'\u20AA'}{job.accepted_worker_price.toLocaleString()}</span>
                            </>
                          )}
                          {!job.has_accepted_worker && job.worker_count > 0 && (
                            <span className="text-fg-muted/70">
                              {[
                                job.contact_count > 0 && `${job.contact_count} contact`,
                                job.contacted_count > 0 && `${job.contacted_count} contacted`,
                                job.offer_count > 0 && `${job.offer_count} offer`,
                              ].filter(Boolean).join(', ')}
                            </span>
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
                  <RowTimeline
                    job={job}
                    jobPhases={jobPhases}
                    insideLaneInfo={lanesByJob.get(job.id)}
                    columns={displayCols}
                    labelPosition={labelPosition}
                    dragging={dragging}
                    activeDragKey={activeDragKey}
                    todayPos={todayPos}
                    colors={colors}
                    onMouseDown={onMouseDown}
                    onJobClick={onJobClick}
                    onPanStart={onPanStart}
                    totalCols={totalCols}
                    timelineRef={timelineRef}
                  />
                </tr>
              );
            })}

            {/* Add Job row */}
            <tr>
              <td className="sticky left-0 z-[11] bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none px-4 py-3">
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
