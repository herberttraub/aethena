import type { TimelinePhase } from "@/lib/scientist-types";
import { formatTimelineWeeks } from "@/lib/scientist-utils";

interface Props {
  timeline: TimelinePhase[];
  maxWeek: number;
}

const BAR_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--status-novel))",
  "hsl(var(--slate-blue))",
  "hsl(var(--brass-deep))",
  "hsl(var(--clay))",
  "hsl(var(--moss))",
];

/**
 * Construction-style schedule.
 * - Sticky left "phase" column (always-readable label)
 * - Right gantt track with week ticks
 * - Bar shows just dates; deliverable + dependencies render BELOW the bar in a caption row
 *   so long text never truncates and never overlaps neighbouring bars.
 */
export function ConstructionTimeline({ timeline, maxWeek }: Props) {
  const weeks = Math.max(1, maxWeek);
  // Show ~6 ticks max for readability
  const tickStep = Math.max(1, Math.ceil(weeks / 6));
  const ticks: number[] = [];
  for (let w = 1; w <= weeks; w += tickStep) ticks.push(w);
  if (ticks[ticks.length - 1] !== weeks) ticks.push(weeks);

  return (
    <div className="lab-card p-4 md:p-5">
      {/* Header row: tick marks */}
      <div className="grid grid-cols-[140px_1fr] gap-3 mb-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Phase</div>
        <div className="relative h-5">
          {ticks.map((w) => (
            <div
              key={w}
              className="absolute -translate-x-1/2 text-[10px] uppercase tracking-wider text-muted-foreground"
              style={{ left: `${((w - 1) / Math.max(1, weeks - 1)) * 100}%` }}
            >
              W{w}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {timeline.map((t, i) => {
          const left = ((t.start_week - 1) / weeks) * 100;
          const width = Math.max(2, ((t.end_week - t.start_week + 1) / weeks) * 100);
          const color = BAR_COLORS[i % BAR_COLORS.length];

          return (
            <div key={i} className="grid grid-cols-[140px_1fr] gap-3 items-start">
              {/* Phase column */}
              <div className="pt-1.5">
                <div className="text-sm font-medium text-foreground leading-tight">{t.phase}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                  {formatTimelineWeeks(t.start_week, t.end_week)}
                </div>
              </div>

              {/* Gantt track */}
              <div>
                <div className="relative h-7 rounded bg-secondary/60 border border-border/50">
                  {/* faint week gridlines */}
                  {ticks.map((w) => (
                    <div
                      key={w}
                      className="absolute top-0 bottom-0 w-px bg-border/40"
                      style={{ left: `${((w - 1) / Math.max(1, weeks - 1)) * 100}%` }}
                    />
                  ))}
                  {/* the bar */}
                  <div
                    className="absolute top-1 bottom-1 rounded-sm shadow-sm flex items-center justify-end pr-1.5"
                    style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }}
                    title={t.deliverable}
                  >
                    <span className="text-[10px] font-mono text-white/90 tabular-nums">
                      {t.end_week - t.start_week + 1}w
                    </span>
                  </div>
                </div>

                {/* Caption underneath — like a construction schedule */}
                <div className="mt-1.5 flex items-start gap-2 text-xs">
                  <span
                    className="mt-1 h-2 w-2 rounded-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div className="min-w-0">
                    <p className="text-foreground leading-snug">{t.deliverable}</p>
                    {t.depends_on?.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        ↳ depends on: {t.depends_on.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
