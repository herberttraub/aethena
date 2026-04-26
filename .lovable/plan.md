# Aethena — Platform Rebrand & Feature Expansion

Transform the current "AI Scientist" hackathon prototype into **aethena**, a polished live workable platform with a richer planning flow, mineral/notebook visual identity, document upload, depth selection, and post-plan collaboration windows (collaborators + equipment sourcing).

---

## 1. Rebrand to aethena

**Logo & identity**
- Save the uploaded logo to `src/assets/aethena-logo.png` and use it in `SiteHeader`, browser tab favicon (`index.html`), and as a hero mark.
- App name everywhere: **aethena** (lowercase, with the "æ" ligature: **æthena**).
- Strip all references to: *Hack-Nation, Hackathon, Fulcrum, Challenge 04, Challenge, Competition*. Update header, footer, hero badges, README, page titles, meta tags.
- Tagline becomes something neutral & product-y: e.g. *"From hypothesis to runnable experiment."*

**Color palette (mineral / petri-dish inspired)**
Pull directly from the logo:
- `mineral-cream` `#f4ede0` (background, paper)
- `brass` `#c9a24b` (primary accent, ring border)
- `sage` `#9bb5a8` (secondary, "novel" status)
- `slate-blue` `#7a93a8` (info, similar)
- `dark-graphite` `#2b2e2c` (foreground)
- `clay` `#b87a5e` (warnings / exact match)
- `moss` `#5d7a5a` (deep accent)
Update `src/index.css` HSL tokens + `tailwind.config.ts` color extensions. Add subtle **paper grain** texture (CSS noise SVG) to the body background and a notebook-rule hairline to cards.

**Typography (notebook feel, consistent across platform)**
- Headings: **Caveat** or **Kalam** (handwritten notebook) for hero/section titles — used sparingly.
- Body / UI: **Inter** kept, but switched to a warmer weight; or **Söhne**-like fallback.
- Mono / data: **JetBrains Mono** kept.
Single consistent pairing across every page.

---

## 2. First screen — simplified hypothesis input

- Remove the four sample-prompt cards entirely.
- Remove the "Challenge 04 · Fulcrum Science" badge.
- Hero copy becomes simply: **"Let's create your plan."** with a one-line subhead.
- Below the NL textarea, add a **second card: "Add reference material (optional)"** — a drag-and-drop file uploader.

**Upload behavior**
- Accepts any file: PDF, DOCX, TXT, MD, CSV, images, etc.
- Multiple files allowed, max 10, 20 MB each.
- Files stored in a new Supabase Storage bucket `hypothesis-uploads` (private, signed URL access).
- On submit, a new edge function **`parse-uploads`** extracts text from each file (PDF/DOCX via a lightweight Deno parser; plain text passthrough; images sent to Lovable AI vision for OCR/description). The combined extracted text is passed alongside the hypothesis into both `literature-qc` and `generate-plan` as additional grounding context.
- Upload is fully optional — workflow proceeds without it.

---

## 3. Second screen — literature QC visualization

Add a visual treatment for the novelty result, color-coded:
- **Novel territory** → emerald/sage panel with an animated **petri-dish SVG** showing sparse, scattered colonies (visual metaphor for "untouched ground").
- **Similar work exists** → slate-blue panel with overlapping colony clusters.
- **Exact match found** → clay panel with a dense, fully-colonized dish.
The dish is rendered as a small SVG (radial gradient + procedurally placed circles seeded by the hypothesis hash for visual stability). Each novelty class gets its own distinct color and density pattern, making the verdict instantly readable at a glance.

---

## 4. Depth-of-analysis modal (gating plan generation)

When the user clicks **Generate experiment plan**, intercept and open a modal:

> **How deep should we go?**
> - **Light** — Concise, headline-only plan. Best for early scoping. (~30 sec)
> - **Regular** — Balanced detail with rationale per step. (~60 sec)
> - **Deep** — Exhaustive: alternative protocols, failure modes, extended reasoning, citations per step. (~2 min)

Plan generation does **not** start until the user picks one. The chosen depth is sent to `generate-plan` as a `depth` parameter and:
- Adjusts the system prompt (length & verbosity instructions).
- Switches model: Light → `google/gemini-3-flash-preview`; Regular → same with longer max tokens; Deep → `google/gemini-2.5-pro` with extended reasoning.
- Adjusts the JSON schema's `description` minimum lengths so the model produces longer protocol descriptions / rationale fields for deeper modes.
- Stored on the `plans` row (new `depth` column).

---

## 5. Plan view — visual & UX upgrades

**Protocol section**
- If `safety_notes` is empty / `"none"` / null → render nothing (no "None" placeholder, no warning icon).

**Budget section — replace bar chart**
Replace horizontal bars with a **donut/pie chart with side legend**, showing each category as an arc segment with its $ amount and %. Built with a small SVG (no chart lib needed). This makes proportional relationships between categories instantly visible at a glance, which bars stacked vertically obscure.

**Timeline section — week labels**
- Replace `Wk 1–1` / `Wk 2–2` with smarter labels:
  - Single-week phase → `Week 3` (no range).
  - Multi-week phase → `Week 2 → 5` or `Weeks 2–5 (4 wks)`.
- Add total span indicator: "Week 3 of 12" mini ticks.

**More visuals after generation**
- Hero stats row gets small inline sparkline-style icons (already partially there — polish).
- Materials table gets a small per-row supplier chip.
- Section nav rail gets the brass accent on the active section via scroll-spy (`IntersectionObserver`).

---

## 6. New post-plan windows

Two new sections added at the bottom of the plan view, after Validation:

### A. **Find collaborators** — researchers with relevant experience
- New edge function `find-collaborators` queries the **Semantic Scholar Author Search API** using key terms extracted from the hypothesis + protocol.
- Returns 5–8 researchers (name, affiliation, h-index, top relevant paper, profile URL).
- Rendered as a card grid with a "View profile" link.
- Filter chip: **MIT / Harvard / BU / Tufts / Greater Boston / Anywhere** (default Anywhere). Affiliation filter applied client-side after fetching.

### B. **Source equipment** — local sourcing for each piece of equipment
- New edge function `source-equipment` takes the deduplicated equipment list from `plan.protocol[].equipment` and `plan.materials`.
- For each item, asks Lovable AI (Gemini) with a curated knowledge prompt to suggest local sources from a known list of MIT / Cambridge / Boston facilities, e.g.:
  - MIT.nano, MIT BioMicro Center, Koch Institute Core Facilities, Whitehead Genome Tech Core
  - Harvard Bauer Core, HMS Core Facilities, Broad Institute platforms
  - BU Micro & Nano Imaging Facility, Northeastern IDEA
  - Commercial: New England Biolabs (Ipswich), Thermo Fisher Cambridge office
- Each row: equipment name → 1–3 suggested sources (facility, contact link, notes about access policy "open to external academics" / "MIT-only" / "fee-for-service").
- Rendered as a two-column card list grouped by equipment.

Both sections show a skeleton loader while fetching and surface gracefully if the call fails (the plan itself is unaffected).

---

## 7. Cleanup & misc

- Footer becomes: *"aethena — your AI co-scientist."*
- `Reviews.tsx` page renamed to **Past plans** — already mostly is; remove any remaining hackathon copy.
- README rewritten to describe aethena as a platform, not a hackathon submission.
- Remove `SAMPLE_PROMPTS` export (no longer used) — keep types.
- Update `<title>` and meta description in `index.html`.

---

## Technical summary

**New files**
- `src/components/DepthModal.tsx` — depth picker dialog
- `src/components/UploadDropzone.tsx` — file uploader on input screen
- `src/components/PetriDishViz.tsx` — SVG novelty visualization
- `src/components/BudgetDonut.tsx` — SVG donut chart
- `src/components/CollaboratorsPanel.tsx`
- `src/components/EquipmentPanel.tsx`
- `src/assets/aethena-logo.png`
- `supabase/functions/parse-uploads/index.ts`
- `supabase/functions/find-collaborators/index.ts`
- `supabase/functions/source-equipment/index.ts`

**DB migration**
- `plans`: add `depth text`, `upload_summary text` columns
- New storage bucket `hypothesis-uploads` (private) + RLS policies (public insert, owner read via signed URL — anonymous OK for MVP)

**Edited files**
- `src/index.css`, `tailwind.config.ts` — full palette + fonts swap, paper texture
- `index.html` — fonts, title, favicon
- `src/components/SiteHeader.tsx` — new logo + nav copy
- `src/components/HypothesisInput.tsx` — strip samples & badge, add upload card, simplify copy
- `src/components/LiteratureQc.tsx` — embed PetriDishViz
- `src/components/PlanView.tsx` — donut chart, timeline label fix, conditional safety, new bottom panels
- `src/pages/Index.tsx` — wire depth modal, upload state, pass depth to generate-plan
- `src/pages/Reviews.tsx` — rebrand
- `src/lib/scientist-types.ts` — add `Depth` type, `Collaborator`, `EquipmentSource`
- `src/lib/scientist-utils.ts` — `formatTimelineWeeks(start, end)` helper
- `supabase/functions/generate-plan/index.ts` — accept `depth` & `upload_summary`, branch model/prompt
- `supabase/functions/literature-qc/index.ts` — accept `upload_summary`

**APIs used**
- Semantic Scholar paper search (existing) + author search (new) — public, no key.
- Lovable AI Gateway — Gemini 3 Flash (default) + Gemini 2.5 Pro (deep mode) + Gemini 2.5 Flash for sourcing/parsing.
