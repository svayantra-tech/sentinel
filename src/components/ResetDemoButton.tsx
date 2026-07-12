'use client';
// Corpus-safe demo reset — visible to EVERY logged-in role, on Operations and
// the Technician inbox. All safety lives server-side in /api/reset:
// demo_generated-only deletion, the ≤100 abort cap, and the reset watermark.
import { api } from '@/lib/client';

export default function ResetDemoButton({ onReset, className = 'btn btn-ghost' }: { onReset?: () => void; className?: string }) {
  const resetDemo = async () => {
    if (!confirm('Clear demo run history? The seeded corpus (~2,800 cases) is preserved. This cannot be undone.')) return;
    try {
      const r = await api<{ runsCleared: number; snapshotsCleared: number; writeBacksRemoved: number; incidentsBefore: number; incidentsAfter: number }>(
        '/api/reset', { method: 'POST' });
      alert(`Reset complete.\nRuns cleared: ${r.runsCleared} in-memory + ${r.snapshotsCleared} persisted\nWrite-backs removed: ${r.writeBacksRemoved}\nCorpus: ${r.incidentsBefore} → ${r.incidentsAfter} points (seeded preserved)`);
      onReset?.();
    } catch (e) {
      alert(`Reset failed: ${(e as Error).message}`);
    }
  };
  return <button onClick={resetDemo} className={className}>Reset Demo</button>;
}
