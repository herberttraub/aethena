// Multi-format exporters for an experiment plan: PDF, Word (.docx), LaTeX.
import jsPDF from "jspdf";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
} from "docx";
import type { ExperimentPlan } from "./scientist-types";
import { formatUSD, formatTimelineWeeks, isMeaningfulSafetyNote } from "./scientist-utils";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------- PDF ------------------------------- */

export function exportPdf(plan: ExperimentPlan, hypothesis: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  function ensure(h: number) {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }
  function h1(text: string) {
    ensure(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(text, margin, y);
    y += 22;
  }
  function h2(text: string) {
    ensure(22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(text, margin, y);
    y += 16;
  }
  function p(text: string, opts: { italic?: boolean; size?: number } = {}) {
    if (!text) return;
    doc.setFont("helvetica", opts.italic ? "italic" : "normal");
    doc.setFontSize(opts.size ?? 10.5);
    const lines = doc.splitTextToSize(text, maxW) as string[];
    lines.forEach((line) => {
      ensure(14);
      doc.text(line, margin, y);
      y += 13;
    });
    y += 2;
  }
  function bullet(text: string) {
    if (!text) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(text, maxW - 14) as string[];
    lines.forEach((line, i) => {
      ensure(14);
      doc.text(i === 0 ? `• ${line}` : `  ${line}`, margin, y);
      y += 13;
    });
  }
  function spacer(h = 6) {
    y += h;
  }

  // Title
  h1("Experiment Plan");
  p(`Hypothesis: ${hypothesis}`, { italic: true });
  p(`Domain: ${plan.domain}`);
  spacer(8);

  h2("Overview");
  p(`Restated hypothesis: ${plan.overview.restated_hypothesis}`);
  p(`Objective: ${plan.overview.objective}`);
  p(`Control condition: ${plan.overview.control_condition}`);
  p(`Success criteria: ${plan.overview.success_criteria}`);

  h2("Protocol");
  plan.protocol.forEach((s) => {
    p(`Step ${s.step}. ${s.title}  (${s.duration})`);
    p(s.description);
    if (s.equipment?.length) bullet(`Equipment: ${s.equipment.join(", ")}`);
    if (isMeaningfulSafetyNote(s.safety_notes)) bullet(`Safety: ${s.safety_notes}`);
    spacer(4);
  });

  h2("Materials");
  plan.materials.forEach((m) => {
    bullet(
      `${m.name} — ${m.supplier} (cat ${m.catalog_number}), qty ${m.quantity}, ${formatUSD(m.unit_cost_usd)}${m.notes ? ` — ${m.notes}` : ""}`,
    );
  });

  h2("Budget");
  plan.budget.forEach((b) => {
    bullet(`${b.category} · ${b.item} — ${formatUSD(b.amount_usd)}${b.notes ? ` (${b.notes})` : ""}`);
  });
  const total = plan.budget.reduce((acc, b) => acc + (b.amount_usd ?? 0), 0);
  spacer(2);
  p(`Total: ${formatUSD(total)}`);

  h2("Timeline");
  plan.timeline.forEach((t) => {
    bullet(`${formatTimelineWeeks(t.start_week, t.end_week)} · ${t.phase} — ${t.deliverable}`);
  });

  h2("Validation");
  p(`Primary endpoint: ${plan.validation.primary_endpoint}`);
  p(`Statistical approach: ${plan.validation.statistical_approach}`);
  p(`Decision criteria: ${plan.validation.decision_criteria}`);
  if (plan.validation.risks?.length) {
    p("Risks:");
    plan.validation.risks.forEach((r) => bullet(r));
  }

  doc.save("experiment-plan.pdf");
}

/* ------------------------------- DOCX ------------------------------- */

function tcell(text: string, bold = false) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: text ?? "", bold })] })],
  });
}

export async function exportDocx(plan: ExperimentPlan, hypothesis: string) {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Experiment Plan")] }),
    new Paragraph({ children: [new TextRun({ text: `Hypothesis: ${hypothesis}`, italics: true })] }),
    new Paragraph({ children: [new TextRun(`Domain: ${plan.domain}`)] }),
    new Paragraph({ text: "" }),
  );

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Overview" }));
  children.push(new Paragraph(`Restated hypothesis: ${plan.overview.restated_hypothesis}`));
  children.push(new Paragraph(`Objective: ${plan.overview.objective}`));
  children.push(new Paragraph(`Control condition: ${plan.overview.control_condition}`));
  children.push(new Paragraph(`Success criteria: ${plan.overview.success_criteria}`));

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Protocol" }));
  plan.protocol.forEach((s) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun(`Step ${s.step}. ${s.title} (${s.duration})`)],
      }),
    );
    children.push(new Paragraph(s.description));
    if (s.equipment?.length) children.push(new Paragraph(`Equipment: ${s.equipment.join(", ")}`));
    if (isMeaningfulSafetyNote(s.safety_notes)) children.push(new Paragraph(`Safety: ${s.safety_notes}`));
  });

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Materials" }));
  const matRows = [
    new TableRow({
      children: ["Reagent", "Catalog", "Supplier", "Qty", "Unit cost"].map((h) => tcell(h, true)),
    }),
    ...plan.materials.map(
      (m) =>
        new TableRow({
          children: [
            tcell(m.name),
            tcell(m.catalog_number),
            tcell(m.supplier),
            tcell(m.quantity),
            tcell(formatUSD(m.unit_cost_usd)),
          ],
        }),
    ),
  ];
  const matTable = new Table({
    rows: matRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Budget" }));
  plan.budget.forEach((b) => {
    children.push(new Paragraph(`• ${b.category} · ${b.item} — ${formatUSD(b.amount_usd)}${b.notes ? ` (${b.notes})` : ""}`));
  });
  const total = plan.budget.reduce((acc, b) => acc + (b.amount_usd ?? 0), 0);
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Total: ${formatUSD(total)}`, bold: true })],
      alignment: AlignmentType.RIGHT,
    }),
  );

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Timeline" }));
  plan.timeline.forEach((t) => {
    children.push(new Paragraph(`• ${formatTimelineWeeks(t.start_week, t.end_week)} · ${t.phase} — ${t.deliverable}`));
  });

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Validation" }));
  children.push(new Paragraph(`Primary endpoint: ${plan.validation.primary_endpoint}`));
  children.push(new Paragraph(`Statistical approach: ${plan.validation.statistical_approach}`));
  children.push(new Paragraph(`Decision criteria: ${plan.validation.decision_criteria}`));
  plan.validation.risks?.forEach((r) => children.push(new Paragraph(`• ${r}`)));

  // Insert materials table just after the Materials heading by rebuilding sections list.
  const doc = new Document({
    sections: [
      {
        children: [...children.slice(0, findHeadingIndex(children, "Materials") + 1), matTable, ...children.slice(findHeadingIndex(children, "Materials") + 1)],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, "experiment-plan.docx");
}

function findHeadingIndex(paras: Paragraph[], text: string): number {
  return paras.findIndex((p) => (p as any).options?.text === text || (p as any).root?.[1]?.root?.[1]?.text === text);
}

/* ------------------------------- LaTeX ------------------------------- */

function texEscape(s: string): string {
  if (!s) return "";
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

export function exportLatex(plan: ExperimentPlan, hypothesis: string) {
  const lines: string[] = [];
  lines.push("\\documentclass[11pt]{article}");
  lines.push("\\usepackage[margin=1in]{geometry}");
  lines.push("\\usepackage{longtable}");
  lines.push("\\usepackage{hyperref}");
  lines.push("\\title{Experiment Plan}");
  lines.push("\\date{}");
  lines.push("\\begin{document}");
  lines.push("\\maketitle");
  lines.push(`\\textit{Hypothesis:} ${texEscape(hypothesis)} \\\\`);
  lines.push(`\\textit{Domain:} ${texEscape(plan.domain)}`);

  lines.push("\\section*{Overview}");
  lines.push("\\begin{itemize}");
  lines.push(`  \\item \\textbf{Restated hypothesis:} ${texEscape(plan.overview.restated_hypothesis)}`);
  lines.push(`  \\item \\textbf{Objective:} ${texEscape(plan.overview.objective)}`);
  lines.push(`  \\item \\textbf{Control condition:} ${texEscape(plan.overview.control_condition)}`);
  lines.push(`  \\item \\textbf{Success criteria:} ${texEscape(plan.overview.success_criteria)}`);
  lines.push("\\end{itemize}");

  lines.push("\\section*{Protocol}");
  lines.push("\\begin{enumerate}");
  plan.protocol.forEach((s) => {
    lines.push(`  \\item \\textbf{${texEscape(s.title)}} (${texEscape(s.duration)}) \\\\`);
    lines.push(`        ${texEscape(s.description)}`);
    if (s.equipment?.length) lines.push(`        \\\\ \\textit{Equipment:} ${texEscape(s.equipment.join(", "))}`);
    if (isMeaningfulSafetyNote(s.safety_notes))
      lines.push(`        \\\\ \\textit{Safety:} ${texEscape(s.safety_notes)}`);
  });
  lines.push("\\end{enumerate}");

  lines.push("\\section*{Materials}");
  lines.push("\\begin{longtable}{p{4cm}p{2.5cm}p{3cm}p{2cm}p{2cm}}");
  lines.push("\\textbf{Reagent} & \\textbf{Catalog} & \\textbf{Supplier} & \\textbf{Qty} & \\textbf{Unit cost} \\\\ \\hline");
  plan.materials.forEach((m) => {
    lines.push(
      `${texEscape(m.name)} & ${texEscape(m.catalog_number)} & ${texEscape(m.supplier)} & ${texEscape(m.quantity)} & ${texEscape(formatUSD(m.unit_cost_usd))} \\\\`,
    );
  });
  lines.push("\\end{longtable}");

  lines.push("\\section*{Budget}");
  lines.push("\\begin{itemize}");
  plan.budget.forEach((b) => {
    lines.push(
      `  \\item \\textbf{${texEscape(b.category)}} -- ${texEscape(b.item)}: ${texEscape(formatUSD(b.amount_usd))}${b.notes ? ` (${texEscape(b.notes)})` : ""}`,
    );
  });
  lines.push("\\end{itemize}");
  const total = plan.budget.reduce((acc, b) => acc + (b.amount_usd ?? 0), 0);
  lines.push(`\\textbf{Total:} ${texEscape(formatUSD(total))}`);

  lines.push("\\section*{Timeline}");
  lines.push("\\begin{itemize}");
  plan.timeline.forEach((t) => {
    lines.push(
      `  \\item \\textbf{${texEscape(formatTimelineWeeks(t.start_week, t.end_week))} -- ${texEscape(t.phase)}:} ${texEscape(t.deliverable)}`,
    );
  });
  lines.push("\\end{itemize}");

  lines.push("\\section*{Validation}");
  lines.push("\\begin{itemize}");
  lines.push(`  \\item \\textbf{Primary endpoint:} ${texEscape(plan.validation.primary_endpoint)}`);
  lines.push(`  \\item \\textbf{Statistical approach:} ${texEscape(plan.validation.statistical_approach)}`);
  lines.push(`  \\item \\textbf{Decision criteria:} ${texEscape(plan.validation.decision_criteria)}`);
  plan.validation.risks?.forEach((r) => lines.push(`  \\item \\textit{Risk:} ${texEscape(r)}`));
  lines.push("\\end{itemize}");

  lines.push("\\end{document}");

  const blob = new Blob([lines.join("\n")], { type: "application/x-tex" });
  downloadBlob(blob, "experiment-plan.tex");
}
