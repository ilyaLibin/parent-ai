'use client';

import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { RenovationJob, RenovationPhase, PhaseDependency, CalendarData } from './page';
import { nameToColor } from './utils';

type ZoomLevel = 'month' | 'week' | '3day' | 'day';
const ZOOM_LEVELS: ZoomLevel[] = ['month', 'week', '3day', 'day'];

interface Props {
  jobs: RenovationJob[];
  phases: RenovationPhase[];
  deps: PhaseDependency[];
  projectStart: string | null;
  projectEnd: string | null;
  hidePrices: boolean;
  calendar: CalendarData;
  onJobClick: (job: RenovationJob) => void;
  onJobDatesChange: (id: number, start: string, end: string) => void;
  onPhaseDatesChange: (phaseId: number, start: string, end: string) => void;
  onReorderJobs: (orderedIds: number[]) => void;
  onAddJob: () => void;
  onCreatePhase: (jobId: number, name: string, startDate: string, endDate: string, color: string) => Promise<number | null>;
  onUpdatePhase: (phaseId: number, updates: { name?: string; color?: string }) => void;
  onDeletePhase: (phaseId: number) => void;
  onCreateDep: (phaseId: number, dependsOnId: number) => Promise<boolean>;
  onDeleteDep: (depId: number) => void;
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

function workDaysBetween(a: string, b: string, holidayDaysOff?: Set<string>): number {
  let count = 0;
  let cur = parseDate(a);
  const end = parseDate(b);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 5 && dow !== 6) { // exclude Fri/Sat
      if (!holidayDaysOff || !holidayDaysOff.has(fmtDate(cur))) count++;
    }
    cur = addDays(cur, 1);
  }
  return count;
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

  // Separate multi-day and single-day phases
  const multiDay = phases.filter(p => p.start_date !== p.end_date);
  const singleDay = phases.filter(p => p.start_date === p.end_date);

  // Assign lanes for multi-day first
  const sorted = [...multiDay].sort((a, b) => {
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

  // Single-day phases go below all multi-day lanes, with their own lane assignment
  const multiLaneCount = laneEnds.length;
  const singleBase = Math.max(multiLaneCount, 1);
  if (singleDay.length > 0) {
    const sortedSingle = [...singleDay].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const singleLaneEnds: string[] = [];
    for (const phase of sortedSingle) {
      let lane = -1;
      for (let i = 0; i < singleLaneEnds.length; i++) {
        if (singleLaneEnds[i] < phase.start_date) { lane = i; break; }
      }
      if (lane === -1) { lane = singleLaneEnds.length; singleLaneEnds.push(phase.end_date); }
      else { singleLaneEnds[lane] = phase.end_date; }
      assignments.push({ phase, lane: singleBase + lane });
    }
    return { assignments, laneCount: singleBase + singleLaneEnds.length };
  }
  return { assignments, laneCount: multiLaneCount };
}

const TASK_COL_W = 220;
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
        isWeekend: dow === 5 || dow === 6,
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
  const DAY = 86400000;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime() + DAY; // through end of last day
  const span = t1 - t0;
  if (span <= 0) return null;
  const s = Math.max(parseDate(start).getTime(), t0);
  const e = Math.min(parseDate(end).getTime() + DAY, t1); // through end of end date
  if (s > e) return null;
  const isSingleDay = start === end;
  const rawWidth = ((e - s) / span) * 100;
  return { left: ((s - t0) / span) * 100, width: Math.max(rawWidth, 0.3), isSingleDay };
}

function todayPosition(columns: Column[]): number | null {
  if (!columns.length) return null;
  const DAY = 86400000;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime() + DAY;
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
  isSelected: boolean;
  lane?: number;
  onMouseDownMove: (e: React.MouseEvent) => void;
  onMouseDownLeft: (e: React.MouseEvent) => void;
  onMouseDownRight: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  outsideLane?: number;
  barKey?: string;
  onDoubleClick: (e: React.MouseEvent) => void;
  phaseId?: number;
  onHoverPhase?: (id: number | null) => void;
  holidayDaysOff?: Set<string>;
}

function GanttBar({ barPos, color, label, startDate, endDate, statusClasses, isDragging, isActiveDrag, isSelected, lane = 0, outsideLane = 0, barKey, onMouseDownMove, onMouseDownLeft, onMouseDownRight, onClick, onDoubleClick, phaseId, onHoverPhase, holidayDaysOff }: BarProps) {
  const [hover, setHover] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const useCustomColor = !!color;
  const days = daysBetween(startDate, endDate);
  const isSingleDay = barPos.isSingleDay;
  const showInside = !isSingleDay;
  const topOffset = 6 + lane * LANE_HEIGHT + (isSingleDay ? outsideLane * OUTSIDE_LABEL_LANE_H : 0);

  return (
    <div
      ref={barRef}
      className="absolute group/bar"
      style={{ left: isSingleDay ? `${barPos.left}%` : `calc(${barPos.left}% + 4px)`, width: isSingleDay ? 'auto' : `calc(${barPos.width}% - 8px)`, minWidth: isSingleDay ? 12 : 20, top: topOffset, zIndex: 5 }}
      onMouseEnter={() => { setHover(true); if (phaseId != null && onHoverPhase) onHoverPhase(phaseId); }}
      onMouseLeave={() => { setHover(false); if (onHoverPhase) onHoverPhase(null); }}
    >
      {isSingleDay ? (
        <div className="flex items-center gap-1.5">
          <div
            className={`w-3 h-3 rotate-45 rounded-sm shrink-0 ${isSelected ? 'ring-2 ring-accent ring-offset-1' : 'border border-black/10'}`}
            style={{ cursor: isDragging ? 'grabbing' : 'grab', backgroundColor: color || '#9ca3af' }}
            onMouseDown={onMouseDownMove}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
          />
          <div data-label-key={barKey} className="flex items-baseline gap-1.5 pointer-events-none">
            <span className="text-[10px] text-fg-muted/60 font-content select-none whitespace-nowrap leading-tight">{DAY_NAMES[parseDate(startDate).getDay()]} {fmtShort(startDate)}</span>
            <span className="text-xs text-fg-secondary font-medium font-content select-none whitespace-nowrap leading-tight" dir="auto">
              {label}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`h-[18px] rounded-md ${showInside ? 'flex items-center' : ''} overflow-hidden ${isSelected ? 'ring-2 ring-accent ring-offset-1' : ''} ${useCustomColor ? `border ${isSelected ? 'border-accent' : 'border-black/10'}` : `${statusClasses?.bg || 'bg-gray-400/90'} border ${isSelected ? 'border-accent' : statusClasses?.border || 'border-gray-500'}`}`}
            style={{ cursor: isDragging ? 'grabbing' : 'grab', ...(useCustomColor ? { backgroundColor: color } : {}) }}
            onMouseDown={onMouseDownMove}
            onClick={onClick}
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

      {/* Connector line + label below (outside mode for multi-day short bars only) */}
      {(!showInside) && !isSingleDay && (
        <div className="flex flex-col items-start">
          <div className="w-px bg-fg-muted/40" style={{ height: 8 + outsideLane * OUTSIDE_LABEL_LANE_H }} />
          <div data-label-key={barKey} className="flex items-baseline gap-1.5">
            <span className="text-[10px] text-fg-muted/60 font-content select-none whitespace-nowrap leading-tight">{DAY_NAMES[parseDate(startDate).getDay()]} {fmtShort(startDate)}</span>
            <span className="text-xs text-fg-secondary font-medium font-content select-none whitespace-nowrap leading-tight" dir="auto">
              {label}
            </span>
          </div>
        </div>
      )}

      {/* Tooltip on hover — portaled to body to escape table stacking contexts */}
      {(hover || isActiveDrag) && barRef.current && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none bg-surface-secondary border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
          style={{ left: barRef.current.getBoundingClientRect().left, top: barRef.current.getBoundingClientRect().top - 4, transform: 'translateY(-100%)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color || '#9ca3af' }} />
            <span className="font-semibold text-fg font-content" dir="auto">{label}</span>
          </div>
          <div className="text-fg-muted font-content">
            {DAY_NAMES[parseDate(startDate).getDay()]} {fmtShort(startDate)}{startDate !== endDate && ` → ${DAY_NAMES[parseDate(endDate).getDay()]} ${fmtShort(endDate)}`}
          </div>
          <div className="text-fg-muted font-content">
            {days + 1} day{days > 0 ? 's' : ''}{days > 0 && ` (${workDaysBetween(startDate, endDate, holidayDaysOff)} w. days)`}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── segment dialog (inline popover for create/edit) ──

interface DepPill {
  depId: number;
  label: string;
  direction: 'predecessor' | 'successor';
}

interface SegmentDialogProps {
  mode: 'create' | 'edit';
  x: number;
  y: number;
  initialName: string;
  initialDays: number;
  initialColor: string;
  depPills: DepPill[];
  onSubmit: (name: string, days: number, color: string) => void;
  onDelete?: () => void;
  onDeleteDep?: (depId: number) => void;
  onCancel: () => void;
}

function SegmentDialog({ mode, x, y, initialName, initialDays, initialColor, depPills, onSubmit, onDelete, onDeleteDep, onCancel }: SegmentDialogProps) {
  const [name, setName] = useState(initialName);
  const [days, setDays] = useState(initialDays > 0 ? initialDays : 1);
  const [color, setColor] = useState(initialColor);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    const onClick = (e: MouseEvent) => { if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onCancel(); };
    document.addEventListener('keydown', onKey);
    // Delay adding mousedown listener so the originating double-click doesn't immediately close it
    const timer = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [onCancel]);

  const handleNameChange = (v: string) => {
    setName(v);
    setColor(nameToColor(v));
  };

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed && mode === 'edit') { onCancel(); return; }
    onSubmit(trimmed || 'New segment', days, color);
  };

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed z-[9999] bg-surface-secondary border border-border rounded-lg shadow-xl p-3 space-y-2"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          className="input-inset rounded-md px-2 py-1 text-sm font-content w-48"
          placeholder="Segment name"
          dir="auto"
        />
        <span className="w-4 h-4 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: color }} />
      </div>
      {mode === 'create' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={days}
            onChange={e => setDays(Math.max(1, parseInt(e.target.value) || 1))}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            className="input-inset rounded-md px-2 py-1 text-sm font-content w-48"
          />
          <label className="text-xs text-fg-muted">Days</label>
        </div>
      )}
      {/* Dependency pills */}
      {depPills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {depPills.map(pill => (
            <span
              key={pill.depId}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] bg-surface-hover border border-border-subtle text-fg-secondary"
            >
              <span className="text-fg-muted">{pill.direction === 'predecessor' ? 'after' : 'before'}</span>
              <span className="font-medium font-content" dir="auto">{pill.label}</span>
              {onDeleteDep && (
                <button
                  onClick={() => onDeleteDep(pill.depId)}
                  className="text-fg-muted hover:text-error transition-colors ml-0.5 leading-none"
                  title="Remove dependency"
                >
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center">
        {mode === 'edit' && onDelete ? (
          <button onClick={onDelete} className="text-xs text-error hover:text-error/80 transition-colors">
            Delete
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-raised rounded-md px-3 py-1 text-xs">
            Cancel
          </button>
          <button onClick={handleSubmit} className="btn-accent rounded-md px-3 py-1 text-xs">
            {mode === 'create' ? 'Add' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── row timeline (handles outside label lane measurement) ──

function RowTimeline({
  job,
  jobPhases,
  insideLaneInfo,
  columns,
  dragging,
  activeDragKey,
  todayPos,
  colors,
  onMouseDown,
  onJobClick,
  onPanStart,
  onTimelineDblClick,
  onSegmentDblClick,
  selectedPhaseId,
  onSelectPhase,
  hoveredPhaseId,
  onHoverPhase,
  totalCols,
  timelineRef: parentTimelineRef,
  hoveredCol,
  holidayDaysOff,
  zoom,
  holidayByDate,
}: {
  job: RenovationJob;
  jobPhases: RenovationPhase[];
  insideLaneInfo: { assignments: LaneAssignment[]; laneCount: number } | undefined;
  columns: Column[];
  dragging: boolean;
  activeDragKey: string | null;
  todayPos: number | null;
  colors: { bg: string; border: string };
  onMouseDown: (e: React.MouseEvent, type: 'job' | 'phase', id: number, start: string, end: string, edge: 'left' | 'right' | 'move') => void;
  onJobClick: (job: RenovationJob) => void;
  onPanStart: (e: React.MouseEvent) => void;
  onTimelineDblClick: (e: React.MouseEvent, job: RenovationJob) => void;
  onSegmentDblClick: (e: React.MouseEvent, phase: RenovationPhase) => void;
  selectedPhaseId: number | null;
  onSelectPhase: (id: number, metaKey: boolean) => void;
  hoveredPhaseId: number | null;
  onHoverPhase: (id: number | null) => void;
  totalCols: number;
  timelineRef: React.MutableRefObject<HTMLDivElement | null>;
  hoveredCol: number | null;
  holidayDaysOff: Set<string>;
  zoom: ZoomLevel;
  holidayByDate: Map<string, { name: string; dayOff: boolean }>;
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
  }, [columns, measureKey, dragging]);

  const baseH = Math.max(56, insideLaneCount * LANE_HEIGHT + 12);
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
      onDoubleClick={e => onTimelineDblClick(e, job)}
    >
      <div ref={setRef} className="absolute inset-0">
        {/* Grid lines */}
        <div className="absolute inset-0 flex pointer-events-none">
          {columns.map((col, i) => {
            const dateKey = zoom === 'day' ? fmtDate(col.start) : null;
            const isHolidayOff = dateKey ? (holidayByDate.get(dateKey)?.dayOff ?? false) : false;
            return <div key={i} className={`flex-1 border-l border-border-subtle transition-colors duration-75 ${isHolidayOff ? 'bg-rose-50/40' : i === hoveredCol ? 'bg-black/[0.04]' : col.isWeekend ? 'bg-surface-hover/30' : ''}`} />;
          })}
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

                lane={lane}
                outsideLane={outsideLanes.get(key) || 0}
                isDragging={dragging}
                isActiveDrag={activeDragKey === key}
                isSelected={selectedPhaseId === phase.id}
                onMouseDownMove={e => {
                  if (e.metaKey || e.ctrlKey) { e.stopPropagation(); e.preventDefault(); onSelectPhase(phase.id, true); return; }
                  onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'move');
                }}
                onMouseDownLeft={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'left')}
                onMouseDownRight={e => onMouseDown(e, 'phase', phase.id, phase.start_date, phase.end_date, 'right')}
                onClick={e => { e.stopPropagation(); if (e.metaKey || e.ctrlKey) return; onSelectPhase(phase.id, false); }}
                onHoverPhase={onHoverPhase}
                phaseId={phase.id}
                onDoubleClick={e => onSegmentDblClick(e, phase)}
                holidayDaysOff={holidayDaysOff}
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

                lane={0}
                outsideLane={outsideLanes.get(key) || 0}
                isDragging={dragging}
                isActiveDrag={activeDragKey === `job-${job.id}`}
                isSelected={false}
                onMouseDownMove={e => onMouseDown(e, 'job', job.id, job.start_date, job.end_date, 'move')}
                onMouseDownLeft={e => onMouseDown(e, 'job', job.id, job.start_date, job.end_date, 'left')}
                onMouseDownRight={e => onMouseDown(e, 'job', job.id, job.start_date, job.end_date, 'right')}
                onClick={() => {}}
                onDoubleClick={() => onJobClick(job)}
                holidayDaysOff={holidayDaysOff}
              />
            );
          })()
        )}
      </div>
    </td>
  );
}

// ── dependency arrow overlay ──

function DependencyArrows({
  deps,
  phases,
  columns,
  jobs,
  lanesByJob,
  hoveredPhaseId,
  scrollContainer,
  onDeleteDep,
}: {
  deps: PhaseDependency[];
  phases: RenovationPhase[];
  columns: Column[];
  jobs: RenovationJob[];
  lanesByJob: Map<number, { assignments: LaneAssignment[]; laneCount: number }>;
  hoveredPhaseId: number | null;
  scrollContainer: HTMLElement | null;
  onDeleteDep: (depId: number) => void;
}) {
  if (!scrollContainer || deps.length === 0 || !columns.length) return null;

  if (hoveredPhaseId === null) return null;

  // Find deps related to the active phase
  const relevantDeps = deps.filter(d => d.phase_id === hoveredPhaseId || d.depends_on_id === hoveredPhaseId);
  if (relevantDeps.length === 0) return null;

  const phaseMap = new Map(phases.map(p => [p.id, p]));

  // Measure actual row positions from DOM
  const table = scrollContainer.querySelector('table');
  if (!table) return null;
  const tableRect = table.getBoundingClientRect();
  const scrollTop = scrollContainer.scrollTop;
  const scrollLeft = scrollContainer.scrollLeft;
  const containerRect = scrollContainer.getBoundingClientRect();

  // Map job IDs to actual row top positions (relative to table top)
  const rows = table.querySelectorAll('tbody tr');
  const rowYOffset = new Map<number, number>();
  rows.forEach((row, i) => {
    if (i < jobs.length) {
      const rect = row.getBoundingClientRect();
      rowYOffset.set(jobs[i].id, rect.top - tableRect.top);
    }
  });

  const DAY = 86400000;
  const t0 = columns[0].start.getTime();
  const t1 = columns[columns.length - 1].end.getTime() + DAY;
  const tableW = table.scrollWidth;

  // Find the timeline td width (the actual rendering area for bars)
  const firstTimelineTd = table.querySelector('tbody tr td[colspan]') as HTMLElement | null;
  const timelineW = firstTimelineTd ? firstTimelineTd.offsetWidth : tableW - TASK_COL_W;
  const timelineLeft = firstTimelineTd ? (firstTimelineTd.getBoundingClientRect().left - tableRect.left) : TASK_COL_W;

  function getPhaseXPx(phase: RenovationPhase, edge: 'left' | 'right'): number | null {
    const s = Math.max(parseDate(phase.start_date).getTime(), t0);
    const e = Math.min(parseDate(phase.end_date).getTime() + DAY, t1);
    if (s > e) return null;
    const leftPct = (s - t0) / (t1 - t0);
    const rightPct = (e - t0) / (t1 - t0);
    // Bars have 4px inset on each side
    if (edge === 'right') return timelineLeft + rightPct * timelineW - 4;
    return timelineLeft + leftPct * timelineW + 4;
  }

  function getPhaseYPx(phase: RenovationPhase): number | null {
    const rowY = rowYOffset.get(phase.job_id);
    if (rowY == null) return null;
    // Find the timeline td in this row to get its top (bar positions are relative to this)
    const rowIdx = jobs.findIndex(j => j.id === phase.job_id);
    const row = rowIdx >= 0 ? rows[rowIdx] : null;
    const timelineTd = row?.querySelector('td[colspan]') as HTMLElement | null;
    const tdTop = timelineTd ? (timelineTd.getBoundingClientRect().top - tableRect.top) : rowY;

    const laneInfo = lanesByJob.get(phase.job_id);
    let lane = 0;
    if (laneInfo) {
      const assignment = laneInfo.assignments.find(a => a.phase.id === phase.id);
      if (assignment) lane = assignment.lane;
    }
    return tdTop + 6 + lane * LANE_HEIGHT + LANE_BAR_H / 2;
  }

  const arrows: { x1: number; y1: number; x2: number; y2: number; violated: boolean; depId: number }[] = [];

  for (const dep of relevantDeps) {
    const predecessor = phaseMap.get(dep.depends_on_id);
    const successor = phaseMap.get(dep.phase_id);
    if (!predecessor || !successor) continue;

    const x1 = getPhaseXPx(predecessor, 'right');
    const y1 = getPhaseYPx(predecessor);
    const x2 = getPhaseXPx(successor, 'left');
    const y2 = getPhaseYPx(successor);
    if (x1 == null || y1 == null || x2 == null || y2 == null) continue;

    // FS violation: successor starts before predecessor ends
    const violated = successor.start_date <= predecessor.end_date;

    arrows.push({ x1, y1, x2, y2, violated, depId: dep.id });
  }

  if (arrows.length === 0) return null;

  return (
    <svg
      className="absolute top-0 left-0 z-[8]"
      width={tableW}
      height={table.scrollHeight}
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        <marker id="dep-arrow" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
          <path d="M0,0 L6,2.5 L0,5" fill="none" stroke="#000" strokeWidth="1" />
        </marker>
        <marker id="dep-arrow-red" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
          <path d="M0,0 L6,2.5 L0,5" fill="none" stroke="#ef4444" strokeWidth="1" />
        </marker>
      </defs>
      {arrows.map((a, i) => {
        const arrowColor = a.violated ? '#ef4444' : '#000';
        const markerId = a.violated ? 'dep-arrow-red' : 'dep-arrow';
        const dx = a.x2 - a.x1;
        const r = 4; // corner radius
        const gap = 10;
        const dy = a.y2 - a.y1;
        let path: string;
        if (Math.abs(dy) < 1) {
          // Same row — straight horizontal line
          path = `M${a.x1},${a.y1} H${a.x2}`;
        } else if (a.x2 >= a.x1 - gap && a.x2 <= a.x1 + gap) {
          // Successor is roughly below/above predecessor — go straight down, turn right
          const sy = dy > 0 ? 1 : -1;
          path = `M${a.x1},${a.y1} V${a.y2 - r * sy} Q${a.x1},${a.y2} ${a.x1 + r},${a.y2} H${a.x2}`;
        } else if (dx > gap * 2) {
          // Normal: right a gap, down/up to successor row, right to successor
          const turnX = a.x1 + gap;
          const sy = dy > 0 ? 1 : -1;
          path = `M${a.x1},${a.y1} H${turnX - r} Q${turnX},${a.y1} ${turnX},${a.y1 + r * sy} V${a.y2 - r * sy} Q${turnX},${a.y2} ${turnX + r},${a.y2} H${a.x2}`;
        } else {
          // Successor overlaps/before predecessor — route around below
          const turnX = a.x1 + gap;
          const belowY = Math.max(a.y1, a.y2) + 25;
          const entryX = a.x2 - gap;
          path = `M${a.x1},${a.y1} H${turnX - r} Q${turnX},${a.y1} ${turnX},${a.y1 + r} V${belowY - r} Q${turnX},${belowY} ${turnX - r},${belowY} H${entryX + r} Q${entryX},${belowY} ${entryX},${belowY - r} V${a.y2 + r} Q${entryX},${a.y2} ${entryX + r},${a.y2} H${a.x2}`;
        }
        return (
          <g key={i}>
            <path
              d={path}
              fill="none"
              stroke={arrowColor}
              strokeWidth={1}
              strokeDasharray={a.violated ? '4,3' : 'none'}
              markerEnd={`url(#${markerId})`}
            />
            {/* Fat invisible hit area for clicking to delete */}
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onDeleteDep(a.depId); }}
            >
              <title>Click to remove dependency</title>
            </path>
          </g>
        );
      })}
    </svg>
  );
}

// ── segment dialog state ──

interface SegmentDialogState {
  mode: 'create' | 'edit';
  x: number;
  y: number;
  jobId: number;
  phaseId?: number; // only for edit
  date: string; // click date for create
  initialName: string;
  initialDays: number;
  initialColor: string;
}

// ── component ──

export function GanttChart({ jobs, phases, deps, projectStart, projectEnd, hidePrices, calendar, onJobClick, onJobDatesChange, onPhaseDatesChange, onReorderJobs, onAddJob, onCreatePhase, onUpdatePhase, onDeletePhase, onCreateDep, onDeleteDep, filters, onToggleFilter, onClearFilters, totalJobCount }: Props) {
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const savedZoom = localStorage.getItem('gantt-zoom') as ZoomLevel;
    if (savedZoom && ZOOM_LEVELS.includes(savedZoom)) setZoom(savedZoom);
    const savedFs = localStorage.getItem('gantt-fullscreen') === 'true';
    if (savedFs) setFullscreen(true);
    setHydrated(true);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem('gantt-zoom', zoom); }, [zoom, hydrated]);
  const zoomIdx = ZOOM_LEVELS.indexOf(zoom);
  const canZoomIn = zoomIdx < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIdx > 0;

  const range = useMemo(() => computeRange(jobs, projectStart, projectEnd), [jobs, projectStart, projectEnd]);
  const columns = useMemo(() => buildColumns(zoom, range[0], range[1]), [zoom, range]);
  const showMonthStrip = zoom !== 'month';
  const monthSpans = useMemo(() => showMonthStrip ? buildMonthSpans(columns) : [], [showMonthStrip, columns]);

  // Calendar lookups (weather + holidays) — only used on day zoom
  const weatherByDate = useMemo(() => {
    const map = new Map<string, { rain: boolean; wind: boolean; rainMm: number; windKmh: number }>();
    for (const w of calendar.weather) map.set(w.date, w);
    return map;
  }, [calendar.weather]);

  const holidayByDate = useMemo(() => {
    const map = new Map<string, { name: string; dayOff: boolean }>();
    for (const h of calendar.holidays) map.set(h.date, h);
    return map;
  }, [calendar.holidays]);

  const holidayDaysOff = useMemo(() => {
    const set = new Set<string>();
    for (const h of calendar.holidays) {
      if (h.dayOff) set.add(h.date);
    }
    return set;
  }, [calendar.holidays]);

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

  // Build successor map for cascade moves
  const successorMap = useMemo(() => {
    const map = new Map<number, number[]>(); // predecessorId -> [successorIds]
    for (const d of deps) {
      if (!map.has(d.depends_on_id)) map.set(d.depends_on_id, []);
      map.get(d.depends_on_id)!.push(d.phase_id);
    }
    return map;
  }, [deps]);

  // Get all transitive successors of a phase
  const getTransitiveSuccessors = useCallback((phaseId: number): number[] => {
    const result: number[] = [];
    const visited = new Set<number>();
    const queue = [phaseId];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const succs = successorMap.get(cur) || [];
      for (const s of succs) {
        result.push(s);
        queue.push(s);
      }
    }
    return result;
  }, [successorMap]);

  const frozenCols = useRef(columns);
  const dragInfo = useRef<{
    type: 'job' | 'phase';
    id: number;
    edge: 'left' | 'right' | 'move';
    startX: number;
    origStart: string;
    origEnd: string;
    pxPerMs: number;
    cascadePhases?: { id: number; origStart: string; origEnd: string }[];
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

    // Compute cascade phases for "move" drags on phases
    let cascadePhases: { id: number; origStart: string; origEnd: string }[] | undefined;
    if (type === 'phase' && edge === 'move') {
      const successors = getTransitiveSuccessors(id);
      if (successors.length > 0) {
        cascadePhases = successors.map(sId => {
          const p = phases.find(ph => ph.id === sId);
          return p ? { id: sId, origStart: p.start_date, origEnd: p.end_date } : null;
        }).filter(Boolean) as { id: number; origStart: string; origEnd: string }[];
      }
    }

    dragInfo.current = { type, id, edge, startX: e.clientX, origStart: startDate, origEnd: endDate, pxPerMs: px / (t1 - t0), cascadePhases };
    setActiveDragKey(`${type}-${id}`);
    setDragging(true);
  }, [columns, phases, getTransitiveSuccessors]);

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
      else {
        phaseCbRef.current(d.id, fmtDate(ns), fmtDate(ne));
        // Cascade move all transitive successors
        if (d.edge === 'move' && d.cascadePhases) {
          for (const cp of d.cascadePhases) {
            const cs = addDays(parseDate(cp.origStart), daysDelta);
            const ce = addDays(parseDate(cp.origEnd), daysDelta);
            phaseCbRef.current(cp.id, fmtDate(cs), fmtDate(ce));
          }
        }
      }
    };
    const onUp = () => { dragInfo.current = null; setDragging(false); setActiveDragKey(null); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  const displayCols = dragging ? frozenCols.current : columns;

  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { if (hydrated) localStorage.setItem('gantt-fullscreen', String(fullscreen)); }, [fullscreen, hydrated]);

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

  // ── pan drag (on empty timeline areas) with momentum ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const panInfo = useRef<{ startX: number; scrollLeft: number; lastX: number; lastTime: number; velocity: number } | null>(null);
  const momentumRef = useRef<number>(0);
  const [panning, setPanning] = useState(false);

  const onPanStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.group\\/bar')) return;
    if (!scrollRef.current) return;
    e.preventDefault();
    cancelAnimationFrame(momentumRef.current);
    panInfo.current = { startX: e.clientX, scrollLeft: scrollRef.current.scrollLeft, lastX: e.clientX, lastTime: Date.now(), velocity: 0 };
    setPanning(true);
  }, []);

  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      const p = panInfo.current;
      if (!p || !scrollRef.current) return;
      const now = Date.now();
      const dt = now - p.lastTime;
      if (dt > 0) p.velocity = (p.lastX - e.clientX) / dt;
      p.lastX = e.clientX;
      p.lastTime = now;
      scrollRef.current.scrollLeft = p.scrollLeft - (e.clientX - p.startX);
    };
    const onUp = () => {
      const v = panInfo.current?.velocity || 0;
      panInfo.current = null;
      setPanning(false);
      // Momentum coast
      if (Math.abs(v) > 0.1 && scrollRef.current) {
        let velocity = v * 16; // scale to px/frame
        const decay = 0.95;
        const el = scrollRef.current;
        const animate = () => {
          velocity *= decay;
          if (Math.abs(velocity) < 0.5) return;
          el.scrollLeft += velocity;
          momentumRef.current = requestAnimationFrame(animate);
        };
        momentumRef.current = requestAnimationFrame(animate);
      }
    };
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

  // ── column hover highlight ──
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const hoveredColRef = useRef<number | null>(null);
  const onTimelineMouseMove = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    const tableEl = scrollRef.current.querySelector('table');
    if (!tableEl) return;
    const tableRect = tableEl.getBoundingClientRect();
    const x = e.clientX - tableRect.left - TASK_COL_W; // subtract sticky task column
    if (x < 0) { if (hoveredColRef.current !== null) { hoveredColRef.current = null; setHoveredCol(null); } return; }
    const colWidth = (tableRect.width - TASK_COL_W) / displayCols.length;
    const idx = Math.min(Math.floor(x / colWidth), displayCols.length - 1);
    if (idx !== hoveredColRef.current) { hoveredColRef.current = idx; setHoveredCol(idx); }
  }, [displayCols.length]);
  const onTimelineMouseLeave = useCallback(() => { hoveredColRef.current = null; setHoveredCol(null); }, []);

  // ── phase selection + dependency linking ──
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  const [hoveredPhaseId, setHoveredPhaseId] = useState<number | null>(null);

  const handlePhaseClick = useCallback((phaseId: number, metaKey: boolean) => {
    if (metaKey && selectedPhaseId !== null && selectedPhaseId !== phaseId) {
      // Cmd+click: create dependency from selected (predecessor) → clicked (successor)
      // Or remove if already exists
      const existing = deps.find(d =>
        (d.depends_on_id === selectedPhaseId && d.phase_id === phaseId) ||
        (d.depends_on_id === phaseId && d.phase_id === selectedPhaseId)
      );
      if (existing) {
        onDeleteDep(existing.id);
      } else {
        onCreateDep(phaseId, selectedPhaseId); // clicked depends on selected
      }
      setSelectedPhaseId(null);
    } else {
      setSelectedPhaseId(phaseId);
    }
  }, [selectedPhaseId, deps, onCreateDep, onDeleteDep]);

  useEffect(() => {
    if (selectedPhaseId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeletePhase(selectedPhaseId);
        setSelectedPhaseId(null);
      }
      if (e.key === 'Escape') setSelectedPhaseId(null);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        const phase = phases.find(p => p.id === selectedPhaseId);
        if (phase) {
          const newStart = fmtDate(addDays(parseDate(phase.start_date), delta));
          const newEnd = fmtDate(addDays(parseDate(phase.end_date), delta));
          phaseCbRef.current(selectedPhaseId, newStart, newEnd);
          // Cascade move all transitive successors
          const successors = getTransitiveSuccessors(selectedPhaseId);
          for (const sId of successors) {
            const sp = phases.find(p => p.id === sId);
            if (sp) {
              phaseCbRef.current(sId, fmtDate(addDays(parseDate(sp.start_date), delta)), fmtDate(addDays(parseDate(sp.end_date), delta)));
            }
          }
        }
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      // Don't deselect when clicking on a bar (allows Cmd+click linking)
      if ((e.target as HTMLElement).closest('.group\\/bar')) return;
      setSelectedPhaseId(null);
    };
    document.addEventListener('keydown', onKey);
    // Delay so the click that selected doesn't immediately deselect
    const timer = setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(timer); document.removeEventListener('mousedown', onClickOutside); };
  }, [selectedPhaseId, onDeletePhase, phases, getTransitiveSuccessors]);

  // ── segment dialog ──
  const [segDialog, setSegDialog] = useState<SegmentDialogState | null>(null);

  const handleTimelineDblClick = useCallback((e: React.MouseEvent, job: RenovationJob) => {
    if ((e.target as HTMLElement).closest('.group\\/bar')) return;
    if (!timelineRef.current || !displayCols.length) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const DAY = 86400000;
    const t0 = displayCols[0].start.getTime();
    const t1 = displayCols[displayCols.length - 1].end.getTime() + DAY;
    const clickTime = t0 + xRatio * (t1 - t0);
    const clickDate = new Date(clickTime);
    const dateStr = fmtDate(clickDate);

    setSegDialog({
      mode: 'create',
      x: e.clientX,
      y: e.clientY,
      jobId: job.id,
      date: dateStr,
      initialName: '',
      initialDays: 0,
      initialColor: nameToColor(''),
    });
  }, [displayCols]);

  const handleSegmentDblClick = useCallback((e: React.MouseEvent, phase: RenovationPhase) => {
    setSegDialog({
      mode: 'edit',
      x: e.clientX,
      y: e.clientY,
      jobId: phase.job_id,
      phaseId: phase.id,
      date: phase.start_date,
      initialName: phase.name,
      initialDays: daysBetween(phase.start_date, phase.end_date) + 1,
      initialColor: phase.color,
    });
  }, []);

  const handleSegDialogSubmit = useCallback(async (name: string, days: number, color: string) => {
    if (!segDialog) return;
    if (segDialog.mode === 'create') {
      const startDate = segDialog.date;
      const endDate = days > 1 ? fmtDate(addDays(parseDate(startDate), days - 1)) : startDate;
      const newId = await onCreatePhase(segDialog.jobId, name, startDate, endDate, color);
      if (newId) setSelectedPhaseId(newId);
    } else if (segDialog.phaseId != null) {
      onUpdatePhase(segDialog.phaseId, { name, color });
    }
    setSegDialog(null);
  }, [segDialog, onCreatePhase, onUpdatePhase]);

  const handleSegDialogDelete = useCallback(() => {
    if (!segDialog || segDialog.mode !== 'edit' || segDialog.phaseId == null) return;
    onDeletePhase(segDialog.phaseId);
    setSegDialog(null);
  }, [segDialog, onDeletePhase]);

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-white flex flex-col overflow-hidden' : 'card-raised rounded-xl overflow-hidden'}>
      {/* Zoom controls */}
      <div className="gantt-print-toolbar flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-hover/20">
        <div className="flex items-center gap-3">
          {/* Filters */}
          <div className="hidden md:flex items-center gap-2 ml-2 gantt-print-toolbar">
            <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Filter</span>
            {[
              { key: 'no-contacts', label: 'No contacts' },
              { key: 'no-assigned', label: 'Not assigned' },
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
            onClick={async () => {
              if (!scrollRef.current || exporting) return;
              setExporting(true);
              const { exportGanttPdf } = await import('./gantt-export');
              await exportGanttPdf(scrollRef.current);
              setExporting(false);
            }}
            disabled={exporting}
            className="hidden md:flex btn-raised rounded-md px-2 py-1 text-[10px] text-fg-secondary items-center gap-1 gantt-print-toolbar disabled:opacity-50"
            title="Export PDF"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {exporting ? 'Exporting...' : 'PDF'}
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
        className={`overflow-x-auto gantt-print-container relative ${fullscreen ? 'flex-1 overflow-y-auto' : ''}`}
        style={{ cursor: panning ? 'grabbing' : undefined, overscrollBehavior: 'none' }}
        onMouseMove={onTimelineMouseMove}
        onMouseLeave={onTimelineMouseLeave}
      >
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed', minWidth: displayCols.length * minColW }}>
          <colgroup>
            <col className="hidden md:table-column" style={{ width: TASK_COL_W }} />
            <col className="md:hidden" style={{ width: 0 }} />
            {displayCols.map((_, i) => <col key={i} style={{ minWidth: minColW }} />)}
          </colgroup>

          <thead>
            {/* Month strip */}
            {showMonthStrip && monthSpans.length > 0 && (
              <tr className="border-b border-border-subtle">
                <th className="hidden md:table-cell sticky left-0 z-20 bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none" />
                <th className="md:hidden p-0" />
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
              <th className="hidden md:table-cell sticky left-0 z-20 bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none text-left px-4 py-3 text-xs font-semibold text-fg-secondary uppercase tracking-wider">
                Date range
              </th>
              <th className="md:hidden p-0" />
              {displayCols.map((col, i) => {
                const dateKey = zoom === 'day' ? fmtDate(col.start) : null;
                const weather = dateKey ? weatherByDate.get(dateKey) : null;
                const holiday = dateKey ? holidayByDate.get(dateKey) : null;
                const isHolidayOff = holiday?.dayOff ?? false;
                // For 3-day view, collect weather per day in range
                const threeDayWeather = zoom === '3day' ? [0, 1, 2].map(offset => {
                  const d = addDays(col.start, offset);
                  const key = fmtDate(d);
                  return weatherByDate.get(key) ?? null;
                }) : null;
                const hasThreeDayWeather = threeDayWeather?.some(w => w?.rain || w?.wind);
                return (
                  <th key={i} className={`relative text-center px-1 py-2 text-xs border-l border-border-subtle font-normal transition-colors duration-75 ${isHolidayOff ? 'bg-rose-50/60' : i === hoveredCol ? 'bg-black/[0.04]' : col.isWeekend ? 'bg-surface-hover/40' : ''}`}>
                    <div className={`font-semibold ${i === todayColIdx ? 'text-error' : 'text-fg-secondary'}`}>{col.label}</div>
                    {col.sublabel && <div className={`text-[10px] ${i === todayColIdx ? 'text-error/70' : 'text-fg-muted'}`}>{col.sublabel}</div>}
                    {zoom === 'day' && (weather?.rain || weather?.wind) && (
                      <div
                        className={`absolute bottom-0 left-0 right-0 h-[3px] ${weather.rain && weather.wind ? 'bg-gradient-to-r from-blue-400 to-teal-400' : weather.rain ? 'bg-blue-400' : 'bg-teal-400'}`}
                        title={[weather.rain ? `Rain ${weather.rainMm}mm` : '', weather.wind ? `Wind ${weather.windKmh}km/h` : ''].filter(Boolean).join(', ')}
                      />
                    )}
                    {zoom === '3day' && hasThreeDayWeather && (
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] flex">
                        {threeDayWeather!.map((w, j) => {
                          const hasW = w?.rain || w?.wind;
                          const cls = !hasW ? 'bg-transparent' : w.rain && w.wind ? 'bg-gradient-to-r from-blue-400 to-teal-400' : w.rain ? 'bg-blue-400' : 'bg-teal-400';
                          const d = addDays(col.start, j);
                          const title = hasW ? `${fmtDate(d)}: ${[w.rain ? `Rain ${w.rainMm}mm` : '', w.wind ? `Wind ${w.windKmh}km/h` : ''].filter(Boolean).join(', ')}` : '';
                          return <div key={j} className={`flex-1 ${cls}`} title={title} />;
                        })}
                      </div>
                    )}
                    {zoom === 'day' && holiday && (
                      <div className={`text-[8px] leading-tight mt-0.5 truncate max-w-[38px] ${isHolidayOff ? 'text-rose-500 font-medium' : 'text-fg-muted'}`} title={holiday.name}>
                        {holiday.name.replace(/\s*\(.*\)/, '').split(' ').slice(0, 2).join(' ')}
                      </div>
                    )}
                  </th>
                );
              })}
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
                  {/* Left info (hidden on mobile) */}
                  <td className="hidden md:table-cell sticky left-0 z-[11] bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none px-4 py-3 align-middle">
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
                            <span className="text-amber-500 text-sm shrink-0" title="Not assigned">&#9888;</span>
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

                  {/* Mobile sticky label */}
                  <td className="md:hidden sticky left-0 z-[11] p-0 align-top overflow-visible">
                    <div className="bg-white/80 backdrop-blur-sm rounded px-1.5 py-0.5 ml-1 mt-1 text-[10px] leading-tight w-max pointer-events-none">
                      <span className="font-medium text-fg font-content" dir="auto">{job.name}</span>
                      {job.accepted_worker_name && (
                        <span className="text-accent font-content ml-1" dir="auto">{job.accepted_worker_name}</span>
                      )}
                    </div>
                  </td>

                  {/* Timeline */}
                  <RowTimeline
                    job={job}
                    jobPhases={jobPhases}
                    insideLaneInfo={lanesByJob.get(job.id)}
                    columns={displayCols}
                    dragging={dragging}
                    activeDragKey={activeDragKey}
                    todayPos={todayPos}
                    colors={colors}
                    onMouseDown={onMouseDown}
                    onJobClick={onJobClick}
                    onPanStart={onPanStart}
                    onTimelineDblClick={handleTimelineDblClick}
                    onSegmentDblClick={handleSegmentDblClick}
                    selectedPhaseId={selectedPhaseId}
                    onSelectPhase={handlePhaseClick}
                    hoveredPhaseId={hoveredPhaseId}
                    onHoverPhase={setHoveredPhaseId}
                    totalCols={totalCols}
                    timelineRef={timelineRef}
                    hoveredCol={hoveredCol}
                    holidayDaysOff={holidayDaysOff}
                    zoom={zoom}
                    holidayByDate={holidayByDate}
                  />
                </tr>
              );
            })}

            {/* Add Work row */}
            <tr>
              <td className="hidden md:table-cell sticky left-0 z-[11] bg-surface relative after:absolute after:right-0 after:top-0 after:bottom-0 after:w-1.5 after:translate-x-full after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent after:pointer-events-none px-4 py-3">
                <button
                  onClick={onAddJob}
                  className="text-sm text-fg-muted hover:text-accent transition-colors font-medium"
                >
                  + Add Work
                </button>
              </td>
              <td className="md:hidden p-0" />
              <td colSpan={displayCols.length} />
            </tr>
          </tbody>
        </table>

        {/* Dependency arrows (on hover/select) */}
        <DependencyArrows
          deps={deps}
          phases={phases}
          columns={displayCols}
          jobs={jobs}
          lanesByJob={lanesByJob}
          hoveredPhaseId={hoveredPhaseId}
          scrollContainer={scrollRef.current}
          onDeleteDep={onDeleteDep}
        />
      </div>

      {/* Segment create/edit dialog */}
      {segDialog && (
        <SegmentDialog
          mode={segDialog.mode}
          x={segDialog.x}
          y={segDialog.y}
          initialName={segDialog.initialName}
          initialDays={segDialog.initialDays}
          initialColor={segDialog.initialColor}
          depPills={segDialog.phaseId != null ? deps
            .filter(d => d.phase_id === segDialog.phaseId || d.depends_on_id === segDialog.phaseId)
            .map(d => {
              const isPredecessor = d.depends_on_id !== segDialog.phaseId;
              const relatedId = isPredecessor ? d.depends_on_id : d.phase_id;
              const related = phases.find(p => p.id === relatedId);
              return {
                depId: d.id,
                label: related?.name || `#${relatedId}`,
                direction: isPredecessor ? 'predecessor' as const : 'successor' as const,
              };
            }) : []}
          onSubmit={handleSegDialogSubmit}
          onDelete={segDialog.mode === 'edit' ? handleSegDialogDelete : undefined}
          onDeleteDep={onDeleteDep}
          onCancel={() => setSegDialog(null)}
        />
      )}
    </div>
  );
}
