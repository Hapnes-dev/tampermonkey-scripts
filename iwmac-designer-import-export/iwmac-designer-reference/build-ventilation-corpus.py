#!/usr/bin/env python3
"""Build a sanitized, deterministic ventilation-panel corpus."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any


VENTILATION_WORDS = re.compile(
    r"(?:(?<=\d)|\b)(?:ventilasjon|ventilation)\b"
)


def normalize_text(value: object) -> str:
    """Return NFKC-normalized, case-folded text with collapsed whitespace."""

    text = unicodedata.normalize("NFKC", "" if value is None else str(value))
    return " ".join(text.casefold().split())


def is_ventilation_name(value: object) -> bool:
    """Match the approved whole-word Norwegian or English ventilation terms."""

    return bool(VENTILATION_WORDS.search(normalize_text(value)))


def _error_summary(value: object, limit: int = 200) -> str | None:
    if value is None:
        return None
    summary = " ".join(str(value).split())
    return summary[:limit] or None


def _list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _joined_panel_units(
    panel: dict[str, Any], unit_rows: list[Any]
) -> tuple[list[str], list[str]]:
    """Return sorted panel-local IDs and exact same-plant inventory joins."""

    unit_ids = sorted(
        {
            value
            for value in _list(panel.get("unit_ids"))
            if isinstance(value, str) and value
        }
    )
    unit_names: list[str] = []
    seen_names: set[str] = set()
    for unit_id in unit_ids:
        for row in unit_rows:
            if not isinstance(row, dict) or row.get("unit_id") != unit_id:
                continue
            unit_name = row.get("unit_name")
            if (
                not isinstance(unit_name, str)
                or not unit_name.strip()
                or unit_name in seen_names
            ):
                continue
            seen_names.add(unit_name)
            unit_names.append(unit_name)
    return unit_ids, unit_names


def _panel_record(
    plant_id: str,
    plant_name: object,
    fleet: object,
    panel: dict[str, Any],
    discovery_reason: str,
    unit_ids: list[str],
    unit_names: list[str],
) -> dict[str, Any]:
    """Project one matched source panel through the public allowlist."""

    return {
        "plant_id": plant_id,
        "plant_name": plant_name,
        "fleet": fleet,
        "panel_id": panel.get("id"),
        "panel_name": panel.get("name"),
        "discovery_reason": discovery_reason,
        "source_format": panel.get("source_format"),
        "visibility": "visible" if panel.get("visible") == "1" else "hidden",
        "width": panel.get("w"),
        "height": panel.get("h"),
        "objects": panel.get("n_obj"),
        "containers": panel.get("n_cont"),
        "graphics": panel.get("n_graph"),
        "total_items": panel.get("n_items_total"),
        "linked_objects": panel.get("n_linked"),
        "v2_objects": panel.get("n_v2"),
        "max_x": panel.get("max_x"),
        "max_y": panel.get("max_y"),
        "census": _dict(panel.get("census")),
        "has_background": panel.get("has_bg"),
        "background_name": panel.get("org_image"),
        "background_kb": panel.get("bg_kb"),
        "separator": panel.get("separator"),
        "unit_ids": unit_ids,
        "unit_names": unit_names,
        "fetch_error": _error_summary(panel.get("fetch_error"), 120),
    }


def _canonical_examples() -> dict[str, dict[str, Any]]:
    return {
        "production": {
            "classification": "production",
            "plant_id": "9099",
            "panel_name": "360.001 Ventilasjon",
            "width": 1400,
            "height": 750,
            "objects": 102,
            "linked_objects": 57,
            "unit_ids": ["V01"],
            "unit_names": ["360.001Ventilasjon"],
            "v2_objects": 0,
            "containers": 0,
            "graphics": 0,
            "max_x": 1400,
            "max_y": 623,
            "background": "blank/sidebar PNG",
            "background_kb_approx": 6,
            "outside_batch": True,
        },
        "generated_demo": {
            "classification": "generated_demo",
            "name": "ventilation_demo_360001.json",
            "objects": 45,
            "linked_objects": 0,
            "background": "SVG",
            "production_bindings": False,
            "included_in_production_totals": False,
            "present_in_repository": False,
            "provenance": (
                "session artifact in the user's Downloads folder, 2026-08-08; "
                "never committed to this repository and not retrievable from it"
            ),
            "violates_background_contract": True,
            "why_recorded": (
                "kept as a named counter-example: an authored image_svg background "
                "and 45 unlinked objects are what a Ventilasjon panel must not be"
            ),
        },
    }


def build_corpus(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate a 20-plant survey and build its sanitized focused corpus."""

    if not isinstance(raw, dict):
        raise ValueError("raw survey must be an object")

    batch = _dict(raw.get("batch"))
    if type(batch.get("requested")) is not int or batch["requested"] != 20:
        raise ValueError("batch.requested must be the integer 20")

    plant_ids = batch.get("plant_ids")
    if (
        not isinstance(plant_ids, list)
        or len(plant_ids) != 20
        or any(not isinstance(plant_id, str) for plant_id in plant_ids)
        or len(set(plant_ids)) != 20
    ):
        raise ValueError("batch.plant_ids must contain exactly 20 unique string IDs")

    plants_by_id = raw.get("plants")
    if not isinstance(plants_by_id, dict):
        raise ValueError("plants must be an object")
    expected_plant_ids = set(plant_ids)
    actual_plant_ids = set(plants_by_id)
    if actual_plant_ids != expected_plant_ids:
        missing = sorted(expected_plant_ids - actual_plant_ids)
        extra = sorted(str(value) for value in actual_plant_ids - expected_plant_ids)
        raise ValueError(
            "plants keys must exactly match batch.plant_ids "
            f"(missing={missing}, extra={extra})"
        )

    fleet = raw.get("fleet")
    coverage: list[dict[str, Any]] = []
    matched_panels: list[dict[str, Any]] = []

    for plant_id in plant_ids:
        plant = plants_by_id[plant_id]
        if not isinstance(plant, dict):
            raise ValueError(f"plant {plant_id} must be an object")

        source_panels = _list(plant.get("panels"))
        unit_rows = _list(plant.get("units"))
        plant_matches: list[dict[str, Any]] = []
        panel_errors: list[dict[str, Any]] = []

        for source_panel in source_panels:
            if not isinstance(source_panel, dict):
                continue
            panel_error = _error_summary(source_panel.get("fetch_error"), 120)
            if panel_error:
                panel_errors.append(
                    {
                        "panel_id": source_panel.get("id"),
                        "panel_name": source_panel.get("name"),
                        "error": panel_error,
                    }
                )
                continue

            unit_ids, unit_names = _joined_panel_units(source_panel, unit_rows)
            panel_match = is_ventilation_name(source_panel.get("name"))
            unit_match = any(
                is_ventilation_name(unit_name)
                for unit_name in unit_names
            )
            if not panel_match and not unit_match:
                continue

            if panel_match and unit_match:
                reason = "both"
            elif panel_match:
                reason = "panel_name"
            else:
                reason = "unit_name"

            record = _panel_record(
                plant_id,
                plant.get("name"),
                fleet,
                source_panel,
                reason,
                unit_ids,
                unit_names,
            )
            plant_matches.append(record)
            matched_panels.append(record)

        plant_error = _error_summary(plant.get("error"))
        unit_error = _error_summary(plant.get("unit_error"))
        if plant_error and not source_panels:
            outcome = "failed"
        elif plant_error or unit_error or panel_errors:
            outcome = "partial"
        elif plant_matches:
            outcome = "matched"
        else:
            outcome = "zero_match"

        coverage.append(
            {
                "plant_id": plant_id,
                "plant_name": plant.get("name"),
                "outcome": outcome,
                "surveyed_panels": len(source_panels),
                "matched_panels": len(plant_matches),
                "error": plant_error,
                "unit_error": unit_error,
                "panel_errors": panel_errors,
            }
        )

    outcomes = [plant["outcome"] for plant in coverage]
    summary = {
        "attempted_plants": len(coverage),
        "successful_plants": sum(outcome != "failed" for outcome in outcomes),
        "failed_plants": outcomes.count("failed"),
        "partial_plants": outcomes.count("partial"),
        "zero_match_plants": outcomes.count("zero_match"),
        "matched_plants": sum(plant["matched_panels"] > 0 for plant in coverage),
        "matched_panels": len(matched_panels),
        "json_panels": sum(
            panel["source_format"] == "json" for panel in matched_panels
        ),
        "xml_only_panels": sum(
            panel["source_format"] == "xml_only" for panel in matched_panels
        ),
        "visible_panels": sum(
            panel["visibility"] == "visible" for panel in matched_panels
        ),
        "hidden_panels": sum(
            panel["visibility"] == "hidden" for panel in matched_panels
        ),
        "v2_bearing_panels": sum(
            isinstance(panel["v2_objects"], (int, float))
            and panel["v2_objects"] > 0
            for panel in matched_panels
        ),
    }

    return {
        "schema_version": 1,
        "generated_from": "plant-panel-survey-meny-20.json",
        "survey_date": raw.get("survey_date"),
        "fleet": fleet,
        "batch": {
            "requested": batch.get("requested"),
            "plant_ids": list(plant_ids),
        },
        "summary": summary,
        "plants": coverage,
        "panels": matched_panels,
        "canonical_examples": _canonical_examples(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a sanitized ventilation corpus from a 20-plant survey."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    raw = json.loads(args.input.read_text(encoding="utf-8"))
    corpus = build_corpus(raw)
    args.output.write_text(
        json.dumps(corpus, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
