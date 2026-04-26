import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Feather, Microscope, Telescope } from "lucide-react";
import type { Depth } from "@/lib/scientist-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (depth: Depth) => void;
}

const OPTIONS: {
  id: Depth;
  title: string;
  eta: string;
  blurb: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  hoverBorder: string;
  etaBg: string;
  etaColor: string;
}[] = [
  {
    id: "light",
    title: "Light",
    eta: "≈ 30 sec",
    blurb: "Concise headline plan. Best for early scoping and quick sanity checks.",
    icon: Feather,
    iconBg: "bg-mineral-teal/15",
    iconColor: "text-mineral-teal",
    hoverBorder: "hover:border-mineral-teal",
    etaBg: "bg-mineral-teal/15",
    etaColor: "text-mineral-teal",
  },
  {
    id: "regular",
    title: "Regular",
    eta: "≈ 60 sec",
    blurb: "Balanced detail with rationale per step. The default for most cases.",
    icon: Microscope,
    iconBg: "bg-status-novel-soft",
    iconColor: "text-status-novel",
    hoverBorder: "hover:border-status-novel",
    etaBg: "bg-status-novel-soft",
    etaColor: "text-status-novel-deep",
  },
  {
    id: "deep",
    title: "Deep",
    eta: "≈ 2 min",
    blurb: "Exhaustive: alternative protocols, failure modes, extended reasoning, citations per step.",
    icon: Telescope,
    iconBg: "bg-mineral-violet/15",
    iconColor: "text-mineral-violet",
    hoverBorder: "hover:border-mineral-violet",
    etaBg: "bg-mineral-violet/15",
    etaColor: "text-mineral-violet",
  },
];

export function DepthModal({ open, onOpenChange, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">How deep should we go?</DialogTitle>
          <DialogDescription>
            We'll match the level of detail and explanation in your report to the depth you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => onPick(o.id)}
              className={`text-left lab-card p-4 ${o.hoverBorder} hover:shadow-md transition-all group`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`grid place-items-center h-9 w-9 rounded-md ${o.iconBg} ${o.iconColor}`}>
                  <o.icon className="h-4 w-4" />
                </span>
                <span className={`text-[11px] uppercase tracking-[0.14em] font-medium px-2 py-0.5 rounded-full ${o.etaBg} ${o.etaColor}`}>
                  {o.eta}
                </span>
              </div>
              <p className="font-serif text-xl text-foreground">{o.title}</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{o.blurb}</p>
            </button>
          ))}
        </div>

        <div className="flex justify-end mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
