"""Source-equipment agent — ported from the Lovable Supabase function.

For each piece of equipment in the request, return 1-3 local sources at MIT
and the wider Cambridge / Boston academic ecosystem, drawing on a curated
knowledge prompt. Response shape matches Lovable's `EquipmentSourcing[]`:

    [{equipment, sources: [{facility, location, access, url?, notes}]}, ...]
"""
from __future__ import annotations

from textwrap import dedent
from typing import Any

from .. import llm
from ..settings import settings


FACILITY_KNOWLEDGE = dedent(
    """
    Known core facilities and equipment access points in the Greater Boston / Cambridge academic ecosystem:

    MIT
    - MIT.nano (Building 12) — fabrication, characterization, electron & ion microscopy. Open to MIT and external academic users (fee-for-service).
    - MIT BioMicro Center — Illumina sequencing, qPCR, NanoDrop, BioAnalyzer. Open to MIT users primarily.
    - Koch Institute Swanson Biotechnology Center — flow cytometry, microscopy (Nikon spinning disc, multiphoton), histology, peptide synthesis. Open to all academics.
    - MIT Center for Materials Science and Engineering (CMSE) — XRD, TEM, SEM, surface analysis. Fee-for-service for external users.
    - MIT Whitehead Genome Technology Core — sequencing, genotyping. Whitehead/MIT users.
    - MIT Department of Biology — shared confocal microscopes (Nikon Ti2, Zeiss LSM 980).

    Harvard / HMS / Broad
    - Harvard Bauer Core Facility (FAS) — flow cytometry, sequencing, mass spec, microscopy. Open to academics.
    - HMS Microscopy Resources on the North Quad (MicRoN) — confocal, super-resolution. Open to academics.
    - Harvard Center for Biological Imaging (HCBI) — light + electron microscopy.
    - Broad Institute Genomics Platform — large-scale sequencing, single-cell. By collaboration / service request.

    BU / Northeastern / Tufts
    - BU Micro & Nano Imaging Facility — SEM, AFM, confocal.
    - BU Cellular Imaging Core — confocal, live-cell imaging.
    - Northeastern IDEA / Kostas Research Institute — fabrication and characterization.
    - Tufts CLIC — confocal & light microscopy.

    Commercial / regional
    - New England Biolabs (Ipswich) — enzymes, kits, sometimes will run service reactions.
    - Thermo Fisher Cambridge — local sales / demo equipment.
    - Addgene (Watertown) — plasmid distribution.
    - Boston BioProducts (Ashland) — buffers, reagents.
    - VWR / Fisher Boston warehouses — same-day common consumables.

    Boston-area shared equipment networks
    - Massachusetts Life Sciences Center "Shared Cores" — searchable directory of academic cores across MA.
    - HMS Research Cores — directory.

    Access policies vary: "Open to external academics" = standard fee-for-service with a recharge account; "MIT-only" = require MIT PI affiliation; "Fee-for-service" = external rate applies.
    """
).strip()


SOURCING_SYSTEM = (
    "You map scientific equipment requests to local sourcing options at MIT and the wider Cambridge / Boston "
    "academic ecosystem. Use ONLY the curated knowledge below; if no good fit exists, suggest the closest "
    'commercial supplier or "Massachusetts Life Sciences Center Shared Cores directory" as the source. Always '
    "prefer MIT facilities first, then Harvard/Broad, then other Boston-area academics, then commercial. For "
    "each piece of equipment, give 1-3 sources. Output strict JSON.\n\n" + FACILITY_KNOWLEDGE
)


SOURCING_SCHEMA = {
    "type": "object",
    "properties": {
        "sourcing": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "equipment": {"type": "string"},
                    "sources": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "facility": {"type": "string"},
                                "location": {"type": "string"},
                                "access": {"type": "string"},
                                "url": {"type": "string"},
                                "notes": {"type": "string"},
                            },
                            "required": ["facility", "location", "access", "notes"],
                        },
                    },
                },
                "required": ["equipment", "sources"],
            },
        },
    },
    "required": ["sourcing"],
}


def source_equipment(equipment: list[str]) -> dict[str, Any]:
    """Top-level entry. Returns {sourcing: [{equipment, sources: [...]}]}."""
    if not equipment:
        return {"sourcing": []}

    listing = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(equipment))
    prompt = f"Equipment list to source:\n{listing}"

    try:
        out = llm.generate_structured(
            prompt,
            response_schema=SOURCING_SCHEMA,
            system=SOURCING_SYSTEM,
            model=settings.GEMINI_MODEL_FLASH,
        )
    except Exception as e:
        # Mirror Lovable's behaviour: on hard failure, surface a 500-style error
        # but keep the response shape valid so the UI degrades gracefully.
        return {"sourcing": [], "error": str(e)[:300]}

    return {"sourcing": out.get("sourcing") or []}
