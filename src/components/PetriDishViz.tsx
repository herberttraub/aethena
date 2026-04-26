import { useMemo } from "react";
import type { Novelty } from "@/lib/scientist-types";

interface Props {
  novelty: Novelty;
  seed: string;
  size?: number;
}

// Simple deterministic PRNG seeded from string
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const PALETTE: Record<
  Novelty,
  { ring: string; bg: string; colony: string[]; count: number; maxR: number; opacity: number; label: string; tag: string }
> = {
  not_found: {
    ring: "hsl(var(--status-novel-deep))",
    bg: "hsl(var(--status-novel-soft))",
    colony: ["hsl(var(--status-novel) / 0.65)", "hsl(var(--status-novel-deep) / 0.45)", "hsl(var(--brass) / 0.35)"],
    count: 8,
    maxR: 14,
    opacity: 0.75,
    label: "Sparse colonies — open ground",
    tag: "novel",
  },
  similar_work_exists: {
    ring: "hsl(var(--brass-deep))",
    bg: "hsl(var(--status-similar-soft))",
    colony: ["hsl(var(--status-similar) / 0.6)", "hsl(var(--slate-blue) / 0.5)", "hsl(var(--moss) / 0.4)"],
    count: 22,
    maxR: 22,
    opacity: 0.75,
    label: "Overlapping clusters — adjacent territory",
    tag: "similar",
  },
  exact_match_found: {
    ring: "hsl(var(--brass-deep))",
    bg: "hsl(var(--status-exact-soft))",
    colony: ["hsl(var(--status-exact) / 0.7)", "hsl(var(--clay) / 0.6)", "hsl(var(--brass-deep) / 0.5)"],
    count: 38,
    maxR: 28,
    opacity: 0.8,
    label: "Densely colonized — well-trodden path",
    tag: "exact",
  },
};

export function PetriDishViz({ novelty, seed, size = 170 }: Props) {
  const cfg = PALETTE[novelty];

  const colonies = useMemo(() => {
    const r = rng(hashString(seed + ":" + novelty));
    const cx = size / 2;
    const cy = size / 2;
    const dishR = size / 2 - 6;
    const items: { x: number; y: number; r: number; fill: string }[] = [];
    for (let i = 0; i < cfg.count; i++) {
      const angle = r() * Math.PI * 2;
      const dist = Math.sqrt(r()) * (dishR - cfg.maxR - 6);
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const radius = 4 + r() * cfg.maxR;
      const fill = cfg.colony[Math.floor(r() * cfg.colony.length)];
      items.push({ x, y, r: radius, fill });
    }
    return items;
  }, [seed, novelty, size, cfg]);

  const id = `dish-${cfg.tag}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-sm shrink-0">
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor={cfg.bg} stopOpacity="1" />
          <stop offset="100%" stopColor={cfg.bg} stopOpacity="0.5" />
        </radialGradient>
        <radialGradient id={`${id}-rim`} cx="50%" cy="50%" r="50%">
          <stop offset="92%" stopColor="transparent" />
          <stop offset="98%" stopColor={cfg.ring} stopOpacity="0.55" />
          <stop offset="100%" stopColor={cfg.ring} stopOpacity="0.95" />
        </radialGradient>
        <filter id={`${id}-blur`}>
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill={`url(#${id}-bg)`} />
      <g filter={`url(#${id}-blur)`} opacity={cfg.opacity}>
        {colonies.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={c.r} fill={c.fill} />
        ))}
      </g>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 10} fill="none" stroke={cfg.ring} strokeOpacity="0.18" />
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 18} fill="none" stroke={cfg.ring} strokeOpacity="0.1" />
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill={`url(#${id}-rim)`} />
    </svg>
  );
}
