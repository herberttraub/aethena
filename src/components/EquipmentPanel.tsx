import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, ExternalLink, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { EquipmentItem, EquipmentSourcing, ExperimentPlan } from "@/lib/scientist-types";

interface Props {
  plan: ExperimentPlan;
}

const BOOKING_URL = "https://atlas.mit.edu/";

function uniqueEquipmentNames(plan: ExperimentPlan): string[] {
  const set = new Set<string>();
  plan.protocol.forEach((s) => s.equipment?.forEach((e) => e && set.add(e.trim())));
  (plan.equipment_list ?? []).forEach((e) => e?.name && set.add(e.name.trim()));
  return Array.from(set).slice(0, 16);
}

function mapsLinkHref(location: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location}, Cambridge, MA`)}`;
}

function mapsEmbedHref(location: string) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(`${location}, Cambridge, MA`)}&z=15&output=embed`;
}

interface BuildingGroup {
  /** Display name for the building (e.g. "Building 32" or "Stata Center"). */
  building: string;
  /** Rooms within this building, each with the equipment that lives there. */
  rooms: { room: string; items: EquipmentItem[] }[];
  owners: string[];
}

/** Extract a building label and a room label from a free-form location string.
 * Examples:
 *   "Building 32, Room 415"   → ("Building 32", "Room 415")
 *   "Bldg 76 Rm 220"           → ("Building 76", "Room 220")
 *   "32-415"                   → ("Building 32", "Room 415")
 *   "Stata Center, Room 4-200" → ("Stata Center", "Room 4-200")
 *   "MIT Koch Institute"       → ("MIT Koch Institute", "")
 */
function splitBuildingRoom(loc: string): { building: string; room: string } {
  const raw = (loc || "").trim();
  if (!raw) return { building: "Location not specified", room: "" };
  // "32-415" style → infer building 32, room 415
  const dashMatch = raw.match(/^([A-Za-z]?\d{1,3})-([A-Za-z]?\d{2,4})\b/);
  if (dashMatch) return { building: `Building ${dashMatch[1]}`, room: `Room ${dashMatch[2]}` };
  // "Building X, Room Y" / "Bldg X Rm Y"
  const bldgMatch = raw.match(/\b(?:building|bldg|bld)\.?\s*([A-Za-z0-9-]+)\b/i);
  const roomMatch = raw.match(/\b(?:room|rm)\.?\s*([A-Za-z0-9-]+)\b/i);
  if (bldgMatch) {
    return {
      building: `Building ${bldgMatch[1].toUpperCase()}`,
      room: roomMatch ? `Room ${roomMatch[1]}` : "",
    };
  }
  // Comma-separated: building before the first comma, room after.
  const commaIdx = raw.indexOf(",");
  if (commaIdx > 0) {
    return { building: raw.slice(0, commaIdx).trim(), room: raw.slice(commaIdx + 1).trim() };
  }
  // Otherwise treat the whole thing as a building name.
  return { building: raw, room: "" };
}

function groupByBuilding(items: EquipmentItem[]): BuildingGroup[] {
  const map = new Map<string, BuildingGroup>();
  for (const it of items) {
    const { building, room } = splitBuildingRoom(it.location || "");
    let g = map.get(building);
    if (!g) {
      g = { building, rooms: [], owners: [] };
      map.set(building, g);
    }
    const roomKey = room || "Unspecified room";
    let r = g.rooms.find((x) => x.room === roomKey);
    if (!r) {
      r = { room: roomKey, items: [] };
      g.rooms.push(r);
    }
    r.items.push(it);
    if (it.owner_team && !g.owners.includes(it.owner_team)) {
      g.owners.push(it.owner_team);
    }
  }
  return Array.from(map.values());
}

export function EquipmentPanel({ plan }: Props) {
  const equipmentList = plan.equipment_list ?? [];
  const groups = useMemo(() => groupByBuilding(equipmentList), [equipmentList]);
  const hasRichData = groups.length > 0 && groups.some((g) => g.building && g.building !== "Location not specified");

  // Fallback path: if we don't have plan.equipment_list, fall back to /equipment-sourcing
  const [sourcing, setSourcing] = useState<EquipmentSourcing[]>([]);
  const [sourcingLoading, setSourcingLoading] = useState(false);
  const [sourcingError, setSourcingError] = useState<string | null>(null);

  useEffect(() => {
    if (hasRichData) {
      setSourcing([]);
      setSourcingLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const equipment = uniqueEquipmentNames(plan);
      if (equipment.length === 0) {
        setSourcing([]);
        setSourcingLoading(false);
        return;
      }
      setSourcingLoading(true);
      try {
        const data = await api.sourceEquipment({ equipment });
        if (cancelled) return;
        setSourcing(data?.sourcing ?? []);
      } catch (e: any) {
        if (!cancelled) setSourcingError(e?.message ?? "Could not fetch equipment sources");
      } finally {
        if (!cancelled) setSourcingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, hasRichData]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <p className="text-xs text-muted-foreground max-w-xl">
          Where to find each piece of equipment locally — grouped by lab so you can plan one visit per location.
        </p>
        <Button
          asChild
          size="sm"
          className="gap-1.5 shrink-0"
          style={{ background: "hsl(192 75% 38%)", color: "hsl(0 0% 100%)" }}
        >
          <a href={BOOKING_URL} target="_blank" rel="noreferrer">
            <CalendarCheck className="h-3.5 w-3.5" /> Book equipment / lab
          </a>
        </Button>
      </div>

      {hasRichData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map((g, i) => {
            const totalItems = g.rooms.reduce((acc, r) => acc + r.items.length, 0);
            return (
              <article key={i} className="lab-card p-4 flex flex-col gap-3">
                <div>
                  <a
                    href={mapsLinkHref(g.building)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-serif text-lg text-foreground hover:underline inline-flex items-center gap-1"
                  >
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {g.building}
                  </a>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {totalItems} item{totalItems === 1 ? "" : "s"}
                    {g.rooms.length > 1 ? ` across ${g.rooms.length} rooms` : ""}
                    {g.owners.length > 0 ? ` · owner${g.owners.length === 1 ? "" : "s"}: ${g.owners.join(", ")}` : ""}
                  </p>
                </div>
                <div className="space-y-2.5">
                  {g.rooms.map((r, ri) => (
                    <div key={ri}>
                      {r.room && r.room !== "Unspecified room" && (
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                          {r.room}
                        </p>
                      )}
                      <ul className="space-y-1">
                        {r.items.map((it, j) => {
                          const slug = it.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                          return (
                            <li key={j} id={`equipment-${slug}`} className="text-sm scroll-mt-28">
                              <span className="font-medium text-foreground">{it.name}</span>
                              {it.model && (
                                <span className="font-mono text-[11px] text-muted-foreground ml-2">{it.model}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
                <iframe
                  src={mapsEmbedHref(g.building)}
                  loading="lazy"
                  className="w-full h-32 rounded-md border border-border"
                  title={`Map for ${g.building}`}
                />
              </article>
            );
          })}
        </div>
      ) : sourcingLoading ? (
        <div className="lab-card p-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground mt-2">Mapping equipment to local facilities…</p>
        </div>
      ) : sourcingError ? (
        <div className="lab-card p-6 text-sm text-muted-foreground">
          Couldn't reach equipment sourcing: {sourcingError}
        </div>
      ) : sourcing.length === 0 ? (
        <div className="lab-card p-6 text-sm text-muted-foreground">
          No equipment list extracted from this protocol.
        </div>
      ) : (
        <div className="space-y-3">
          {sourcing.map((it, i) => {
            const slug = it.equipment.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            return (
              <article
                key={i}
                id={`equipment-${slug}`}
                className="lab-card p-4 transition-shadow scroll-mt-28"
              >
                <h3 className="font-serif text-lg text-foreground">{it.equipment}</h3>
                <ul className="mt-3 space-y-2">
                  {it.sources.map((s, j) => (
                    <li key={j} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{s.facility}</p>
                          <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" /> {s.location}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] rounded-full bg-secondary px-2 py-0.5 text-foreground/70">
                          {s.access}
                        </span>
                      </div>
                      {s.notes && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{s.notes}</p>}
                      {s.url && (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1"
                        >
                          Visit facility <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
