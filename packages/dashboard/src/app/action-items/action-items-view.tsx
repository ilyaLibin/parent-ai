'use client';

import { useState, useMemo } from 'react';
import type { ActionItem } from './page';

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

export function ActionItemsView({ initialItems }: { initialItems: ActionItem[] }) {
  const [items, setItems] = useState<ActionItem[]>(initialItems);
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const todayStr = formatLocalDate(today);

  // Group items by date
  const itemsByDate = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of items) {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date)!.push(item);
    }
    return map;
  }, [items]);

  // Calendar grid
  const { firstDay, daysInMonth } = getMonthDays(viewYear, viewMonth);
  const monthLabel = new Date(viewYear, viewMonth).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  });

  // How many rows the grid needs
  const totalCells = firstDay + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function goToToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }

  async function handleDismiss(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setDismissing(id);
    try {
      const res = await fetch(`/api/action-items/${id}/dismiss`, { method: 'PATCH' });
      if (res.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        if (expandedItem === id) setExpandedItem(null);
      }
    } finally {
      setDismissing(null);
    }
  }

  // Build cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad remaining cells in last row
  while (cells.length < rows * 7) cells.push(null);

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="btn-raised rounded-md px-2.5 py-1.5 text-sm"
          >
            &larr;
          </button>
          <h3 className="text-lg font-bold text-fg min-w-[180px] text-center">
            {monthLabel}
          </h3>
          <button
            onClick={nextMonth}
            className="btn-raised rounded-md px-2.5 py-1.5 text-sm"
          >
            &rarr;
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-muted">
            {items.length} active item{items.length !== 1 ? 's' : ''}
          </span>
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
          <div
            key={day}
            className="text-xs text-fg-muted font-medium py-2 text-center"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid — fills remaining space */}
      <div
        className="grid grid-cols-7 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {cells.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`empty-${i}`}
                className="border-b border-r border-border-subtle bg-surface/50"
              />
            );
          }

          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayItems = itemsByDate.get(dateStr) || [];
          const isToday = dateStr === todayStr;

          return (
            <div
              key={dateStr}
              className={`
                border-b border-r border-border-subtle
                flex flex-col overflow-hidden
                ${isToday ? 'bg-accent-subtle/40' : ''}
              `}
            >
              {/* Day number */}
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
                  {day}
                </span>
                {dayItems.length > 3 && (
                  <span className="text-[10px] text-fg-muted">
                    +{dayItems.length - 3}
                  </span>
                )}
              </div>

              {/* Action items — show up to 3 */}
              <div className="flex-1 overflow-hidden px-1 pb-1 space-y-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      setExpandedItem(expandedItem === item.id ? null : item.id)
                    }
                    className="w-full text-left rounded px-1.5 py-1 text-sm leading-snug truncate bg-accent-subtle text-accent font-medium hover:bg-accent hover:text-white transition-colors"
                    title={item.description}
                  >
                    {item.description}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

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

              <p className="text-base font-bold text-fg pr-6">{item.description}</p>

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
                <p className="text-sm text-fg-secondary mt-3 leading-relaxed">
                  {item.summary}
                </p>
              )}

              <div className="mt-5 flex items-center gap-3">
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
                <button
                  onClick={() => setExpandedItem(null)}
                  className="btn-raised rounded-md px-4 py-2 text-sm text-fg-secondary"
                >
                  close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
