'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Group, DailyCount } from './page';

interface Message {
  id: string;
  sender: string;
  content: string;
  type: string;
  time: string;
}

interface GroupMessages {
  groupId: string;
  groupName: string;
  messageCount: number;
  messages: Message[];
}

interface DayCell {
  date: string;
  dayNum: number;
  month: string;
  monthIdx: number;
  year: number;
  hasMessages: boolean;
  count: number;
  isToday: boolean;
}

interface DayGroup {
  date: string;
  label: string;
  messages: (Message & { groupName?: string })[];
}

function generateDays(dailyCounts: DailyCount[]): DayCell[] {
  const countMap = new Map(dailyCounts.map((d) => [d.date, d.count]));
  const days: DayCell[] = [];
  const now = new Date();
  const todayStr = formatLocalDate(now);

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = formatLocalDate(d);
    const count = countMap.get(dateStr) || 0;
    days.push({
      date: dateStr,
      dayNum: d.getDate(),
      month: d.toLocaleString('en', { month: 'short' }),
      monthIdx: d.getMonth(),
      year: d.getFullYear(),
      hasMessages: count > 0,
      count,
      isToday: dateStr === todayStr,
    });
  }
  return days;
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rangeToTimestamps(fromDate: string, toDate: string): { from: number; to: number } {
  const a = new Date(fromDate + 'T00:00:00').getTime();
  const b = new Date(toDate + 'T00:00:00').getTime();
  const from = Math.min(a, b);
  const to = Math.max(a, b) + 24 * 60 * 60 * 1000 - 1;
  return { from, to };
}

function groupMessagesByDay(allMessages: (Message & { groupName?: string })[]): DayGroup[] {
  const map = new Map<string, (Message & { groupName?: string })[]>();
  for (const msg of allMessages) {
    const d = new Date(msg.time);
    const dateStr = formatLocalDate(d);
    if (!map.has(dateStr)) map.set(dateStr, []);
    map.get(dateStr)!.push(msg);
  }
  return Array.from(map.entries()).map(([date, messages]) => {
    const d = new Date(date + 'T00:00:00');
    const today = new Date();
    const isToday = formatLocalDate(today) === date;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = formatLocalDate(yesterday) === date;
    const label = isToday
      ? 'Today'
      : isYesterday
        ? 'Yesterday'
        : d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    return { date, label, messages };
  });
}

export function MessagesView({ groups, dailyCounts: initialDailyCounts }: { groups: Group[]; dailyCounts: DailyCount[] }) {
  const todayStr = formatLocalDate(new Date());
  const weekAgoStr = formatLocalDate((() => { const d = new Date(); d.setDate(d.getDate() - 6); return d; })());

  const [fromDate, setFromDate] = useState<string>(weekAgoStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [selecting, setSelecting] = useState(false);
  const [checkedGroupIds, setCheckedGroupIds] = useState<Set<string>>(new Set());
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);
  const [allGroupMessages, setAllGroupMessages] = useState<GroupMessages[]>([]);
  const [loading, setLoading] = useState(false);
  const [daySortAsc, setDaySortAsc] = useState(false);
  const [filteredDailyCounts, setFilteredDailyCounts] = useState<DailyCount[]>(initialDailyCounts);
  const [groupList, setGroupList] = useState<Group[]>(groups);

  async function toggleTracking(e: React.MouseEvent, group: Group) {
    e.stopPropagation();
    const newTracked = !group.tracked;
    // Optimistic update
    setGroupList((prev) => prev.map((g) => g.id === group.id ? { ...g, tracked: newTracked } : g));
    try {
      const res = await fetch('/api/groups/tracked', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, tracked: newTracked }),
      });
      if (!res.ok) {
        // Revert on failure
        setGroupList((prev) => prev.map((g) => g.id === group.id ? { ...g, tracked: !newTracked } : g));
      }
    } catch {
      setGroupList((prev) => prev.map((g) => g.id === group.id ? { ...g, tracked: !newTracked } : g));
    }
  }

  // The active group IDs for display: if previewing one group, show just that; otherwise show checked
  const activeGroupIds = useMemo(() => {
    if (previewGroupId) return new Set([previewGroupId]);
    return checkedGroupIds;
  }, [previewGroupId, checkedGroupIds]);

  // Fetch filtered daily counts when active groups change
  useEffect(() => {
    if (activeGroupIds.size === 0) {
      setFilteredDailyCounts(initialDailyCounts);
      return;
    }
    const ids = Array.from(activeGroupIds).join(',');
    fetch(`/api/messages/daily-counts?days=30&groupIds=${encodeURIComponent(ids)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.counts) setFilteredDailyCounts(data.counts);
      })
      .catch(() => {});
  }, [activeGroupIds, initialDailyCounts]);

  const days = useMemo(() => generateDays(filteredDailyCounts), [filteredDailyCounts]);

  const loadMessages = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const { from: fromTs, to: toTs } = rangeToTimestamps(from, to);
      const res = await fetch(`/api/messages?from=${fromTs}&to=${toTs}`);
      if (!res.ok) { setAllGroupMessages([]); return; }
      const data = await res.json();
      setAllGroupMessages((data.groups as GroupMessages[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Compute messages for display: filter by active groups, group by day
  const dayGroups = useMemo(() => {
    if (activeGroupIds.size === 0) return [];
    const showMultiple = activeGroupIds.size > 1;
    const msgs: (Message & { groupName?: string })[] = [];
    for (const gm of allGroupMessages) {
      if (!activeGroupIds.has(gm.groupId)) continue;
      for (const m of gm.messages) {
        msgs.push({ ...m, groupName: showMultiple ? gm.groupName : undefined });
      }
    }
    msgs.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const grouped = groupMessagesByDay(msgs);
    grouped.sort((a, b) => daySortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    return grouped;
  }, [allGroupMessages, activeGroupIds, daySortAsc]);

  // Sort groups: always put groups with messageCount > 0 first, sorted by messageCount desc.
  // Once messages are loaded, use API order (sorted by latest message) for groups that have messages in range.
  const sortedGroups = useMemo(() => {
    // Build a map of API-returned order (already sorted by latest message time)
    const apiOrderMap = new Map<string, number>();
    allGroupMessages.forEach((gm, i) => {
      if (gm.messageCount > 0) apiOrderMap.set(gm.groupId, i);
    });

    return [...groupList].sort((a, b) => {
      const aHas = a.messageCount > 0;
      const bHas = b.messageCount > 0;
      // Groups with 0 total messages always go to bottom
      if (aHas !== bHas) return bHas ? 1 : -1;
      if (!aHas && !bHas) return 0;
      // If we have API data, use the API order (by latest message in range)
      const aApi = apiOrderMap.get(a.id);
      const bApi = apiOrderMap.get(b.id);
      if (aApi !== undefined && bApi !== undefined) return aApi - bApi;
      if (aApi !== undefined) return -1;
      if (bApi !== undefined) return 1;
      // Fallback: by total messageCount
      return b.messageCount - a.messageCount;
    });
  }, [groupList, allGroupMessages]);

  function handleDayClick(dateStr: string) {
    if (!selecting) {
      setFromDate(dateStr);
      setToDate(dateStr);
      setSelecting(true);
    } else {
      const clickedIdx = days.findIndex((d) => d.date === dateStr);
      const fromIdx = days.findIndex((d) => d.date === fromDate);
      const finalFrom = clickedIdx < fromIdx ? dateStr : fromDate;
      const finalTo = clickedIdx < fromIdx ? fromDate : dateStr;
      if (clickedIdx < fromIdx) {
        setFromDate(dateStr);
      } else {
        setToDate(dateStr);
      }
      setSelecting(false);
      if (activeGroupIds.size > 0) loadMessages(finalFrom, finalTo);
    }
  }

  function handleDayHover(dateStr: string) {
    if (!selecting) return;
    const hoverIdx = days.findIndex((d) => d.date === dateStr);
    const fromIdx = days.findIndex((d) => d.date === fromDate);
    if (hoverIdx >= fromIdx) {
      setToDate(dateStr);
    }
  }

  function toggleCheck(groupId: string) {
    setCheckedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
    setPreviewGroupId(null);
    setTimeout(() => {
      loadMessages(fromDate, toDate);
    }, 0);
  }

  function clickGroup(groupId: string) {
    // Clicking a row (not checkbox) = exclusive select: deselect all others, check only this one
    setCheckedGroupIds(new Set([groupId]));
    setPreviewGroupId(null);
    loadMessages(fromDate, toDate);
  }

  function deselectAll() {
    setCheckedGroupIds(new Set());
    setPreviewGroupId(null);
    setAllGroupMessages([]);
  }

  function isInRange(dateStr: string): boolean {
    const start = fromDate <= toDate ? fromDate : toDate;
    const end = fromDate <= toDate ? toDate : fromDate;
    return dateStr >= start && dateStr <= end;
  }

  function isRangeStart(dateStr: string): boolean {
    return dateStr === (fromDate <= toDate ? fromDate : toDate);
  }

  function isRangeEnd(dateStr: string): boolean {
    return dateStr === (fromDate <= toDate ? toDate : fromDate);
  }

  const monthLabels = useMemo(() => {
    const labels: { label: string; startIdx: number }[] = [];
    let lastMonth = -1;
    days.forEach((day, i) => {
      if (day.monthIdx !== lastMonth) {
        labels.push({ label: day.month, startIdx: i });
        lastMonth = day.monthIdx;
      }
    });
    return labels;
  }, [days]);

  const rangeLabel = useMemo(() => {
    if (fromDate === toDate) {
      const d = days.find((d) => d.date === fromDate);
      return d ? `${d.month} ${d.dayNum}${d.isToday ? ' (today)' : ''}` : '';
    }
    const f = days.find((d) => d.date === fromDate);
    const t = days.find((d) => d.date === toDate);
    if (!f || !t) return '';
    return `${f.month} ${f.dayNum} — ${t.month} ${t.dayNum}`;
  }, [fromDate, toDate, days]);

  const hasSelection = activeGroupIds.size > 0;

  if (groupList.length === 0) {
    return <p className="text-fg-muted">No groups found.</p>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Calendar strip */}
      <div className="mb-5">
        <div className="flex mb-1.5 px-0.5">
          {monthLabels.map((m, i) => {
            const nextStart = i < monthLabels.length - 1 ? monthLabels[i + 1].startIdx : days.length;
            const span = nextStart - m.startIdx;
            return (
              <div
                key={`${m.label}-${m.startIdx}`}
                className="text-xs text-fg-muted font-medium"
                style={{ width: `${(span / days.length) * 100}%` }}
              >
                {m.label}
              </div>
            );
          })}
        </div>

        <div className="flex gap-[3px]">
          {days.map((day) => {
            const inRange = isInRange(day.date);
            const rangeStart = isRangeStart(day.date);
            const rangeEnd = isRangeEnd(day.date);

            return (
              <button
                key={day.date}
                onClick={() => handleDayClick(day.date)}
                onMouseEnter={() => handleDayHover(day.date)}
                title={`${day.date} — ${day.count} messages`}
                className={`
                  flex-1 aspect-square rounded-md text-xs font-medium
                  flex items-center justify-center
                  transition-all duration-100 cursor-pointer
                  border-2
                  ${day.hasMessages
                    ? 'bg-accent-subtle text-accent'
                    : 'bg-surface-secondary text-fg-muted'
                  }
                  ${inRange
                    ? 'border-accent'
                    : day.isToday
                      ? 'border-border'
                      : 'border-transparent hover:border-border'
                  }
                  ${rangeStart || rangeEnd ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''}
                `}
              >
                {day.dayNum}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-fg-secondary">
            {rangeLabel}
            {selecting && <span className="text-fg-muted ml-2">click another day to set range</span>}
          </span>
          {fromDate !== weekAgoStr || toDate !== todayStr ? (
            <button
              onClick={() => {
                setFromDate(weekAgoStr);
                setToDate(todayStr);
                setSelecting(false);
                if (hasSelection) loadMessages(weekAgoStr, todayStr);
              }}
              className="text-xs text-accent hover:text-accent-hover"
            >
              reset to this week
            </button>
          ) : null}
        </div>
      </div>

      {/* Main content */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Group list with checkboxes */}
        <div className="w-64 shrink-0 flex flex-col overflow-y-auto">
          {checkedGroupIds.size > 0 && (
            <button
              onClick={deselectAll}
              className="text-xs text-accent hover:text-accent-hover mb-2 text-left px-2"
            >
              deselect all
            </button>
          )}
          <div className="space-y-1">
          {sortedGroups.map((group) => {
            const isChecked = checkedGroupIds.has(group.id);
            const isPreviewing = previewGroupId === group.id;
            const isActive = isPreviewing || (isChecked && !previewGroupId);

            return (
              <div
                key={group.id}
                className={`flex items-center gap-2 px-2 py-2 rounded text-sm transition-all ${
                  isActive
                    ? 'bg-accent-subtle text-accent font-medium border border-border'
                    : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleCheck(group.id)}
                  className="accent-accent shrink-0 w-3.5 h-3.5 cursor-pointer"
                />
                <button
                  onClick={() => clickGroup(group.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="font-medium truncate font-content">{group.name}</div>
                  <div className="text-xs text-fg-muted">{group.messageCount} msgs</div>
                </button>
                <button
                  onClick={(e) => toggleTracking(e, group)}
                  title={group.tracked ? 'Tracking — click to stop' : 'Not tracking — click to start'}
                  className="shrink-0 p-1 rounded hover:bg-surface-hover transition-colors"
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${group.tracked ? 'bg-green-500' : 'bg-fg-muted/30'}`} />
                </button>
              </div>
            );
          })}
          </div>
        </div>

        {/* Messages panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {hasSelection && dayGroups.length > 1 && (
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setDaySortAsc(!daySortAsc)}
                className="text-xs text-fg-secondary hover:text-accent flex items-center gap-1"
              >
                <span>{daySortAsc ? '↑ Oldest first' : '↓ Newest first'}</span>
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-4">
            {!hasSelection && (
              <p className="text-fg-muted text-sm">Select a group to view messages.</p>
            )}
            {loading && <p className="text-fg-muted text-sm animate-pulse">loading...</p>}
            {!loading && hasSelection && dayGroups.length === 0 && (
              <p className="text-fg-muted text-sm">No messages in this date range.</p>
            )}
            {!loading &&
              dayGroups.map((dayGroup) => (
                <div key={dayGroup.date}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-px flex-1 bg-border-subtle" />
                    <span className="text-xs font-medium text-fg-muted shrink-0">
                      {dayGroup.label}
                    </span>
                    <div className="h-px flex-1 bg-border-subtle" />
                  </div>

                  <div className="space-y-2">
                    {dayGroup.messages.map((msg) => (
                      <div key={msg.id} className="card-raised rounded-lg px-4 py-3">
                        <div className="flex justify-between items-baseline mb-1">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-sm font-bold text-accent truncate font-content">{msg.sender}</span>
                            {msg.groupName && (
                              <span className="text-xs text-fg-muted truncate font-content">in {msg.groupName}</span>
                            )}
                          </div>
                          <span className="text-xs text-fg-muted shrink-0 ml-2">
                            {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-fg-secondary whitespace-pre-wrap font-content" dir="auto">
                          {msg.content || (
                            <span className="italic text-fg-muted">[{msg.type}]</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
