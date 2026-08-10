#!/usr/bin/env python3
"""Regenerate the Maskin blocks of documentation-rules.json from the fixture.

    python build-maskin-rules.py            # rewrite documentation-rules.json
    python build-maskin-rules.py --check    # exit 1 if the file is out of date

Owns four regions of documentation-rules.json and nothing else:

    scope_tags.MASKIN, scope_tags.TEMPLATE-10229
    evidence.E9 .. evidence.E13
    panel_types.maskin
    profiles.TEMPLATE-10229

Every geometry number is READ FROM reference_data/maskin-10229-sanitized.json at
run time, so the machine-readable contract cannot drift away from the fixture
the validator checks against. Prose - identity, scope wording, request classes,
QA steps - is literal here, because this script is the generator and editing the
generator is the sanctioned way to change generated output.

The role classification is imported from build-maskin-fixture.py rather than
restated, so there is exactly one definition of what "the MT suction group" is.

No network access. Reads and writes only inside the reference directory.
"""

from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"
FIXTURE_PATH = ROOT / "reference_data" / "maskin-10229-sanitized.json"


def _load_fixture_builder():
    spec = importlib.util.spec_from_file_location(
        "build_maskin_fixture", ROOT / "build-maskin-fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURE_BUILDER = _load_fixture_builder()
classify = FIXTURE_BUILDER.classify
ROLE_RULES = FIXTURE_BUILDER.ROLE_RULES
as_int = FIXTURE_BUILDER.as_int


# --------------------------------------------------------------------------
# Literal prose - the parts that are not measurements
# --------------------------------------------------------------------------

SCOPE_TAGS = {
    "MASKIN": (
        "Applies to Maskin / machine-room panels. Confirmed on the plant-10229 "
        "AK-PC 782A CO2 booster export (E9/E10) and consistent with the fleet "
        "survey in PANEL-TYPE-GUIDE.md. A rule tagged MASKIN that rests on E9 "
        "alone says so in its own evidence list."
    ),
    "TEMPLATE-10229": (
        "Geometry of one named Maskin template: the plant-10229 AK-PC 782A "
        "booster with 3 MT + 3 LT compressors, gas cooler, receiver and heat "
        "recovery, measured from E9 and committed sanitized as E10. Reproduce it "
        "when that template is the selected source. A different machine room "
        "legitimately differs - never promote a TEMPLATE-10229 coordinate to "
        "MASKIN without a second export."
    ),
}

EVIDENCE = {
    "E9": {
        "file": "iwmac-panel_10229_maskin_20260810-1033.json "
                "(user Downloads, plant 10229, NOT committed)",
        "committed": False,
        "sanitized": False,
        "panel": "Maskin",
        "generator": "IWDIE v1.7.0",
        "role": "The production export supplied with the 2026-08-10 Maskin "
                "documentation task. Highest-precedence source for Maskin "
                "geometry, object vocabulary, z-indexes, ordering, background "
                "fields, aliases and role coverage. Carries live plant bindings "
                "and is therefore not committed.",
    },
    "E10": {
        "file": "reference_data/maskin-10229-sanitized.json",
        "committed": True,
        "sanitized": True,
        "plant": "",
        "panel": "Maskin",
        "role": "E9 with its bindings replaced by the unlinked-demo contract and "
                "nothing else touched. Produced by build-maskin-fixture.py. "
                "Authoritative for TEMPLATE-10229 geometry; a demo, not a "
                "production export, for bindings.",
        "derived_from": "E9",
        "dropped": ["panel.image_svg_trace"],
    },
    "E11": {
        "file": "reference_data/generated-maskin-example.json",
        "committed": True,
        "sanitized": True,
        "panel": "Maskin",
        "role": "An AUTHORED demo: 63 objects on an AI-authored image_svg "
                "background, insert-verified, aliases taken from E12. Its "
                "coordinates were composed, not measured, and its zIndex is "
                "\"default\" throughout. Valid as a worked example of the "
                "unlinked-demo contract and of image_svg authoring. NOT a "
                "geometry source: where it disagrees with E9/E10, E9/E10 win.",
    },
    "E12": {
        "file": "reference_data/maskin-akpc-link-map.json",
        "committed": True,
        "role": "Alias to Danfoss AK-PC parameter map, 64/64 exact alias matches "
                "on a masked production panel, plus the relink recipe and the "
                "driver-id anatomy. This is why alias_text survives "
                "sanitization.",
    },
    "E13": {
        "file": "tests/fixtures/maskin-compressor-bank/",
        "committed": True,
        "sanitized": True,
        "role": "Miniature 96x64 instrumented fixture for the compressor-bank "
                "editing procedure: source panel, edited full panel, "
                "background-only patch and expectations. Its marker colours, "
                "canvas and (+24,0) pitch are test instrumentation, never "
                "production geometry.",
    },
}

IDENTITY = {
    "name": "Maskin / machine room",
    "owner_document": "MASKIN-GENERATION-CONTRACT.md",
    "description": "The machine-room overview of a CO2 booster refrigeration "
                   "pack: MT and LT compressor banks, gas cooler / condenser, "
                   "receiver, high-pressure and receiver valves, optional heat "
                   "recovery, and a right-hand status strip.",
    "controller": {
        "family": "Danfoss AK-PC pack controller",
        "measured_on_E9": "AK-PC 782A (V3_akpc_782A_suct suction strips, "
                          "V3_akpc_783_781A_782A_cond condenser strip)",
        "note": "The six compressor status strips on E9 use "
                "V3_akpc_772_781_781A_783_contr. Recorded as measured; do not "
                "infer a controller model from a strip id.",
    },
    "linking": "alias_text IS the Danfoss parameter name. Relink by EXACT alias "
               "match - never fuzzy, never positional. See evidence E12.",
}

BACKGROUND = {
    "ownership": "The background owns ALL artwork: enclosure, pipes, equipment "
                 "symbols, valves, static labels, the empty value pills and the "
                 "grey information panel. Dynamic objects own live values, "
                 "status strips, LEDs and pumps, and nothing else.",
    "never": "Never bake a live number, state or colour into the background, and "
             "never draw a value box in artwork that a dynamic object will also "
             "render.",
    "family": "Advansor-style CO2 booster drawing on the light skin. "
              "reference_data/maskin-drawing-method.txt is the artwork doctrine; "
              "reference_data/maskin-light-style-reference.png is the canonical "
              "look. Never draw a Maskin on a dark background.",
    "fields": {
        "converted": "\"true\" plus panel.image_data (a data: URI) is how a "
                     "raster background travels in an export",
        "image_svg": "AI-authored vector background. Validated by "
                     "iwdieValidateSvg and converted by iwdieSvgToDataUrl on "
                     "insert.",
        "image_svg_trace": "WRITTEN BY EXPORT, NEVER BY A GENERATOR. It is an "
                           "automatic vector trace of the raster background, "
                           "supplied to an AI as input, and the insert path "
                           "deletes it. Emitting it is a defect.",
        "priority_on_insert": ["a background file picked in the dialog",
                               "panel.image_svg", "panel.image_data"],
    },
}

BINDINGS = {
    "production_export": {
        "id": "driver_id (host literal on every object)",
        "link_name": "link_name (host literal on every object)",
        "driver_id": "<plant>_<controller path>_<parameter>_<index>, or empty on "
                     "an object the designer never linked",
        "linked": "\"true\" whenever driver_id is not the literal placeholder - "
                  "INCLUDING when driver_id is empty. That is host behaviour "
                  "(V3scripts.js), not a defect.",
        "unit_id": "the AK-PC unit address, identical across the pack",
    },
    "demo": "global_invariants.unlinked_demo_contract, unchanged.",
    "mode_discriminator": "The literal string \"driver_id\" in driver_id. A "
                          "generated demo emits it on every object; a production "
                          "export never does - an unlinked production object "
                          "carries an EMPTY driver_id.",
}

SANITIZATION = {
    "replace": {
        "envelope.source_plant_id": "",
        "panel.plant_id": "",
        "panel.saved_by": "",
        "panel.org_image_name": "",
        "panel.image_name": "",
        "object.id": "driver_id",
        "object.driver_id": "driver_id",
        "object.linked": "false",
        "object.link_name": "",
        "object.link_tag": "",
        "object.unit_id": "",
        "object.unit_ref": "",
        "object.sub_group": "",
    },
    "preserve": ["obj_id", "name", "posLeft", "posTop", "posWidth", "posHeight",
                 "zIndex", "tag_text", "alias_text", "array order",
                 "panel.image_data", "panel.converted", "panel.panel_width",
                 "panel.panel_height"],
    "drop": ["panel.image_svg_trace"],
    "why_alias_survives": "alias_text is the selector a human relinks by "
                          "(evidence E12). Stripping it makes the fixture "
                          "unrelinkable and destroys the role inventory.",
    "generator": "build-maskin-fixture.py",
}

REQUEST_CLASSES = {
    "new_unlinked_demo": {
        "output": "a full panel document with the unlinked-demo contract on "
                  "every object",
        "background": "author image_svg, or state that the background is "
                      "supplied separately",
        "insert": "empty canvas only - Insert JSON appends",
    },
    "linked_copy": {
        "output": "a full panel document keeping every supplied binding, with "
                  "the driver-id plant prefix rewritten to the target plant",
        "background": "carry panel.image_data through unchanged",
        "insert": "empty canvas only",
        "never": "Never invent a driver id, unit id or plant id. If the target "
                 "plant's prefix was not supplied, stop and ask.",
    },
    "modify_supplied_export": {
        "output": "the ENTIRE supplied document, with only the requested "
                  "objects changed or appended",
        "rule": "The supplied panel is the whole geometric template. Every "
                "untouched object keeps every field byte-for-byte.",
        "insert": "empty canvas only - inserting a full document onto a "
                  "populated canvas duplicates every object",
    },
    "background_only_patch": {
        "output": "panel.image_data (or image_svg) changed; counts all zero; "
                  "single_objects, containers and graphics all empty",
        "rule": "This is the correct answer whenever the target canvas already "
                "carries its objects and only the artwork changes.",
    },
}

QA = {
    "checklist_file": "MASKIN-QA-CHECKLIST.md",
    "stages": ["A structural", "B geometry", "C visual",
               "D linking/sanitization", "E import/save"],
    "checks": [
        "Reparse the emitted JSON.",
        "counts equals each array length.",
        "All 17 object fields present on every object.",
        "Names sequential object_0..object_N unless a preserved source dictates "
        "otherwise.",
        "Every obj_id present in reference_data/all-design-objects.json.",
        "No live plant id, driver id, unit id, link target or saved_by identity "
        "in anything committed.",
        "Geometry, sizes, zIndex, aliases and ordering match the source unless "
        "a documented rule changes them.",
        "Render at 1400x750 with the real background AND the dynamic-object "
        "overlay; inspect MT bank, LT bank, gas cooler, heat recovery, "
        "receiver/valves and the right-hand status strip.",
        "Compare by role key (obj_id + alias_text + tag_text), never by array "
        "index.",
        "python validate-maskin-panel.py PANEL.json [--profile TEMPLATE-10229]",
        "python -m unittest tests.test_maskin_10229_contract",
    ],
    "render_crops": "Derived, not listed. render-maskin-panel.py computes one "
                    "crop per entry in panel_types.maskin.roles from the role's "
                    "own object bounding box, so the crops cannot drift from "
                    "the role inventory. Do not hand-place them here.",
    "test_command_note": "The repo convention is per-module. "
                         "`python -m unittest discover -s tests` fails with "
                         "ImportError: Start directory is not importable, "
                         "because tests/ has no __init__.py.",
    "on_failure": "Restart from the retained source export or the sanitized "
                  "fixture. Do not stack compensating edits on an already "
                  "damaged derivative.",
}

EVIDENCE_REQUIRED = [
    "A second Maskin production export from a different plant, to separate "
    "MASKIN from TEMPLATE-10229. Every geometry rule here currently rests on E9 "
    "alone.",
    "A Maskin panel with 4 or more compressors per suction group, to confirm "
    "that the compressor pitch continues at ~80 px.",
    "A Maskin panel whose LT bank has a VSD compressor other than C1, to "
    "confirm that the VSD row is a per-compressor property and not a "
    "C1-only convention.",
    "Whether the two objects sharing driver_id ~206_7 on E9 are intentional or "
    "a leftover. Recorded as an anomaly, not corrected.",
]

# The alias markers that mark a setpoint / reference pill rather than a
# measurement. Data, not code, because it is a naming heuristic measured on one
# export - see panel_types.maskin.setpoint_pill.severity.
SETPOINT_ALIAS_MARKERS = ["reference", "ref.", "consumer request", "ctrl."]


# --------------------------------------------------------------------------
# Generated from the fixture
# --------------------------------------------------------------------------

def load_objects():
    document = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    envelope = document["envelope"]
    return envelope, envelope["panel"]["single_objects"]


def geometry_of(obj):
    return {
        "name": obj["name"],
        "obj_id": obj["obj_id"],
        "alias_text": obj["alias_text"],
        "tag_text": obj["tag_text"],
        "left": as_int(obj["posLeft"]),
        "top": as_int(obj["posTop"]),
        "width": as_int(obj["posWidth"]),
        "height": as_int(obj["posHeight"]),
        "zIndex": str(obj["zIndex"]),
    }


def build_vocabulary(objects):
    sizes = collections.defaultdict(set)
    zs = collections.defaultdict(set)
    for obj in objects:
        sizes[obj["obj_id"]].add((as_int(obj["posWidth"]), as_int(obj["posHeight"])))
        zs[obj["obj_id"]].add(str(obj["zIndex"]))
    counts = collections.Counter(o["obj_id"] for o in objects)
    return {
        obj_id: {
            "count_E10": count,
            "sizes": [f"{w}x{h}" for w, h in sorted(sizes[obj_id])],
            "z_bands": sorted(zs[obj_id]),
        }
        for obj_id, count in counts.most_common()
    }


def build_z_bands(objects):
    bands = {}
    grouped = collections.defaultdict(list)
    for obj in objects:
        grouped[str(obj["zIndex"])].append(obj)
    for z in sorted(grouped, key=lambda v: as_int(v) or 0):
        members = grouped[z]
        bands[z] = {
            "count_E10": len(members),
            "obj_ids": sorted({o["obj_id"] for o in members}),
        }
    return bands


def build_roles(objects):
    buckets = collections.defaultdict(list)
    for obj in objects:
        hits = classify(obj["alias_text"])
        buckets[hits[0] if len(hits) == 1 else "UNCLASSIFIED"].append(obj)
    if "UNCLASSIFIED" in buckets:
        raise SystemExit("role rules do not classify every alias exactly once: "
                         f"{[o['alias_text'] for o in buckets['UNCLASSIFIED']]}")
    return {
        role: {
            "count_E10": len(buckets[role]),
            "aliases": [o["alias_text"] for o in sorted(
                buckets[role], key=lambda o: (as_int(o["posTop"]), as_int(o["posLeft"])))],
        }
        for role, _ in ROLE_RULES if buckets.get(role)
    }


def build_compressor_columns(objects):
    index = {o["alias_text"]: o for o in objects}
    columns = {}
    for side in ("MT", "LT"):
        rows = {}
        for row, suffix in (("status", "status"), ("capacity", "capacity"),
                            ("runtime", "Runtime total"), ("vsd", "VSD 1 speed")):
            cells = []
            for n in (1, 2, 3, 4, 5, 6):
                hit = index.get(f"C{n} {side} {suffix}")
                if hit:
                    cells.append({"compressor": n,
                                  "obj_id": hit["obj_id"],
                                  "left": as_int(hit["posLeft"]),
                                  "top": as_int(hit["posTop"]),
                                  "zIndex": str(hit["zIndex"])})
            if not cells:
                continue
            pitches = [(b["left"] - a["left"], b["top"] - a["top"])
                       for a, b in zip(cells, cells[1:])]
            rows[row] = {"cells": cells,
                         "pitch": [list(p) for p in pitches]}
        columns[side] = rows
    return columns


def build_role_translations(objects):
    """MT -> LT displacement per role key. Excludes the duplicated alias: two
    objects share it, so 'the' MT position is not defined."""
    duplicated = {a for a, n in collections.Counter(
        o["alias_text"] for o in objects).items() if n > 1}
    index = {o["alias_text"]: o for o in objects if o["alias_text"] not in duplicated}
    out = {}
    for alias, obj in index.items():
        if "MT" not in alias:
            continue
        other = index.get(alias.replace("MT", "LT"))
        if not other:
            continue
        out[alias] = {
            "to": alias.replace("MT", "LT"),
            "delta": [as_int(other["posLeft"]) - as_int(obj["posLeft"]),
                      as_int(other["posTop"]) - as_int(obj["posTop"])],
        }
    return dict(sorted(out.items()))


def build_anomalies(objects):
    out = []
    for obj in objects:
        if obj["tag_text"] not in ("", None):
            out.append({
                "object": obj["name"], "alias": obj["alias_text"],
                "finding": f"tag_text is {obj['tag_text']!r} (a single space), "
                           "not empty",
                "treatment": "preserved verbatim in E10; do not normalise it "
                             "away when copying this template",
            })
    counts = collections.Counter(o["alias_text"] for o in objects)
    for alias, count in counts.items():
        if count > 1:
            members = [o for o in objects if o["alias_text"] == alias]
            out.append({
                "object": [o["name"] for o in members],
                "alias": alias,
                "finding": f"{count} objects share this alias at "
                           + " and ".join(f"({as_int(o['posLeft'])},{as_int(o['posTop'])})"
                                          for o in members)
                           + ", and in E9 they shared one driver id",
                "treatment": "preserved in E10 and reported as a WARNING by the "
                             "validator. Whether it is intentional is open "
                             "evidence - do not silently delete one.",
            })
    return out


def build_absent_by_design(objects):
    aliases = {o["alias_text"] for o in objects}
    absent = [f"C{n} {side} VSD 1 speed"
              for side in ("MT", "LT") for n in (2, 3)
              if f"C{n} {side} VSD 1 speed" not in aliases]
    return {
        "roles": absent,
        "why": "On E9 only C1 carries a VSD row, on each suction group. C2 and "
               "C3 are fixed-speed: status, capacity and runtime only. Cloning "
               "C1 to make a C4 imports a VSD row the machine does not have.",
    }


def build_maskin_panel_type(envelope, objects):
    return {
        "identity": IDENTITY,
        "owner_document": "MASKIN-GENERATION-CONTRACT.md",
        "canvas": {
            "width": as_int(envelope["panel"]["panel_width"]),
            "height": as_int(envelope["panel"]["panel_height"]),
            "scope": "MASKIN",
            "evidence": ["E9", "E10"],
            "override": "Match the plant if a supplied export says otherwise.",
        },
        "background": BACKGROUND,
        "composition": {
            "single_objects": len(objects),
            "containers": len(envelope["panel"].get("containers") or []),
            "graphics": len(envelope["panel"].get("graphics") or []),
            "distinct_obj_ids": len({o["obj_id"] for o in objects}),
            "scope": "TEMPLATE-10229",
            "evidence": ["E9", "E10"],
            "note": "Fleet median is 59 objects across 39 Maskin panels "
                    "(PANEL-TYPE-GUIDE.md). 66 is this template, not a target.",
        },
        "z_indexes": {
            "mode": "explicit bands OR the literal string \"default\" - never "
                    "mixed in one panel",
            "bands": build_z_bands(objects),
            "scope": "MASKIN",
            "evidence": ["E9", "E10"],
            "conflict": "These are NOT the Ventilasjon bands. On a vent panel "
                        "110 is value/setpoint boxes and 1100 is labels; on "
                        "Maskin E9, 1100 is the value pills and 110 is the two "
                        "json/no-conn boxes. The bands are per panel type. "
                        "Never carry a vent band onto a Maskin panel.",
            "default_mode_note": "\"default\" is legal - the userscript fills it "
                                 "in when zIndex is missing - but then array "
                                 "order IS stacking order. E9 uses explicit "
                                 "bands, so on E9 array order does not affect "
                                 "stacking.",
        },
        "object_vocabulary": build_vocabulary(objects),
        "roles": build_roles(objects),
        "setpoint_pill": {
            "rule": "number_v3_white_value_only is the setpoint / reference "
                    "pill; number_v3_value_only is the measurement pill.",
            "alias_markers": SETPOINT_ALIAS_MARKERS,
            "evidence": ["E9", "E10"],
            "measured": "7 of 7 white pills carry a marker; 0 of 59 measurement "
                        "pills do. 'Requested cap. MT/LT' and 'Cond. requested "
                        "cap.' are measurements despite the word 'requested' - "
                        "which is why the marker is 'consumer request', not "
                        "'request'.",
            "severity": "warning",
            "scope": "MASKIN",
        },
        "compressor_columns": {
            "measured": build_compressor_columns(objects),
            "scope": "TEMPLATE-10229",
            "evidence": ["E9", "E10"],
            "rule": "A compressor column is an atomic cluster: status strip, "
                    "capacity pill, runtime pill, and a VSD pill only where the "
                    "machine has one. Clone the whole column with ONE "
                    "translation vector; never copy the status strip alone.",
            "pitch_note": "Measured centre pitch is 79-82 px in x with a 0-1 px "
                          "y jitter that is in the source. Do not average it to "
                          "a round number and do not 'correct' the jitter when "
                          "reproducing this template.",
        },
        "role_translations_mt_to_lt": {
            "measured": build_role_translations(objects),
            "scope": "TEMPLATE-10229",
            "evidence": ["E9", "E10"],
            "note": "The compressor rows translate by about (0,+325). The "
                    "suction-group readouts do NOT share one vector - Sd, Ss, "
                    "Superheat and the suction references each move differently "
                    "because the LT circuit is drawn elsewhere on the artwork. "
                    "There is no single MT->LT vector for the panel.",
        },
        "absent_by_design": build_absent_by_design(objects),
        "anomalies": build_anomalies(objects),
        "bindings": BINDINGS,
        "sanitization": SANITIZATION,
        "request_classes": REQUEST_CLASSES,
        "insert_semantics": "Insert JSON APPENDS to the live canvas - it never "
                            "clears it, and it renames every inserted object "
                            "from the canvas child index. A full panel document "
                            "belongs on an EMPTY canvas unless duplication is "
                            "intended.",
        "required_roles": {
            "rule": "A Maskin panel that claims a suction group must carry that "
                    "group's readouts, and a compressor that exists must carry "
                    "status, capacity and runtime.",
            "per_suction_group": ["Control status", "Running capacity",
                                  "Requested cap.", "Suction temp. To-",
                                  "Suction ref. To-", "Superheat", "Ss-", "Sd-"],
            "per_compressor": ["status", "capacity", "Runtime total"],
            "per_compressor_optional": ["VSD 1 speed"],
            "scope": "TEMPLATE-10229",
            "evidence": ["E9", "E10"],
        },
        "qa": QA,
        "evidence_required": EVIDENCE_REQUIRED,
    }


def build_template_profile(envelope, objects):
    return {
        "title": "Plant-10229 AK-PC 782A CO2 booster machine room",
        "scope": "TEMPLATE-10229",
        "evidence": ["E9", "E10"],
        "derived_from": "reference_data/maskin-10229-sanitized.json, generated "
                        "by build-maskin-rules.py",
        "panel_type": "maskin",
        "canvas": [as_int(envelope["panel"]["panel_width"]),
                   as_int(envelope["panel"]["panel_height"])],
        "object_count": len(objects),
        "distinct_obj_ids": len({o["obj_id"] for o in objects}),
        "background": {
            "converted": envelope["panel"].get("converted"),
            "image_data_chars": len(envelope["panel"].get("image_data") or ""),
            "image_svg": False,
            "note": "The raster background travels with the fixture. It is the "
                    "artwork every coordinate below was measured against; "
                    "rendering the objects without it proves nothing.",
        },
        "applies_when": "The task supplies this template, names TEMPLATE-10229, "
                        "or asks for a copy of the 10229 machine room. It does "
                        "NOT apply to an arbitrary Maskin panel.",
        "objects": [geometry_of(o) for o in objects],
        "compressor_columns": build_compressor_columns(objects),
        "role_translations_mt_to_lt": build_role_translations(objects),
        "absent_by_design": build_absent_by_design(objects),
        "anomalies": build_anomalies(objects),
    }


# --------------------------------------------------------------------------

def apply(rules):
    envelope, objects = load_objects()

    rules["scope_tags"].update(SCOPE_TAGS)
    rules["evidence"].update(EVIDENCE)

    for entry in rules["source_precedence"]:
        if entry.get("rank") == 3:
            entry["source"] = (
                "The measured geometry contract for the panel type, "
                "scope-tagged: VENTILATION-GEOMETRY-CONTRACT.md for vent "
                "panels, LIST-PANEL-GENERATION-CONTRACT.md for list panels, "
                "MASKIN-GENERATION-CONTRACT.md for Maskin panels")

    rules["panel_types"]["maskin"] = build_maskin_panel_type(envelope, objects)
    rules["profiles"]["TEMPLATE-10229"] = build_template_profile(envelope, objects)
    return rules


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if documentation-rules.json is out of date")
    args = parser.parse_args(argv)

    current = RULES_PATH.read_text(encoding="utf-8")
    rules = apply(json.loads(current))
    updated = json.dumps(rules, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        if updated != current:
            print("documentation-rules.json is out of date; run "
                  "build-maskin-rules.py", file=sys.stderr)
            return 1
        print("documentation-rules.json is up to date")
        return 0

    RULES_PATH.write_text(updated, encoding="utf-8")
    print(f"wrote {RULES_PATH} - panel_types.maskin and profiles.TEMPLATE-10229 "
          f"regenerated from {len(objects_count(rules))} fixture objects")
    return 0


def objects_count(rules):
    return rules["profiles"]["TEMPLATE-10229"]["objects"]


if __name__ == "__main__":
    sys.exit(main())
