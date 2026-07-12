'use client';
// Animated n8n-style orchestration diagram — pure SVG + CSS (no deps).
// Hover/tap a node → its description appears in the caption strip below.
// Edges carry animated dash-flow pulses; the write-back → retrieval loop is the flywheel.
import { useState } from 'react';

interface Node { id: string; x: number; y: number; icon: string; label: string; sub: string; color: string; desc: string }

const NODES: Node[] = [
  { id: 'fault',   x: 70,   y: 130, icon: '⚠️', label: 'Fault',           sub: 'MCP · CMMS work order',       color: '#F59E0B', desc: 'A sensor alarm or operator report fires. Sentinel ingests it and opens a CMMS work order automatically — via a real MCP tool.' },
  { id: 'qdrant',  x: 205,  y: 130, icon: '🧠', label: 'Qdrant Retrieval', sub: 'Qdrant Cloud',                color: '#00C9A7', desc: 'Semantic search + HARD payload filters over 3 collections: similar incidents, the exact OEM manual section, and vetted runbooks — filtered to the technician’s auth level.' },
  { id: 'draft',   x: 340,  y: 130, icon: '✍️', label: 'LLM Draft',        sub: 'Groq · llama-3.3-70b',        color: '#7DA2FF', desc: 'A step-by-step repair runbook is drafted (Groq llama-3.3-70b in live mode), grounded in the retrieved context.' },
  { id: 'scorer',  x: 475,  y: 130, icon: '📊', label: 'Mastra Scorer',    sub: 'Mastra scorers',              color: '#B48CFF', desc: 'Deterministic scorers grade relevance, safety and completeness (pass ≥ 0.75 each). A failing draft triggers one self-refine pass with scorer feedback.' },
  { id: 'gate',    x: 610,  y: 130, icon: '⛔', label: 'Safety Gate',      sub: 'Physics engine + Enkrypt AI', color: '#EF4444', desc: 'Every numeric spec is cross-checked against OEM ground truth; LOTO ordering, interlock tampering and auth level are enforced — locally and deterministically, with Enkrypt cloud running in parallel. Dangerous steps are corrected or removed.' },
  { id: 'hitl',    x: 745,  y: 130, icon: '👤', label: 'HITL Approval',    sub: 'Mastra suspend/resume',       color: '#F59E0B', desc: 'The workflow genuinely suspends (Mastra suspend/resume, durable in Turso). Nothing executes until a human with sufficient auth level signs off.' },
  { id: 'post',    x: 880,  y: 130, icon: '📝', label: 'Post-Mortem',      sub: 'Groq + Enkrypt bias check',   color: '#00C9A7', desc: 'A blameless post-mortem is written and itself passes a bias gate (no unevidenced operator-blame).' },
  { id: 'memory',  x: 1000, y: 130, icon: '💾', label: 'Write-Back',       sub: 'Qdrant upsert',               color: '#34D399', desc: 'The resolved incident is written back into Qdrant — the next similar failure retrieves THIS fix. That loop is the flywheel.' },
];

const EDGES: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]];

export default function FlowDiagram() {
  const [active, setActive] = useState(4); // default: the safety gate — the money moment
  const n = NODES[active];

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1060 235" className="w-full min-w-[760px]" role="img" aria-label="Sentinel orchestration pipeline">
          {/* straight-run edges */}
          {EDGES.map(([a, b]) => (
            <path
              key={`${a}-${b}`}
              d={`M ${NODES[a].x + 30} ${NODES[a].y} C ${NODES[a].x + 70} ${NODES[a].y - 26}, ${NODES[b].x - 70} ${NODES[b].y - 26}, ${NODES[b].x - 30} ${NODES[b].y}`}
              fill="none" stroke={NODES[b].color} strokeWidth="2" className="flow-edge" opacity=".8"
            />
          ))}
          {/* the flywheel: write-back loops to retrieval */}
          <path
            d={`M ${NODES[7].x} ${NODES[7].y + 30} C ${NODES[7].x - 120} ${NODES[7].y + 95}, ${NODES[1].x + 120} ${NODES[1].y + 95}, ${NODES[1].x} ${NODES[1].y + 32}`}
            fill="none" stroke="#34D399" strokeWidth="2" className="flow-edge" opacity=".7"
          />
          <text x={(NODES[1].x + NODES[7].x) / 2} y={NODES[7].y + 92} textAnchor="middle" fill="#34D399" fontSize="11" fontFamily="monospace">
            the flywheel — every resolution makes the next one faster
          </text>
          {/* nodes */}
          {NODES.map((node, i) => (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              style={{ cursor: 'pointer' }}
            >
              <circle r="30" fill={`${node.color}22`} stroke={node.color} strokeWidth={active === i ? 3 : 1.6} />
              {active === i && <circle r="36" fill="none" stroke={node.color} strokeWidth="1" opacity=".5" className="led" />}
              <text textAnchor="middle" dy="7" fontSize="22">{node.icon}</text>
              <text textAnchor="middle" y="50" fill={active === i ? node.color : '#8FA3BF'} fontSize="12" fontWeight="600">{node.label}</text>
              {/* the actual stack under each step — mono, muted, projector-legible */}
              <text textAnchor="middle" y="64" fill="#64748B" fontSize="9" fontFamily="monospace">{node.sub}</text>
            </g>
          ))}
        </svg>
      </div>
      {/* caption strip = the tooltip surface (hover/tap a node) */}
      <div className="panel p-4 mt-2 min-h-[74px] flex items-start gap-3" style={{ borderColor: `${n.color}66` }}>
        <span className="text-xl leading-none">{n.icon}</span>
        <div>
          <div className="text-sm font-bold" style={{ color: n.color }}>{n.label}</div>
          <p className="text-[13px] text-muted leading-relaxed">{n.desc}</p>
        </div>
      </div>
    </div>
  );
}
