#!/usr/bin/env python3
"""Deterministic validator for IWMAC Designer room-control table panels.

Usage::

    python validate-romkontroll-panel.py PANEL.json --check
    python validate-romkontroll-panel.py PANEL.json --check --source-sql DUMP.sql
    python validate-romkontroll-panel.py PANEL.json --profile TEMPLATE-8653-ROMKONTROLL
    python validate-romkontroll-panel.py --compare SOURCE.json CANDIDATE.json
    python validate-romkontroll-panel.py PANEL.json --json-report

The rules are data, not code. Everything panel-type- and template-specific is
read from ``documentation-rules.json``, and the grid is derived by the same
functions that built the fixture (``build-romkontroll-fixture.py``), so the
contract, the fixture, the machine-readable rules and this validator cannot
drift apart. There is no second definition of what a column is.

Five rule namespaces, matching ROMKONTROLL-GENERATION-CONTRACT.md section 11:

``R-S*``  the document - envelope, counts, object names, all 17 fields,
          geometry types, the object vocabulary, the background.
``R-T*``  the table - one ``table_container``, a complete grid, regular header
          bands, every canvas object centred in its cell, the rooms.
``R-B*``  the bindings - output-mode consistency, and with ``--source-sql``
          every identifier checked against the plant's parameter dump.
``R-P*``  the profile - one building's measured geometry. A failure on another
          plant means the profile does not apply, not that the panel is wrong.
``R-C*``  source versus candidate - what changed between a known-good export
          and a generated or edited file.

WHY THIS EXISTS
    On 2026-08-10 two generated versions of this exact panel were rejected. The
    first was a custom dataset - correct room analysis, no ``format``, no
    ``panel.single_objects`` - a JSON file that was not a panel document. The
    second carried a correct envelope around a placeholder overview: 59 objects
    instead of 1553, all labels and headings, zero containers, every object
    ``linked "false"`` with ``driver_id "driver_id"``, although the parameter
    dump was attached and every binding was available. Both parsed cleanly.
    Neither was usable. Every check below exists because one of those two, or
    an edit that would have produced them, gets past a human reading the file.

WHAT THIS CANNOT DO
    It cannot tell whether the panel is the one the user wanted, whether the
    column order is functionally sensible, or whether a well-formed identifier
    names a parameter the controller actually exposes - without ``--source-sql``
    an invented ``driver_id`` is indistinguishable from a real one. It does not
    render anything, so it cannot see overlap, clipping or unreadable text. A
    clean run here is a necessary condition, never a sufficient one, and must
    never be reported as "the panel is correct".

Exit status is 0 when no finding has severity ``error``, 1 otherwise. This file
performs no network access and reads nothing outside the reference directory
except the panel and dump paths it is given.
"""

from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import pathlib
import re
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"
PALETTE_PATH = ROOT / "reference_data" / "all-design-objects.json"
REGISTRY_PATH = ROOT / "reference_data" / "controls-registry.json"
CATALOG_PATH = ROOT / "reference_data" / "design-object-catalog.json"
BUILDER_PATH = ROOT / "build-romkontroll-fixture.py"

PANEL_TYPE = "romkontroll_table"
DEFAULT_PROFILE = "TEMPLATE-8653-ROMKONTROLL"

PLACEHOLDER = "driver_id"
GEOMETRY_FIELDS = ("posWidth", "posHeight", "posLeft", "posTop")

MOJIBAKE = re.compile(r"[ÃÂ][\x80-\xbf]|�")
MASK_ONLY = re.compile(r"^N+$")
NUMERIC_TOKEN = re.compile(r"\d+")
RETIRED = re.compile(r"inactive|outdated|unsupported|deprecated", re.I)

# The one signature measured on every alarm-bell binding in the reference
# export: a read-only boolean with no engineering unit. An alarm LIMIT is a
# setpoint in degrees and gets a value box (contract section 5.1).
ALARM_SIGNATURE = {"hardware_datatype": "HW_ENUM", "att": "r", "eng_unit": ""}


# --------------------------------------------------------------------------
# the fixture builder is the single definition of the grid
# --------------------------------------------------------------------------

_BUILDER = None


def builder():
    """Import build-romkontroll-fixture.py once, by path.

    The hyphen in the filename makes it unimportable by name; the same
    importlib idiom is what build-romkontroll-rules.py uses. Deriving the grid
    here instead would create a second, silently divergent definition of what a
    column is.
    """
    global _BUILDER
    if _BUILDER is None:
        spec = importlib.util.spec_from_file_location(
            "build_romkontroll_fixture", BUILDER_PATH
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _BUILDER = module
    return _BUILDER


# --------------------------------------------------------------------------
# findings
# --------------------------------------------------------------------------


class Finding:
    __slots__ = ("rule", "severity", "message")

    def __init__(self, rule, severity, message):
        self.rule = rule
        self.severity = severity
        self.message = message

    def __repr__(self):
        return f"{self.severity.upper():7s} {self.rule:6s} {self.message}"

    def as_dict(self):
        return {"rule": self.rule, "severity": self.severity, "message": self.message}


def error(findings, rule, message):
    findings.append(Finding(rule, "error", message))


def warn(findings, rule, message):
    findings.append(Finding(rule, "warning", message))


def note(findings, rule, message):
    findings.append(Finding(rule, "info", message))


def sample(values, limit=8):
    values = list(values)
    shown = ", ".join(str(v) for v in values[:limit])
    return shown + (" ..." if len(values) > limit else "")


# --------------------------------------------------------------------------
# loaders
# --------------------------------------------------------------------------


def load_rules(path=RULES_PATH):
    return json.loads(path.read_text(encoding="utf-8"))


def load_allowlist():
    """Every obj_id the host can render, and the ones it marks retired.

    Two registries, because the table cell types the host generates itself are
    absent from the palette dump - conflict RC-C2. The allowlist is their
    union; the retired set comes from the catalogue's ``menu`` field
    (``Inactive_IBT``, ``Outdated____IBT``, ...).
    """
    palette = set()
    if PALETTE_PATH.exists():
        data = json.loads(PALETTE_PATH.read_text(encoding="utf-8"))
        palette = {e["object_id"] for e in data.get("all_design_objects", []) if e.get("object_id")}
    registry = set()
    if REGISTRY_PATH.exists():
        data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        registry = set(data.get("controls", {}))
    retired = set()
    if CATALOG_PATH.exists():
        data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        for object_id, entry in (data.get("objects") or {}).items():
            if RETIRED.search(str(entry.get("menu", ""))):
                retired.add(object_id)
    return palette, registry, retired


def read_document(path, findings):
    """Parse a panel file. R-S1 covers both the parse and the encoding."""
    try:
        text = pathlib.Path(path).read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        error(findings, "R-S1", f"{path} is not valid UTF-8: {exc}")
        return None
    except OSError as exc:
        error(findings, "R-S1", f"{path} could not be read: {exc}")
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        error(findings, "R-S1", f"{path} is not valid JSON: {exc}")
        return None


# --------------------------------------------------------------------------
# the panel under test
# --------------------------------------------------------------------------


class Panel:
    """A parsed panel plus everything derived from it, computed once.

    Nothing here reports; it only measures. A panel whose container is missing
    or malformed still constructs - ``geometry`` is then ``None`` and the
    table checks say so rather than crashing.
    """

    def __init__(self, document, label):
        bf = builder()
        self.label = pathlib.Path(label).name
        self.document = document
        self.envelope = bf.envelope_of(document) if isinstance(document, dict) else {}
        if not isinstance(self.envelope, dict):
            self.envelope = {}
        self.panel = self.envelope.get("panel")
        panel = self.panel if isinstance(self.panel, dict) else {}
        self.objects = panel.get("single_objects") if isinstance(panel.get("single_objects"), list) else []
        self.containers = panel.get("containers") if isinstance(panel.get("containers"), list) else []
        self.graphics = panel.get("graphics") if isinstance(panel.get("graphics"), list) else []

        self.geometry = None
        self.geometry_error = None
        try:
            self.geometry = bf.table_geometry(self.envelope)
        except Exception as exc:  # a missing or unusable container
            self.geometry_error = f"{type(exc).__name__}: {exc}"

        self.label_columns = []
        self.signal_columns = []
        self.rooms = {}
        self.placed = {}       # object name -> (column, row)
        self.strays = []       # objects that sit outside the grid
        if self.geometry:
            self._classify_columns()
            self.rooms = bf.room_labels(self.geometry)
            self._place_objects()

    # -- derived -----------------------------------------------------------

    def _classify_columns(self):
        """A label column is one whose body cells carry real text.

        Signal-column body cells carry a single space; the room-number and
        description columns carry the room and its description. That is the
        discriminator, and it does not depend on which indices this building
        happens to use.
        """
        cells = self.geometry["cells"]
        for column in self.geometry["columns"]:
            texts = []
            for row in self.geometry["rows"]:
                cell = cells.get((column["rel_left"], row["rel_top"]))
                if cell is not None:
                    texts.append(str(cell.get("tag_text") or "").strip())
            filled = sum(1 for t in texts if t)
            if texts and filled * 2 > len(texts):
                self.label_columns.append(column)
            else:
                self.signal_columns.append(column)

    def _place_objects(self):
        bf = builder()
        geometry = self.geometry
        height = geometry["row_height"]
        for obj in self.objects:
            if not isinstance(obj, dict):
                continue
            left = bf.as_int(obj.get("posLeft"))
            top = bf.as_int(obj.get("posTop"))
            column = bf.column_of(geometry, left)
            row, offset = bf.row_of(geometry, top)
            if column is not None and row is not None and offset is not None and 0 <= offset < height:
                self.placed[obj.get("name")] = (column, row)
            else:
                self.strays.append(obj)

    # -- convenience -------------------------------------------------------

    @property
    def container(self):
        return self.containers[0] if len(self.containers) == 1 and isinstance(self.containers[0], dict) else None

    def grid_objects(self):
        return [o for o in self.objects if isinstance(o, dict) and o.get("name") in self.placed]

    def bound_objects(self):
        return [
            o for o in self.objects
            if isinstance(o, dict) and str(o.get("driver_id") or "") not in ("", PLACEHOLDER)
        ]

    def mode(self):
        """A, B or C - and 'mixed' when the file is half linked.

        A production export never writes the literal string ``driver_id``; only
        a generated template does. That asymmetry is the whole discriminator
        (CLAUDE.md section 17b, contract section 10).
        """
        if not self.objects:
            return "empty"
        placeholders = sum(1 for o in self.objects if isinstance(o, dict) and o.get("driver_id") == PLACEHOLDER)
        bound = len(self.bound_objects())
        if placeholders and bound:
            return "mixed"
        if placeholders:
            return "B"
        if bound:
            return "C"
        return "unbound"

    def cell_for(self, column, row):
        return self.geometry["cells"].get((column["rel_left"], row["rel_top"]))

    def room_of(self, row):
        return self.rooms.get(row["index"])

    def key_of(self, obj):
        """(room, column title) - the identity that survives renumbering."""
        placement = self.placed.get(obj.get("name"))
        if placement is None:
            return None
        column, row = placement
        return (self.room_of(row), column["title"])


# --------------------------------------------------------------------------
# R-S* - the document
# --------------------------------------------------------------------------


def check_envelope(panel, findings):
    envelope = panel.envelope
    fmt = envelope.get("format")
    if fmt != "iwmac-designer-panel":
        error(findings, "R-S2", f"format is {fmt!r}, must be 'iwmac-designer-panel'. A JSON file is not a panel document")
    version = envelope.get("version")
    if version != 1:
        error(findings, "R-S3", f"version is {version!r}, must be 1")
    if not isinstance(panel.panel, dict):
        error(findings, "R-S4", "no 'panel' object - there is nothing to import")
        return
    for key in ("single_objects", "containers", "graphics"):
        value = panel.panel.get(key)
        if value is None:
            error(findings, "R-S5", f"panel.{key} is missing")
        elif not isinstance(value, list):
            error(findings, "R-S5", f"panel.{key} is {type(value).__name__}, must be an array")
    if isinstance(panel.panel.get("single_objects"), list) and not panel.objects:
        error(findings, "R-S4", "panel.single_objects is empty - an empty panel is not this panel type")


def check_counts(panel, findings):
    counts = panel.envelope.get("counts")
    if not isinstance(counts, dict):
        warn(findings, "R-S6", "no 'counts' block - the importer does not need it, but a reader cannot cross-check the arrays")
        return
    measured = {
        "single_objects": len(panel.objects),
        "containers": len(panel.containers),
        "graphics": len(panel.graphics),
    }
    for key, actual in measured.items():
        declared = counts.get(key)
        if declared is None:
            warn(findings, "R-S6", f"counts.{key} is missing (measured {actual})")
        elif declared != actual:
            error(findings, "R-S6", f"counts.{key} says {declared}, the array holds {actual}")


def check_names(panel, findings):
    names = [o.get("name") for o in panel.objects if isinstance(o, dict)]
    duplicates = [n for n, c in collections.Counter(names).items() if c > 1]
    if duplicates:
        error(findings, "R-S7", f"{len(duplicates)} duplicate object name(s): {sample(duplicates)}")
    expected = [f"object_{i}" for i in range(len(names))]
    if names != expected:
        wrong = [(i, n) for i, n in enumerate(names) if n != expected[i]]
        error(
            findings,
            "R-S7",
            f"object names are not object_0..object_{len(names) - 1}: "
            f"{len(wrong)} position(s) differ, first at index {wrong[0][0]} ({wrong[0][1]!r})",
        )


def check_fields(panel, rules, findings):
    fields = tuple(builder().OBJECT_FIELDS)
    missing = collections.Counter()
    extra = collections.Counter()
    for obj in panel.objects:
        if not isinstance(obj, dict):
            error(findings, "R-S8", "a single_objects entry is not an object")
            return
        for field in fields:
            if field not in obj:
                missing[field] += 1
        for key in obj:
            if key not in fields and key != "file_pdf":
                extra[key] += 1
    for field, count in missing.most_common():
        error(findings, "R-S8", f"{count} object(s) are missing the field {field!r} (all {len(fields)} are required)")
    for key, count in extra.most_common():
        warn(findings, "R-S8", f"{count} object(s) carry the unknown field {key!r}")

    constants = (
        rules.get("panel_types", {})
        .get(PANEL_TYPE, {})
        .get("object_fields", {})
        .get("constants_on_this_panel_type", {})
    )
    for field in ("id", "link_name"):
        expected = constants.get(field)
        if expected is None:
            continue
        wrong = [o for o in panel.objects if isinstance(o, dict) and o.get(field) != expected]
        if wrong:
            seen = sorted({repr(o.get(field)) for o in wrong})
            error(
                findings,
                "R-S11",
                f"{len(wrong)} object(s) carry {field} {sample(seen, 3)} instead of {expected!r}: "
                f"{sample([o.get('name') for o in wrong], 5)}",
            )
    for field in ("link_tag", "sub_group", "unit_ref", "posHeight"):
        if field not in constants:
            continue
        expected = constants[field]
        wrong = [o.get("name") for o in panel.objects if isinstance(o, dict) and o.get(field) != expected]
        if wrong:
            warn(
                findings,
                "R-S11",
                f"{len(wrong)} object(s) differ from the reference constant {field}={expected!r}: {sample(wrong, 5)}",
            )


def check_geometry_types(panel, findings):
    bad_type = []
    negative = []
    for obj in panel.objects:
        if not isinstance(obj, dict):
            continue
        for field in GEOMETRY_FIELDS:
            value = obj.get(field)
            if isinstance(value, bool) or not isinstance(value, int):
                bad_type.append(f"{obj.get('name')}.{field}={value!r}")
            elif value < 0:
                negative.append(f"{obj.get('name')}.{field}={value}")
    if bad_type:
        error(findings, "R-S9", f"{len(bad_type)} geometry field(s) are not JSON integers: {sample(bad_type, 5)}")
    if negative:
        warn(findings, "R-S9", f"{len(negative)} geometry field(s) are negative: {sample(negative, 5)}")

    defaults = [o.get("name") for o in panel.objects if isinstance(o, dict) and o.get("zIndex") == "default"]
    if defaults:
        error(
            findings,
            "R-S10",
            f"{len(defaults)} object(s) carry zIndex 'default'. This panel type uses explicit bands; "
            f"'default' makes array order the stacking order: {sample(defaults, 5)}",
        )
    non_string = [
        f"{o.get('name')}={o.get('zIndex')!r}"
        for o in panel.objects
        if isinstance(o, dict) and not isinstance(o.get("zIndex"), str)
    ]
    if non_string:
        error(findings, "R-S10", f"{len(non_string)} object(s) have a non-string zIndex: {sample(non_string, 5)}")


def check_vocabulary(panel, rules, findings):
    palette, registry, retired = load_allowlist()
    if not palette and not registry:
        warn(findings, "R-S12", "neither all-design-objects.json nor controls-registry.json is present - obj_id was not checked")
        return
    allowed = palette | registry
    census = collections.Counter(
        o.get("obj_id") for o in panel.objects if isinstance(o, dict)
    )
    if panel.container:
        census.update(
            item.get("obj_id")
            for item in panel.container.get("items", [])
            if isinstance(item, dict)
        )
    unknown = {k: v for k, v in census.items() if k not in allowed}
    if unknown:
        error(
            findings,
            "R-S12",
            f"{len(unknown)} obj_id(s) appear in neither the palette nor the controls registry - "
            f"they render as broken undefined-class boxes: {sample(sorted(unknown))}",
        )
    dead = {k: v for k, v in census.items() if k in retired}
    if dead:
        error(findings, "R-S12", f"obj_id(s) the catalogue marks inactive or outdated: {sample(sorted(dead))}")
    registry_only = sorted(k for k in census if k in registry and k not in palette)
    if registry_only:
        note(
            findings,
            "R-S12",
            f"host-generated cell type(s) present in controls-registry.json but not in the palette dump "
            f"(conflict RC-C2, expected for a table container): {sample(registry_only)}",
        )

    vocabulary = rules.get("panel_types", {}).get(PANEL_TYPE, {}).get("object_vocabulary", {})
    if vocabulary:
        outside = sorted(
            k for k, v in census.items()
            if k not in vocabulary and k not in {"number_v3_cell_grey25", "number_v3_header_grey75"}
        )
        if outside:
            note(
                findings,
                "R-S12",
                f"obj_id(s) outside the reference vocabulary for this panel type - legal, but say why: {sample(outside)}",
            )


def check_background(panel, findings):
    if not isinstance(panel.panel, dict):
        return
    embedded = panel.envelope.get("background_embedded")
    image_data = panel.panel.get("image_data")
    converted = panel.panel.get("converted")
    has_data = isinstance(image_data, str) and image_data.startswith("data:image")
    if embedded is True and not has_data:
        error(findings, "R-S13", "background_embedded is true but panel.image_data carries no data URI")
    if embedded is False and has_data:
        warn(findings, "R-S13", "background_embedded is false but panel.image_data carries a data URI")
    if has_data and converted != "true":
        error(findings, "R-S13", f"panel.image_data is present but converted is {converted!r} - the host renders the background only when converted is 'true'")
    if not has_data:
        warn(findings, "R-S13", "no embedded background - this panel type ships the blank canvas in image_data")
    if "image_svg_trace" in panel.panel:
        error(
            findings,
            "R-S14",
            "panel.image_svg_trace is input-only; applyImportCore deletes it before rendering. Never re-emit it",
        )
    if panel.panel.get("image_svg"):
        error(
            findings,
            "R-S14",
            "panel.image_svg is authored artwork. A room-control table draws its grid with a container, not with an SVG",
        )


def check_stacking(panel, findings):
    at_origin = [
        o.get("name")
        for o in panel.objects
        if isinstance(o, dict) and o.get("posLeft") == 0 and o.get("posTop") == 0
    ]
    if at_origin:
        warn(
            findings,
            "R-S15",
            f"{len(at_origin)} object(s) sit at (0,0) - usually malformed geometry parsed to 0: {sample(at_origin, 5)}",
        )
    boxes = collections.Counter(
        (o.get("obj_id"), o.get("posLeft"), o.get("posTop"), o.get("posWidth"), o.get("posHeight"))
        for o in panel.objects
        if isinstance(o, dict)
    )
    stacked = {k: v for k, v in boxes.items() if v > 1}
    if stacked:
        warn(
            findings,
            "R-S16",
            f"{len(stacked)} coincident object position(s), {sum(stacked.values())} objects involved - "
            f"explain each or remove the copies: {sample([f'{k[0]}@{k[1]},{k[2]} x{v}' for k, v in stacked.items()], 4)}",
        )


def check_encoding(panel, findings):
    hits = []
    for obj in panel.objects:
        if not isinstance(obj, dict):
            continue
        for field in ("alias_text", "tag_text", "link_name", "sub_group"):
            value = obj.get(field)
            if isinstance(value, str) and MOJIBAKE.search(value):
                hits.append(f"{obj.get('name')}.{field}={value!r}")
    if hits:
        error(
            findings,
            "R-S17",
            f"{len(hits)} field(s) carry mojibake - the dump was read as latin-1 instead of UTF-8: {sample(hits, 4)}",
        )


# --------------------------------------------------------------------------
# R-T* - the table
# --------------------------------------------------------------------------


def check_table(panel, rules, findings):
    if len(panel.containers) != 1:
        error(
            findings,
            "R-T1",
            f"{len(panel.containers)} container(s); this panel type has exactly one table_container. "
            f"A file with no container is not a room-control table - it is a headings-and-labels overview",
        )
    container = panel.container
    if container is None:
        return
    if container.get("container_type") != "table_container":
        error(findings, "R-T1", f"container_type is {container.get('container_type')!r}, must be 'table_container'")
    if container.get("type") != "container_c":
        warn(findings, "R-T1", f"container type is {container.get('type')!r}, the reference uses 'container_c'")
    unique_id = str(container.get("unique_id") or "")
    if "custom_" not in unique_id:
        error(
            findings,
            "R-T2",
            f"container unique_id is {unique_id!r}; it must contain 'custom_' or the container "
            f"silently vanishes on Insert (V3scripts.js:528, .template() is an empty stub)",
        )
    if container.get("zIndex") != 4:
        warn(findings, "R-T3", f"container zIndex is {container.get('zIndex')!r}, the reference uses the number 4")

    items = container.get("items")
    if not isinstance(items, list) or not items:
        error(findings, "R-T1", "the container has no items - nothing draws the grid")
        return
    bad_z = [i.get("name") for i in items if isinstance(i, dict) and i.get("zIndex") != "5"]
    if bad_z:
        warn(findings, "R-T3", f"{len(bad_z)} container item(s) do not carry zIndex '5': {sample(bad_z, 5)}")

    bad_tag = [i.get("name") for i in items if isinstance(i, dict) and i.get("link_tag") != "NA"]
    if bad_tag:
        warn(findings, "R-T14", f"{len(bad_tag)} container item(s) do not carry link_tag 'NA': {sample(bad_tag, 5)}")
    bound_items = [i.get("name") for i in items if isinstance(i, dict) and str(i.get("driver_id") or "")]
    if bound_items:
        error(
            findings,
            "R-T14",
            f"{len(bound_items)} container item(s) carry a driver_id. Grid cells draw the table; "
            f"the values live in single_objects: {sample(bound_items, 5)}",
        )

    if panel.graphics:
        error(findings, "R-T15", f"panel.graphics holds {len(panel.graphics)} entries; this panel type has none")

    if panel.geometry is None:
        error(findings, "R-T6", f"the grid could not be derived from the container ({panel.geometry_error})")
        return

    geometry = panel.geometry
    columns = geometry["columns"]
    rows = geometry["rows"]

    declared_col = builder().as_int(container.get("num_of_col"))
    if declared_col != len(columns):
        error(findings, "R-T4", f"num_of_col is {container.get('num_of_col')!r}, the grid measures {len(columns)} columns")
    declared_rows = builder().as_int(container.get("num_of_rows"))
    if declared_rows != len(rows):
        error(findings, "R-T5", f"num_of_rows is {container.get('num_of_rows')!r}, the grid measures {len(rows)} body rows")

    holes = [
        (column["index"], row["index"])
        for column in columns
        for row in rows
        if panel.cell_for(column, row) is None
    ]
    if holes:
        error(
            findings,
            "R-T6",
            f"the grid is incomplete: {len(holes)} of {len(columns) * len(rows)} (column,row) pairs have no body cell: "
            f"{sample(holes, 6)}",
        )

    check_header_bands(panel, findings)
    check_row_pitch(panel, findings)

    last_y = builder().as_int(container.get("last_y"))
    expected_last = rows[-1]["rel_top"] + geometry["row_height"]
    if last_y != expected_last:
        error(findings, "R-T9", f"last_y is {container.get('last_y')!r}, the last row ends at {expected_last}")

    check_placement(panel, findings)
    check_label_columns(panel, findings)
    check_rooms(panel, findings)
    check_extent(panel, rules, findings)


def check_header_bands(panel, findings):
    geometry = panel.geometry
    columns = geometry["columns"]
    bands = collections.defaultdict(list)
    for item in geometry["headers"]:
        bands[builder().as_int(item.get("posTop"))].append(item)
    heights = {builder().as_int(i.get("posHeight")) for i in geometry["headers"]}
    if len(heights) > 1:
        error(findings, "R-T7", f"header cells have {len(heights)} different heights: {sorted(heights)}")
    expected_lefts = sorted(c["rel_left"] for c in columns)
    for top in sorted(bands):
        band = bands[top]
        if len(band) != len(columns):
            error(
                findings,
                "R-T7",
                f"the header band at rel_top {top} carries {len(band)} cells, the grid has {len(columns)} columns",
            )
            continue
        lefts = sorted(builder().as_int(i.get("posLeft")) for i in band)
        if lefts != expected_lefts:
            error(findings, "R-T7", f"the header band at rel_top {top} does not align with the columns")
    if not bands:
        error(findings, "R-T7", "no header cells - the table has no column captions")


def check_row_pitch(panel, findings):
    geometry = panel.geometry
    rows = geometry["rows"]
    height = geometry["row_height"]
    header_height = geometry["header_height"]
    allowed = {height, height + header_height}
    bad = []
    for previous, current in zip(rows, rows[1:]):
        delta = current["rel_top"] - previous["rel_top"]
        if delta not in allowed:
            bad.append(f"row {previous['index']}->{current['index']} delta {delta}")
    if bad:
        error(
            findings,
            "R-T8",
            f"{len(bad)} irregular row pitch(es); expected {height} or {height + header_height} "
            f"(a row that follows a header band): {sample(bad, 5)}",
        )


def check_placement(panel, findings):
    geometry = panel.geometry
    height = geometry["row_height"]
    left0 = geometry["left"]
    top0 = geometry["top"]
    misplaced = []
    for obj in panel.grid_objects():
        column, row = panel.placed[obj["name"]]
        cell = panel.cell_for(column, row)
        if cell is None:
            continue
        width = builder().as_int(obj.get("posWidth"))
        obj_height = builder().as_int(obj.get("posHeight"))
        cell_width = builder().as_int(cell.get("posWidth"))
        dx = builder().as_int(obj.get("posLeft")) - left0 - column["rel_left"]
        dy = builder().as_int(obj.get("posTop")) - top0 - row["rel_top"]
        if 2 * dx != cell_width - width or dy != (height - obj_height) // 2:
            misplaced.append(
                f"{obj['name']} at +{dx},+{dy} in column {column['index']} row {row['index']} "
                f"(centred would be +{(cell_width - width) / 2:g},+{(height - obj_height) // 2})"
            )
    if misplaced:
        error(
            findings,
            "R-T10",
            f"{len(misplaced)} object(s) are not centred in their cell: {sample(misplaced, 4)}",
        )
    if panel.strays:
        below = [
            o for o in panel.strays
            if builder().as_int(o.get("posTop")) >= top0 + geometry["rows"][-1]["rel_top"] + height
        ]
        other = [o for o in panel.strays if o not in below]
        if below:
            warn(
                findings,
                "R-T10",
                f"{len(below)} object(s) sit below the last row - the annotation cluster pattern. "
                f"Legitimate when deliberate; say so: {sample([o.get('name') for o in below], 5)}",
            )
        if other:
            where = ["{0}@{1},{2}".format(o.get("name"), o.get("posLeft"), o.get("posTop")) for o in other]
            error(
                findings,
                "R-T10",
                f"{len(other)} object(s) sit outside every column or row of the grid: {sample(where, 5)}",
            )


def check_label_columns(panel, findings):
    if not panel.label_columns:
        error(
            findings,
            "R-T11",
            "no label column - every column's body cells are blank, so no row can be identified by room",
        )
        return
    occupied = collections.Counter()
    for obj in panel.grid_objects():
        column, _row = panel.placed[obj["name"]]
        occupied[column["index"]] += 1
    intruders = [c["index"] for c in panel.label_columns if occupied.get(c["index"])]
    if intruders:
        error(
            findings,
            "R-T11",
            f"label column(s) {intruders} carry canvas objects; the cell text is the label, "
            f"a value box on top of it is a collision",
        )


def check_rooms(panel, findings):
    rows = panel.geometry["rows"]
    labels = panel.rooms
    missing = [r["index"] for r in rows if not str(labels.get(r["index"]) or "").strip()]
    if missing:
        error(findings, "R-T12", f"{len(missing)} body row(s) have no room label: {sample(missing, 8)}")
    present = [str(labels[r["index"]]).strip() for r in rows if str(labels.get(r["index"]) or "").strip()]
    duplicates = [n for n, c in collections.Counter(present).items() if c > 1]
    if duplicates:
        error(findings, "R-T12", f"room(s) appear on more than one row: {sample(duplicates)}")
    numeric = []
    for value in present:
        try:
            numeric.append(int(value))
        except ValueError:
            warn(findings, "R-T12", f"room label {value!r} is not an integer - ordering cannot be checked")
            numeric = None
            break
    if numeric and numeric != sorted(numeric):
        first = next(i for i in range(1, len(numeric)) if numeric[i] < numeric[i - 1])
        error(
            findings,
            "R-T12",
            f"rooms are not ascending as integers - {numeric[first - 1]} is followed by {numeric[first]}. "
            f"Sorting room numbers as text is the usual cause",
        )

    per_room = collections.Counter()
    for obj in panel.grid_objects():
        _column, row = panel.placed[obj["name"]]
        per_room[panel.room_of(row)] += 1
    if per_room:
        census = collections.Counter(per_room.values())
        if len(census) > 1:
            usual, _count = census.most_common(1)[0]
            odd = sorted((room, n) for room, n in per_room.items() if n != usual)
            warn(
                findings,
                "R-T13",
                f"rooms carry different object counts (most carry {usual}); "
                f"list the difference room by room: {sample([f'{r}:{n}' for r, n in odd], 8)}",
            )
    empty_rooms = [panel.room_of(r) for r in rows if not per_room.get(panel.room_of(r))]
    if empty_rooms:
        error(
            findings,
            "R-T13",
            f"{len(empty_rooms)} room row(s) carry no canvas object at all - an empty row is a row of nothing: "
            f"{sample(empty_rooms, 8)}",
        )


def check_extent(panel, rules, findings):
    if not panel.objects:
        return
    bf = builder()
    right = max(bf.as_int(o.get("posLeft")) + bf.as_int(o.get("posWidth")) for o in panel.objects if isinstance(o, dict))
    bottom = max(bf.as_int(o.get("posTop")) + bf.as_int(o.get("posHeight")) for o in panel.objects if isinstance(o, dict))
    width = bf.as_int(panel.envelope.get("panel_width"))
    height = bf.as_int(panel.envelope.get("panel_height"))
    if not width or not height:
        return
    if right > width or bottom > height:
        note(
            findings,
            "R-T16",
            f"content reaches x {right}, y {bottom} on a declared {width}x{height} viewport. "
            f"That is expected - panel_height is a viewport, not a clipping boundary, and the plant view scrolls. "
            f"Reported, not corrected",
        )
    else:
        warn(
            findings,
            "R-T16",
            f"content fits inside {width}x{height} (reaches x {right}, y {bottom}). A room-control table across all "
            f"floors does not normally fit; check that rooms or columns were not dropped or compressed to make it",
        )


# --------------------------------------------------------------------------
# R-B* - the bindings
# --------------------------------------------------------------------------


def check_bindings(panel, findings):
    mode = panel.mode()
    if mode == "empty":
        return mode
    if mode == "mixed":
        placeholders = [o.get("name") for o in panel.objects if isinstance(o, dict) and o.get("driver_id") == PLACEHOLDER]
        error(
            findings,
            "R-B3",
            f"half-linked file: {len(placeholders)} object(s) carry the literal 'driver_id' while "
            f"{len(panel.bound_objects())} carry a real binding. A template withholds every binding; "
            f"a linked panel withholds none: {sample(placeholders, 5)}",
        )
    elif mode == "unbound":
        error(
            findings,
            "R-B1",
            "no object carries a binding of any kind - neither a real driver_id nor the template placeholder",
        )
    else:
        note(findings, "R-B1", f"output mode {mode} - " + ("linked panel" if mode == "C" else "unlinked template"))

    if mode in ("C", "mixed"):
        no_unit = [
            o.get("name") for o in panel.bound_objects()
            if not str(o.get("unit_id") or "").strip()
        ]
        if no_unit:
            error(
                findings,
                "R-B2",
                f"{len(no_unit)} object(s) have a real driver_id and an empty unit_id - the binding cannot resolve: "
                f"{sample(no_unit, 5)}",
            )

    # R-B4: the host sets linked="true" whenever driver_id != "driver_id",
    # including when driver_id is empty (V3scripts.js:514). An object with an
    # empty driver_id and linked "true" is host behaviour, not a defect.
    wrong_linked = []
    for obj in panel.objects:
        if not isinstance(obj, dict):
            continue
        expected = "false" if obj.get("driver_id") == PLACEHOLDER else "true"
        if str(obj.get("linked")) != expected:
            wrong_linked.append(f"{obj.get('name')} linked={obj.get('linked')!r} driver_id={obj.get('driver_id')!r}")
    if wrong_linked:
        error(
            findings,
            "R-B4",
            f"{len(wrong_linked)} object(s) disagree with the host rule linked=\"true\" whenever "
            f"driver_id != \"driver_id\" (V3scripts.js:514): {sample(wrong_linked, 4)}",
        )

    ids = [o.get("driver_id") for o in panel.bound_objects()]
    duplicates = [d for d, c in collections.Counter(ids).items() if c > 1]
    if duplicates:
        error(
            findings,
            "R-B5",
            f"{len(duplicates)} driver_id(s) are bound more than once - two cells showing one parameter: "
            f"{sample(duplicates, 4)}",
        )
    return mode


def check_source_sql(panel, sql_path, findings):
    bf = builder()
    rows, malformed = bf.parse_sql(sql_path)
    if malformed:
        warn(findings, "R-B6", f"{malformed} tuple(s) in {sql_path} could not be parsed")
    if not rows:
        error(findings, "R-B6", f"{sql_path} yielded no parameter rows")
        return
    by_driver = {row["driver_id"]: row for row in rows}
    note(findings, "R-B6", f"{len(rows)} parameter rows, {len(by_driver)} distinct driver_id, from {pathlib.Path(sql_path).name}")

    bound = panel.bound_objects()
    if not bound:
        warn(findings, "R-B6", "the panel carries no bindings - nothing to check against the dump")
        return

    # A sanitized fixture masks the plant prefix. Normalize it only in that
    # direction, only when the panel's prefix is a mask, and say so. Every real
    # panel is still compared byte for byte.
    panel_prefixes = {str(o.get("driver_id")).split("_", 1)[0] for o in bound}
    dump_prefixes = {row["driver_id"].split("_", 1)[0] for row in rows}
    rewrite = None
    if len(panel_prefixes) == 1 and MASK_ONLY.match(next(iter(panel_prefixes))) and len(dump_prefixes) == 1:
        mask = next(iter(panel_prefixes))
        real = next(iter(dump_prefixes))
        rewrite = (mask + "_", real + "_")
        note(
            findings,
            "R-B6",
            f"the panel is sanitized: driver_id prefix {mask!r} normalized to the dump's {real!r} for this comparison. "
            f"Only a masked prefix is normalized; every other character is compared as-is",
        )

    def resolve(driver_id):
        if rewrite and driver_id.startswith(rewrite[0]):
            return rewrite[1] + driver_id[len(rewrite[0]):]
        return driver_id

    unknown, wrong_unit, wrong_alias = [], [], []
    for obj in bound:
        key = resolve(str(obj.get("driver_id")))
        row = by_driver.get(key)
        if row is None:
            unknown.append(f"{obj.get('name')}={obj.get('driver_id')}")
            continue
        if str(obj.get("unit_id")) != row["unit_id"]:
            wrong_unit.append(f"{obj.get('name')} has {obj.get('unit_id')!r}, the dump row says {row['unit_id']!r}")
        if str(obj.get("alias_text")) != row["alias_text"]:
            wrong_alias.append(f"{obj.get('name')}: {obj.get('alias_text')!r} != {row['alias_text']!r}")
    if unknown:
        error(
            findings,
            "R-B6",
            f"{len(unknown)} driver_id(s) do not exist in the dump - constructed, adapted from another plant, "
            f"or invented: {sample(unknown, 5)}",
        )
    else:
        note(findings, "R-B6", f"all {len(bound)} driver_id(s) resolve in the dump")
    if wrong_unit:
        error(findings, "R-B7", f"{len(wrong_unit)} unit_id(s) disagree with their dump row: {sample(wrong_unit, 4)}")
    if wrong_alias:
        error(
            findings,
            "R-B8",
            f"{len(wrong_alias)} alias_text value(s) are not byte-identical to the dump - including whitespace, "
            f"which the selector writes and a generator must not normalize: {sample(wrong_alias, 3)}",
        )

    check_rooms_against_sql(panel, by_driver, resolve, findings)
    check_alarm_roles(panel, by_driver, resolve, findings)


def check_rooms_against_sql(panel, by_driver, resolve, findings):
    if panel.geometry is None:
        return
    per_row = collections.defaultdict(set)
    for obj in panel.grid_objects():
        driver_id = str(obj.get("driver_id") or "")
        if driver_id in ("", PLACEHOLDER):
            continue
        row = panel.placed[obj["name"]][1]
        per_row[row["index"]].add(str(obj.get("unit_id")))

    unbound_rows, split_rows, mismatched = [], [], []
    for row in panel.geometry["rows"]:
        room = str(panel.room_of(row) or "").strip()
        units = per_row.get(row["index"])
        if not units:
            unbound_rows.append(room or f"row {row['index']}")
            continue
        if len(units) > 1:
            split_rows.append(f"{room}: {sample(sorted(units), 4)}")
            continue
        unit_id = next(iter(units))
        names = {
            by_driver[resolve(str(o.get("driver_id")))]["unit_name"]
            for o in panel.grid_objects()
            if panel.placed[o["name"]][1]["index"] == row["index"]
            and resolve(str(o.get("driver_id"))) in by_driver
        }
        if not names:
            continue
        unit_name = next(iter(names))
        if room and room not in NUMERIC_TOKEN.findall(unit_name):
            mismatched.append(f"row labelled {room} binds to unit {unit_id} ({unit_name})")
    if unbound_rows:
        error(
            findings,
            "R-B9",
            f"{len(unbound_rows)} room row(s) carry no binding - a room the source cannot supply is an invented row: "
            f"{sample(unbound_rows, 6)}",
        )
    if split_rows:
        error(
            findings,
            "R-B9",
            f"{len(split_rows)} row(s) bind to more than one unit - one row is one room controller: {sample(split_rows, 3)}",
        )
    if mismatched:
        error(
            findings,
            "R-B9",
            f"{len(mismatched)} row label(s) do not appear in the unit_name they bind to - the row shows another "
            f"room's controller: {sample(mismatched, 3)}",
        )
    if not (unbound_rows or split_rows or mismatched):
        note(findings, "R-B9", f"every one of the {len(panel.geometry['rows'])} rows binds to exactly one unit whose name carries the room number")


def check_alarm_roles(panel, by_driver, resolve, findings):
    alarm_obj = builder().ALARM_OBJ
    wrong = []
    for obj in panel.objects:
        if not isinstance(obj, dict) or obj.get("obj_id") != alarm_obj:
            continue
        row = by_driver.get(resolve(str(obj.get("driver_id") or "")))
        if row is None:
            continue
        actual = {k: row.get(k, "") for k in ALARM_SIGNATURE}
        if actual != ALARM_SIGNATURE:
            wrong.append(f"{obj.get('name')} -> {row['alias_text']} ({actual})")
    if wrong:
        error(
            findings,
            "R-B10",
            f"{len(wrong)} alarm object(s) bind to something that is not an alarm state. The measured signature is "
            f"a read-only boolean with no engineering unit; an alarm LIMIT is a setpoint in degrees and gets a "
            f"value box: {sample(wrong, 3)}",
        )
    elif any(isinstance(o, dict) and o.get("obj_id") == alarm_obj for o in panel.objects):
        note(findings, "R-B10", "every alarm object binds to a read-only boolean with no engineering unit")


# --------------------------------------------------------------------------
# R-P* - the profile
# --------------------------------------------------------------------------


def check_profile(panel, profile, name, findings):
    note(
        findings,
        "R-P1",
        f"profile {name} is scoped evidence about one building. A failure below means the profile does not apply "
        f"to this panel, not necessarily that the panel is wrong",
    )
    if panel.geometry is None:
        error(findings, "R-P1", "no grid - the profile cannot be applied")
        return

    expected_columns = profile.get("columns") or []
    columns = panel.geometry["columns"]
    if len(columns) != len(expected_columns):
        error(findings, "R-P1", f"{len(columns)} columns, the profile has {len(expected_columns)}")
    else:
        wrong = [
            f"col {e['index']}: {c['title']!r}@{c['abs_left']}w{c['width']} != {e['title']!r}@{e['abs_left']}w{e['width']}"
            for c, e in zip(columns, expected_columns)
            if c["title"] != e["title"] or c["abs_left"] != e["abs_left"] or c["width"] != e["width"]
        ]
        if wrong:
            error(findings, "R-P1", f"{len(wrong)} column(s) differ from the profile: {sample(wrong, 3)}")

    expected_rooms = [str(r) for r in profile.get("rooms") or []]
    rooms = [str(panel.room_of(r) or "").strip() for r in panel.geometry["rows"]]
    if rooms != expected_rooms:
        missing = [r for r in expected_rooms if r not in rooms]
        added = [r for r in rooms if r not in expected_rooms]
        error(
            findings,
            "R-P2",
            f"the room set differs from the profile: {len(missing)} missing ({sample(missing, 6)}), "
            f"{len(added)} added ({sample(added, 6)})",
        )

    bands = profile.get("header_bands") or {}
    tops = sorted({builder().as_int(i.get("posTop")) for i in panel.geometry["headers"]})
    if bands.get("rel_tops") and tops != list(bands["rel_tops"]):
        error(findings, "R-P3", f"header bands at {tops}, the profile has {bands['rel_tops']}")
    if bands.get("height") and panel.geometry["header_height"] != bands["height"]:
        error(findings, "R-P3", f"header height {panel.geometry['header_height']}, the profile has {bands['height']}")

    geo = profile.get("row_geometry") or {}
    if geo.get("count") and len(panel.geometry["rows"]) != geo["count"]:
        error(findings, "R-P4", f"{len(panel.geometry['rows'])} rows, the profile has {geo['count']}")
    if geo.get("height") and panel.geometry["row_height"] != geo["height"]:
        error(findings, "R-P4", f"row height {panel.geometry['row_height']}, the profile has {geo['height']}")
    for key, actual in (("first_rel_top", panel.geometry["rows"][0]["rel_top"]),
                        ("last_rel_top", panel.geometry["rows"][-1]["rel_top"])):
        if geo.get(key) is not None and actual != geo[key]:
            error(findings, "R-P4", f"{key} is {actual}, the profile has {geo[key]}")

    expected_census = profile.get("obj_id_census") or {}
    census = collections.Counter(o.get("obj_id") for o in panel.objects if isinstance(o, dict))
    for obj_id, entry in expected_census.items():
        if census.get(obj_id, 0) != entry.get("count"):
            error(findings, "R-P5", f"{census.get(obj_id, 0)} x {obj_id}, the profile has {entry.get('count')}")
    for obj_id in census:
        if obj_id not in expected_census:
            error(findings, "R-P5", f"{obj_id} is not in the profile's object census")

    container = panel.container or {}
    for key, expected in (profile.get("container_attributes") or {}).items():
        if container.get(key) != expected:
            severity = warn if key in ("name", "unique_id") else error
            severity(findings, "R-P6", f"container {key} is {container.get(key)!r}, the profile has {expected!r}")

    cluster = ((profile.get("anomalies") or {}).get("annotation_cluster_below_the_grid") or {}).get("objects") or []
    if cluster:
        present = {
            (o.get("obj_id"), o.get("posLeft"), o.get("posTop"))
            for o in panel.objects
            if isinstance(o, dict)
        }
        missing = [
            f"{e['obj_id']}@{e['left']},{e['top']}"
            for e in cluster
            if (e["obj_id"], e["left"], e["top"]) not in present
        ]
        if missing:
            error(
                findings,
                "R-P7",
                f"{len(missing)} object(s) of the reset/annotation cluster are absent: {sample(missing, 3)}",
            )


# --------------------------------------------------------------------------
# R-C* - source versus candidate
# --------------------------------------------------------------------------


def compare(source, candidate, findings):
    skip = {"exported_at", "generator", "panel"}
    for key in sorted(set(source.envelope) | set(candidate.envelope)):
        if key in skip:
            continue
        a, b = source.envelope.get(key), candidate.envelope.get(key)
        if key == "counts":
            continue
        if a != b:
            severity = error if key in ("format", "version") else warn
            severity(findings, "R-C1", f"envelope {key}: source {a!r}, candidate {b!r}")
    for key in ("plant_id", "panel_width", "panel_height", "org_image_name", "converted"):
        a = (source.panel or {}).get(key)
        b = (candidate.panel or {}).get(key)
        if a != b:
            warn(findings, "R-C1", f"panel.{key}: source {a!r}, candidate {b!r}")
    a_image = ((source.panel or {}).get("image_data") or "")
    b_image = ((candidate.panel or {}).get("image_data") or "")
    if a_image != b_image:
        warn(findings, "R-C1", f"the background differs: source {len(a_image)} chars, candidate {len(b_image)}")

    a_census = collections.Counter(o.get("obj_id") for o in source.objects if isinstance(o, dict))
    b_census = collections.Counter(o.get("obj_id") for o in candidate.objects if isinstance(o, dict))
    for obj_id in sorted(set(a_census) | set(b_census)):
        if a_census.get(obj_id, 0) != b_census.get(obj_id, 0):
            warn(findings, "R-C2", f"{obj_id}: source {a_census.get(obj_id, 0)}, candidate {b_census.get(obj_id, 0)}")
    if len(source.objects) != len(candidate.objects):
        warn(findings, "R-C2", f"{len(source.objects)} objects in the source, {len(candidate.objects)} in the candidate")

    if source.geometry is None or candidate.geometry is None:
        blind = [
            f"{p.label}: {p.geometry_error or 'no table container'}"
            for p in (source, candidate)
            if p.geometry is None
        ]
        error(
            findings,
            "R-C3",
            "no grid could be derived, so rooms, columns and cell placement were not compared at all - "
            f"{'; '.join(blind)}",
        )
    else:
        a_rooms = [str(source.room_of(r) or "").strip() for r in source.geometry["rows"]]
        b_rooms = [str(candidate.room_of(r) or "").strip() for r in candidate.geometry["rows"]]
        missing = [r for r in a_rooms if r not in b_rooms]
        added = [r for r in b_rooms if r not in a_rooms]
        if missing:
            error(findings, "R-C3", f"{len(missing)} room(s) present in the source and absent from the candidate: {sample(missing, 8)}")
        if added:
            warn(findings, "R-C3", f"{len(added)} room(s) the source does not have: {sample(added, 8)}")

        a_titles = [c["title"] for c in source.geometry["columns"]]
        b_titles = [c["title"] for c in candidate.geometry["columns"]]
        gone = [t for t in a_titles if t not in b_titles]
        new = [t for t in b_titles if t not in a_titles]
        if gone:
            error(findings, "R-C4", f"{len(gone)} column(s) dropped: {sample(gone, 6)}")
        if new:
            warn(findings, "R-C4", f"{len(new)} column(s) added: {sample(new, 6)}")

        a_cells = {source.key_of(o): o for o in source.grid_objects()}
        b_cells = {candidate.key_of(o): o for o in candidate.grid_objects()}
        shared = [k for k in a_cells if k in b_cells and k[0] is not None]
        if shared:
            dx = [b_cells[k]["posLeft"] - a_cells[k]["posLeft"] for k in shared]
            dy = [b_cells[k]["posTop"] - a_cells[k]["posTop"] for k in shared]
            moved = sum(1 for x, y in zip(dx, dy) if x or y)
            message = (
                f"{len(shared)} cell(s) present in both; median displacement "
                f"{statistics.median(dx):g},{statistics.median(dy):g}; {moved} moved"
            )
            if moved and (statistics.median(dx) or statistics.median(dy)):
                warn(findings, "R-C5", message + " - explain the shift, or a column width changed")
            elif moved:
                warn(findings, "R-C5", message)
            else:
                note(findings, "R-C5", message)
        else:
            warn(findings, "R-C5", "no cell is identifiable in both files - the comparison found nothing to align")

        lost = [
            f"{k[0]}/{k[1]}"
            for k, obj in a_cells.items()
            if k in b_cells
            and str(obj.get("driver_id") or "") not in ("", PLACEHOLDER)
            and str(b_cells[k].get("driver_id") or "") in ("", PLACEHOLDER)
        ]
        if lost:
            error(
                findings,
                "R-C7",
                f"{len(lost)} binding(s) present in the source are placeholdered or blank in the candidate: "
                f"{sample(lost, 5)}",
            )

    a_container = source.container or {}
    b_container = candidate.container or {}
    for key in sorted(set(a_container) | set(b_container)):
        if key == "items":
            continue
        if a_container.get(key) != b_container.get(key):
            warn(findings, "R-C6", f"container {key}: source {a_container.get(key)!r}, candidate {b_container.get(key)!r}")

    a_z = collections.Counter(o.get("zIndex") for o in source.objects if isinstance(o, dict))
    b_z = collections.Counter(o.get("zIndex") for o in candidate.objects if isinstance(o, dict))
    if set(a_z) != set(b_z):
        error(findings, "R-C8", f"z-bands changed: source {sorted(a_z)}, candidate {sorted(b_z)}")
    else:
        for band in sorted(a_z):
            if a_z[band] != b_z[band]:
                warn(findings, "R-C8", f"z-band {band!r}: source {a_z[band]} objects, candidate {b_z[band]}")


# --------------------------------------------------------------------------
# drivers
# --------------------------------------------------------------------------


def validate(document, rules, label, profile_name=None, sql_path=None):
    findings = []
    panel = Panel(document, label)
    check_envelope(panel, findings)
    if not panel.objects:
        return panel, findings
    check_counts(panel, findings)
    check_names(panel, findings)
    check_fields(panel, rules, findings)
    check_geometry_types(panel, findings)
    check_vocabulary(panel, rules, findings)
    check_background(panel, findings)
    check_stacking(panel, findings)
    check_encoding(panel, findings)
    check_table(panel, rules, findings)
    mode = check_bindings(panel, findings)
    if sql_path:
        check_source_sql(panel, sql_path, findings)
    elif mode == "C":
        note(
            findings,
            "R-B6",
            "no --source-sql: an invented driver_id is indistinguishable from a real one here. Run it with the dump",
        )
    if profile_name:
        profile = (rules.get("profiles") or {}).get(profile_name)
        if profile is None:
            error(findings, "R-P1", f"profile {profile_name!r} is not in documentation-rules.json")
        elif profile.get("panel_type") != PANEL_TYPE:
            error(findings, "R-P1", f"profile {profile_name!r} belongs to panel type {profile.get('panel_type')!r}")
        else:
            check_profile(panel, profile, profile_name, findings)
    return panel, findings


def validate_pair(source_document, candidate_document, rules, source_label, candidate_label):
    panel, findings = validate(candidate_document, rules, candidate_label)
    source = Panel(source_document, source_label)
    if not source.objects:
        error(findings, "R-C1", f"{source_label} carries no objects - it cannot serve as the comparison source")
        return panel, findings
    compare(source, panel, findings)
    return panel, findings


LIMITS = (
    "A clean run proves the file is well formed, the grid is a grid and the identifiers resolve. "
    "It does not prove the panel is the one that was asked for."
)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Validate an IWMAC Designer room-control table panel.",
        epilog=LIMITS,
    )
    parser.add_argument("panel", nargs="?", help="the panel JSON to check")
    parser.add_argument("--check", action="store_true", help="run the document, table and binding checks (the default)")
    parser.add_argument("--source-sql", dest="source_sql", help="the plant's iw_gen_driver_parameters dump")
    parser.add_argument("--profile", help=f"apply a template profile, e.g. {DEFAULT_PROFILE}")
    parser.add_argument("--compare", nargs=2, metavar=("SOURCE", "CANDIDATE"), help="compare a candidate against a known-good export")
    parser.add_argument("--json-report", dest="as_json", action="store_true", help="emit the findings as JSON")
    args = parser.parse_args(argv)

    if bool(args.compare) == bool(args.panel):
        parser.error("give either a panel path or --compare SOURCE CANDIDATE, not both")

    rules = load_rules()
    findings = []
    if args.compare:
        source_path, candidate_path = args.compare
        source_document = read_document(source_path, findings)
        candidate_document = read_document(candidate_path, findings)
        subject = f"{pathlib.Path(candidate_path).name} against {pathlib.Path(source_path).name}"
        if source_document is not None and candidate_document is not None:
            _panel, more = validate_pair(source_document, candidate_document, rules, source_path, candidate_path)
            findings.extend(more)
    else:
        subject = pathlib.Path(args.panel).name
        document = read_document(args.panel, findings)
        if document is not None:
            _panel, more = validate(document, rules, args.panel, profile_name=args.profile, sql_path=args.source_sql)
            findings.extend(more)

    errors = sum(1 for f in findings if f.severity == "error")
    warnings = sum(1 for f in findings if f.severity == "warning")
    if args.as_json:
        print(json.dumps(
            {
                "subject": subject,
                "errors": errors,
                "warnings": warnings,
                "findings": [f.as_dict() for f in findings],
                "limits": LIMITS,
            },
            indent=2,
            ensure_ascii=False,
        ))
    else:
        order = {"error": 0, "warning": 1, "info": 2}
        for finding in sorted(findings, key=lambda f: order.get(f.severity, 3)):
            print(finding)
        print(f"\n{errors} error(s), {warnings} warning(s) in {subject}")
        print(LIMITS)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
