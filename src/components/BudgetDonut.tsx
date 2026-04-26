import { useMemo, useState } from "react";
import { formatUSD } from "@/lib/scientist-utils";

interface Props {
  data: { label: string; value: number }[];
  size?: number;
}

// Differentiated palette for budget pie chart only — warm + cool mix
const COLORS = [
  "hsl(192 75% 38%)",   // ocean teal
  "hsl(38 85% 55%)",    // mustard yellow
  "hsl(8 65% 50%)",     // brick red
  "hsl(168 55% 38%)",   // sea green
  "hsl(265 45% 55%)",   // muted violet
  "hsl(20 75% 55%)",    // terracotta
  "hsl(210 65% 35%)",   // deep navy
  "hsl(45 70% 48%)",    // amber gold
  "hsl(340 55% 55%)",   // dusty rose
  "hsl(140 40% 40%)",   // moss green
];

export function BudgetDonut({ data, size = 220 }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = useMemo(() => data.reduce((acc, d) => acc + d.value, 0), [data]);

  const slices = useMemo(() => {
    if (total <= 0) return [];
    let cumulative = 0;
    return data.map((d, i) => {
      const pct = d.value / total;
      const start = cumulative;
      cumulative += pct;
      const end = cumulative;
      return {
        label: d.label,
        value: d.value,
        pct,
        start,
        end,
        color: COLORS[i % COLORS.length],
      };
    });
  }, [data, total]);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 6;
  const rInner = rOuter * 0.62;

  function arcPath(startFrac: number, endFrac: number, expand = 0) {
    const a0 = startFrac * Math.PI * 2 - Math.PI / 2;
    const a1 = endFrac * Math.PI * 2 - Math.PI / 2;
    const large = endFrac - startFrac > 0.5 ? 1 : 0;
    const ro = rOuter + expand;
    const x0o = cx + Math.cos(a0) * ro;
    const y0o = cy + Math.sin(a0) * ro;
    const x1o = cx + Math.cos(a1) * ro;
    const y1o = cy + Math.sin(a1) * ro;
    const x0i = cx + Math.cos(a1) * rInner;
    const y0i = cy + Math.sin(a1) * rInner;
    const x1i = cx + Math.cos(a0) * rInner;
    const y1i = cy + Math.sin(a0) * rInner;
    return [
      `M ${x0o} ${y0o}`,
      `A ${ro} ${ro} 0 ${large} 1 ${x1o} ${y1o}`,
      `L ${x0i} ${y0i}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${x1i} ${y1i}`,
      `Z`,
    ].join(" ");
  }

  const hoveredSlice = hovered !== null ? slices[hovered] : null;

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.length === 0 ? (
            <circle cx={cx} cy={cy} r={rOuter} fill="hsl(var(--muted))" />
          ) : slices.length === 1 ? (
            <>
              <circle cx={cx} cy={cy} r={rOuter} fill={slices[0].color} />
              <circle cx={cx} cy={cy} r={rInner} fill="hsl(var(--card))" />
            </>
          ) : (
            slices.map((s, i) => (
              <path
                key={i}
                d={arcPath(s.start, s.end, hovered === i ? 4 : 0)}
                fill={s.color}
                stroke="hsl(var(--card))"
                strokeWidth="1.5"
                style={{
                  cursor: "pointer",
                  transition: "d 150ms ease, opacity 150ms ease",
                  opacity: hovered === null || hovered === i ? 1 : 0.55,
                }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${s.label} — ${formatUSD(s.value)} (${(s.pct * 100).toFixed(0)}%)`}</title>
              </path>
            ))
          )}
          {hoveredSlice ? (
            <>
              <text x={cx} y={cy - 6} textAnchor="middle" className="font-serif" fontSize="12" fill="hsl(var(--muted-foreground))">
                {hoveredSlice.label.length > 18 ? hoveredSlice.label.slice(0, 17) + "…" : hoveredSlice.label}
              </text>
              <text x={cx} y={cy + 16} textAnchor="middle" className="font-serif" fontSize="20" fill="hsl(var(--foreground))">
                {formatUSD(hoveredSlice.value)}
              </text>
              <text x={cx} y={cy + 34} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                {(hoveredSlice.pct * 100).toFixed(0)}% of total
              </text>
            </>
          ) : (
            <>
              <text x={cx} y={cy - 4} textAnchor="middle" className="font-serif" fontSize="13" fill="hsl(var(--muted-foreground))">
                Total
              </text>
              <text x={cx} y={cy + 18} textAnchor="middle" className="font-serif" fontSize="22" fill="hsl(var(--foreground))">
                {formatUSD(total)}
              </text>
            </>
          )}
        </svg>
      </div>

      <ul className="flex-1 min-w-0 w-full space-y-1.5">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center gap-3 text-sm rounded px-1.5 py-0.5 cursor-pointer transition-colors ${
              hovered === i ? "bg-secondary" : ""
            }`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-foreground truncate flex-1">{s.label}</span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {(s.pct * 100).toFixed(0)}%
            </span>
            <span className="font-mono text-sm text-foreground tabular-nums">{formatUSD(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
