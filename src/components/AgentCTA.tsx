'use client';
// "Watch the agent work" — opens the global Sentinel Agent panel (it handles
// the not-signed-in case honestly by asking the visitor to log in first).
export default function AgentCTA({ className = 'btn btn-ghost' }: { className?: string }) {
  return (
    <button className={className} onClick={() => window.dispatchEvent(new Event('sentinel-agent-open'))}>
      Watch the agent work ▸
    </button>
  );
}
