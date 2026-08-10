#!/usr/bin/env python3
"""Regenerate the Romkontroll-table regions of documentation-rules.json.

Owns five regions of documentation-rules.json and nothing else:

    scope_tags.ROMKONTROLL
    scope_tags.TEMPLATE-8653-ROMKONTROLL
    evidence.E18 .. evidence.E21
    panel_types.romkontroll_table
    profiles.TEMPLATE-8653-ROMKONTROLL

Every geometric number is read from reference_data/romkontroll-8653-sanitized.json
at run time, through the same helpers build-romkontroll-fixture.py uses to write
it. There is therefore one definition of the table geometry in the repository,
and the machine-readable contract cannot drift from the fixture it describes.

The prose is literal in this generator rather than in the JSON, because editing
the generator is the sanctioned way to change generated output -
documentation-rules.json is never hand-edited (AI-BRIEFING.txt, "the
machine-readable twin").

No network access. Reads and writes only inside the reference directory.

    python build-romkontroll-rules.py            # rewrite the three regions
    python build-romkontroll-rules.py --check    # exit 1 if out of date
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
FIXTURE_PATH = ROOT / "reference_data" / "romkontroll-8653-sanitized.json"
PROFILE = "TEMPLATE-8653-ROMKONTROLL"
PANEL_TYPE = "romkontroll_table"


def _load_fixture_builder():
    spec = importlib.util.spec_from_file_location(
        "build_romkontroll_fixture", ROOT / "build-romkontroll-fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURE_BUILDER = _load_fixture_builder()
envelope_of = FIXTURE_BUILDER.envelope_of
as_int = FIXTURE_BUILDER.as_int
the_container = FIXTURE_BUILDER.the_container
table_geometry = FIXTURE_BUILDER.table_geometry
column_of = FIXTURE_BUILDER.column_of
row_of = FIXTURE_BUILDER.row_of
room_labels = FIXTURE_BUILDER.room_labels
CELL_HEADER = FIXTURE_BUILDER.CELL_HEADER
CELL_BODY = FIXTURE_BUILDER.CELL_BODY
VALUE_OBJ = FIXTURE_BUILDER.VALUE_OBJ
ALARM_OBJ = FIXTURE_BUILDER.ALARM_OBJ


# --------------------------------------------------------------------------
# Literal prose - the normative text this generator owns
# --------------------------------------------------------------------------

SCOPE_TAGS = {
    "ROMKONTROLL": (
        "Applies to the room-control TABLE panel type - one wide scrolling "
        "table with one row per room and one column per parameter, built from "
        "a single table_container whose items draw the grid while canvas "
        "single_objects carry the live values. Measured on the plant-8653 "
        "production export (E18/E19). Does NOT apply to the Romkontroll FLOOR "
        "PLAN of a hotel panel set (AI-BRIEFING.txt 7d), which is a spatial "
        "panel of rc_box room cards with no container at all, and does NOT "
        "apply to the spjeldliste list panel, which builds one container per "
        "row (LIST-PANEL-GENERATION-CONTRACT.md). The three share the words "
        "'room control' or 'list' and nothing structural."
    ),
    PROFILE: (
        "Geometry, column set and room set of ONE named room-control table: "
        "the plant-8653 hotel, 34 columns x 50 rooms over 8 floors, 1553 canvas "
        "objects and 1802 container items. Reproduce it when repairing or "
        "copying THAT panel. Never treat its counts as a target for another "
        "building - a building has as many rows as it has room controllers and "
        "as many columns as its controllers share."
    ),
}


IDENTITY = {
    "name": "Romkontroll table (Tabell romkontroll alle plan)",
    "aliases": [
        "tabell romkontroll alle plan", "romkontroll alle plan",
        "room control table", "room-control table", "all floors table",
        "tabell romkontroll", "romkontrolltabell",
    ],
    "one_line": (
        "One panel per building: every room controller as a row, every shared "
        "parameter as a column, live values read straight off the grid."
    ),
    "classification_test": [
        "Exactly one container, container_type table_container.",
        "The container's items draw the grid and carry no bindings.",
        "The canvas single_objects carry the bindings, one per populated cell.",
        "One row per room; the room number is a container item, not an object.",
        "Content is far wider and taller than the declared canvas.",
    ],
    "not_this_panel_type": {
        "romkontroll_floor_plan": (
            "Room cards (rc_box) placed on a floor drawing, one panel per "
            "floor, no container. AI-BRIEFING.txt 7d."
        ),
        "spjeldliste": (
            "One container_c per table row, 208 of them. "
            "LIST-PANEL-GENERATION-CONTRACT.md. Its 'one container per row' "
            "rule is false for this panel type - conflict RC-C1."
        ),
        "data_file": (
            "A JSON description of the rooms and their parameters is not a "
            "panel document. That is rejected generation 13.1."
        ),
    },
}


OUTPUT_MODES = {
    "A_data_only": {
        "produce_when": (
            "The user explicitly asked for extracted data, an API payload or a "
            "data table."
        ),
        "shape": "any custom structure - it is not a panel document",
    },
    "B_unlinked_template": {
        "produce_when": (
            "The user explicitly asked for a reusable template or unlinked "
            "skeleton, OR no binding data exists for the plant."
        ),
        "shape": (
            "The COMPLETE panel - same columns, same rows, same object types, "
            "same geometry - with driver_id the literal 'driver_id', linked "
            "'false', unit_id ''. A skeleton that also drops the container and "
            "the value objects is not mode B; it is rejected generation 13.2."
        ),
        "placeholders_legal": True,
    },
    "C_linked_panel": {
        "produce_when": (
            "Binding data exists. THIS IS THE DEFAULT whenever a plant "
            "parameter export is attached."
        ),
        "shape": (
            "Every driver_id, unit_id and alias_text copied verbatim from the "
            "iw_gen_driver_parameters dump. No placeholder anywhere. A signal "
            "the dump does not carry leaves an EMPTY cell, never a placeholder."
        ),
        "placeholders_legal": False,
    },
    "partial_binding": (
        "If the dump covers only part of the panel, emit mode C for what is "
        "bound, leave the rest empty, and name exactly what could not be "
        "bound. Do not downgrade the whole file to mode B."
    ),
}


IDENTIFIERS = {
    "rule": (
        "driver_id, unit_id and alias_text are COPIED VERBATIM from the "
        "plant's iw_gen_driver_parameters dump. The driver_id is stored "
        "ready-made in the parameter row; it is never constructed."
    ),
    "prohibited": [
        "constructing a driver_id from its parts",
        "concatenating a driver_id from a plant prefix and a menu code",
        "adapting a driver_id from another room or another plant",
        "normalizing alias_text whitespace - the aliases carry double spaces "
        "and empty bracket pairs, and they are matched byte for byte",
        "inventing an obj_id, unit_id, plant_id or navigation target",
        "marking an object linked without a verified binding",
        "replacing a real identifier with a placeholder in mode C",
    ],
    "cross_check": (
        "python build-romkontroll-fixture.py <export.json> --sql "
        "<iw_gen_driver_parameters.sql> reports, per class: driver ids missing "
        "from the dump, unit_id mismatches, and alias_text differences. On "
        "E18 x E20 all three are zero across 1551 bound objects."
    ),
    "encoding": (
        "The dump is UTF-8. Reading it as latin-1 produces mojibake in every "
        "Norwegian alias and every degree sign, and the mojibake then travels "
        "into the panel as a real binding value."
    ),
}


VIEWPORT = {
    "rule": (
        "panel_height is a VIEWPORT, not a clipping boundary. The plant view "
        "scrolls. A room-control table cannot fit the declared canvas and is "
        "not supposed to."
    ),
    "evidence": ["E18", "E19"],
    "host_behaviour": (
        "Nothing in the designer or the plant view clamps to panel_width / "
        "panel_height - CLAUDE.md gotcha 25, established on the spjeldliste "
        "(content to y 4646 on a nominal 1400x750 panel)."
    ),
    "prohibited": [
        "compressing the table to fit the declared canvas",
        "dropping rooms or columns to fit",
        "rescaling geometry to fit",
        "raising panel_width / panel_height to match the content - the "
        "reference declares 1400x750 and the host is content with that",
    ],
}


INPUT_ROUTING = {
    "a_json_request_in_an_iwmac_context": (
        "Is a request for an iwmac-designer-panel document, not for a generic "
        "JSON export. AI-REQUEST-ROUTING.md 1."
    ),
    "context_inheritance": (
        "'trenger .json fil', 'send den som fil', 'now as JSON' after a panel "
        "discussion inherit the panel task. Serializing the analysis instead is "
        "rejected generation 13.1."
    ),
    "known_good_export_attached": (
        "Inspect it before generating or modifying. It outranks every document "
        "in this repository (source precedence rank 1)."
    ),
    "sql_dump_attached": (
        "Mode C. A parameter dump is binding data; falling back to placeholders "
        "with the dump in hand is rejected generation 13.2."
    ),
    "owner_document": "AI-REQUEST-ROUTING.md",
}


PRESERVE_AND_PATCH = {
    "rule": (
        "A supplied export is the geometric and compositional template. "
        "Preserve and patch; never rebuild."
    ),
    "do_not_touch": {
        "linked_true_with_empty_driver_id": (
            "Host behaviour: load_new_ver_objects sets linked='true' whenever "
            "driver_id !== 'driver_id', including when it is empty "
            "(V3scripts.js:514). Not a defect, not to be tidied."
        ),
        "container_item_link_tag_NA": (
            "Every one of the 1802 items carries link_tag 'NA' and alias_text "
            "'new text'. Host artefacts of the table builder, round-tripped by "
            "the collector."
        ),
        "container_width_height": (
            "width 405 / height 72 do not describe the table. They are the "
            "container's own box, left over from creation. Correcting them "
            "invents a number."
        ),
        "image_data": (
            "The background is the blank canvas. The grid is drawn by the "
            "container, not painted."
        ),
    },
    "structural_edits": {
        "add_column": (
            "append at the functionally correct position, shift the columns to "
            "its right, add one header cell per band and one body cell per row, "
            "bump num_of_col, add one canvas object per room that has the signal"
        ),
        "add_room": (
            "insert in integer order, add one body cell per column, add the "
            "canvas objects, shift every row below down by the row height, "
            "recompute the header bands, bump num_of_rows and last_y"
        ),
        "relink": (
            "change driver_id, unit_id and alias_text together, from the same "
            "dump row. Changing one alone binds to the wrong parameter."
        ),
    },
}


SANITIZATION = {
    "convention": "masked production, not unlinked demo",
    "rewrite": [
        "the plant number inside every driver_id, to NNNN",
        "envelope source_plant_id and panel.plant_id",
        "panel.saved_by",
    ],
    "preserve": [
        "unit_id", "alias_text", "linked", "geometry", "zIndex", "tag_text",
        "array order", "the container and all of its items", "image_data",
    ],
    "drop": ["panel.image_svg_trace"],
    "why": (
        "The column set, the room set and the signal roles are what a "
        "comparison is built from. Blanking unit_id and alias_text the "
        "unlinked-demo way would destroy the evidence the profile exists to "
        "carry."
    ),
    "residue_check": (
        "build-romkontroll-fixture.py refuses to write a fixture that still "
        "contains the source plant number anywhere outside image_data."
    ),
}


VERIFICATION = {
    "validator": "validate-romkontroll-panel.py",
    "modes": {
        "--check": "schema, objects, table, bindings - R-S*, R-T*, R-B*",
        "--source-sql": "every identifier against the plant's dump - R-B6..R-B9",
        "--compare SOURCE CANDIDATE": "structural and geometric diff - R-C*",
        "--profile " + PROFILE: "this building's own numbers - R-P*",
    },
    "rule_namespaces": {
        "R-S": "schema and object well-formedness",
        "R-T": "the table: container, grid, placement",
        "R-B": "bindings",
        "R-P": "profile - one named building only",
        "R-C": "comparison against a known-good export",
    },
    "cannot_detect": [
        "a well-formed driver_id naming a parameter the controller does not "
        "expose - only --source-sql sees that, and only for the supplied dump",
        "a column ordered in a way that is legal but unreadable",
        "whether the room set is the set the operator wanted",
        "whether the panel renders as intended - nothing here renders",
    ],
    "do_not_weaken": (
        "A rule that a generated file fails is changed in the contract with "
        "evidence and recorded in documentation-change-log.md, never relaxed "
        "silently to make one generation pass."
    ),
}


CONFLICTS = [
    {
        "id": "RC-C1",
        "between": [
            "LIST-PANEL-GENERATION-CONTRACT.md 1.1 - 'one objects_container per "
            "table row'",
            "E18 - ONE table_container for the entire 34x50 grid",
        ],
        "resolution": (
            "Both are correct within their scope. The spjeldliste family builds "
            "one container_c per row (208 on the reference). The room-control "
            "table family builds one table_container for the whole grid. "
            "Neither document is rewritten; both are scoped."
        ),
        "scope_of_each": {
            "LIST": "spjeldliste and damper-list panels",
            "ROMKONTROLL": "room-control tables",
        },
        "normative": True,
    },
    {
        "id": "RC-C2",
        "between": [
            "DESIGN-OBJECT-CATALOG.md - number_v3_cell_grey25 is absent",
            "E18 - number_v3_cell_grey25 is used 1700 times in production",
        ],
        "resolution": (
            "The obj_id allowlist becomes 'present in DESIGN-OBJECT-CATALOG.md "
            "OR in reference_data/controls-registry.json'. The cell type exists "
            "in the controls registry as a host-generated table-cell control "
            "(obj_type 'dummy', canLink false, classname css_v3_cell_grey25) - "
            "it is not a palette object because no one drags it onto a canvas; "
            "table_container.build emits it. Validation is widened by evidence, "
            "not weakened to make a file pass."
        ),
        "evidence": ["E18", "E19", "reference_data/controls-registry.json"],
        "normative": True,
    },
    {
        "id": "RC-C3",
        "between": [
            "AI-AGENT-INSTRUCTIONS.txt - the unlinked placeholder template, "
            "taught as the shape of every generated panel",
            "This panel type's default output mode C",
        ],
        "resolution": (
            "The unlinked template is mode B, not the universal shape. "
            "AI-AGENT-INSTRUCTIONS.txt is labelled accordingly and given a "
            "room-control route. This was the direct cause of rejected "
            "generation 13.2."
        ),
        "normative": True,
    },
    {
        "id": "RC-C4",
        "between": [
            "The 2026-08-10 request's proposed eight-level source hierarchy",
            "The repository's single source_precedence list",
        ],
        "resolution": (
            "The repository list stands - a second precedence list would be a "
            "second owner for the same rule. The request's intent is met by a "
            "companion table mapping kind-of-fact to authoritative source "
            "(ROMKONTROLL-GENERATION-CONTRACT.md, 'Which source owns which kind "
            "of fact'). The difference is recorded rather than resolved by "
            "renumbering."
        ),
        "normative": False,
    },
    {
        "id": "RC-C5",
        "between": [
            "AI-BRIEFING.txt 9 - the EVERY PANEL self-check requires object "
            "positions inside the canvas",
            "E18 - content to x 3120 and y 1690 on a declared 1400x750 canvas",
        ],
        "resolution": (
            "The self-check's exception, already granted to list panels, is "
            "widened to room-control tables. Content beyond the viewport is "
            "reported, never corrected."
        ),
        "evidence": ["E18", "E19"],
        "normative": True,
    },
]


REJECTED_GENERATIONS = [
    {
        "id": "13.1",
        "file": "Tabell_romkontroll_alle_plan.json",
        "size_bytes": 1_580_000,
        "shape": (
            "A custom dataset: schema_version, kilde, utvalg, plan_tolkning, "
            "antall_romkontrollere, planoversikt, romkontrollere."
        ),
        "defects": [
            "not a panel document - no format, no version, no panel",
            "no single_objects, no containers, no geometry, no obj_id",
        ],
        "root_cause": "routing - a .json request was read as a data request",
        # Measured against build-romkontroll-negatives.py "dataset-not-a-panel",
        # not predicted. --compare adds R-C1, R-C3, R-C8.
        "caught_by": ["routing, before generation", "R-S2", "R-S3", "R-S4"],
        "note": (
            "The room analysis inside it was correct. The analysis was right "
            "and the routing was wrong."
        ),
    },
    {
        "id": "13.2",
        "file": "Romkontroll_alle_plan_IWMAC_Designer.json",
        "size_bytes": 30_000,
        "shape": (
            "A correct envelope wrapped around a placeholder overview: 59 "
            "objects (50 number_v3_label_11px_norm + 9 "
            "number_v3_header_grey75), 0 containers, 0 graphics."
        ),
        "defects": [
            "no table_container - the panel type's defining structure absent",
            "59 objects against 1553 - 96 percent of the content missing",
            "labels and headings only - no value objects, no alarm objects",
            "every object linked 'false', driver_id 'driver_id', unit_id '' - "
            "with the parameter dump attached and every binding available",
            "zIndex 'default' on all 59",
            "link_name '' where the host writes 'link_name'",
            "an unlinked template nobody asked for",
        ],
        "root_cause": (
            "the unlinked placeholder template taught as universal - conflict "
            "RC-C3"
        ),
        # Measured against build-romkontroll-negatives.py "placeholder-overview",
        # not predicted. R-B1 and R-C4 were in an earlier draft of this list and
        # do NOT fire: every object is placeholdered, so the file is a valid
        # mode-B template (R-B1 is a note), and with no container there are no
        # columns to compare (R-C4 stays silent). The defect is that nobody
        # asked for a template - a routing check, not a binding rule.
        "caught_by": ["R-T1", "R-S10", "R-S11", "R-C3", "R-C8", "R-P1"],
        "note": (
            "It parsed, and it passed every envelope and count check. Parsing "
            "is not usability."
        ),
    },
]


EVIDENCE = {
    "E18": {
        "file": ("iwmac-panel_8653_tabell-romkontroll-alle-plan_20260810-2157.json "
                 "(user Downloads, plant 8653, NOT committed)"),
        "committed": False,
        "why_not_committed": (
            "Carries a live plant id and 1552 real driver ids; repo policy "
            "masks reference JSONs before commit."
        ),
        "sanitized": False,
        "panel": "Tabell romkontroll alle plan",
        "generator": "IWDIE v1.7.0 - a real userscript export of a live panel",
        "size_bytes": 1_894_376,
        "role": (
            "The known-good export supplied with the 2026-08-10 room-control "
            "task. Highest-precedence source for everything geometric about "
            "this panel type, and the only production evidence that the "
            "table_container family exists. Must not be modified."
        ),
    },
    "E19": {
        "file": "reference_data/romkontroll-8653-sanitized.json",
        "committed": True,
        "sanitized": True,
        "masked_not_unlinked": True,
        "panel": "Tabell romkontroll alle plan",
        "derived_from": "E18",
        "role": (
            "E18 with the plant number masked to NNNN inside every driver id "
            "and the plant/author fields blanked, and nothing else touched: "
            "same 1553 objects, same container, same 1802 items, same "
            "geometry, sizes, zIndex, tag_text, alias_text, unit_id, array "
            "order and byte-identical image_data. The committed "
            "TEMPLATE-8653-ROMKONTROLL reference. Produced by "
            "build-romkontroll-fixture.py."
        ),
        "dropped": ["panel.image_svg_trace"],
    },
    "E20": {
        "file": "iw_gen_driver_parameters (3).sql (user Downloads, NOT committed)",
        "committed": False,
        "why_not_committed": (
            "A 10 315-row phpMyAdmin dump of a live plant's parameter table."
        ),
        "kind": "parameter source",
        "encoding": "UTF-8",
        "rows": 10_315,
        "distinct_driver_ids": 10_315,
        "distinct_unit_ids": 91,
        "role": (
            "The authoritative source for every driver_id, unit_id, alias_text "
            "and engineering unit on plant 8653. Cross-checked against E18: 0 "
            "driver ids missing, 0 unit_id mismatches, 1551 of 1551 alias_text "
            "values byte-identical."
        ),
    },
    "E21": {
        "file": ("Tabell_romkontroll_alle_plan.json and "
                 "Romkontroll_alle_plan_IWMAC_Designer.json "
                 "(user Downloads, NOT committed)"),
        "committed": False,
        "kind": "negative example",
        "role": (
            "The two failed attempts at this panel, and the reason this "
            "documentation exists. 13.1 is a custom dataset that is not a panel "
            "document; 13.2 is a correct envelope around a placeholder overview "
            "with 59 of 1553 objects and no container. Both parsed cleanly. "
            "Reproduced synthetically by build-romkontroll-negatives.py so the "
            "validator is tested against them without committing either file."
        ),
    },
}


# --------------------------------------------------------------------------
# Measurement - every number below is read from the fixture
# --------------------------------------------------------------------------

def load_fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def objects_of(document):
    return envelope_of(document)["panel"]["single_objects"]


def measured_vocabulary(objects):
    census = collections.Counter(o["obj_id"] for o in objects)
    sizes = collections.defaultdict(collections.Counter)
    for obj in objects:
        sizes[obj["obj_id"]][(as_int(obj["posWidth"]), as_int(obj["posHeight"]))] += 1
    return {
        obj_id: {
            "count": count,
            "sizes": [{"width": w, "height": h, "count": n}
                      for (w, h), n in sizes[obj_id].most_common()],
            "role": ROLE_NOTES.get(obj_id, "-"),
        }
        for obj_id, count in census.most_common()
    }


ROLE_NOTES = {
    VALUE_OBJ: (
        "every numeric value and every writable setpoint - temperatures, "
        "percentages, alarm LIMITS, curve points, and the read-only booleans "
        "that are fan-stage and reset states"
    ),
    ALARM_OBJ: (
        "alarm STATE only. On E18 it is used for exactly the 250 Digital IO "
        "boolean r signals whose menu code is an _AL / _ALH / _ALL alarm - "
        "never for an alarm limit, which is a setpoint in degrees and gets a "
        "value box"
    ),
    "number_v3_60px_json_obj": "the one writable manual-reset control",
    "number_v3_label_11px_norm": "free-text annotation under the table",
}


def measured_bands(objects):
    bands = collections.Counter(str(o["zIndex"]) for o in objects)
    return {z: {"count": n, "objects": BAND_NOTES.get(z, "-")}
            for z, n in bands.most_common()}


BAND_NOTES = {
    "110": "every grid object - values, alarms and the reset control",
    "1100": "the two free-text annotations under the table",
}


def uniform_fields(records, fields):
    """The fields that carry ONE value across every record, with its real type.

    Keyed on the JSON encoding so the comparison is exact, but the value stored
    is the original - a validator reading this must see that posHeight is the
    number 20 and zIndex is the string "110", because that distinction is
    itself a rule (R-S9, R-S10).
    """
    out = {}
    for field in fields:
        seen = {}
        for record in records:
            seen[json.dumps(record.get(field))] = record.get(field)
            if len(seen) > 1:
                break
        if len(seen) == 1:
            out[field] = next(iter(seen.values()))
    return out


def measured_constants(objects):
    """Fields that carry one value across every object in the fixture."""
    return uniform_fields(objects, (
        "id", "posHeight", "linked", "link_name", "link_tag", "sub_group",
        "unit_ref"))


def measured_container(document):
    container = the_container(envelope_of(document))
    items = container.get("items") or []
    census = collections.Counter(i["obj_id"] for i in items)
    sizes = collections.defaultdict(collections.Counter)
    for item in items:
        sizes[item["obj_id"]][(as_int(item["posWidth"]),
                               as_int(item["posHeight"]))] += 1
    constants = uniform_fields(items, (
        "id", "zIndex", "linked", "link_name", "link_tag", "sub_group",
        "driver_id", "unit_id", "unit_ref", "alias_text"))
    return {
        "count": 1,
        "keys": sorted(k for k in container if k != "items"),
        "key_count": len(container),
        "attributes": {k: v for k, v in container.items() if k != "items"},
        "item_count": len(items),
        "item_census": {
            obj_id: {
                "count": n,
                "sizes": [{"width": w, "height": h, "count": c}
                          for (w, h), c in sizes[obj_id].most_common()],
            }
            for obj_id, n in census.most_common()
        },
        "item_constants": constants,
        "notes": {
            "unique_id": (
                "must contain 'custom_'. load_new_ver_containers routes on "
                "unique_id.indexOf('custom_') and the other branch, "
                ".template(), is an empty stub - a container without it "
                "SILENTLY VANISHES on Insert (V3scripts.js:528, :684)."
            ),
            "width_height": (
                "do not describe the table. The grid is drawn by the items; "
                "these are the container's own box."
            ),
            "header_item_naming": (
                "header items have name == tag_text; every body cell is named "
                "'driver_id'. Nothing resolves a container item by name."
            ),
            "bindings": (
                "container items carry NO bindings. driver_id '', unit_id '', "
                "link_tag 'NA', alias_text 'new text' on all of them."
            ),
        },
    }


def measured_table(document):
    geometry = table_geometry(envelope_of(document))
    objects = objects_of(document)

    per_column = collections.Counter()
    for obj in objects:
        column = column_of(geometry, as_int(obj["posLeft"]))
        if column is not None:
            per_column[column["index"]] += 1

    header_tops = geometry["header_tops"]
    row_tops = [r["rel_top"] for r in geometry["rows"]]
    pitch = collections.Counter(b - a for a, b in zip(row_tops, row_tops[1:]))
    rows_per_band = []
    for n, top in enumerate(header_tops):
        end = header_tops[n + 1] if n + 1 < len(header_tops) else None
        rows_per_band.append(sum(1 for t in row_tops
                                 if t > top and (end is None or t < end)))

    widths = collections.Counter(c["width"] for c in geometry["columns"])

    return {
        "origin": {"left": geometry["left"], "top": geometry["top"]},
        "columns": {
            "count": len(geometry["columns"]),
            "widths": [{"width": w, "count": n} for w, n in widths.most_common()],
            "carrying_objects": sum(1 for c in geometry["columns"]
                                    if per_column[c["index"]]),
            "label_columns": [c["index"] for c in geometry["columns"]
                              if not per_column[c["index"]]],
            "gutter": 0,
        },
        "rows": {
            "count": len(geometry["rows"]),
            "height": geometry["row_height"],
            "first_rel_top": row_tops[0],
            "last_rel_top": row_tops[-1],
            "pitch": [{"delta": d, "count": n} for d, n in pitch.most_common()],
            "pitch_note": (
                "the larger delta is a row that follows a header band: "
                "row height + header height"
            ),
        },
        "header_bands": {
            "count": len(header_tops),
            "height": geometry["header_height"],
            "rel_tops": header_tops,
            "pitch": (header_tops[1] - header_tops[0]) if len(header_tops) > 1 else None,
            "body_rows_per_band": rows_per_band,
            "repeat_rule": (
                "one band every N body rows, where N is what fits a screen. "
                "The last band carries the remainder."
            ),
        },
        "last_y": {
            "value": the_container(envelope_of(document)).get("last_y"),
            "rule": "last body row rel top + row height",
        },
        "placement_formula": {
            "posLeft": "container.left + cell.posLeft + (cell.posWidth - posWidth) / 2",
            "posTop": "container.top + cell.posTop + floor((row_height - posHeight) / 2)",
            "note": (
                "objects are centred in their cell. The formula reproduces "
                "every grid object in the fixture; the annotation cluster below "
                "the table is hand-placed and is listed as an anomaly."
            ),
        },
        "cell_offsets": measured_offsets(geometry, objects),
        "missing_signal": (
            "leaves the cell EMPTY - no object at all. Never a placeholder "
            "object, never a zero, never a dash."
        ),
    }


def measured_offsets(geometry, objects):
    """Object offsets inside their cell, per obj_id - the placement evidence."""
    offsets = collections.defaultdict(collections.Counter)
    outside = 0
    for obj in objects:
        column = column_of(geometry, as_int(obj["posLeft"]))
        row, dy = row_of(geometry, as_int(obj["posTop"]))
        if column is None or row is None:
            outside += 1
            continue
        offsets[obj["obj_id"]][(as_int(obj["posLeft"]) - column["abs_left"], dy)] += 1
    return {
        "per_obj_id": {
            obj_id: [{"dx": dx, "dy": dy, "count": n}
                     for (dx, dy), n in counter.most_common()]
            for obj_id, counter in offsets.items()
        },
        "outside_any_column_or_row": outside,
    }


def measured_rooms(document):
    geometry = table_geometry(envelope_of(document))
    labels = room_labels(geometry)
    rooms = [labels[i] for i in sorted(labels)]
    numeric = [int(r) for r in rooms if str(r).strip().isdigit()]
    floors = collections.Counter(str(n)[0] for n in numeric)
    return {
        "count": len(rooms),
        "source": (
            "the container item in the first column of each body row - the "
            "room number is a CELL, not a canvas object"
        ),
        "ordering": "ascending as integers, not as strings",
        "floor_rule": "the leading digit of the room number - derived, never asked",
        "ascending": numeric == sorted(numeric),
        "duplicates": [r for r, n in collections.Counter(rooms).items() if n > 1],
        "per_floor": dict(sorted(floors.items())),
        "grouping": (
            "no floor header rows, no divider rows, no spacer rows. The floor "
            "is legible from the room number alone."
        ),
        "repeat_label_column": (
            "the room-number column is repeated partway across so a scrolled "
            "row stays identifiable"
        ),
    }


def measured_extent(document):
    objects = objects_of(document)
    env = envelope_of(document)
    panel = env["panel"]
    lefts = [as_int(o["posLeft"]) for o in objects]
    tops = [as_int(o["posTop"]) for o in objects]
    rights = [as_int(o["posLeft"]) + as_int(o["posWidth"]) for o in objects]
    bottoms = [as_int(o["posTop"]) + as_int(o["posHeight"]) for o in objects]
    return {
        "declared": {
            "panel_width": panel.get("panel_width"),
            "panel_height": panel.get("panel_height"),
        },
        "measured": {
            "min_left": min(lefts), "max_right": max(rights),
            "min_top": min(tops), "max_bottom": max(bottoms),
        },
        "overflow": {
            "horizontal": max(rights) - as_int(panel.get("panel_width")),
            "vertical": max(bottoms) - as_int(panel.get("panel_height")),
        },
    }


def measured_anomalies(document):
    """Production oddities: round-trip them, do not imitate them."""
    geometry = table_geometry(envelope_of(document))
    objects = objects_of(document)
    container = the_container(envelope_of(document))

    below = []
    last_row = geometry["rows"][-1]
    for obj in objects:
        top = as_int(obj["posTop"])
        if top >= last_row["abs_top"] + geometry["row_height"]:
            below.append({
                "name": obj["name"], "obj_id": obj["obj_id"],
                "left": as_int(obj["posLeft"]), "top": top,
                "tag_text": obj["tag_text"], "alias_text": obj["alias_text"],
                "zIndex": str(obj["zIndex"]),
            })

    per_column = collections.Counter()
    for obj in objects:
        column = column_of(geometry, as_int(obj["posLeft"]))
        if column is not None:
            per_column[column["index"]] += 1
    signal_counts = collections.Counter(
        n for i, n in per_column.items() if n)

    header_titles = collections.Counter(
        c["title"] for c in geometry["columns"])

    return {
        "annotation_cluster_below_the_grid": {
            "objects": below,
            "note": (
                "a manual-reset control and its two instruction labels, placed "
                "under the last body row rather than in a cell. Hand-placed: "
                "they do not satisfy the centring formula. Keep them when "
                "editing this panel; do not treat them as a required feature "
                "of the panel type."
            ),
        },
        "uneven_column_object_counts": {
            "counts": dict(sorted(signal_counts.items())),
            "note": (
                "most signal columns carry one object per room. Columns that "
                "carry more include the annotation cluster; a column that "
                "carries fewer has rooms whose controller does not expose the "
                "signal. Both are legitimate - the panel does not pad."
            ),
        },
        "repeated_header_title": {
            "titles": [t for t, n in header_titles.items() if n > 1],
            "note": (
                "the room-number column is deliberately repeated partway "
                "across, so two headers share a caption."
            ),
        },
        "container_box_does_not_describe_the_table": {
            "width": container.get("width"), "height": container.get("height"),
            "note": "see preserve_and_patch.do_not_touch",
        },
    }


def composition(document):
    objects = objects_of(document)
    env = envelope_of(document)
    container = the_container(env)
    return {
        "two_layers": {
            "grid": (
                "container items - one header cell per column per band, one "
                "body cell per column per row. They draw the table and carry "
                "no bindings."
            ),
            "values": (
                "canvas single_objects - one per populated cell, centred in "
                "it, carrying the binding."
            ),
            "why_it_matters": (
                "A file with only the value layer has no table. A file with "
                "only the grid layer has no values. Rejected generation 13.2 "
                "had neither - it had labels."
            ),
        },
        "counts": {
            "single_objects": len(objects),
            "containers": 1,
            "graphics": 0,
            "container_items": len(container.get("items") or []),
        },
        "graphics": "always empty on this panel type",
        "background": {
            "background_embedded": env.get("background_embedded"),
            "converted": env["panel"].get("converted"),
            "image_data_chars": len(env["panel"].get("image_data") or ""),
            "image_svg": bool(env["panel"].get("image_svg")),
            "rule": (
                "the blank canvas. The grid is drawn by the container, never "
                "painted. Never author image_svg for this panel type, and "
                "never emit image_svg_trace - the importer deletes it."
            ),
        },
    }


# --------------------------------------------------------------------------
# Blocks
# --------------------------------------------------------------------------

def panel_type_block(document):
    objects = objects_of(document)
    return {
        "identity": IDENTITY,
        "owner_document": "ROMKONTROLL-GENERATION-CONTRACT.md",
        "companion_documents": {
            "routing": "AI-REQUEST-ROUTING.md",
            "procedure": "ROMKONTROLL-AUTHORING-GUIDE.md",
            "acceptance": "ROMKONTROLL-QA-CHECKLIST.md",
            "copilot": "ROMKONTROLL-COPILOT-PREFLIGHT.md",
            "fixture": FIXTURE_PATH.relative_to(ROOT).as_posix(),
            "validator": "validate-romkontroll-panel.py",
        },
        "canvas": {
            "width": 1400,
            "height": 750,
            "scope": "ROMKONTROLL",
            "evidence": ["E18", "E19"],
            "note": (
                "the declared viewport. The content is far larger - see "
                "viewport_versus_content."
            ),
        },
        "viewport_versus_content": dict(VIEWPORT, measured=measured_extent(document)),
        "composition": composition(document),
        "z_indexes": {
            "mode": "explicit bands - never the literal string \"default\"",
            "bands": measured_bands(objects),
            "scope": "ROMKONTROLL",
            "evidence": ["E18", "E19"],
            "conflict": (
                "These are not the Maskin bands and not the Ventilasjon bands. "
                "Container items sit at 5, every grid object at 110, the two "
                "annotations at 1100. The bands are per panel type."
            ),
        },
        "object_fields": {
            "count": 17,
            "constants_on_this_panel_type": measured_constants(objects),
            "note": (
                "linked 'true' with an empty driver_id is host behaviour "
                "(V3scripts.js:514), not a claim about the binding."
            ),
        },
        "object_vocabulary": measured_vocabulary(objects),
        "object_selection": {
            "allowlist": (
                "present in DESIGN-OBJECT-CATALOG.md OR in "
                "reference_data/controls-registry.json - conflict RC-C2"
            ),
            "alarm_rule": (
                "an alarm object binds to an alarm STATE. An alarm LIMIT is a "
                "setpoint in engineering units and gets a value box. A "
                "read-only boolean is not automatically an alarm."
            ),
            "prohibited": [
                "one text-label obj_id for every cell",
                "an obj_id the catalogue marks inactive, outdated or unsupported",
                "an obj_id that appears in neither registry",
            ],
        },
        "container": measured_container(document),
        "table": measured_table(document),
        "rooms": measured_rooms(document),
        "identifiers": IDENTIFIERS,
        "output_modes": OUTPUT_MODES,
        "input_routing": INPUT_ROUTING,
        "preserve_and_patch": PRESERVE_AND_PATCH,
        "sanitization": SANITIZATION,
        "verification": VERIFICATION,
        "conflicts": CONFLICTS,
        "rejected_generations": REJECTED_GENERATIONS,
        "anomalies": measured_anomalies(document),
    }


def profile_block(document):
    env = envelope_of(document)
    panel = env["panel"]
    objects = objects_of(document)
    geometry = table_geometry(env)
    container = the_container(env)
    labels = room_labels(geometry)

    per_column = collections.Counter()
    for obj in objects:
        column = column_of(geometry, as_int(obj["posLeft"]))
        if column is not None:
            per_column[column["index"]] += 1

    return {
        "title": "Plant-8653 hotel room-control table (Tabell romkontroll alle plan)",
        "scope": PROFILE,
        "evidence": ["E18", "E19", "E20"],
        "derived_from": (f"{FIXTURE_PATH.relative_to(ROOT).as_posix()}, generated "
                         f"by build-romkontroll-rules.py"),
        "panel_type": PANEL_TYPE,
        "canvas": [as_int(panel["panel_width"]), as_int(panel["panel_height"])],
        "content_extent": measured_extent(document)["measured"],
        "object_count": len(objects),
        "container_item_count": len(container.get("items") or []),
        "column_count": len(geometry["columns"]),
        "room_count": len(labels),
        "distinct_obj_ids": len({o["obj_id"] for o in objects}),
        "background": {
            "converted": panel.get("converted"),
            "image_data_chars": len(panel.get("image_data") or ""),
            "image_svg": bool(panel.get("image_svg")),
            "note": (
                "the blank canvas travels with the fixture. The grid is drawn "
                "by the container."
            ),
        },
        "applies_when": (
            "The task supplies this panel, names TEMPLATE-8653-ROMKONTROLL, or "
            "asks for a repair or copy of the 8653 room-control table. It does "
            "NOT apply to another building: another building has different "
            "rooms, different controllers and a different set of shared "
            "parameters. A profile failure on another plant means the profile "
            "does not apply, not that the panel is wrong."
        ),
        "container_attributes": {k: v for k, v in container.items() if k != "items"},
        "columns": [
            {
                "index": column["index"],
                "rel_left": column["rel_left"],
                "abs_left": column["abs_left"],
                "width": column["width"],
                "title": column["title"],
                "objects": per_column[column["index"]],
                "kind": "label" if not per_column[column["index"]] else "signal",
            }
            for column in geometry["columns"]
        ],
        "rows": [
            {
                "index": row["index"],
                "rel_top": row["rel_top"],
                "abs_top": row["abs_top"],
                "room": labels.get(row["index"]),
            }
            for row in geometry["rows"]
        ],
        "rooms": [labels[i] for i in sorted(labels)],
        "header_bands": measured_table(document)["header_bands"],
        "row_geometry": measured_table(document)["rows"],
        "cell_offsets": measured_table(document)["cell_offsets"],
        "obj_id_census": measured_vocabulary(objects),
        "z_bands": measured_bands(objects),
        "anomalies": measured_anomalies(document),
        "objects_not_listed": (
            "The 1553 object records are not duplicated here. They are the "
            "fixture; listing them would double this file without adding a "
            "fact. Everything a validator needs - the grid, the columns, the "
            "rooms, the offsets, the censuses - is measured above."
        ),
    }


def apply(rules):
    document = load_fixture()
    rules.setdefault("scope_tags", {}).update(SCOPE_TAGS)
    rules.setdefault("evidence", {}).update(EVIDENCE)
    rules.setdefault("panel_types", {})[PANEL_TYPE] = panel_type_block(document)
    rules.setdefault("profiles", {})[PROFILE] = profile_block(document)
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
                  "build-romkontroll-rules.py", file=sys.stderr)
            return 1
        print("documentation-rules.json is up to date")
        return 0

    RULES_PATH.write_text(updated, encoding="utf-8")
    profile = rules["profiles"][PROFILE]
    print(f"wrote {RULES_PATH} - panel_types.{PANEL_TYPE} and profiles.{PROFILE} "
          f"regenerated from {profile['object_count']} fixture objects, "
          f"{profile['column_count']} columns x {profile['room_count']} rooms, "
          f"{profile['container_item_count']} container items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
