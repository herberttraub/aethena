"""Supplier-URL canonicalization.

Gemini hallucinates supplier URLs (wrong domains, made-up product paths) more
often than not. This module replaces the LLM's `supplier_url` with a known-good
URL when:
  - the supplier name maps to a known supplier in our table, AND
  - we have a deterministic URL template for that supplier's product/catalog
    page

If the URL the LLM produced doesn't match the canonical pattern for the
supplier, it gets rewritten. If we have no template for the supplier, we fall
back to the supplier's site search keyed on the catalog number — never a
broken direct link.

This applies in-place on a list of `Material` dicts (Repo B's plan.materials
shape) before the plan is returned to the client.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote


def _norm_supplier(s: str) -> str:
    return (s or "").strip().lower()


# (canonical_label, search_url_builder, direct_url_builder_or_None)
# direct builders take a catalog_no and return a URL; None means "no direct,
# always use the search builder".
_SUPPLIERS: list[tuple[list[str], str, str | None]] = [
    # Sigma-Aldrich / Merck
    (
        ["sigma-aldrich", "sigma aldrich", "sigma", "merck", "merck-millipore", "millipore-sigma"],
        "https://www.sigmaaldrich.com/US/en/search/{cat}?focus=products",
        "https://www.sigmaaldrich.com/US/en/search/{cat}?focus=products",
    ),
    # Thermo Fisher Scientific
    (
        ["thermo fisher", "thermo fisher scientific", "thermofisher", "thermo scientific", "invitrogen", "fisher scientific"],
        "https://www.thermofisher.com/search/results?query={cat}&persona=Catalog",
        "https://www.thermofisher.com/search/results?query={cat}&persona=Catalog",
    ),
    # New England Biolabs
    (
        ["neb", "new england biolabs"],
        "https://www.neb.com/en/search#q={cat}",
        "https://www.neb.com/en/search#q={cat}",
    ),
    # Promega
    (
        ["promega"],
        "https://www.promega.com/search-results/?searchKeyword={cat}",
        "https://www.promega.com/search-results/?searchKeyword={cat}",
    ),
    # Qiagen
    (
        ["qiagen"],
        "https://www.qiagen.com/us/search?q={cat}",
        "https://www.qiagen.com/us/search?q={cat}",
    ),
    # Bio-Rad
    (
        ["bio-rad", "bio rad", "biorad"],
        "https://www.bio-rad.com/en-us/search?q={cat}",
        "https://www.bio-rad.com/en-us/search?q={cat}",
    ),
    # IDT (Integrated DNA Technologies)
    (
        ["idt", "integrated dna technologies"],
        "https://www.idtdna.com/site/Search?searchTerm={cat}",
        "https://www.idtdna.com/site/Search?searchTerm={cat}",
    ),
    # ATCC
    (
        ["atcc"],
        "https://www.atcc.org/search#q={cat}",
        "https://www.atcc.org/products/{cat}",
    ),
    # Addgene
    (
        ["addgene"],
        "https://www.addgene.org/search/catalog/plasmids/?q={cat}",
        "https://www.addgene.org/{cat}/",
    ),
    # Corning / Falcon
    (
        ["corning", "falcon"],
        "https://ecatalog.corning.com/life-sciences/b2c/US/en/Search?q={cat}",
        "https://ecatalog.corning.com/life-sciences/b2c/US/en/Search?q={cat}",
    ),
    # VWR
    (
        ["vwr", "avantor"],
        "https://us.vwr.com/store/search?keyword={cat}",
        "https://us.vwr.com/store/search?keyword={cat}",
    ),
    # Eppendorf
    (
        ["eppendorf"],
        "https://www.eppendorf.com/us-en/eshop-products/?q={cat}",
        "https://www.eppendorf.com/us-en/eshop-products/?q={cat}",
    ),
    # R&D Systems / Bio-Techne
    (
        ["r&d systems", "bio-techne"],
        "https://www.rndsystems.com/search?keywords={cat}",
        "https://www.rndsystems.com/search?keywords={cat}",
    ),
    # Cell Signaling Technology
    (
        ["cell signaling", "cell signaling technology", "cst"],
        "https://www.cellsignal.com/browse/?Ntt={cat}",
        "https://www.cellsignal.com/browse/?Ntt={cat}",
    ),
    # Abcam
    (
        ["abcam"],
        "https://www.abcam.com/en-us/search?q={cat}",
        "https://www.abcam.com/en-us/search?q={cat}",
    ),
]


def _matches_supplier(supplier: str, aliases: list[str]) -> bool:
    s = _norm_supplier(supplier)
    return any(alias in s for alias in aliases)


def canonicalize_one(supplier: str, catalog_no: str, current_url: str) -> str:
    """Return a known-good URL for (supplier, catalog_no).

    Strategy:
    1. If the supplier is in our table, return the search URL keyed on
       catalog_no — that always works because supplier search pages all degrade
       gracefully to "no results" instead of 404'ing.
    2. If supplier isn't recognized but we have a real-looking https URL,
       keep it.
    3. Otherwise fall back to a Google search.
    """
    cat = (catalog_no or "").strip()
    sup = (supplier or "").strip()
    if not cat and not sup:
        return current_url or ""

    encoded = quote(cat or sup, safe="")

    for aliases, search_tpl, _direct_tpl in _SUPPLIERS:
        if _matches_supplier(sup, aliases):
            return search_tpl.format(cat=encoded)

    # Unknown supplier — only keep the LLM's URL if it's an https URL on a
    # plausible-looking host (not localhost / example.com / made-up paths).
    if current_url and current_url.startswith("https://") and "localhost" not in current_url:
        return current_url

    # Final fallback: a Google search that's almost always useful.
    q = quote(f"{sup} {cat}".strip(), safe="")
    return f"https://www.google.com/search?q={q}"


def canonicalize_materials(materials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """In-place fix supplier_url on each material dict."""
    for m in materials or []:
        m["supplier_url"] = canonicalize_one(
            m.get("supplier") or "",
            m.get("catalog_no") or "",
            m.get("supplier_url") or "",
        )
    return materials
