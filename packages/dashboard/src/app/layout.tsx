import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parent AI Dashboard',
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block px-4 py-2 rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen flex">
        <aside className="w-56 bg-zinc-900 border-r border-zinc-800 p-4 flex flex-col gap-1 shrink-0">
          <h1 className="text-lg font-semibold px-4 py-3 mb-2 text-white">Parent AI</h1>
          <NavLink href="/cron-jobs">Cron Jobs</NavLink>
          <NavLink href="/messages">Messages</NavLink>
        </aside>
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
