'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import type { ActionItem } from './page';

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get the Sunday that starts the week containing `d` */
function getWeekStart(d: Date): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function buildGoogleCalendarUrl(item: ActionItem): string {
  const date = item.date.replace(/-/g, '');
  const startDate = date;
  const d = new Date(item.date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const endDate = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.description,
    dates: `${startDate}/${endDate}`,
  });

  if (item.summary) params.set('details', item.summary);
  if (item.source_group_name) params.set('details', `${item.summary || ''}\n\nSource: ${item.source_group_name}`.trim());

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

type ViewMode = 'month' | 'week';

export function ActionItemsView({ initialItems }: { initialItems: ActionItem[] }) {
  const [items, setItems] = useState<ActionItem[]>(initialItems);
  const today = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today));
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const todayStr = formatLocalDate(today);

  // Flat sorted list for prev/next navigation
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
    [items],
  );

  const currentIndex = useMemo(
    () => (expandedItem !== null ? sortedItems.findIndex((i) => i.id === expandedItem) : -1),
    [expandedItem, sortedItems],
  );

  const goNext = useCallback(() => {
    if (currentIndex < sortedItems.length - 1) {
      setExpandedItem(sortedItems[currentIndex + 1].id);
    }
  }, [currentIndex, sortedItems]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setExpandedItem(sortedItems[currentIndex - 1].id);
    }
  }, [currentIndex, sortedItems]);

  // Keyboard navigation
  useEffect(() => {
    if (expandedItem === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'Escape') setExpandedItem(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedItem, goNext, goPrev]);

  // Group items by date
  const itemsByDate = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of items) {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date)!.push(item);
    }
    return map;
  }, [items]);

  // Month view helpers
  const { firstDay, daysInMonth } = getMonthDays(viewYear, viewMonth);
  const monthLabel = new Date(viewYear, viewMonth).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  });
  const totalCells = firstDay + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  // Week view helpers
  const weekDates = useMemo(() => {
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [weekStart]);

  const weekLabel = useMemo(() => {
    const start = weekDates[0];
    const end = weekDates[6];
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (start.getFullYear() !== end.getFullYear()) {
      return `${start.toLocaleDateString('en', { ...opts, year: 'numeric' })} — ${end.toLocaleDateString('en', { ...opts, year: 'numeric' })}`;
    }
    if (start.getMonth() !== end.getMonth()) {
      return `${start.toLocaleDateString('en', opts)} — ${end.toLocaleDateString('en', opts)}, ${end.getFullYear()}`;
    }
    return `${start.toLocaleDateString('en', { month: 'long' })} ${start.getDate()} — ${end.getDate()}, ${end.getFullYear()}`;
  }, [weekDates]);

  function prevPeriod() {
    if (viewMode === 'week') {
      const d = new Date(weekStart);
      d.setDate(d.getDate() - 7);
      setWeekStart(d);
    } else {
      if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
      else setViewMonth(viewMonth - 1);
    }
  }

  function nextPeriod() {
    if (viewMode === 'week') {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + 7);
      setWeekStart(d);
    } else {
      if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
      else setViewMonth(viewMonth + 1);
    }
  }

  function goToToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setWeekStart(getWeekStart(today));
  }

  async function handleDismiss(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setDismissing(id);
    try {
      const res = await fetch(`/api/action-items/${id}/dismiss`, { method: 'PATCH' });
      if (res.ok) {
        if (expandedItem === id) {
          const idx = sortedItems.findIndex((i) => i.id === id);
          const remaining = sortedItems.filter((i) => i.id !== id);
          if (remaining.length === 0) {
            setExpandedItem(null);
          } else if (idx < remaining.length) {
            setExpandedItem(remaining[idx].id);
          } else {
            setExpandedItem(remaining[remaining.length - 1].id);
          }
        }
        setItems((prev) => prev.filter((item) => item.id !== id));
      }
    } finally {
      setDismissing(null);
    }
  }

  // Shared day cell renderer
  function renderDayCell(dateStr: string, dayNum: number, isToday: boolean, maxItems?: number) {
    const dayItems = itemsByDate.get(dateStr) || [];
    const limit = maxItems ?? dayItems.length;
    const overflow = dayItems.length > limit ? dayItems.length - limit : 0;

    return (
      <div
        key={dateStr}
        className={`
          border-b border-r border-border-subtle
          flex flex-col overflow-hidden
          ${isToday ? 'bg-accent-subtle/40' : ''}
        `}
      >
        <div className="flex items-center justify-between px-2 pt-1.5 pb-0.5">
          <span
            className={`
              text-xs font-medium leading-none
              ${isToday
                ? 'bg-accent text-white w-5 h-5 rounded-full flex items-center justify-center'
                : 'text-fg-secondary'
              }
            `}
          >
            {dayNum}
          </span>
          {overflow > 0 && (
            <span className="text-[10px] text-fg-muted">
              +{overflow}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-1 pb-1 space-y-0.5">
          {dayItems.slice(0, limit).map((item) => (
            <button
              key={item.id}
              onClick={() =>
                setExpandedItem(expandedItem === item.id ? null : item.id)
              }
              className={`w-full text-left rounded px-1.5 py-1 text-sm leading-snug truncate font-medium transition-colors ${
                expandedItem === item.id
                  ? 'bg-accent text-white ring-2 ring-accent ring-offset-1'
                  : 'bg-accent-subtle text-accent hover:bg-accent hover:text-white'
              }`}
              dir="auto"
              title={item.description}
            >
              {item.description}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Build month cells
  const monthCells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) monthCells.push(d);
  while (monthCells.length < rows * 7) monthCells.push(null);

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={prevPeriod} className="btn-raised rounded-md px-2.5 py-1.5 text-sm">
            &larr;
          </button>
          <h3 className="text-lg font-bold text-fg min-w-[180px] text-center">
            {viewMode === 'month' ? monthLabel : weekLabel}
          </h3>
          <button onClick={nextPeriod} className="btn-raised rounded-md px-2.5 py-1.5 text-sm">
            &rarr;
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-muted">
            {items.length} active item{items.length !== 1 ? 's' : ''}
          </span>
          {/* View mode toggle */}
          <div className="flex rounded-md overflow-hidden border border-border">
            <button
              onClick={() => setViewMode('week')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'week'
                  ? 'bg-accent text-white'
                  : 'bg-raised text-fg-secondary hover:text-fg'
              }`}
            >
              week
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'month'
                  ? 'bg-accent text-white'
                  : 'bg-raised text-fg-secondary hover:text-fg'
              }`}
            >
              month
            </button>
          </div>
          <button
            onClick={goToToday}
            className="btn-raised rounded-md px-3 py-1.5 text-xs font-medium"
          >
            today
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-xs text-fg-muted font-medium py-2 text-center">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {viewMode === 'month' ? (
        <div
          className="grid grid-cols-7 flex-1 min-h-0"
          style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {monthCells.map((day, i) => {
            if (day === null) {
              return (
                <div
                  key={`empty-${i}`}
                  className="border-b border-r border-border-subtle bg-surface/50"
                />
              );
            }
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return renderDayCell(dateStr, day, dateStr === todayStr, 3);
          })}
        </div>
      ) : (
        <div className="grid grid-cols-7 flex-1 min-h-0">
          {weekDates.map((d) => {
            const dateStr = formatLocalDate(d);
            return renderDayCell(dateStr, d.getDate(), dateStr === todayStr);
          })}
        </div>
      )}

      {/* Detail modal */}
      {expandedItem !== null && (() => {
        const item = items.find((i) => i.id === expandedItem);
        if (!item) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={() => setExpandedItem(null)}
          >
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="relative card-raised rounded-xl max-w-md w-full mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setExpandedItem(null)}
                className="absolute top-3 right-3 text-fg-muted hover:text-fg text-lg leading-none"
              >
                &times;
              </button>

              {/* Navigation arrows */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={goPrev}
                  disabled={currentIndex <= 0}
                  className="btn-raised rounded-md w-7 h-7 flex items-center justify-center text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  &larr;
                </button>
                <span className="text-xs text-fg-muted">
                  {currentIndex + 1} / {sortedItems.length}
                </span>
                <button
                  onClick={goNext}
                  disabled={currentIndex >= sortedItems.length - 1}
                  className="btn-raised rounded-md w-7 h-7 flex items-center justify-center text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  &rarr;
                </button>
              </div>

              <p className="text-base font-bold text-fg pr-6" dir="auto">{item.description}</p>

              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm text-fg-muted">
                  {new Date(item.date + 'T00:00:00').toLocaleDateString('en', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                {item.source_group_name && (
                  <span className="text-sm text-accent">{item.source_group_name}</span>
                )}
              </div>

              {item.summary && (
                <p className="text-sm text-fg-secondary mt-3 leading-relaxed" dir="auto">
                  {item.summary}
                </p>
              )}

              <div className="mt-5 flex items-center gap-3">
                <a
                  href={buildGoogleCalendarUrl(item)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-accent rounded-md px-4 py-2 text-sm font-medium flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  add to calendar
                </a>
                <button
                  onClick={(e) => handleDismiss(e, item.id)}
                  disabled={dismissing === item.id}
                  className="btn-raised rounded-md px-4 py-2 text-sm text-fg-secondary hover:text-error flex items-center gap-1.5"
                >
                  {dismissing === item.id ? '...' : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      dismiss
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
