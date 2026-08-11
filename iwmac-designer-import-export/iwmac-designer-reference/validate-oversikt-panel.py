#!/usr/bin/env python3
"""Deterministic validator for IWMAC Designer Oversikt (store overview) panels.

Usage:
    python validate-oversikt-panel.py --check PANEL.json [--profile TEMPLATE-10113]
    python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json
    python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json \
                                      --patch-scope value-position
    python validate-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json
    python validate-oversikt-panel.py PANEL.json            # same as --check
    python validate-oversikt-panel.py ... --json-report

The rules are data, not code: everything panel-type- and template-specific is
read from ``documentation-rules.json`` (``panel_types.oversikt`` and
``profiles.TEMPLATE-10113``, both generated from the committed fixture by
build-oversikt-rules.py) so the contract, the fixture and this validator cannot
drift apart. Four namespaces:

    O-S*   structure. Runs on every panel.
    O-G*   Oversikt relationships - clusters, coverage, placement. Every panel.
    O-P*   template geometry. Runs only when --profile is given.
    O-C*   source versus candidate. Runs only in --compare.

WHY THIS EXISTS. On 2026-08-10 a 21-cluster production Oversikt was rebuilt
twice from secondary sources: once as dashboard-style groupings, once as a
visually similar panel carrying 9 of its 21 controller clusters. Both were
structurally valid JSON. Every check the kit had at the time passed. The
missing 12 controllers were invisible because nothing compared the candidate to
its source and nothing counted clusters. --compare is the control for that
failure, and it is the mode to use whenever a production export was supplied.

WHAT THIS CANNOT DO. It cannot see the background artwork, so in --check it
cannot tell whether a cluster sits on the case it monitors, on the aisle beside
it, or on the wall. It can only say a cluster is coherent, inside the canvas
and not on a suspicious lattice. Placement against artwork is a visual question
and OVERSIKT-QA-CHECKLIST.md stage C answers it with a native-size render.

It also cannot detect an invented binding from the candidate alone: a driver id
naming a parameter the controller does not expose is well-formed, and only the
source or the plant knows better. --compare catches it as an added object and
as changed cluster coverage; --profile catches it for a known template as an
unfamiliar parameter tail. A clean run here is a necessary condition, never a
sufficient one, and must never be reported as "the panel is correct".

Exit status is 0 when no finding has severity ``error``, 1 otherwise. This file
performs no network access and reads nothing outside the reference directory.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"
PALETTE_PATH = ROOT / "reference_data" / "all-design-objects.json"

OBJECT_FIELDS = (
    "obj_id", "name", "id", "posWidth", "posHeight", "posLeft", "posTop",
    "zIndex", "tag_text", "linked", "link_name", "link_tag", "sub_group",
    "driver_id", "unit_id", "unit_ref", "alias_text",
)

# A cluster on this fixture is 42x86. Anything sprawling further than this is
# not one case any more, whatever its unit_id says. Generous on purpose: the
# check exists to catch a cluster torn apart, not to police layout.
CLUSTER_SPAN_LIMIT = 160

# Beyond a nudge, a cluster has been RELOCATED, and a supplied production export
# is the geometric template. Under it, treat as a tidy-up and warn.
CLUSTER_NUDGE_LIMIT = 20

# Two boxes sharing an edge by a pixel or two is how hand-dragged symbols stack.
# Measured on the fixture: three such pairs, all inside one cluster.
HAIRLINE = 2

PLANT_PREFIX = re.compile(r"^\d{4,6}_")
MOJIBAKE = re.compile(r"[ÃÂ][\x80-\xbf]|�")


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


# --------------------------------------------------------------------------
# Loading and shape helpers
# --------------------------------------------------------------------------

def load_rules(path=RULES_PATH):
    return json.loads(path.read_text(encoding="utf-8"))


def load_palette(path=PALETTE_PATH):
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return {entry["object_id"] for entry in data.get("all_design_objects", [])}


def envelope_of(document):
    """Accept both shapes: a live userscript export is flat, a committed
    reference JSON wraps the same document as {_note, envelope:{...}}."""
    if isinstance(document, dict) and isinstance(document.get("envelope"), dict):
        return document["envelope"]
    return document


def objects_of(envelope):
    panel = envelope.get("panel")
    if not isinstance(panel, dict):
        return []
    value = panel.get("single_objects")
    return value if isinstance(value, list) else []


def as_int(value):
    """The host parses geometry with parseInt, so "120px" is 120. Return None
    only when parseInt would return NaN."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value == int(value) else None
    if isinstance(value, str):
        match = re.match(r"^\s*[-+]?\d+", value)
        return int(match.group()) if match else None
    return None


def rect(obj):
    left, top = as_int(obj.get("posLeft")), as_int(obj.get("posTop"))
    width, height = as_int(obj.get("posWidth")), as_int(obj.get("posHeight"))
    if None in (left, top, width, height):
        return None
    return left, top, left + width, top + height


def role_map(oversikt):
    return {entry["obj_id"]: entry["role"]
            for entry in (oversikt.get("cluster") or {}).get("roles", [])}


def controller_key(obj):
    """unit_id first, the normalized driver prefix second, nothing third.

    Deliberately not spatial: proximity merges two adjacent cases into one
    cluster and splits one case whose symbols were nudged apart. Mirrors
    build-oversikt-fixture.controller_key so the fixture, the generated rules
    and this validator cannot disagree about what a cluster is.
    """
    unit = (obj.get("unit_id") or "").strip()
    if unit and unit != "undefined":
        return unit, "unit_id"
    driver = (obj.get("driver_id") or "").strip()
    if driver and driver != "driver_id":
        parts = driver.split("_")
        if len(parts) >= 5:
            return "_".join(parts[:5]), "driver_id"
        return driver, "driver_id"
    return None, "none"


def parameter_tail(driver_id):
    parts = (driver_id or "").split("_")
    return "_".join(parts[5:]) if len(parts) > 5 else ""


def inventory(objects, roles):
    """Group objects into controller clusters, in first-appearance order."""
    clusters = collections.OrderedDict()
    for index, obj in enumerate(objects):
        key, origin = controller_key(obj)
        entry = clusters.setdefault(key, {
            "key": key, "origin": origin, "members": [], "first_index": index})
        entry["members"].append(obj)
    for entry in clusters.values():
        boxes = [r for r in (rect(o) for o in entry["members"]) if r]
        entry["bbox"] = (min(b[0] for b in boxes), min(b[1] for b in boxes),
                         max(b[2] for b in boxes), max(b[3] for b in boxes)) \
            if boxes else None
        entry["roles"] = collections.Counter(
            roles.get(o.get("obj_id"), o.get("obj_id")) for o in entry["members"])
    return clusters


def coverage_signature(entry):
    return tuple(sorted(entry["roles"].items()))


# --------------------------------------------------------------------------
# O-S: structure
# --------------------------------------------------------------------------

def check_envelope(envelope, findings):
    if envelope.get("format") != "iwmac-designer-panel":
        findings.append(Finding("O-S01", "error",
                                f"format is {envelope.get('format')!r}, expected "
                                f"'iwmac-designer-panel'"))
    if str(envelope.get("version")) not in ("1", "1.0"):
        findings.append(Finding("O-S01", "warning",
                                f"version is {envelope.get('version')!r}, expected 1"))
    if not isinstance(envelope.get("panel"), dict):
        findings.append(Finding("O-S01", "error", "envelope has no panel document"))


def check_counts(envelope, findings):
    counts = envelope.get("counts")
    if not isinstance(counts, dict):
        findings.append(Finding("O-S02", "warning", "envelope has no counts block"))
        return
    panel = envelope.get("panel") or {}
    for key in ("single_objects", "containers", "graphics"):
        stated = counts.get(key)
        actual = len(panel.get(key) or [])
        if stated is None:
            findings.append(Finding("O-S02", "warning", f"counts.{key} is absent"))
        elif as_int(stated) != actual:
            findings.append(Finding("O-S02", "error",
                                    f"counts.{key} says {stated} but the array holds "
                                    f"{actual}"))


def check_fields_and_names(objects, findings):
    seen = collections.Counter()
    for index, obj in enumerate(objects):
        if not isinstance(obj, dict):
            findings.append(Finding("O-S03", "error", f"object {index} is not an object"))
            continue
        missing = [f for f in OBJECT_FIELDS if f not in obj]
        if missing:
            findings.append(Finding("O-S03", "error",
                                    f"{obj.get('name', index)} is missing "
                                    f"{', '.join(missing)}"))
        extra = [k for k in obj if k not in OBJECT_FIELDS]
        if extra:
            findings.append(Finding("O-S03", "warning",
                                    f"{obj.get('name', index)} carries unknown field(s) "
                                    f"{', '.join(sorted(extra))}"))
        seen[obj.get("name")] += 1

    duplicates = sorted(name for name, n in seen.items() if n > 1)
    if duplicates:
        findings.append(Finding("O-S04", "error",
                                f"duplicate object name(s): {', '.join(map(str, duplicates))}"))
    expected = [f"object_{i}" for i in range(len(objects))]
    actual = [o.get("name") for o in objects if isinstance(o, dict)]
    if len(actual) == len(expected) and actual != expected:
        findings.append(Finding("O-S04", "warning",
                                "object names are not the sequential object_0..N-1 the "
                                "host writes; harmless on import, it renames from the "
                                "canvas child index, but it means these names carry no "
                                "information"))


def check_geometry(objects, canvas, findings):
    width, height = canvas
    for obj in objects:
        box = rect(obj)
        if box is None:
            findings.append(Finding("O-S05", "error",
                                    f"{obj.get('name')} has unparseable geometry "
                                    f"({obj.get('posLeft')!r}, {obj.get('posTop')!r}, "
                                    f"{obj.get('posWidth')!r}, {obj.get('posHeight')!r})"))
            continue
        left, top, right, bottom = box
        if left < 0 or top < 0:
            findings.append(Finding("O-S05", "error",
                                    f"{obj.get('name')} starts off-canvas at ({left},{top})"))
        if width and right > width or height and bottom > height:
            findings.append(Finding("O-S05", "error",
                                    f"{obj.get('name')} extends to ({right},{bottom}), "
                                    f"outside the {width}x{height} canvas"))


def check_canvas(envelope, canvas, findings):
    panel = envelope.get("panel") or {}
    width, height = as_int(panel.get("panel_width")), as_int(panel.get("panel_height"))
    if width is None or height is None:
        findings.append(Finding("O-S06", "error", "panel has no usable dimensions"))
        return (0, 0)
    if (width, height) != tuple(canvas):
        findings.append(Finding("O-S06", "warning",
                                f"canvas is {width}x{height}; the Oversikt contract records "
                                f"{canvas[0]}x{canvas[1]}. Match the plant, not the "
                                f"contract, when an export says otherwise"))
    return (width, height)


def check_background(envelope, findings):
    panel = envelope.get("panel") or {}
    has_data = bool(panel.get("image_data"))
    has_svg = bool(panel.get("image_svg"))
    if not (has_data or has_svg):
        findings.append(Finding("O-S07", "error",
                                "no embedded background. An Oversikt IS its store plan: "
                                "without it the coordinates below describe nothing and no "
                                "reviewer can tell whether a cluster sits on its case"))
    if has_data and str(panel.get("converted")).lower() != "true":
        findings.append(Finding("O-S07", "warning",
                                f"image_data is present but converted is "
                                f"{panel.get('converted')!r}; the host expects \"true\""))
    if panel.get("image_svg_trace"):
        findings.append(Finding("O-S08", "error",
                                "panel.image_svg_trace is present. It is written by EXPORT "
                                "as AI input and deleted on insert; a generator must never "
                                "emit it"))


def check_bindings(objects, findings):
    for obj in objects:
        driver = (obj.get("driver_id") or "").strip()
        linked = str(obj.get("linked")).lower()
        bound = bool(driver) and driver != "driver_id"
        if bound and linked != "true":
            findings.append(Finding("O-S09", "error",
                                    f"{obj.get('name')} carries a driver_id but linked is "
                                    f"{obj.get('linked')!r}; the host sets linked whenever "
                                    f"driver_id is not the literal placeholder"))
        if not bound and linked == "true":
            findings.append(Finding("O-S09", "warning",
                                    f"{obj.get('name')} is marked linked with no driver_id"))


def check_palette(objects, palette, findings):
    if not palette:
        return
    for obj in objects:
        obj_id = obj.get("obj_id")
        if obj_id not in palette:
            findings.append(Finding("O-S10", "error",
                                    f"{obj.get('name')} uses obj_id {obj_id!r}, which is not "
                                    f"in the design-object catalogue; the host renders an "
                                    f"unknown obj_id as a broken undefined-class box"))


def check_encoding(objects, findings):
    for obj in objects:
        for field in ("alias_text", "tag_text", "link_name", "sub_group"):
            value = obj.get(field)
            if isinstance(value, str) and MOJIBAKE.search(value):
                findings.append(Finding("O-S11", "error",
                                        f"{obj.get('name')}.{field} looks mis-decoded: "
                                        f"{value!r}"))


def check_z_bands(objects, bands, findings):
    if not bands:
        return
    known = {str(z): set(entry.get("obj_ids") or []) for z, entry in bands.items()}
    for obj in objects:
        z = str(obj.get("zIndex"))
        if z == "default":
            continue
        owners = known.get(z)
        if owners is None:
            findings.append(Finding("O-S12", "warning",
                                    f"{obj.get('name')} uses zIndex {z}, outside the bands "
                                    f"this panel type was measured with "
                                    f"({', '.join(sorted(known))})"))
        elif obj.get("obj_id") not in owners:
            findings.append(Finding("O-S12", "warning",
                                    f"{obj.get('name')} ({obj.get('obj_id')}) sits in band "
                                    f"{z}, measured as carrying only "
                                    f"{', '.join(sorted(owners))}"))


# --------------------------------------------------------------------------
# O-G: Oversikt relationships
# --------------------------------------------------------------------------

def check_identity(objects, findings):
    orphans = [o.get("name") for o in objects if controller_key(o)[0] is None]
    if orphans:
        findings.append(Finding("O-G01", "error",
                                f"{len(orphans)} object(s) carry neither a unit_id nor a "
                                f"usable driver_id, so they belong to no controller and "
                                f"cannot be inventoried: "
                                f"{', '.join(map(str, orphans[:8]))}"
                                f"{' ...' if len(orphans) > 8 else ''}"))


def check_vocabulary(objects, roles, findings):
    strangers = collections.Counter(
        o.get("obj_id") for o in objects if o.get("obj_id") not in roles)
    for obj_id, count in strangers.most_common():
        findings.append(Finding("O-G02", "info",
                                f"{count} object(s) use {obj_id!r}, outside the four "
                                f"cluster roles. Legitimate for a label or a legend; it "
                                f"takes no part in coverage"))


def check_cluster_cohesion(clusters, findings):
    for entry in clusters.values():
        if entry["key"] is None or entry["bbox"] is None:
            continue
        left, top, right, bottom = entry["bbox"]
        span_w, span_h = right - left, bottom - top
        if span_w > CLUSTER_SPAN_LIMIT or span_h > CLUSTER_SPAN_LIMIT:
            findings.append(Finding("O-G03", "error",
                                    f"controller {entry['key']} spans {span_w}x{span_h}px "
                                    f"across {len(entry['members'])} objects; a cluster "
                                    f"reads as ONE position and this one has been torn "
                                    f"apart. Move a cluster with one vector or not at all"))


def check_duplicate_roles(clusters, findings):
    for entry in clusters.values():
        if entry["key"] is None:
            continue
        doubled = sorted(role for role, n in entry["roles"].items() if n > 1)
        if doubled:
            findings.append(Finding("O-G04", "error",
                                    f"controller {entry['key']} carries {', '.join(doubled)} "
                                    f"more than once. One controller is one position: a "
                                    f"second copy is a duplicated cluster, and the two "
                                    f"will always show the same reading in different places"))


def check_partial_clusters(clusters, findings):
    partial = [e for e in clusters.values()
               if e["key"] is not None and len(e["roles"]) < 4]
    if partial:
        findings.append(Finding("O-G05", "info",
                                f"{len(partial)} cluster(s) carry fewer than four roles: "
                                f"{', '.join(str(e['key']) for e in partial)}. LEGITIMATE - "
                                f"a controller exposing no cooling or defrost relay has "
                                f"nothing to show. Never pad a cluster to four"))


def check_grid(clusters, findings):
    origins = [e["bbox"][:2] for e in clusters.values()
               if e["key"] is not None and e["bbox"]]
    n = len(origins)
    if n < 6:
        return
    xs = sorted({x for x, _ in origins})
    ys = sorted({y for _, y in origins})
    columns_allowed = max(4, math.ceil(math.sqrt(n)) + 2)
    rows_allowed = max(3, math.ceil(n / max(1, len(xs))) + 1)
    if len(xs) > columns_allowed or len(ys) > rows_allowed:
        return
    gaps_x = {b - a for a, b in zip(xs, xs[1:])}
    gaps_y = {b - a for a, b in zip(ys, ys[1:])}
    if len(gaps_x) <= 1 and len(gaps_y) <= 1:
        findings.append(Finding("O-G06", "error",
                                f"{n} clusters sit on a regular lattice: {len(xs)} column(s) "
                                f"{gaps_x or 'n/a'}px apart, {len(ys)} row(s) "
                                f"{gaps_y or 'n/a'}px apart. An Oversikt is a MAP - each "
                                f"cluster belongs on the case it monitors. A grid of cards "
                                f"is a CLUSTER KIT hand-off, and a kit must be labelled a "
                                f"kit, never delivered as a finished panel"))


def check_overlaps(objects, roles, findings):
    """Report overlapping objects, minus the two kinds this panel type expects.

    Cooling and defrost on the same controller share one coordinate on purpose:
    the host draws whichever state is active. And symbols stacked vertically in
    a cluster routinely abut by a pixel, because the cluster was laid out by
    dragging. Reporting either is reporting noise, and noise is how a real
    overlap gets ignored.
    """
    boxed = [(o, rect(o)) for o in objects]
    boxed = [(o, b) for o, b in boxed if b]
    reported = 0
    for i in range(len(boxed)):
        obj_a, (al, at, ar, ab) = boxed[i]
        for j in range(i + 1, len(boxed)):
            obj_b, (bl, bt, br, bb) = boxed[j]
            if ar <= bl or br <= al or ab <= bt or bb <= at:
                continue
            same_controller = controller_key(obj_a)[0] == controller_key(obj_b)[0]
            pair = {roles.get(obj_a.get("obj_id")), roles.get(obj_b.get("obj_id"))}
            if same_controller and pair == {"cooling", "defrost"}:
                continue
            if min(min(ar, br) - max(al, bl), min(ab, bb) - max(at, bt)) <= HAIRLINE:
                continue
            reported += 1
            if reported <= 12:
                findings.append(Finding("O-G07", "warning",
                                        f"{obj_a.get('name')} ({roles.get(obj_a.get('obj_id'), '-')}) "
                                        f"overlaps {obj_b.get('name')} "
                                        f"({roles.get(obj_b.get('obj_id'), '-')}) - one hides "
                                        f"part of the other"))
    if reported > 12:
        findings.append(Finding("O-G07", "warning",
                                f"...and {reported - 12} further overlapping pair(s)"))


# --------------------------------------------------------------------------
# O-G08..O-G10: value centering against MEASURED equipment footprints
#
# A panel JSON contains no equipment-box boundaries. Nothing in this file can
# derive one, and a check that pretended otherwise would be worse than no check:
# it would report "centered" for a value box sitting on a label. So centering is
# only ever checked against a sidecar measurement supplied with --footprints,
# exactly as validate-romkontroll-panel.py checks bindings only against
# --source-sql. Without the flag the validator says what it therefore cannot
# prove, and proves nothing.
# --------------------------------------------------------------------------

FOOTPRINT_FORMAT = "iwmac-oversikt-footprints"

# build-oversikt-footprints.py --synthetic stamps both of these. A synthetic
# sidecar is back-derived from the panel's own value objects, so O-G08 passes by
# construction and proves nothing at all - it exists to exercise the checker.
SYNTHETIC_SOURCE = "synthetic-back-derived"

# The slack of a hand-dragged object. Same value and same reasoning as HAIRLINE.
CENTER_TOLERANCE = 2

# Beyond a nudge the value box is on a different part of the equipment, which is
# the defect the 2026-08-11 correction was issued against. Same threshold as
# CLUSTER_NUDGE_LIMIT, for the same reason.
CENTER_MOVE_LIMIT = CLUSTER_NUDGE_LIMIT


def half_up(value):
    """Round .5 away from zero, which is what the documented formula means.

    Python's round() is banker's rounding: round(2.5) is 2 and round(3.5) is 4.
    A centering formula rounded that way lands one pixel left of centre on every
    other even-width footprint, so the contract specifies HALF UP and this is the
    reference implementation of it.
    """
    return int(math.floor(value + 0.5)) if value >= 0 else -int(math.floor(-value + 0.5))


def load_footprints(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def is_synthetic(document):
    """True when the sidecar declares itself instrumentation rather than evidence.

    Checked at the header and at every record, because a record may carry its own
    source. Nothing here is a schema requirement - an unmarked synthetic file is
    indistinguishable from a measured one, which is exactly why the generator
    stamps both fields and why this check exists at all.
    """
    if not isinstance(document, dict):
        return False
    if document.get("synthetic") or document.get("source") == SYNTHETIC_SOURCE:
        return True
    records = document.get("records")
    return (isinstance(records, list) and bool(records)
            and all(isinstance(r, dict) and r.get("source") == SYNTHETIC_SOURCE
                    for r in records))


def footprint_records(document):
    """Flatten a footprint document into records with header defaults applied.

    The header carries the values that are the same for every record - the
    resolution measured at, the canvas measured for, where the measurement came
    from - and any record may override them. Returns (records, header).
    """
    if not isinstance(document, dict):
        return [], {}
    header = {key: document.get(key) for key in
              ("format", "version", "panel", "panel_size", "source",
               "source_image_size", "measured_by", "synthetic", "_note")}
    records = document.get("records")
    if not isinstance(records, list):
        records = []
    merged = []
    for record in records:
        if not isinstance(record, dict):
            merged.append({"_malformed": record})
            continue
        entry = dict(record)
        for key in ("source", "source_image_size", "panel_size"):
            if entry.get(key) in (None, "", []):
                entry[key] = header.get(key)
        merged.append(entry)
    return merged, header


def _pair(value):
    if (isinstance(value, (list, tuple)) and len(value) == 2
            and all(as_int(v) is not None for v in value)):
        return as_int(value[0]), as_int(value[1])
    return None


def _box(value):
    if not isinstance(value, dict):
        return None
    parts = [as_int(value.get(key)) for key in ("left", "top", "width", "height")]
    if any(part is None for part in parts):
        return None
    return tuple(parts)


def check_footprint_evidence(envelope, clusters, roles, records, header, findings):
    """O-G09/O-G10: is the measurement itself usable, and does it fit this panel?

    Runs before O-G08 and is deliberately strict. A centering verdict computed
    from a mistyped resolution or a footprint measured on another store's plan
    is a confident wrong answer, and a confident wrong answer here is exactly the
    failure this whole namespace exists to prevent.
    """
    panel = envelope.get("panel") or {}
    canvas = (as_int(panel.get("panel_width")), as_int(panel.get("panel_height")))

    if header.get("format") not in (None, FOOTPRINT_FORMAT):
        findings.append(Finding("O-G09", "error",
                                f"footprint file format is {header.get('format')!r}, "
                                f"expected {FOOTPRINT_FORMAT!r}"))
    if header.get("synthetic") or header.get("source") == SYNTHETIC_SOURCE:
        findings.append(Finding("O-G09", "warning",
                                "this footprint file is SYNTHETIC - back-derived from the "
                                "panel's own value objects, so O-G08 passes by construction "
                                "and proves nothing about the artwork. Test instrumentation, "
                                "never evidence: centering stays unproven until the boxes "
                                "are measured on the background image"))
    if not records:
        findings.append(Finding("O-G09", "error",
                                "the footprint file carries no records. Nothing about "
                                "centering can be checked from it"))
        return {}

    known = {str(key) for key in clusters if key is not None}
    usable = {}
    seen = collections.Counter()
    # One line per distinct resolution, not per record. A scale that applies to
    # every controller is one fact about the file, and repeating it 30 times
    # buries the findings that are about one controller.
    scales = collections.defaultdict(list)

    for index, record in enumerate(records):
        where = f"record {index}"
        if "_malformed" in record:
            findings.append(Finding("O-G09", "error",
                                    f"{where} is not an object: {record['_malformed']!r}"))
            continue
        unit = str(record.get("unit_id") or "").strip()
        if not unit:
            findings.append(Finding("O-G09", "error",
                                    f"{where} has no unit_id. A footprint that names no "
                                    f"controller cannot be checked against anything"))
            continue
        where = f"{unit}"
        seen[unit] += 1
        if seen[unit] > 1:
            findings.append(Finding("O-G09", "error",
                                    f"{where}: measured twice. One controller has one "
                                    f"equipment footprint - if it serves a combined case, "
                                    f"record the UNION as one footprint"))
            continue
        if unit not in known:
            findings.append(Finding("O-G09", "error",
                                    f"{where}: measured, but no such controller is in the "
                                    f"panel. The measurement is of another panel, or the "
                                    f"unit_id is mistyped"))
            continue

        box = _box(record.get("footprint"))
        if box is None:
            findings.append(Finding("O-G09", "error",
                                    f"{where}: footprint is missing or not "
                                    f"{{left, top, width, height}} of integers"))
            continue
        if box[2] <= 0 or box[3] <= 0:
            findings.append(Finding("O-G09", "error",
                                    f"{where}: footprint is {box[2]}x{box[3]}. A "
                                    f"zero-or-negative box has no centre"))
            continue

        image_size = _pair(record.get("source_image_size"))
        panel_size = _pair(record.get("panel_size"))
        if image_size is None or image_size[0] <= 0 or image_size[1] <= 0:
            findings.append(Finding("O-G10", "error",
                                    f"{where}: source_image_size is missing or not a "
                                    f"positive [width, height]. A coordinate quoted "
                                    f"without the resolution it was measured at is not "
                                    f"evidence"))
            continue
        if panel_size is None:
            findings.append(Finding("O-G10", "error",
                                    f"{where}: panel_size is missing. State the canvas the "
                                    f"footprint is being scaled onto"))
            continue
        if None not in canvas and panel_size != canvas:
            findings.append(Finding("O-G10", "error",
                                    f"{where}: panel_size is {panel_size[0]}x{panel_size[1]} "
                                    f"but this panel's canvas is {canvas[0]}x{canvas[1]}. "
                                    f"The measurement was made for a different panel"))
            continue

        if not str(record.get("evidence_note") or "").strip():
            findings.append(Finding("O-G09", "warning",
                                    f"{where}: evidence_note is empty. Record what was "
                                    f"measured and how, or the number cannot be re-checked"))

        scale_x = panel_size[0] / image_size[0]
        scale_y = panel_size[1] / image_size[1]
        entry = clusters.get(unit) or clusters.get(_matching_key(clusters, unit))
        value_obj = next((o for o in (entry or {}).get("members", [])
                          if roles.get(o.get("obj_id")) == "value"), None)
        if value_obj is None:
            findings.append(Finding("O-G09", "warning",
                                    f"{where}: the cluster carries no value object, so "
                                    f"there is nothing to centre on this footprint"))
            continue

        size = (as_int(value_obj.get("posWidth")), as_int(value_obj.get("posHeight")))
        declared = _pair(record.get("value_object_size"))
        if declared and declared != size:
            findings.append(Finding("O-G09", "warning",
                                    f"{where}: value_object_size says "
                                    f"{declared[0]}x{declared[1]}, the object is "
                                    f"{size[0]}x{size[1]}. Using the object's own size - "
                                    f"never force a size onto a supplied panel"))

        left = box[0] * scale_x
        top = box[1] * scale_y
        width = box[2] * scale_x
        height = box[3] * scale_y
        expected = (half_up(left + (width - size[0]) / 2),
                    half_up(top + (height - size[1]) / 2))

        stated = record.get("expected_value_position")
        if isinstance(stated, dict):
            pair = (as_int(stated.get("left")), as_int(stated.get("top")))
            if None in pair:
                findings.append(Finding("O-G09", "error",
                                        f"{where}: expected_value_position is not "
                                        f"{{left, top}} of integers"))
                continue
            if pair != expected:
                findings.append(Finding("O-G09", "error",
                                        f"{where}: expected_value_position says "
                                        f"({pair[0]}, {pair[1]}) but the recorded footprint "
                                        f"implies ({expected[0]}, {expected[1]}). The "
                                        f"measurement contradicts itself - fix the record "
                                        f"before trusting either number"))
                continue

        if (scale_x, scale_y) != (1.0, 1.0):
            scales[(image_size, panel_size, scale_x, scale_y)].append(unit)

        usable[unit] = {
            "record": record,
            "value": value_obj,
            "expected": expected,
            "footprint_canvas": (left, top, width, height),
            "size": size,
        }

    for (image_size, panel_size, scale_x, scale_y), units in scales.items():
        findings.append(Finding("O-G10", "info",
                                f"{len(units)} footprint(s) measured at "
                                f"{image_size[0]}x{image_size[1]}, scaled onto "
                                f"{panel_size[0]}x{panel_size[1]} with "
                                f"scale_x={scale_x:.6g}, scale_y={scale_y:.6g}"))

    unmeasured = sorted(key for key in known if key not in seen)
    if unmeasured:
        findings.append(Finding("O-G09", "info",
                                f"{len(unmeasured)} controller(s) have no measured "
                                f"footprint: {', '.join(unmeasured)}. Centering is NOT "
                                f"proven for these - they are an evidence gap, not a pass"))
    return usable


def _matching_key(clusters, unit):
    for key in clusters:
        if str(key) == unit:
            return key
    return None


def check_value_centering(usable, findings, tolerance=CENTER_TOLERANCE):
    """O-G08: is each value object centred on the footprint measured for it?

    Three verdicts, and the middle one matters most. An exact hit is silent. A
    few pixels out is a nudge and warns. Anything further, or a value box whose
    own centre falls outside the equipment box entirely, is the defect: the
    bubble is on the label, on the edge, or on the floor beside the case.

    A record marked production_proven downgrades every verdict to info. A
    supplied production export is rank 1 and outranks a measurement, and a
    validator that told an author to "correct" a real panel into geometric
    tidiness would be teaching the failure this repository documents.
    """
    if not usable:
        return
    centered = []
    for unit in sorted(usable):
        entry = usable[unit]
        obj = entry["value"]
        actual = (as_int(obj.get("posLeft")), as_int(obj.get("posTop")))
        expected = entry["expected"]
        proven = bool(entry["record"].get("production_proven"))
        if None in actual:
            findings.append(Finding("O-G08", "error",
                                    f"{unit}: the value object has unparseable geometry"))
            continue
        dx, dy = actual[0] - expected[0], actual[1] - expected[1]
        drift = max(abs(dx), abs(dy))

        left, top, width, height = entry["footprint_canvas"]
        cx = actual[0] + entry["size"][0] / 2
        cy = actual[1] + entry["size"][1] / 2
        outside = not (left <= cx <= left + width and top <= cy <= top + height)

        if drift <= tolerance and not outside:
            centered.append(unit)
            continue

        if outside:
            message = (f"{unit}: the value object's centre ({cx:.0f}, {cy:.0f}) is "
                       f"OUTSIDE the measured equipment footprint "
                       f"({half_up(left)}, {half_up(top)}) {half_up(width)}x"
                       f"{half_up(height)}. The temperature bubble is not on the box - "
                       f"expected top-left ({expected[0]}, {expected[1]}), found "
                       f"({actual[0]}, {actual[1]})")
            severity = "error"
        else:
            message = (f"{unit}: the value object is off-centre by ({dx:+d}, {dy:+d}) - "
                       f"expected ({expected[0]}, {expected[1]}), found "
                       f"({actual[0]}, {actual[1]}) on a "
                       f"{half_up(width)}x{half_up(height)} footprint")
            severity = "error" if drift > CENTER_MOVE_LIMIT else "warning"

        if proven:
            findings.append(Finding("O-G08", "info",
                                    message + ". production_proven: a supplied production "
                                    "export outranks this measurement, so this is RECORDED, "
                                    "not corrected"))
            continue
        findings.append(Finding("O-G08", severity, message))

    if centered:
        findings.append(Finding("O-G08", "info",
                                f"{len(centered)} of {len(usable)} measured value object(s) "
                                f"are centred on their equipment footprint within "
                                f"{tolerance}px: {', '.join(centered)}"))


def note_centering_unproven(findings):
    """The other half of the sidecar contract: say what was NOT checked.

    Silence would read as a pass. This validator's whole justification is that a
    well-formed panel can be badly wrong, and "the value boxes are centred" is
    precisely the claim a structural run has no way to make.
    """
    findings.append(Finding("O-G08", "info",
                            "no --footprints: this run proves NOTHING about whether any "
                            "value object is centred on the case it monitors. A panel JSON "
                            "carries no equipment-box boundaries. Measure them "
                            "(build-oversikt-footprints.py) or answer it visually at "
                            "controller-level crops - OVERSIKT-QA-CHECKLIST.md stage C"))


def coverage_rows(clusters, roles_order):
    rows = []
    for entry in clusters.values():
        if entry["key"] is None:
            continue
        left, top, right, bottom = entry["bbox"] or (0, 0, 0, 0)
        rows.append({
            "controller": entry["key"],
            "identity_from": entry["origin"],
            "roles": {role: entry["roles"].get(role, 0) for role in roles_order},
            "members": len(entry["members"]),
            "bbox": [left, top, right, bottom],
        })
    return rows


# --------------------------------------------------------------------------
# O-P: template profile
# --------------------------------------------------------------------------

def check_profile(envelope, objects, clusters, profile, findings):
    panel = envelope.get("panel") or {}
    expected_canvas = tuple(profile.get("canvas") or (0, 0))
    actual_canvas = (as_int(panel.get("panel_width")), as_int(panel.get("panel_height")))
    if expected_canvas and actual_canvas != expected_canvas:
        findings.append(Finding("O-P01", "error",
                                f"canvas is {actual_canvas[0]}x{actual_canvas[1]}, the "
                                f"profile is {expected_canvas[0]}x{expected_canvas[1]}"))

    if profile.get("object_count") is not None and len(objects) != profile["object_count"]:
        findings.append(Finding("O-P02", "error",
                                f"{len(objects)} objects, the profile records "
                                f"{profile['object_count']}"))

    expected_clusters = {c["controller"]: c for c in profile.get("clusters") or []}
    actual_clusters = {k: v for k, v in clusters.items() if k is not None}

    missing = [k for k in expected_clusters if k not in actual_clusters]
    if missing:
        findings.append(Finding("O-P03", "error",
                                f"{len(missing)} controller(s) in the profile are absent "
                                f"from this panel: {', '.join(sorted(missing))}"))
    extra = [k for k in actual_clusters if k not in expected_clusters]
    if extra:
        findings.append(Finding("O-P03", "error",
                                f"{len(extra)} controller(s) are not in the profile: "
                                f"{', '.join(sorted(extra))}"))

    for key, expected in expected_clusters.items():
        actual = actual_clusters.get(key)
        if actual is None:
            continue
        want = {role: n for role, n in (expected.get("roles") or {}).items() if n}
        have = {role: n for role, n in actual["roles"].items() if n}
        if want != have:
            findings.append(Finding("O-P04", "error",
                                    f"controller {key} covers {have or '{}'}; the profile "
                                    f"records {want or '{}'}"))

    by_name = {o.get("name"): o for o in objects}
    for expected in profile.get("objects") or []:
        actual = by_name.get(expected["name"])
        if actual is None:
            continue
        if actual.get("obj_id") != expected["obj_id"]:
            findings.append(Finding("O-P05", "error",
                                    f"{expected['name']} is {actual.get('obj_id')!r}, the "
                                    f"profile records {expected['obj_id']!r}"))
            continue
        for field, want in (("posLeft", expected["left"]), ("posTop", expected["top"]),
                            ("posWidth", expected["width"]), ("posHeight", expected["height"])):
            if as_int(actual.get(field)) != want:
                findings.append(Finding("O-P06", "error",
                                        f"{expected['name']}.{field} is "
                                        f"{actual.get(field)!r}, the profile records {want}"))

    known_tails = collections.defaultdict(set)
    for expected in profile.get("objects") or []:
        known_tails[expected["obj_id"]].add(expected.get("alias_text"))
    for obj in objects:
        aliases = known_tails.get(obj.get("obj_id"))
        if aliases and obj.get("alias_text") not in aliases:
            findings.append(Finding("O-P07", "warning",
                                    f"{obj.get('name')} reads {obj.get('alias_text')!r}; this "
                                    f"template's {obj.get('obj_id')} objects read "
                                    f"{', '.join(sorted(repr(a) for a in aliases))}. An "
                                    f"unfamiliar alias on a known template is the shape an "
                                    f"invented binding takes"))

    expected_chars = (profile.get("background") or {}).get("image_data_chars")
    actual_chars = len(panel.get("image_data") or "")
    if expected_chars and actual_chars != expected_chars:
        findings.append(Finding("O-P08", "error" if not actual_chars else "warning",
                                f"background image_data is {actual_chars} chars, the profile "
                                f"records {expected_chars}. The artwork every coordinate in "
                                f"this profile was measured against is not the artwork here"))


# --------------------------------------------------------------------------
# O-C: source versus candidate
# --------------------------------------------------------------------------

def match_objects(source, candidate):
    """Pair source objects with candidate objects by descending specificity.

    Never by array index: an index match calls a reordered panel a rewritten
    one and hides the rewrite in the noise. Six passes, each consuming what it
    matches:

        1. obj_id + driver_id + unit_id   same object, same binding
        2. obj_id + position              same object, binding changed
        3. obj_id + alias_text            same object, moved and rebound
        4. driver_id + unit_id            SAME BINDING, DIFFERENT OBJECT TYPE
        5. exact position                 same slot, different object type
        6. obj_id, nearest by position    last resort

    Passes 4 and 5 exist so a substituted object is reported as a retype
    (O-C09) instead of a drop plus an unexplained addition. Swapping a
    purpose-built symbol for a generic value pill is a real and recurring
    failure - it is what the Maskin audit found - and the reviewer needs to be
    told which object was replaced by what, not handed two unrelated counts.

    A key of None never matches: an unbound object has no binding to pair on,
    and pass 4 must not marry two arbitrary unlinked objects to each other.

    What is left over on the source side is DROPPED and on the candidate side
    is ADDED - the two findings the 2026-08-10 incident needed and nobody had.
    """
    pairs = []
    left = list(source)
    right = list(candidate)

    def consume(key):
        nonlocal left, right
        buckets = collections.defaultdict(list)
        for obj in right:
            bucket_key = key(obj)
            if bucket_key is not None:
                buckets[bucket_key].append(obj)
        remaining, matched = [], set()
        for obj in left:
            obj_key = key(obj)
            bucket = buckets.get(obj_key) if obj_key is not None else None
            if bucket:
                partner = bucket.pop(0)
                pairs.append((obj, partner))
                matched.add(id(partner))
            else:
                remaining.append(obj)
        left = remaining
        right = [o for o in right if id(o) not in matched]

    def binding(obj):
        driver = (obj.get("driver_id") or "").strip()
        unit = (obj.get("unit_id") or "").strip()
        if not driver or driver == "driver_id":
            return None
        return (driver, unit)

    consume(lambda o: (o.get("obj_id"), (o.get("driver_id") or "").strip(),
                       (o.get("unit_id") or "").strip()))
    consume(lambda o: (o.get("obj_id"), as_int(o.get("posLeft")), as_int(o.get("posTop"))))
    consume(lambda o: (o.get("obj_id"), o.get("alias_text")))
    consume(binding)
    consume(lambda o: (as_int(o.get("posLeft")), as_int(o.get("posTop")),
                       as_int(o.get("posWidth")), as_int(o.get("posHeight"))))

    remaining = []
    for obj in left:
        pool = [o for o in right if o.get("obj_id") == obj.get("obj_id")]
        if not pool:
            remaining.append(obj)
            continue
        box = rect(obj) or (0, 0, 0, 0)
        nearest = min(pool, key=lambda o: abs((rect(o) or (0, 0, 0, 0))[0] - box[0])
                      + abs((rect(o) or (0, 0, 0, 0))[1] - box[1]))
        pairs.append((obj, nearest))
        right = [o for o in right if o is not nearest]
    left = remaining
    return pairs, left, right


# Which object-level differences a named patch is allowed to contain. Anything
# outside its permitted set is a scope escape: real, reported, and not excused
# by the patch having been otherwise correct.
PATCH_SCOPES = {
    "value-position": {
        "roles": ("value",),
        "fields": ("posLeft", "posTop"),
        "description": ("a centering correction: posLeft/posTop on "
                        "temperature/value objects, and no field difference at "
                        "all on any other object"),
    },
    "position": {
        "roles": None,
        "fields": ("posLeft", "posTop"),
        "description": "a pure move: posLeft/posTop on any object, nothing else",
    },
    "none": {
        "roles": (),
        "fields": (),
        "description": ("a no-op: the candidate must be field-identical to the "
                        "source on every matched object"),
    },
}

# Written by export, not by the author, and therefore not evidence that a patch
# escaped its scope. Named explicitly so the exemption is auditable rather than
# implicit in a diff that quietly skips fields.
EXPORT_ONLY_ENVELOPE_FIELDS = ("exported_at", "generator")


def check_patch_scope(pairs, roles, scope_name, findings):
    """O-C16: prove a patch changed only what it was allowed to change.

    The 2026-08-11 correction was one sentence - put the temperature bubble in
    the centre of every box - and the risk in applying it is not that the value
    objects move wrongly. It is that everything ELSE moves too: an object
    renamed by a rebuild, a binding normalized, a size "tidied" to 42x22, an
    array reordered. Each of those is individually invisible in a diff of 128
    objects, and together they are a rewrite wearing a patch's clothes.

    So this does the opposite of the other O-C checks: instead of naming the
    differences that matter, it names the differences that are ALLOWED and
    reports every other one.
    """
    scope = PATCH_SCOPES.get(scope_name)
    if scope is None:
        findings.append(Finding("O-C16", "error",
                                f"unknown --patch-scope {scope_name!r}; "
                                f"defined: {', '.join(sorted(PATCH_SCOPES))}"))
        return
    allowed_roles, allowed_fields = scope["roles"], scope["fields"]

    escapes = collections.Counter()
    detail = []
    for src, cand in pairs:
        role = roles.get(src.get("obj_id"))
        in_scope = allowed_roles is None or role in allowed_roles
        for field in OBJECT_FIELDS:
            before, after = src.get(field), cand.get(field)
            if before == after:
                continue
            if field in allowed_fields and in_scope:
                continue
            escapes[field] += 1
            if len(detail) < 12:
                detail.append(f"{src.get('name')} ({role or '-'}).{field}: "
                              f"{before!r} -> {after!r}")

    if not escapes:
        findings.append(Finding("O-C16", "info",
                                f"patch scope {scope_name!r} held: every matched object "
                                f"differs only within {scope['description']}"))
        return

    findings.append(Finding("O-C16", "error",
                            f"patch scope {scope_name!r} was exceeded - "
                            f"{sum(escapes.values())} field difference(s) outside "
                            f"{scope['description']}: "
                            f"{', '.join(f'{f} x{n}' for f, n in escapes.most_common())}"))
    for line in detail:
        findings.append(Finding("O-C16", "error", f"  {line}"))
    if sum(escapes.values()) > len(detail):
        findings.append(Finding("O-C16", "error",
                                f"  ...and {sum(escapes.values()) - len(detail)} further "
                                f"out-of-scope difference(s)"))


def compare(source_doc, candidate_doc, rules, findings, patch_scope=None):
    src_env, cand_env = envelope_of(source_doc), envelope_of(candidate_doc)
    src_panel = src_env.get("panel") or {}
    cand_panel = cand_env.get("panel") or {}
    src_objects, cand_objects = objects_of(src_env), objects_of(cand_env)
    roles = role_map((rules.get("panel_types") or {}).get("oversikt") or {})

    src_clusters = inventory(src_objects, roles)
    cand_clusters = inventory(cand_objects, roles)

    pairs, dropped, added = match_objects(src_objects, cand_objects)

    if patch_scope:
        check_patch_scope(pairs, roles, patch_scope, findings)

    if dropped:
        names = [str(o.get("name")) for o in dropped[:10]]
        findings.append(Finding("O-C01", "error",
                                f"{len(dropped)} source object(s) are absent from the "
                                f"candidate: {', '.join(names)}"
                                f"{' ...' if len(dropped) > 10 else ''}. A supplied "
                                f"production JSON is the coverage template; a rebuild that "
                                f"loses objects is not a repair"))
    if added:
        labels = [str(o.get("alias_text") or o.get("name")) for o in added[:10]]
        findings.append(Finding("O-C02", "warning",
                                f"{len(added)} candidate object(s) have no source "
                                f"counterpart: {', '.join(labels)}"
                                f"{' ...' if len(added) > 10 else ''}. Legitimate only if "
                                f"the task asked for them - name each one and its evidence"))

    # Missing and changed clusters. This is the headline check.
    src_keys = {k for k in src_clusters if k is not None}
    cand_keys = {k for k in cand_clusters if k is not None}
    missing = sorted(src_keys - cand_keys)
    if missing:
        findings.append(Finding("O-C03", "error",
                                f"{len(missing)} of {len(src_keys)} source controller "
                                f"cluster(s) are missing entirely: {', '.join(missing)}"))
    appeared = sorted(cand_keys - src_keys)
    if appeared:
        findings.append(Finding("O-C04", "error",
                                f"{len(appeared)} controller(s) exist only in the candidate: "
                                f"{', '.join(appeared)}. Either a binding was invented or an "
                                f"identity was rewritten"))

    for key in sorted(src_keys & cand_keys):
        src_entry, cand_entry = src_clusters[key], cand_clusters[key]
        want = {r: n for r, n in src_entry["roles"].items() if n}
        have = {r: n for r, n in cand_entry["roles"].items() if n}
        if want != have:
            findings.append(Finding("O-C05", "error",
                                    f"controller {key} covered {want} in the source and "
                                    f"{have} in the candidate. Coverage is derived from the "
                                    f"source, never assumed - four objects per controller is "
                                    f"not a rule"))
        if src_entry["bbox"] and cand_entry["bbox"]:
            dx = cand_entry["bbox"][0] - src_entry["bbox"][0]
            dy = cand_entry["bbox"][1] - src_entry["bbox"][1]
            distance = max(abs(dx), abs(dy))
            if distance > CLUSTER_NUDGE_LIMIT:
                findings.append(Finding("O-C06", "error",
                                        f"controller {key} moved by ({dx:+d},{dy:+d}) from "
                                        f"{src_entry['bbox'][:2]} to {cand_entry['bbox'][:2]}. "
                                        f"It is no longer on the case the source placed it "
                                        f"on; the source geometry is the template"))
            elif distance:
                findings.append(Finding("O-C06", "warning",
                                        f"controller {key} nudged by ({dx:+d},{dy:+d})"))

    stripped, relinked, retyped, resized, rez = [], [], [], [], []
    for src_obj, cand_obj in pairs:
        src_driver = (src_obj.get("driver_id") or "").strip()
        cand_driver = (cand_obj.get("driver_id") or "").strip()
        bound = src_driver and src_driver != "driver_id"
        now_bound = cand_driver and cand_driver != "driver_id"
        if bound and not now_bound:
            stripped.append(src_obj.get("name"))
        elif bound and src_driver != cand_driver:
            relinked.append(f"{src_obj.get('name')} {src_driver} -> {cand_driver}")
        if (src_obj.get("unit_id") or "") != (cand_obj.get("unit_id") or ""):
            relinked.append(f"{src_obj.get('name')} unit_id "
                            f"{src_obj.get('unit_id')!r} -> {cand_obj.get('unit_id')!r}")
        if src_obj.get("obj_id") != cand_obj.get("obj_id"):
            retyped.append(f"{src_obj.get('name')} {src_obj.get('obj_id')} -> "
                           f"{cand_obj.get('obj_id')}")
        if (as_int(src_obj.get("posWidth")), as_int(src_obj.get("posHeight"))) != \
                (as_int(cand_obj.get("posWidth")), as_int(cand_obj.get("posHeight"))):
            resized.append(src_obj.get("name"))
        if str(src_obj.get("zIndex")) != str(cand_obj.get("zIndex")):
            rez.append(src_obj.get("name"))

    if stripped:
        findings.append(Finding("O-C07", "error",
                                f"{len(stripped)} object(s) lost their driver binding: "
                                f"{', '.join(map(str, stripped[:10]))}"
                                f"{' ...' if len(stripped) > 10 else ''}. A layout correction "
                                f"never blanks a real binding - the objects still render and "
                                f"read nothing, and the JSON looks fine"))
    if relinked:
        findings.append(Finding("O-C08", "error",
                                f"{len(relinked)} binding change(s): "
                                f"{'; '.join(relinked[:6])}"
                                f"{' ...' if len(relinked) > 6 else ''}"))
    if retyped:
        findings.append(Finding("O-C09", "error",
                                f"{len(retyped)} object(s) changed type: "
                                f"{'; '.join(retyped[:6])}"))
    if resized:
        findings.append(Finding("O-C10", "warning",
                                f"{len(resized)} object(s) resized: "
                                f"{', '.join(map(str, resized[:10]))}"))
    if rez:
        findings.append(Finding("O-C11", "warning",
                                f"{len(rez)} object(s) changed zIndex: "
                                f"{', '.join(map(str, rez[:10]))}"))

    src_order = [o.get("name") for o in src_objects]
    cand_order = [c.get("name") for _, c in pairs]
    if len(pairs) == len(src_objects) and cand_order != src_order:
        findings.append(Finding("O-C12", "warning",
                                "array order changed. The host renames objects from the "
                                "canvas child index on insert, so order is how a reviewer "
                                "lines two exports up"))

    src_data = src_panel.get("image_data") or ""
    cand_data = cand_panel.get("image_data") or ""
    if src_data and not cand_data:
        findings.append(Finding("O-C13", "error",
                                "the source carried an embedded background and the candidate "
                                "does not. Same objects on no store plan is a different "
                                "panel"))
    elif src_data and cand_data and src_data != cand_data:
        findings.append(Finding("O-C13", "error",
                                f"the embedded background changed ({len(src_data)} chars -> "
                                f"{len(cand_data)}). Every coordinate in the source was "
                                f"measured against the source artwork"))
    for field in ("org_image_name", "converted"):
        if (src_panel.get(field) or "") != (cand_panel.get(field) or ""):
            findings.append(Finding("O-C14", "warning",
                                    f"panel.{field}: {src_panel.get(field)!r} -> "
                                    f"{cand_panel.get(field)!r}"))

    src_canvas = (as_int(src_panel.get("panel_width")), as_int(src_panel.get("panel_height")))
    cand_canvas = (as_int(cand_panel.get("panel_width")), as_int(cand_panel.get("panel_height")))
    if src_canvas != cand_canvas:
        findings.append(Finding("O-C15", "error",
                                f"canvas changed {src_canvas[0]}x{src_canvas[1]} -> "
                                f"{cand_canvas[0]}x{cand_canvas[1]}; every coordinate below "
                                f"means something different now"))

    kept = len(src_keys & cand_keys)
    findings.append(Finding("O-C00", "info",
                            f"source {len(src_objects)} objects / {len(src_keys)} clusters; "
                            f"candidate {len(cand_objects)} objects / {len(cand_keys)} "
                            f"clusters; {kept} controller(s) present in both"))
    return findings


# --------------------------------------------------------------------------
# Drivers
# --------------------------------------------------------------------------

def validate(document, profile_name=None, rules=None, palette=None,
             footprints=None, tolerance=CENTER_TOLERANCE):
    rules = load_rules() if rules is None else rules
    palette = load_palette() if palette is None else palette
    findings = []

    envelope = envelope_of(document)
    oversikt = (rules.get("panel_types") or {}).get("oversikt") or {}
    roles = role_map(oversikt)
    roles_order = [entry["role"] for entry in (oversikt.get("cluster") or {}).get("roles", [])]
    canvas_rule = oversikt.get("canvas") or {}
    contract_canvas = (canvas_rule.get("width"), canvas_rule.get("height"))
    bands = (oversikt.get("z_indexes") or {}).get("bands") or {}

    check_envelope(envelope, findings)
    check_counts(envelope, findings)
    check_background(envelope, findings)
    canvas = check_canvas(envelope, contract_canvas, findings)

    objects = objects_of(envelope)
    if not objects:
        findings.append(Finding("O-S00", "error",
                                "no objects. An Oversikt with no clusters shows nothing; "
                                "if this is a background-only patch, say so explicitly"))
        return findings

    check_fields_and_names(objects, findings)
    check_geometry(objects, canvas, findings)
    check_bindings(objects, findings)
    check_palette(objects, palette, findings)
    check_encoding(objects, findings)
    check_z_bands(objects, bands, findings)

    clusters = inventory(objects, roles)
    check_identity(objects, findings)
    check_vocabulary(objects, roles, findings)
    check_cluster_cohesion(clusters, findings)
    check_duplicate_roles(clusters, findings)
    check_partial_clusters(clusters, findings)
    check_grid(clusters, findings)
    check_overlaps(objects, roles, findings)

    if footprints is None:
        note_centering_unproven(findings)
    else:
        records, header = footprint_records(footprints)
        usable = check_footprint_evidence(envelope, clusters, roles, records,
                                          header, findings)
        check_value_centering(usable, findings, tolerance)

    rows = coverage_rows(clusters, roles_order)
    totals = collections.Counter()
    for row in rows:
        totals.update({r: n for r, n in row["roles"].items() if n})
    findings.append(Finding("O-G00", "info",
                            f"{len(objects)} objects in {len(rows)} controller cluster(s); "
                            f"{', '.join(f'{r} {totals.get(r, 0)}' for r in roles_order)}. "
                            f"COUNTS ARE EVIDENCE, NOT TARGETS - judge them against this "
                            f"panel's own source, never against another store"))

    if profile_name:
        profile = (rules.get("profiles") or {}).get(profile_name)
        if profile is None:
            findings.append(Finding("O-P00", "error",
                                    f"unknown profile {profile_name!r}; documentation-rules.json "
                                    f"defines {sorted((rules.get('profiles') or {}).keys())}"))
        elif profile.get("panel_type") != "oversikt":
            findings.append(Finding("O-P00", "error",
                                    f"profile {profile_name!r} is not an Oversikt profile"))
        else:
            check_profile(envelope, objects, clusters, profile, findings)

    return findings


def validate_pair(source_doc, candidate_doc, profile_name=None, rules=None, palette=None,
                  footprints=None, tolerance=CENTER_TOLERANCE, patch_scope=None):
    rules = load_rules() if rules is None else rules
    palette = load_palette() if palette is None else palette
    findings = validate(candidate_doc, profile_name, rules=rules, palette=palette,
                        footprints=footprints, tolerance=tolerance)
    compare(source_doc, candidate_doc, rules, findings, patch_scope=patch_scope)
    return findings


def coverage_matrix(document, rules=None):
    """The coverage matrix as data, for a report or a test."""
    rules = load_rules() if rules is None else rules
    oversikt = (rules.get("panel_types") or {}).get("oversikt") or {}
    roles = role_map(oversikt)
    roles_order = [entry["role"] for entry in (oversikt.get("cluster") or {}).get("roles", [])]
    clusters = inventory(objects_of(envelope_of(document)), roles)
    return coverage_rows(clusters, roles_order)


def print_matrix(rows, roles_order, out=sys.stdout):
    if not rows:
        return
    out.write("\nCOVERAGE MATRIX (evidence, not targets)\n")
    header = "controller".ljust(24) + "from".ljust(11)
    header += "".join(role.ljust(10) for role in roles_order) + "bbox\n"
    out.write(header)
    for row in rows:
        line = str(row["controller"]).ljust(24) + row["identity_from"].ljust(11)
        line += "".join((str(row["roles"][r]) if row["roles"][r] else "-").ljust(10)
                        for r in roles_order)
        left, top, right, bottom = row["bbox"]
        line += f"({left},{top})-({right},{bottom})\n"
        out.write(line)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("panel", nargs="?", type=pathlib.Path,
                        help="panel to check; same as --check")
    parser.add_argument("--check", type=pathlib.Path, metavar="PANEL.json")
    parser.add_argument("--compare", nargs=2, type=pathlib.Path,
                        metavar=("SOURCE.json", "CANDIDATE.json"),
                        help="validate the candidate AND diff it against the source. Use "
                             "this whenever a production export was supplied")
    parser.add_argument("--profile", default=None,
                        help="apply a named template profile from documentation-rules.json "
                             "(TEMPLATE-10113)")
    parser.add_argument("--footprints", type=pathlib.Path, default=None,
                        metavar="FOOTPRINTS.json",
                        help="measured equipment footprints (build-oversikt-footprints.py). "
                             "The ONLY way to check that value objects are centred on the "
                             "cases they monitor; without it that question is reported as "
                             "unproven")
    parser.add_argument("--center-tolerance", type=int, default=CENTER_TOLERANCE,
                        metavar="PX",
                        help=f"pixels of slack allowed on a centred value object "
                             f"(default {CENTER_TOLERANCE})")
    parser.add_argument("--patch-scope", default=None, choices=sorted(PATCH_SCOPES),
                        help="in --compare, assert that the candidate differs from the "
                             "source ONLY within this scope (O-C16)")
    parser.add_argument("--json-report", action="store_true", dest="as_json")
    parser.add_argument("--no-matrix", action="store_true",
                        help="suppress the coverage matrix in text output")
    args = parser.parse_args(argv)

    target = args.check or args.panel
    if bool(args.compare) == bool(target):
        parser.error("give exactly one of PANEL.json / --check PANEL.json / "
                     "--compare SOURCE.json CANDIDATE.json")
    if args.patch_scope and not args.compare:
        parser.error("--patch-scope compares a candidate against a source; it needs "
                     "--compare SOURCE.json CANDIDATE.json")

    rules, palette = load_rules(), load_palette()
    footprints = load_footprints(args.footprints) if args.footprints else None
    if args.compare:
        source_path, candidate_path = args.compare
        source_doc = json.loads(source_path.read_text(encoding="utf-8"))
        candidate_doc = json.loads(candidate_path.read_text(encoding="utf-8"))
        findings = validate_pair(source_doc, candidate_doc, args.profile,
                                 rules=rules, palette=palette, footprints=footprints,
                                 tolerance=args.center_tolerance,
                                 patch_scope=args.patch_scope)
        subject, matrix_doc = candidate_path, candidate_doc
    else:
        matrix_doc = json.loads(target.read_text(encoding="utf-8"))
        findings = validate(matrix_doc, args.profile, rules=rules, palette=palette,
                            footprints=footprints, tolerance=args.center_tolerance)
        subject = target

    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]

    if args.as_json:
        oversikt = (rules.get("panel_types") or {}).get("oversikt") or {}
        roles_order = [e["role"] for e in (oversikt.get("cluster") or {}).get("roles", [])]
        print(json.dumps({
            "subject": str(subject),
            "mode": "compare" if args.compare else "check",
            "profile": args.profile,
            "errors": len(errors),
            "warnings": len(warnings),
            "findings": [f.as_dict() for f in findings],
            "coverage_matrix": coverage_matrix(matrix_doc, rules),
            "roles": roles_order,
        }, ensure_ascii=False, indent=2))
    else:
        for finding in findings:
            print(finding)
        if not args.no_matrix:
            oversikt = (rules.get("panel_types") or {}).get("oversikt") or {}
            roles_order = [e["role"] for e in (oversikt.get("cluster") or {}).get("roles", [])]
            print_matrix(coverage_matrix(matrix_doc, rules), roles_order)
        print(f"\n{len(errors)} error(s), {len(warnings)} warning(s) in {subject}")
        print("Structural only. It cannot see the artwork, so it cannot tell whether a "
              "cluster sits on its case - render at native size and check stage C of "
              "OVERSIKT-QA-CHECKLIST.md.")
        if footprints is None:
            print("Value centering was NOT checked. A panel JSON carries no equipment-box "
                  "boundaries; supply measured ones with --footprints FOOTPRINTS.json.")
        elif is_synthetic(footprints):
            print(f"Value centering checked against {args.footprints}, which is SYNTHETIC "
                  f"test instrumentation back-derived from this panel - it passes by "
                  f"construction. Nothing about centering is proved; measure the boxes on "
                  f"the artwork.")
        else:
            print(f"Value centering checked against {args.footprints} at "
                  f"{args.center_tolerance}px tolerance. The measurement is evidence like "
                  f"any other - a supplied production export still outranks it.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
