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
    return <p className="text-zinc-400">No groups found.</p>;
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-10rem)]">
      {/* Group list */}
      <div className="w-64 shrink-0 space-y-1 overflow-y-auto">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => selectGroup(group.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedGroupId === group.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <div className="font-medium truncate">{group.name}</div>
            <div className="text-xs text-zinc-500">{group.messageCount} messages</div>
          </button>
        ))}
      </div>

      {/* Messages panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Hours filter */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-zinc-400">Last</label>
          <input
            type="range"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => changeHours(Number(e.target.value))}
            className="w-40 accent-blue-500"
          />
          <span className="text-sm text-zinc-300 w-16">{hours}h</span>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {!selectedGroupId && (
            <p className="text-zinc-500 text-sm">Select a group to view messages.</p>
          )}
          {loading && <p className="text-zinc-500 text-sm">Loading...</p>}
          {!loading && selectedGroupId && messages.length === 0 && (
            <p className="text-zinc-500 text-sm">No messages in this time range.</p>
          )}
          {!loading &&
            messages.map((msg) => (
              <div key={msg.id} className="bg-zinc-900 rounded-lg px-4 py-3 border border-zinc-800">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium text-blue-400">{msg.sender}</span>
                  <span className="text-xs text-zinc-500">
                    {new Date(msg.time).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                  {msg.content || (
                    <span className="italic text-zinc-500">[{msg.type}]</span>
                  )}
                </p>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
