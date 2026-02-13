'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/cron-jobs', label: 'Cron Jobs' },
  { href: '/messages', label: 'Messages' },
];

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Hamburger button — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="fixed top-4 left-4 z-50 md:hidden bg-zinc-800 rounded-lg p-2"
        aria-label="Open menu"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Backdrop — mobile only */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-56 bg-zinc-900 border-r border-zinc-800 p-4 flex flex-col gap-1 transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <h1 className="text-lg font-semibold px-4 py-3 mb-2 text-white">Parent AI</h1>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className={`block px-4 py-2 rounded-lg transition-colors ${
              pathname === link.href
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </aside>
    </>
  );
}
