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
  blurb: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  hoverBorder: string;
}[] = [
  {
    id: "light",
    title: "Light",
    blurb: "Concise headline plan. Best for early scoping and quick sanity checks.",
    icon: Feather,
    iconBg: "bg-mineral-teal/15",
    iconColor: "text-mineral-teal",
    hoverBorder: "hover:border-mineral-teal",
  },
  {
    id: "regular",
    title: "Regular",
    blurb: "Balanced detail with rationale per step. The default for most cases.",
    icon: Microscope,
    iconBg: "bg-status-novel-soft",
    iconColor: "text-status-novel",
    hoverBorder: "hover:border-status-novel",
  },
  {
    id: "deep",
    title: "Deep",
    blurb: "Exhaustive: alternative protocols, failure modes, extended reasoning, citations per step.",
    icon: Telescope,
    iconBg: "bg-mineral-violet/15",
    iconColor: "text-mineral-violet",
    hoverBorder: "hover:border-mineral-violet",
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
              <div className="flex items-center mb-3">
                <span className={`grid place-items-center h-9 w-9 rounded-md ${o.iconBg} ${o.iconColor}`}>
                  <o.icon className="h-4 w-4" />
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
