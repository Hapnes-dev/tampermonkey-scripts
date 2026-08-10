#!/usr/bin/env python3
"""Derive the masked TEMPLATE-8653-ROMKONTROLL fixture from a production export.

    python build-romkontroll-fixture.py SOURCE.json -o reference_data/romkontroll-8653-sanitized.json
    python build-romkontroll-fixture.py SOURCE.json --report
    python build-romkontroll-fixture.py SOURCE.json --sql "iw_gen_driver_parameters.sql"

WHY THIS IS A SCRIPT AND NOT A HAND-EDITED FILE.

Same reason as build-oversikt-fixture.py: the fixture has to be provably a
*mechanical* derivative of the export it came from. Every coordinate, size,
zIndex, alias, tag, array position, container attribute and the background
survive byte-for-byte, and only the fields in the MASK tables below are
touched. Re-run this against the retained source and diff, and the claim is
testable. A hand-edited copy cannot be.

WHY THIS MASKS AND DOES NOT UNLINK.

A room-control table is not a drawing - it is a 50-room x 31-signal matrix, and
the thing this fixture exists to prove is that the matrix is complete and that
every cell resolves to a real parameter row. Room identity lives in ``unit_id``
and in ``alias_text``; the signal identity lives in the ``driver_id`` tail. An
unlinked copy (the build-maskin-fixture.py contract) would delete exactly the
structure this file carries. So this follows the masked-production convention
already used by real-vent-panel-example.json, real-spjeldliste-example.json and
oversikt-10113-sanitized.json: the live plant number is replaced with ``NNNN``
in every driver id, the plant id, author and background filename are blanked,
and every bus address and parameter suffix is preserved. A driver id whose
plant field is ``NNNN`` binds to nothing; the matrix it encodes is still
readable.

``--report`` prints the measured analysis that ROMKONTROLL-GENERATION-CONTRACT.md
quotes. Regenerate the report rather than retyping a number into the contract.

``--sql`` cross-checks every bound object against an ``iw_gen_driver_parameters``
dump: driver id present, unit id in agreement, alias_text byte-identical. That
is the evidence behind the contract's "every binding is copied, never
constructed" rule, and it is the only mode that can prove it.

The source export carries the live plant id and 1,551 real driver ids and is
deliberately NOT committed. The evidence table in
ROMKONTROLL-GENERATION-CONTRACT.md names it. Nothing in this repository reads
it except this script, on demand.

No network access. Reads only the paths given on the command line.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "reference_data" / "romkontroll-8653-sanitized.json"

OBJECT_FIELDS = (
    "obj_id", "name", "id", "posWidth", "posHeight", "posLeft", "posTop",
    "zIndex", "tag_text", "linked", "link_name", "link_tag", "sub_group",
    "driver_id", "unit_id", "unit_ref", "alias_text",
)

MASKED_PLANT = "NNNN"

# The two cell families a table_container is built from, and the two canvas
# families that sit on top of the cells. Named here so the report can label
# them; the validator reads the same mapping from documentation-rules.json.
CELL_HEADER = "number_v3_header_grey75"
CELL_BODY = "number_v3_cell_grey25"
VALUE_OBJ = "number_v3_value_only"
ALARM_OBJ = "V3_R_20px_anim_rg_alarm_nrm"

MASK_ENVELOPE = {
    "source_plant_id": "",
    "generator": "TEMPLATE-8653-ROMKONTROLL fixture (build-romkontroll-fixture.py)",
}

MASK_PANEL = {
    "plant_id": "",
    # firstname.lastname of the operator who saved the export.
    "saved_by": "",
    # Both are already empty on this export (the background is embedded, not
    # named). Listed anyway so a future export with a filename is masked too.
    "org_image_name": "",
    "image_name": "",
}

# Dropped, not masked: Export writes image_svg_trace as AI *input* and Insert
# deletes it again (IWMAC-Designer-Import-Export.user.js: `delete
# doc.image_svg_trace;`). It is not part of the panel document.
DROP_PANEL = ("image_svg_trace",)

FIXTURE_NOTE = (
    "MASKED PRODUCTION REFERENCE - scope TEMPLATE-8653-ROMKONTROLL. Derived "
    "mechanically from a plant-8653 'Tabell romkontroll alle plan' export "
    "(1553 single_objects + 1 table_container carrying 1802 items) by "
    "build-romkontroll-fixture.py, which replaces ONLY the plant number inside "
    "each driver_id (with NNNN) and the envelope/panel fields listed in its "
    "MASK tables. Geometry, obj_id, sizes, zIndex, ordering, tag_text, "
    "alias_text, unit_id, every container attribute and the background "
    "image_data are byte-identical to that export, so this file is "
    "authoritative for ROOM-CONTROL TABLE geometry, container anatomy and "
    "matrix completeness. It is NOT a linkable panel: every driver id names "
    "plant NNNN, which does not exist. panel.image_svg_trace was dropped "
    "(Insert deletes it anyway). unit_id and alias_text are preserved on "
    "purpose - they are the room and signal identity the completeness check "
    "is built from. 50 rooms, 31 live columns and 1553 objects are the "
    "measurement of THIS building, never a target for another. See "
    "ROMKONTROLL-GENERATION-CONTRACT.md."
)


# --------------------------------------------------------------------------
# Shape helpers
# --------------------------------------------------------------------------

def envelope_of(document):
    if isinstance(document, dict) and isinstance(document.get("envelope"), dict):
        return document["envelope"]
    return document


def as_int(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        sign = -1 if text[:1] == "-" else 1
        text = text.lstrip("+-")
        digits = ""
        for ch in text:
            if not ch.isdigit():
                break
            digits += ch
        return sign * int(digits) if digits else None
    return None


def the_container(envelope):
    containers = (envelope.get("panel") or {}).get("containers") or []
    return containers[0] if containers else None


# --------------------------------------------------------------------------
# Masking
# --------------------------------------------------------------------------

def mask_driver_id(driver_id, plant_id):
    """Replace the leading plant field only. Never rewrite the parameter tail."""
    if not driver_id or not plant_id:
        return driver_id
    parts = driver_id.split("_")
    if parts and parts[0] == plant_id:
        parts[0] = MASKED_PLANT
        return "_".join(parts)
    return driver_id


def mask_object(obj, plant_id):
    return {k: (mask_driver_id(v, plant_id) if k == "driver_id" else v)
            for k, v in obj.items()}


def mask_container(container, plant_id):
    out = {}
    for key, value in container.items():
        if key == "items":
            out[key] = [mask_object(item, plant_id) for item in value]
        else:
            out[key] = value
    return out


def mask(document, plant_id):
    source = envelope_of(document)
    panel = source["panel"]

    out_panel = {}
    for key, value in panel.items():
        if key in DROP_PANEL:
            continue
        if key in MASK_PANEL:
            out_panel[key] = MASK_PANEL[key]
        elif key == "single_objects":
            out_panel[key] = [mask_object(o, plant_id) for o in value]
        elif key == "containers":
            out_panel[key] = [mask_container(c, plant_id) for c in value]
        else:
            out_panel[key] = value

    envelope = {}
    for key, value in source.items():
        if key in MASK_ENVELOPE:
            envelope[key] = MASK_ENVELOPE[key]
        elif key == "panel":
            envelope[key] = out_panel
        else:
            envelope[key] = value

    return {"_note": FIXTURE_NOTE, "envelope": envelope}


def residue(document, plant_id):
    """Every reason this document is still not safe to commit, as a list.

    ``image_data`` is excluded because it is base64 - a four-byte coincidence
    inside a PNG is a false positive, and the background carries no binding.
    ``_note`` and ``generator`` name the plant on purpose: the scope tag IS
    ``TEMPLATE-8653-ROMKONTROLL``, and a plant number in a provenance string is
    not a live binding. Same exclusion, same reason, as the other two builders.
    """
    envelope = envelope_of(document)
    panel = dict(envelope.get("panel") or {})
    panel.pop("image_data", None)
    scanned = {
        "source_plant_id": envelope.get("source_plant_id"),
        "panel_name": envelope.get("panel_name"),
        "panel": panel,
    }
    text = json.dumps(scanned, ensure_ascii=False)
    problems = []
    if plant_id and re.search(r"(?<!\d)" + re.escape(plant_id) + r"(?!\d)", text):
        problems.append(f"source plant id {plant_id!r} still appears outside image_data")
    for obj in envelope["panel"]["single_objects"]:
        driver = obj.get("driver_id") or ""
        if driver and not driver.startswith(MASKED_PLANT + "_"):
            problems.append(f"{obj.get('name')}.driver_id is {driver!r}, "
                            f"expected a {MASKED_PLANT}_ prefix")
    if (envelope.get("panel") or {}).get("saved_by"):
        problems.append("panel.saved_by is not empty")
    return problems


# --------------------------------------------------------------------------
# Table geometry - derived, never assumed
# --------------------------------------------------------------------------

def table_geometry(envelope):
    """Reconstruct the column bands and row tops from the container items.

    Nothing here is hard-coded. The bands come from the header items on the
    first header row, the rows from the distinct body-cell tops. That is what
    makes the report a measurement rather than a restatement.
    """
    container = the_container(envelope)
    if container is None:
        return None
    items = container.get("items") or []
    left0, top0 = as_int(container.get("left")), as_int(container.get("top"))

    headers = [i for i in items if i["obj_id"] == CELL_HEADER]
    body = [i for i in items if i["obj_id"] == CELL_BODY]

    header_tops = sorted({as_int(i["posTop"]) for i in headers})
    first_band = sorted([i for i in headers if as_int(i["posTop"]) == header_tops[0]],
                        key=lambda i: as_int(i["posLeft"]))
    columns = [{
        "index": n,
        "rel_left": as_int(i["posLeft"]),
        "abs_left": left0 + as_int(i["posLeft"]),
        "width": as_int(i["posWidth"]),
        "title": i.get("tag_text"),
    } for n, i in enumerate(first_band)]

    row_tops = sorted({as_int(i["posTop"]) for i in body})
    rows = [{"index": n, "rel_top": t, "abs_top": top0 + t} for n, t in enumerate(row_tops)]

    by_cell = {}
    for i in body:
        by_cell[(as_int(i["posLeft"]), as_int(i["posTop"]))] = i

    return {
        "container": container,
        "left": left0, "top": top0,
        "columns": columns,
        "rows": rows,
        "header_tops": header_tops,
        "header_height": as_int(headers[0]["posHeight"]) if headers else None,
        "row_height": as_int(body[0]["posHeight"]) if body else None,
        "cells": by_cell,
        "headers": headers,
        "body": body,
    }


def column_of(geometry, abs_left):
    for column in geometry["columns"]:
        if column["abs_left"] <= abs_left < column["abs_left"] + column["width"]:
            return column
    return None


def row_of(geometry, abs_top):
    """The body row an object sits in, plus its offset inside that row."""
    best = None
    for row in geometry["rows"]:
        if row["abs_top"] <= abs_top and (best is None or row["abs_top"] > best["abs_top"]):
            best = row
    if best is None:
        return None, None
    return best, abs_top - best["abs_top"]


def room_labels(geometry):
    """The room number in each body row, read from the first column's cells."""
    first = geometry["columns"][0]
    out = {}
    for row in geometry["rows"]:
        cell = geometry["cells"].get((first["rel_left"], row["rel_top"]))
        if cell is not None:
            out[row["index"]] = cell.get("tag_text")
    return out


# --------------------------------------------------------------------------
# Measurement report
# --------------------------------------------------------------------------

def report(document, out=sys.stdout):
    env = envelope_of(document)
    panel = env["panel"]
    objects = panel["single_objects"]
    w = out.write

    w("ENVELOPE\n")
    for key in ("format", "version", "exported_at", "generator", "source_plant_id",
                "panel_name", "panel_width", "panel_height", "background_embedded"):
        w(f"  {key:20s} {env.get(key)!r}\n")
    w(f"  counts               {env.get('counts')!r}\n")
    w(f"  top-level keys       {list(env.keys())}\n")

    w("\nPANEL KEYS\n")
    for key, value in panel.items():
        if isinstance(value, list):
            w(f"  {key:20s} list, {len(value)} entries\n")
        elif isinstance(value, str) and len(value) > 60:
            w(f"  {key:20s} str, {len(value)} chars, starts {value[:44]!r}\n")
        else:
            w(f"  {key:20s} {value!r}\n")

    w("\nCOUNTS VS ARRAY LENGTHS\n")
    for key in ("single_objects", "containers", "graphics"):
        w(f"  {key:20s} declared {(env.get('counts') or {}).get(key)!r}, "
          f"actual {len(panel.get(key) or [])}\n")

    w("\nOBJ_ID FREQUENCY - single_objects\n")
    sizes = collections.defaultdict(set)
    for obj in objects:
        sizes[obj["obj_id"]].add((as_int(obj["posWidth"]), as_int(obj["posHeight"])))
    for obj_id, count in collections.Counter(o["obj_id"] for o in objects).most_common():
        dims = ", ".join(f"{a}x{b}" for a, b in sorted(sizes[obj_id]))
        w(f"  {count:5d}  {obj_id:32s} {dims}\n")

    w("\nFIELD UNIFORMITY - single_objects\n")
    for field in OBJECT_FIELDS:
        counter = collections.Counter(repr(o.get(field)) for o in objects)
        if len(counter) > 4:
            w(f"  {field:12s} {len(counter)} distinct values\n")
        else:
            w(f"  {field:12s} " + ", ".join(f"{v} x{n}" for v, n in counter.most_common()) + "\n")

    names = [o["name"] for o in objects]
    lefts = [as_int(o["posLeft"]) for o in objects]
    tops = [as_int(o["posTop"]) for o in objects]
    rights = [as_int(o["posLeft"]) + as_int(o["posWidth"]) for o in objects]
    bottoms = [as_int(o["posTop"]) + as_int(o["posHeight"]) for o in objects]
    w("\nNAMES AND EXTENT\n")
    w(f"  names sequential object_0..object_{len(objects) - 1}: "
      f"{names == [f'object_{i}' for i in range(len(objects))]}\n")
    w(f"  left  {min(lefts)}..{max(lefts)}   right edge max {max(rights)}\n")
    w(f"  top   {min(tops)}..{max(tops)}   bottom edge max {max(bottoms)}\n")
    w(f"  declared canvas {env.get('panel_width')} x {env.get('panel_height')}\n")
    w("  NOTE: content beyond the declared canvas is legitimate - the plant view\n"
      "  scrolls (CLAUDE.md gotcha 25). panel_height is a viewport, not a clip.\n")
    missing = {o["name"]: [f for f in OBJECT_FIELDS if f not in o] for o in objects}
    w(f"  objects missing any of the 17 fields: "
      f"{[n for n, m in missing.items() if m] or 'none'}\n")

    container = the_container(env)
    if container is None:
        w("\nNO CONTAINER - this is not a room-control table panel\n")
        return

    w(f"\nCONTAINER ANATOMY - {len(panel['containers'])} container(s), "
      f"{len(container.keys())} keys\n")
    for key, value in container.items():
        if key == "items":
            w(f"  {key:16s} list, {len(value)} items\n")
        else:
            w(f"  {key:16s} {value!r}  ({type(value).__name__})\n")

    items = container["items"]
    w("\nOBJ_ID FREQUENCY - container items\n")
    item_sizes = collections.defaultdict(set)
    for item in items:
        item_sizes[item["obj_id"]].add((as_int(item["posWidth"]), as_int(item["posHeight"])))
    for obj_id, count in collections.Counter(i["obj_id"] for i in items).most_common():
        dims = ", ".join(f"{a}x{b}" for a, b in sorted(item_sizes[obj_id]))
        w(f"  {count:5d}  {obj_id:32s} {dims}\n")

    w("\nFIELD UNIFORMITY - container items\n")
    for field in OBJECT_FIELDS:
        counter = collections.Counter(repr(i.get(field)) for i in items)
        if len(counter) > 4:
            w(f"  {field:12s} {len(counter)} distinct values\n")
        else:
            w(f"  {field:12s} " + ", ".join(f"{v} x{n}" for v, n in counter.most_common()) + "\n")

    geometry = table_geometry(env)
    w("\nTABLE GRID\n")
    w(f"  container origin        ({geometry['left']},{geometry['top']})\n")
    w(f"  declared num_of_col     {container.get('num_of_col')!r}, "
      f"header cells on first band {len(geometry['columns'])}\n")
    w(f"  declared num_of_rows    {container.get('num_of_rows')!r}, "
      f"distinct body-cell tops {len(geometry['rows'])}\n")
    w(f"  header bands at rel top {geometry['header_tops']}, height {geometry['header_height']}\n")
    row_tops = [r["rel_top"] for r in geometry["rows"]]
    pitches = collections.Counter(b - a for a, b in zip(row_tops, row_tops[1:]))
    w(f"  body row height         {geometry['row_height']}\n")
    w(f"  body row pitch          {dict(pitches)}\n")
    w(f"  first body row rel top  {row_tops[0]}, last {row_tops[-1]}, "
      f"declared last_y {container.get('last_y')!r}\n")
    band_gaps = [b - a for a, b in zip(geometry["header_tops"], geometry["header_tops"][1:])]
    bands = geometry["header_tops"] + [row_tops[-1] + geometry["row_height"] + 1]
    per_band = [sum(1 for t in row_tops if a < t < b)
                for a, b in zip(bands, bands[1:])]
    w(f"  header band pitch       {band_gaps}  "
      f"(= header {geometry['header_height']} + "
      f"{[(g - geometry['header_height']) // geometry['row_height'] for g in band_gaps]} "
      f"body rows)\n")
    w(f"  body rows per band      {per_band}\n")

    w("\nCOLUMNS - container-relative left / width / header text\n")
    live = collections.Counter()
    for obj in objects:
        column = column_of(geometry, as_int(obj["posLeft"]))
        if column is not None:
            live[column["index"]] += 1
    for column in geometry["columns"]:
        w(f"  {column['index']:3d}  rel {column['rel_left']:5d}  abs {column['abs_left']:5d}  "
          f"w {column['width']:4d}  objects {live.get(column['index'], 0):5d}  "
          f"{column['title']!r}\n")
    w(f"  {sum(1 for c in geometry['columns'] if live.get(c['index'])):d} of "
      f"{len(geometry['columns'])} columns carry canvas objects\n")

    rooms = room_labels(geometry)
    ordered = [rooms[i] for i in sorted(rooms) if rooms.get(i)]
    w(f"\nROOMS - {len(ordered)} body rows carry a room label in column 0\n")
    w(f"  {ordered}\n")
    w(f"  strictly ascending as integers: "
      f"{all(int(a) < int(b) for a, b in zip(ordered, ordered[1:]))}\n")
    floors = collections.Counter(str(r)[0] for r in ordered)
    w(f"  leading digit (floor) histogram: {dict(sorted(floors.items()))}\n")
    w(f"  duplicates: {[r for r, n in collections.Counter(ordered).items() if n > 1] or 'none'}\n")

    w("\nOBJECT PLACEMENT INSIDE A CELL - offsets from the body cell's top-left\n")
    offsets = collections.defaultdict(collections.Counter)
    per_room = collections.Counter()
    unplaced = []
    for obj in objects:
        column = column_of(geometry, as_int(obj["posLeft"]))
        row, dy = row_of(geometry, as_int(obj["posTop"]))
        if column is None or row is None:
            unplaced.append(obj["name"])
            continue
        offsets[obj["obj_id"]][(as_int(obj["posLeft"]) - column["abs_left"], dy)] += 1
        per_room[rooms.get(row["index"])] += 1
    for obj_id, counter in offsets.items():
        w(f"  {obj_id:32s} " + ", ".join(f"dx{a} dy{b} x{n}" for (a, b), n in counter.most_common()) + "\n")
    w(f"  objects outside the grid: {len(unplaced)} {unplaced[:6]}\n")

    w("\nOBJECTS PER ROOM\n")
    shape = collections.Counter(per_room.values())
    for count, rooms_with in shape.most_common():
        w(f"  {rooms_with:3d} rooms carry {count} objects\n")

    w("\nANOMALIES\n")
    found = []
    coincident = collections.defaultdict(list)
    for obj in objects:
        coincident[(as_int(obj["posLeft"]), as_int(obj["posTop"]))].append(obj["name"])
    for pos, names_at in sorted(coincident.items()):
        if len(names_at) > 1:
            found.append(f"coincident at {pos}: {names_at}")
    at_origin = [o["name"] for o in objects
                 if as_int(o["posLeft"]) == 0 and as_int(o["posTop"]) == 0]
    if at_origin:
        found.append(f"objects at 0,0: {at_origin}")
    dupes = [d for d, n in collections.Counter(
        o["driver_id"] for o in objects if o.get("driver_id")).items() if n > 1]
    if dupes:
        found.append(f"duplicate driver_id: {dupes[:5]} ({len(dupes)} total)")
    bound_but_unlinked = [o["name"] for o in objects
                          if o.get("driver_id") and o.get("linked") != "true"]
    if bound_but_unlinked:
        found.append(f"driver_id set but linked != true: {bound_but_unlinked[:5]}")
    linked_no_binding = [o["name"] for o in objects
                         if o.get("linked") == "true" and not o.get("driver_id")]
    if linked_no_binding:
        found.append(f"linked=true with empty driver_id: {len(linked_no_binding)} objects "
                     f"{linked_no_binding[:5]} - host behaviour (V3scripts.js:514), not a defect")
    for line in found or ["none"]:
        w(f"  {line}\n")


# --------------------------------------------------------------------------
# SQL cross-check
# --------------------------------------------------------------------------

SQL_COLUMNS = (
    "row_date", "driver_type", "unit_id", "unit_name", "driver_group", "onl_ind",
    "update_freq", "save_data", "save_freq", "plant_pri", "sys_pri", "alarm_block",
    "alarm_type", "element_id", "driver_id_no", "driver_id", "alias_text", "menu",
    "application", "parameter_type", "hardware_datatype", "relation", "eng_unit",
    "format", "range_min", "range_max", "scale", "raw_min", "raw_max", "eng_min",
    "eng_max", "grp", "att", "grp_name", "regulator_type", "order_no",
    "user_attribs", "driver_adr_extra", "driver_id_extra", "format_extra",
    "category_id",
)
BACKSLASH = chr(92)


def split_sql_tuple(text):
    """Split one INSERT tuple. Handles '' and backslash escapes."""
    out, cur, quoted, i = [], "", False, 0
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == BACKSLASH:
                cur += text[i + 1]
                i += 2
                continue
            if ch == "'":
                if i + 1 < len(text) and text[i + 1] == "'":
                    cur += "'"
                    i += 2
                    continue
                quoted = False
                i += 1
                continue
            cur += ch
            i += 1
            continue
        if ch == "'":
            quoted = True
            i += 1
            continue
        if ch == ",":
            out.append(cur.strip())
            cur = ""
            i += 1
            continue
        cur += ch
        i += 1
    out.append(cur.strip())
    return out


def parse_sql(path):
    """Rows of iw_gen_driver_parameters, keyed by driver_id.

    UTF-8 on purpose. Reading this dump as latin-1 turns every Norwegian
    character into mojibake and makes 100 % of the alias comparisons below
    fail for a reason that has nothing to do with the panel.
    """
    text = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
    rows, malformed = [], 0
    for match in re.finditer(r"^\((.*)\)[,;]\s*$", text, re.M):
        values = split_sql_tuple(match.group(1))
        if len(values) != len(SQL_COLUMNS):
            malformed += 1
            continue
        rows.append(dict(zip(SQL_COLUMNS, values)))
    return rows, malformed


def sql_crosscheck(document, sql_path, out=sys.stdout):
    w = out.write
    rows, malformed = parse_sql(sql_path)
    by_driver = {r["driver_id"]: r for r in rows}
    w(f"SQL SOURCE  {sql_path}\n")
    w(f"  rows parsed {len(rows)}, malformed {malformed}, "
      f"distinct driver_id {len(by_driver)}, distinct unit_id "
      f"{len({r['unit_id'] for r in rows})}\n")

    env = envelope_of(document)
    objects = env["panel"]["single_objects"]
    bound = [o for o in objects if o.get("driver_id")]
    w(f"\nPANEL       {len(objects)} objects, {len(bound)} with a driver_id\n")

    missing = [o for o in bound if o["driver_id"] not in by_driver]
    unit_bad = [o for o in bound
                if o["driver_id"] in by_driver
                and by_driver[o["driver_id"]]["unit_id"] != o.get("unit_id")]
    alias_exact = alias_ws = alias_bad = 0
    samples = []
    for obj in bound:
        row = by_driver.get(obj["driver_id"])
        if row is None:
            continue
        panel_alias, sql_alias = obj.get("alias_text", ""), row["alias_text"]
        if panel_alias == sql_alias:
            alias_exact += 1
        elif re.sub(r"\s+", " ", panel_alias).strip() == re.sub(r"\s+", " ", sql_alias).strip():
            alias_ws += 1
        else:
            alias_bad += 1
            if len(samples) < 5:
                samples.append((obj["name"], panel_alias, sql_alias))

    w(f"  driver_id not found in the dump : {len(missing)}\n")
    for obj in missing[:5]:
        w(f"      {obj['name']} {obj['driver_id']!r}\n")
    w(f"  unit_id disagrees with the dump : {len(unit_bad)}\n")
    for obj in unit_bad[:5]:
        w(f"      {obj['name']} panel {obj['unit_id']!r} "
          f"sql {by_driver[obj['driver_id']]['unit_id']!r}\n")
    w(f"  alias_text byte-identical       : {alias_exact}\n")
    w(f"  alias_text whitespace-only diff : {alias_ws}\n")
    w(f"  alias_text different            : {alias_bad}\n")
    for name, panel_alias, sql_alias in samples:
        w(f"      {name}\n        panel {panel_alias!r}\n        sql   {sql_alias!r}\n")

    w("\nSIGNAL ROLE BY OBJ_ID - what the dump says about each object family\n")
    by_obj = collections.defaultdict(collections.Counter)
    for obj in bound:
        row = by_driver.get(obj["driver_id"])
        if row is None:
            continue
        by_obj[obj["obj_id"]][(row["application"], row["parameter_type"],
                               row["hardware_datatype"], row["att"], row["eng_unit"])] += 1
    for obj_id, counter in by_obj.items():
        w(f"  {obj_id}\n")
        for key, count in counter.most_common():
            w(f"      {key} x{count}\n")

    geometry = table_geometry(env)
    if geometry is not None:
        w("\nCOLUMN -> SIGNAL, read from the dump (menu code / element suffix)\n")
        per_column = collections.defaultdict(list)
        for obj in objects:
            column = column_of(geometry, as_int(obj["posLeft"]))
            if column is not None:
                per_column[column["index"]].append(obj)
        for column in geometry["columns"]:
            members = per_column.get(column["index"], [])
            if not members:
                w(f"  {column['index']:3d}  abs {column['abs_left']:5d}  "
                  f"(no objects)                    {column['title']!r}\n")
                continue
            sql_rows = [by_driver[o["driver_id"]] for o in members
                        if o.get("driver_id") in by_driver]
            menus = collections.Counter(r["menu"] for r in sql_rows)
            atts = collections.Counter(r["att"] for r in sql_rows)
            units = collections.Counter(r["eng_unit"] for r in sql_rows)
            types = collections.Counter(r["parameter_type"] for r in sql_rows)
            suffix = collections.Counter(
                re.sub(r"^=\S+?-", "", r["element_id"]) for r in sql_rows)
            obj_ids = collections.Counter(o["obj_id"] for o in members)
            w(f"  {column['index']:3d}  abs {column['abs_left']:5d}  n={len(members):3d}  "
              f"{obj_ids.most_common(1)[0][0]:28s} menu={'/'.join(menus):8s} "
              f"att={'/'.join(atts):3s} unit={'/'.join(u for u in units if u) or '-':4s} "
              f"type={'/'.join(types):8s} {list(suffix)[:2]}  {column['title']!r}\n")

    return 1 if (missing or unit_bad or alias_bad) else 0


# --------------------------------------------------------------------------
# Serialization
# --------------------------------------------------------------------------

def dump_document(document):
    """Indented JSON, except that every 17-field record stays on ONE line.

    3,355 records at seventeen lines each is 57,000 lines of diff for a change
    to one cell. One line per record keeps the file reviewable: a moved object
    is one changed line, and `git diff` on this fixture is readable output
    rather than a wall. It also halves the file. Nothing reads the formatting -
    the validator and the tests json.load() it.
    """
    def encode(value, depth):
        pad = " " * depth
        if isinstance(value, dict):
            if "obj_id" in value:
                return json.dumps(value, ensure_ascii=False)
            if not value:
                return "{}"
            body = ",\n".join(
                f"{pad} {json.dumps(k, ensure_ascii=False)}: {encode(v, depth + 1)}"
                for k, v in value.items())
            return "{\n" + body + "\n" + pad + "}"
        if isinstance(value, list):
            if not value:
                return "[]"
            body = ",\n".join(f"{pad} {encode(v, depth + 1)}" for v in value)
            return "[\n" + body + "\n" + pad + "]"
        return json.dumps(value, ensure_ascii=False)

    return encode(document, 0) + "\n"


# --------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source", type=pathlib.Path,
                        help="the retained production export (not committed)")
    parser.add_argument("-o", "--output", type=pathlib.Path, default=None,
                        help=f"write the masked fixture here (default {DEFAULT_OUT})")
    parser.add_argument("--report", action="store_true",
                        help="print the measured analysis instead of writing a fixture")
    parser.add_argument("--sql", type=pathlib.Path, default=None,
                        help="cross-check every binding against an "
                             "iw_gen_driver_parameters dump instead of writing a fixture")
    args = parser.parse_args(argv)

    document = json.loads(args.source.read_text(encoding="utf-8"))

    if args.sql:
        return sql_crosscheck(document, args.sql)
    if args.report:
        report(document)
        return 0

    source_env = envelope_of(document)
    plant_id = (source_env.get("source_plant_id")
                or (source_env.get("panel") or {}).get("plant_id") or "")

    fixture = mask(document, plant_id)
    problems = residue(fixture, plant_id)
    if problems:
        for problem in problems:
            print(f"REFUSING TO WRITE: {problem}", file=sys.stderr)
        return 1

    target = args.output or DEFAULT_OUT
    target.write_text(dump_document(fixture), encoding="utf-8")
    panel = fixture["envelope"]["panel"]
    items = sum(len(c.get("items") or []) for c in panel["containers"])
    print(f"wrote {target} - {len(panel['single_objects'])} objects, "
          f"{len(panel['containers'])} container(s), {items} items, "
          f"{target.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
