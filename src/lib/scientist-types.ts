export type Novelty = "not_found" | "similar_work_exists" | "exact_match_found";

export type Depth = "light" | "regular" | "deep";

export interface Reference {
  title: string;
  year?: number | null;
  authors?: string[];
  venue?: string;
  url?: string;
  abstract?: string;
}

export interface QcResult {
  novelty: Novelty;
  rationale: string;
  references: Reference[];
  searched: number;
}

export interface ProtocolStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  equipment: string[];
  /** Materials referenced in this step — separate from equipment so each list links to its own tab. */
  materials?: string[];
  /** Skills the planner assumed the operator already has. */
  assumed_skills?: string[];
  /** Quality-control checks that gate progression to the next step. */
  qc_checks?: string[];
  safety_notes: string;
}

export interface Material {
  name: string;
  catalog_number: string;
  supplier: string;
  quantity: string;
  unit_cost_usd: number;
  link?: string;
  notes: string;
}

export interface BudgetLine {
  category: string;
  item: string;
  amount_usd: number;
  notes: string;
}

export interface TimelinePhase {
  phase: string;
  start_week: number;
  end_week: number;
  deliverable: string;
  depends_on: string[];
}

export interface EquipmentItem {
  name: string;
  model?: string;
  location?: string;
  owner_team?: string;
}

export interface ExperimentPlan {
  domain: string;
  overview: {
    restated_hypothesis: string;
    objective: string;
    control_condition: string;
    success_criteria: string;
  };
  protocol: ProtocolStep[];
  materials: Material[];
  budget: BudgetLine[];
  timeline: TimelinePhase[];
  validation: {
    primary_endpoint: string;
    statistical_approach: string;
    decision_criteria: string;
    risks: string[];
  };
  /** Rich equipment metadata from the backend (location, owner_team, model). Optional. */
  equipment_list?: EquipmentItem[];
}

export interface Collaborator {
  name: string;
  affiliation: string;
  relevance: string;
  /** Specific protocol/skill matches: e.g. ["DMSO cryopreservation", "HeLa cell culture", "FITC-dextran assay"] */
  matched_skills?: string[];
  top_paper_title?: string;
  top_paper_year?: number | null;
  url?: string;
  h_index?: number | null;
  paper_count?: number | null;
  /** Best-effort academic email (may be null when not findable). */
  email?: string | null;
}

export interface EquipmentSourceItem {
  facility: string;
  location: string;
  access: string; // e.g. "Open to external academics", "MIT-only", "Fee-for-service"
  url?: string;
  notes?: string;
}

export interface EquipmentSourcing {
  equipment: string;
  sources: EquipmentSourceItem[];
}
