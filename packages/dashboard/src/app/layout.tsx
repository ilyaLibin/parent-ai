import type { Metadata } from 'next';
import { Sidebar } from './sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parent AI Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen flex">
        <Sidebar />
        <main className="flex-1 p-4 pt-14 md:p-8 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
