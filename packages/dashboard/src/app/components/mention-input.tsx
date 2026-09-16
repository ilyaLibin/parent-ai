'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  autoFocus?: boolean;
}

interface MentionItem {
  type: 'group' | 'knowledge';
  id: string;
  name: string;
  tracked?: boolean;
}

interface GroupData {
  id: string;
  name: string;
  tracked: boolean;
  messageCount: number;
}

interface KnowledgeData {
  id: number;
  name: string;
}

const MENTION_RE = /\[@([^\]]+)\]\((group|knowledge):([^)]+)\)/g;

function extractMentions(text: string): { type: string; name: string; id: string }[] {
  const mentions: { type: string; name: string; id: string }[] = [];
  let match;
  while ((match = MENTION_RE.exec(text)) !== null) {
    mentions.push({ name: match[1], type: match[2], id: match[3] });
  }
  return mentions;
}

let cachedItems: MentionItem[] | null = null;

async function fetchMentionItems(): Promise<MentionItem[]> {
  if (cachedItems) return cachedItems;

  const [groupsRes, knowledgeRes] = await Promise.all([
    fetch('/api/groups?excludeHidden=true'),
    fetch('/api/knowledge'),
  ]);

  const groupsData = await groupsRes.json();
  const knowledgeData = await knowledgeRes.json();

  const groups: MentionItem[] = (groupsData.groups || [])
    .sort((a: GroupData, b: GroupData) => (a.tracked === b.tracked ? 0 : a.tracked ? -1 : 1))
    .map((g: GroupData) => ({
      type: 'group' as const,
      id: g.id,
      name: g.name,
      tracked: g.tracked,
    }));

  const knowledge: MentionItem[] = (knowledgeData || []).map((k: KnowledgeData) => ({
    type: 'knowledge' as const,
    id: String(k.id),
    name: k.name,
  }));

  cachedItems = [...groups, ...knowledge];
  return cachedItems;
}

// Compute pixel coordinates of a character position within a textarea
function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');

  // Copy all relevant styles to the mirror div
  const cssProps = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
    'text-transform', 'word-spacing', 'text-indent', 'box-sizing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'line-height', 'white-space', 'word-wrap', 'overflow-wrap', 'tab-size',
    'direction',
  ];

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.overflow = 'hidden';
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.height = 'auto';

  for (const prop of cssProps) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop));
  }

  // Set text content up to the cursor, with a marker span
  const textBefore = textarea.value.substring(0, position);
  mirror.textContent = textBefore;

  const marker = document.createElement('span');
  marker.textContent = '\u200b'; // zero-width space
  mirror.appendChild(marker);

  document.body.appendChild(mirror);

  const markerRect = marker.offsetTop;
  const markerLeft = marker.offsetLeft;

  document.body.removeChild(mirror);

  return {
    top: markerRect - textarea.scrollTop,
    left: markerLeft - textarea.scrollLeft,
  };
}

export function MentionInput({ value, onChange, placeholder, className, onFocus, autoFocus }: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<MentionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const lower = filter.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(lower));
  }, [items, filter]);

  const mentions = useMemo(() => extractMentions(value), [value]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  // Scroll selected item into view
  useEffect(() => {
    if (!showPopup || !popupRef.current) return;
    const el = popupRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, showPopup]);

  // Close popup on outside click
  useEffect(() => {
    if (!showPopup) return;
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setShowPopup(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPopup]);

  const openPopup = useCallback(async () => {
    if (items.length === 0) {
      const fetched = await fetchMentionItems();
      setItems(fetched);
    }
    setShowPopup(true);
    setFilter('');
    setSelectedIndex(0);
  }, [items.length]);

  function insertMention(item: MentionItem) {
    if (mentionStart === null) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const before = value.substring(0, mentionStart);
    const after = value.substring(textarea.selectionStart);
    const mention = `[@${item.name}](${item.type}:${item.id})`;
    const newValue = before + mention + after;

    onChange(newValue);
    setShowPopup(false);
    setMentionStart(null);

    // Restore cursor position after the inserted mention
    requestAnimationFrame(() => {
      const pos = before.length + mention.length;
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showPopup) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      insertMention(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowPopup(false);
      setMentionStart(null);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    onChange(newValue);

    const cursorPos = e.target.selectionStart;

    // Find if we're in the middle of a @mention
    const textBeforeCursor = newValue.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex >= 0) {
      // Only trigger if @ is at start or preceded by whitespace/newline
      const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' ';
      const textAfterAt = textBeforeCursor.substring(atIndex + 1);

      if (/[\s\n]/.test(charBefore) || atIndex === 0) {
        // Don't trigger if there's a space in the filter text (means user moved on)
        if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
          setMentionStart(atIndex);
          setFilter(textAfterAt);
          // Calculate popup position at the @ character
          if (textareaRef.current) {
            const coords = getCaretCoordinates(textareaRef.current, atIndex);
            setPopupPos({ top: coords.top, left: coords.left });
          }
          if (!showPopup) openPopup();
          return;
        }
      }
    }

    if (showPopup) {
      setShowPopup(false);
      setMentionStart(null);
    }
  }

  const groups = filtered.filter((i) => i.type === 'group');
  const knowledge = filtered.filter((i) => i.type === 'knowledge');

  // Build flat list for indexing
  let flatIndex = 0;
  function getAndInc() {
    return flatIndex++;
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        className={className}
        dir="auto"
        autoFocus={autoFocus}
      />

      {showPopup && filtered.length > 0 && (
        <div
          ref={popupRef}
          className="absolute z-50 bg-raised border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto w-72"
          style={popupPos ? {
            top: `${popupPos.top + 24}px`,
            left: `${Math.min(popupPos.left, (textareaRef.current?.offsetWidth || 288) - 288)}px`,
          } : { top: '100%', left: 0 }}
        >
          {groups.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-muted font-medium sticky top-0 bg-raised border-b border-border">
                Groups
              </div>
              {groups.map((item) => {
                const idx = getAndInc();
                return (
                  <button
                    key={`g-${item.id}`}
                    data-index={idx}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                      idx === selectedIndex
                        ? 'bg-accent/15 text-accent'
                        : 'hover:bg-surface-hover text-fg-primary'
                    }`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(item);
                    }}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        item.tracked ? 'bg-success' : 'bg-fg-muted/30'
                      }`}
                    />
                    <span className="truncate font-content">{item.name}</span>
                  </button>
                );
              })}
            </>
          )}
          {knowledge.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-muted font-medium sticky top-0 bg-raised border-b border-border">
                Knowledge
              </div>
              {knowledge.map((item) => {
                const idx = getAndInc();
                return (
                  <button
                    key={`k-${item.id}`}
                    data-index={idx}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                      idx === selectedIndex
                        ? 'bg-accent/15 text-accent'
                        : 'hover:bg-surface-hover text-fg-primary'
                    }`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(item);
                    }}
                  >
                    <svg className="w-3.5 h-3.5 shrink-0 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate font-content">{item.name}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {mentions.map((m, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                m.type === 'group'
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              }`}
            >
              {m.type === 'group' ? (
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
              ) : (
                <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              {m.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
