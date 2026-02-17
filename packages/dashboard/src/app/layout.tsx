import type { Metadata } from 'next';
import { Sidebar } from './sidebar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Parent AI Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light')return;document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-surface text-fg min-h-screen flex font-mono">
        <Sidebar />
        <main className="flex-1 p-4 md:p-8 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
