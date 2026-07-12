import type { Metadata } from 'next';
import './globals.css';
import SentinelAgent from '@/components/SentinelAgent';

export const metadata: Metadata = {
  title: 'Sentinel — The Factory SRE',
  description: 'Autonomous asset-downtime & maintenance copilot. Mastra · Qdrant · Enkrypt AI. TypeScript only.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-dim/60 bg-navy/60 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-6">
            <a href="/" className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-teal led" />
              <span className="font-bold tracking-wide text-offwhite">SENTINEL</span>
              <span className="text-muted text-xs font-mono hidden sm:inline">// factory SRE</span>
            </a>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <a href="/about" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">About</a>
              <a href="/" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Operations</a>
              <a href="/live" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Live</a>
              <a href="/fleet" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Fleet</a>
              <a href="/analytics" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Insights</a>
              <a href="/history" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">History</a>
              <a href="/knowledge" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Knowledge</a>
              <a href="/technician" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Technician</a>
              <a href="/observability" className="px-3 py-1.5 rounded-lg text-muted hover:text-teal hover:bg-dim/40">Observability</a>
            </nav>
          </div>
        </header>
        {children}
        <SentinelAgent />
        <footer className="mx-auto max-w-7xl px-4 py-6 text-[11px] text-muted/70 font-mono">
          Mastra workflows · Qdrant memory · Enkrypt AI safety — 100% TypeScript · HiDevs × Mastra Hackathon 2026
        </footer>
      </body>
    </html>
  );
}
