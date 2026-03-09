'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './components/theme-toggle';

const links = [
  { href: '/tasks', label: 'tasks' },
  { href: '/action-items', label: 'action items' },
  { href: '/knowledge', label: 'knowledge' },
  { href: '/messages', label: 'messages' },
  { href: '/logs', label: 'logs' },
  { href: '/tts', label: 'tts' },
  { href: '/settings', label: 'settings' },
];

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Hamburger button — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 right-4 z-50 md:hidden btn-raised rounded-lg p-2"
        aria-label="Open menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop — mobile only */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-52 bg-surface-secondary border-r border-border p-3 flex flex-col gap-0.5 transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <h1 className="text-sm font-bold px-3 py-3 mb-1 text-fg tracking-wider uppercase">parent_ai</h1>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className={`block px-3 py-1.5 rounded text-sm transition-all ${
              pathname.startsWith(link.href)
                ? 'bg-accent-subtle text-accent font-medium border border-border'
                : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
            }`}
          >
            /{link.label}
          </Link>
        ))}
        <div className="mt-auto">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
