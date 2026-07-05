// Shared display formatters for the operational surfaces.

export function inr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** Compact ₹ for KPI tiles: ₹1.2 Cr, ₹34.5 L, ₹8,200. */
export function compactINR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
}

export function num(n: number): string {
  return n.toLocaleString('en-IN');
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' });
}

export const SEVERITY_CHIP: Record<string, string> = {
  critical: 'border-danger/60 text-danger',
  high: 'border-amber/60 text-amber',
  medium: 'border-teal/50 text-teal',
};

export const HEALTH_CHIP = (h: number): string =>
  h < 55 ? 'border-danger/60 text-danger' : h < 75 ? 'border-amber/60 text-amber' : 'border-teal/60 text-teal';

export const TREND_ARROW: Record<string, string> = { up: '▲', down: '▼', flat: '▬' };
export const TREND_COLOR: Record<string, string> = { up: 'text-danger', down: 'text-teal', flat: 'text-muted' };

// Recharts palette aligned to the control-room theme.
export const CHART = {
  teal: '#00C9A7',
  blue: '#7aa2ff',
  amber: '#F59E0B',
  danger: '#EF4444',
  violet: '#c084fc',
  pink: '#f472b6',
  grid: '#1E3A5F',
  axis: '#94A3B8',
  categorical: ['#00C9A7', '#7aa2ff', '#F59E0B', '#c084fc', '#f472b6', '#EF4444', '#38bdf8', '#a3e635'],
};
