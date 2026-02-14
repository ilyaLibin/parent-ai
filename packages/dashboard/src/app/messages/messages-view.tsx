'use client';

import { useState } from 'react';
import type { Group } from './page';

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

export function MessagesView({ groups }: { groups: Group[] }) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadMessages(groupId: string, h: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/messages?hours=${h}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = await res.json();
      const group = (data.groups as GroupMessages[])?.find((g) => g.groupId === groupId);
      setMessages(group?.messages ?? []);
    } finally {
      setLoading(false);
    }
  }

  function selectGroup(groupId: string) {
    setSelectedGroupId(groupId);
    loadMessages(groupId, hours);
  }

  function changeHours(h: number) {
    setHours(h);
    if (selectedGroupId) loadMessages(selectedGroupId, h);
  }

  if (groups.length === 0) {
    return <p className="text-fg-muted">No groups found.</p>;
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-10rem)]">
      {/* Group list */}
      <div className="w-64 shrink-0 space-y-1 overflow-y-auto">
        {[...groups].sort((a, b) => {
          if ((a.messageCount > 0) !== (b.messageCount > 0)) return b.messageCount > 0 ? 1 : -1;
          return b.updated_at - a.updated_at;
        }).map((group) => (
          <button
            key={group.id}
            onClick={() => selectGroup(group.id)}
            className={`w-full text-left px-3 py-2 rounded text-sm transition-all ${
              selectedGroupId === group.id
                ? 'bg-accent-subtle text-accent font-medium border border-border'
                : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
            }`}
          >
            <div className="font-medium truncate">{group.name}</div>
            <div className="text-xs text-fg-muted">{group.messageCount} msgs</div>
          </button>
        ))}
      </div>

      {/* Messages panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Hours filter */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-xs text-fg-muted uppercase tracking-wider">Last</label>
          <input
            type="range"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => changeHours(Number(e.target.value))}
            className="w-40 accent-accent"
          />
          <span className="text-sm text-fg-secondary w-16">{hours}h</span>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {!selectedGroupId && (
            <p className="text-fg-muted text-sm">Select a group to view messages.</p>
          )}
          {loading && <p className="text-fg-muted text-sm animate-pulse">loading...</p>}
          {!loading && selectedGroupId && messages.length === 0 && (
            <p className="text-fg-muted text-sm">No messages in this time range.</p>
          )}
          {!loading &&
            messages.map((msg) => (
              <div key={msg.id} className="card-raised rounded-lg px-4 py-3">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-bold text-accent">{msg.sender}</span>
                  <span className="text-xs text-fg-muted">
                    {new Date(msg.time).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-fg-secondary whitespace-pre-wrap">
                  {msg.content || (
                    <span className="italic text-fg-muted">[{msg.type}]</span>
                  )}
                </p>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
