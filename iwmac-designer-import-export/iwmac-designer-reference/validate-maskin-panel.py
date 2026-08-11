#!/usr/bin/env python3
"""Deterministic validator for IWMAC Designer Maskin (machine-room) panel JSON.

Usage:
    python validate-maskin-panel.py PANEL.json [--profile TEMPLATE-10229]
    python validate-maskin-panel.py PANEL.json --json
    python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json
                                    [--patch-scope compressor-addition]

The rules are data, not code: everything panel-type- and template-specific is
read from ``documentation-rules.json`` (``panel_types.maskin`` and
``profiles.TEMPLATE-10229``, both generated from the committed fixture by
build-maskin-rules.py) so the contract, the fixture and this validator cannot
drift apart. Three namespaces:

    M-S*   structure. Runs on every panel.
    M-G*   Maskin relationships. Runs on every panel.
    M-P*   template geometry. Runs only when --profile is given.
    M-C*   candidate against source. Runs only with --compare.

WHAT THIS CANNOT DO. It cannot see the background artwork, so it cannot tell
whether a value pill sits on the pill drawn for it, whether a status strip
covers a compressor, whether a copied pipe branch reaches the header it should
join, or whether a cloned column came out faded. Those are the M-A* rules of
MASKIN-GENERATION-CONTRACT.md §16.1, they are about pixels, and stage C of
MASKIN-QA-CHECKLIST.md answers them with a native-size render. A clean run here
is a necessary condition, never a sufficient one, and must never be reported as
"the panel is correct".

Exit status is 0 when no finding has severity ``error``, 1 otherwise. This file
performs no network access and reads nothing outside the reference directory.
"""

from __future__ import annotations

import argparse
import collections
import json
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

# The two pill families. Everything else on a Maskin panel is a status strip,
# an LED, a pump or an alarm, and those carry their own sizes.
VALUE_PILL = "number_v3_value_only"
SETPOINT_PILL = "number_v3_white_value_only"
PILL_SIZE = (50, 20)

COMPRESSOR_ALIAS = re.compile(r"^C(\d+) (MT|LT) (status|capacity|Runtime total|VSD 1 speed)$")

# Residue shapes, all three measured on the 10229 export: a saved_by of the form
# "first.last", a driver_id of the form "10229_AK3_AKC_0_60_0_<param>_<index>",
# and a unit_id of the form "000:060". The live values stay out of this file.
PERSON = re.compile(r"^[^\s@/\\]+\.[^\s@/\\]+$")
PLANT_PREFIX = re.compile(r"^\d{4,6}_")
UNIT_ID = re.compile(r"^\d{3}:\d{3}$")


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


def is_integer_px(value):
    """Deliberately stricter than as_int: parseInt reads "196.5" as 196 and the
    panel renders, but a fractional coordinate is a generator bug."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return value == int(value)
    if isinstance(value, str):
        return bool(re.match(r"^\s*[-+]?\d+\s*$", value))
    return False


def px(obj, field):
    return as_int(obj.get(field)) or 0


def box(obj):
    left, top = px(obj, "posLeft"), px(obj, "posTop")
    return left, top, left + px(obj, "posWidth"), top + px(obj, "posHeight")


def role_key(obj):
    """How a Maskin object is identified across two documents.

    NOT the array index and NOT the name: Insert renames every object from the
    live canvas child index, so object_7 in a source and object_7 in the result
    are unrelated. obj_id + alias_text + tag_text survives that.
    """
    return (obj.get("obj_id"), obj.get("alias_text"), obj.get("tag_text"))


# --------------------------------------------------------------------------
# Structure - every Maskin panel
# --------------------------------------------------------------------------

def check_envelope(envelope, out):
    if envelope.get("format") != "iwmac-designer-panel":
        out.append(Finding("M-S01", "error",
                           f'format must be exactly "iwmac-designer-panel", '
                           f'got {envelope.get("format")!r}'))
    if envelope.get("version") != 1:
        out.append(Finding("M-S01", "error", f'version must be 1, got {envelope.get("version")!r}'))
    if not isinstance(envelope.get("panel"), dict):
        out.append(Finding("M-S01", "error", '"panel" must be an object'))


def check_counts(envelope, out):
    panel = envelope.get("panel") or {}
    declared = envelope.get("counts")
    if not isinstance(declared, dict):
        out.append(Finding("M-S02", "error", '"counts" must be an object'))
        return
    for key in ("single_objects", "containers", "graphics"):
        actual = len(panel.get(key) or [])
        if declared.get(key) != actual:
            out.append(Finding("M-S02", "error",
                               f"counts.{key} is {declared.get(key)!r} but the "
                               f"array holds {actual}"))


def check_fields_and_names(objects, out):
    for index, obj in enumerate(objects):
        missing = [f for f in OBJECT_FIELDS if f not in obj]
        if missing:
            out.append(Finding("M-S03", "error",
                               f"object at index {index} is missing {', '.join(missing)}"))
    names = [obj.get("name") for obj in objects]
    expected = [f"object_{i}" for i in range(len(objects))]
    if names != expected:
        first = next((i for i, (a, b) in enumerate(zip(names, expected)) if a != b),
                     min(len(names), len(expected)))
        actual = names[first] if first < len(names) else "missing"
        out.append(Finding("M-S04", "error",
                           f"object names must be sequential object_0..object_{len(objects) - 1}; "
                           f"first divergence at index {first}: {actual!r}"))
    duplicates = {n for n in names if names.count(n) > 1}
    if duplicates:
        out.append(Finding("M-S04", "error", f"duplicate object names: {sorted(duplicates)}"))


def check_geometry(objects, canvas, out):
    width, height = canvas
    for obj in objects:
        malformed = False
        for field in ("posLeft", "posTop", "posWidth", "posHeight"):
            if not is_integer_px(obj.get(field)):
                malformed = True
                out.append(Finding("M-S05", "error",
                                   f"{obj.get('name')}: {field}={obj.get(field)!r} is not an "
                                   "integer pixel value"))
        if malformed:
            continue
        left, top, right, bottom = box(obj)
        if left < 0 or top < 0 or right > width or bottom > height:
            out.append(Finding("M-S05", "warning",
                               f"{obj.get('name')} ({obj.get('obj_id')}) extends outside the "
                               f"{width}x{height} canvas: ({left},{top})-({right},{bottom})"))


def check_z_bands(objects, bands, out):
    values = {str(obj.get("zIndex")) for obj in objects}
    if "default" in values and len(values) > 1:
        out.append(Finding("M-S06", "error",
                           'zIndex mixes the literal "default" with explicit bands: '
                           f"{sorted(values)}. Use one mode for the whole panel."))
    if bands:
        unknown = sorted(v for v in values if v != "default" and v not in bands)
        if unknown:
            out.append(Finding("M-S06", "warning",
                               f"zIndex values outside the documented Maskin bands "
                               f"{sorted(bands)}: {unknown}. The Ventilasjon bands are a "
                               "different set - do not borrow them."))
    if values == {"default"}:
        out.append(Finding("M-S06", "warning",
                           'every zIndex is the literal "default", so ARRAY ORDER is stacking '
                           "order. Legal, but the measured Maskin reference uses explicit "
                           "bands; a value pill emitted before its status strip will render "
                           "under it."))


def check_background(envelope, objects, mode, out):
    panel = envelope.get("panel") or {}
    for key in ("containers", "graphics"):
        value = panel.get(key) or []
        if value:
            out.append(Finding("M-S07", "error",
                               f"panel.{key} must be empty on a Maskin panel, got "
                               f"{len(value)} entries"))
    if "image_svg_trace" in panel:
        size = len(panel.get("image_svg_trace") or "")
        if mode == "production":
            # A host export legitimately carries it - Export writes it FOR an
            # AI to read. It is still not something to commit or hand back.
            out.append(Finding("M-S07", "warning",
                               f"panel.image_svg_trace is present ({size} chars). Export writes "
                               "it as AI *input* and Insert deletes it again, so it is normal in "
                               "a host export - but strip it before committing the file or "
                               "re-emitting it as output."))
        else:
            out.append(Finding("M-S07", "error",
                               "panel.image_svg_trace must never be emitted. Export writes it as "
                               "AI *input*; the insert path deletes it again. Emitting it ships "
                               "megabytes the host throws away."))
    has_raster = bool(panel.get("image_data"))
    has_vector = bool(panel.get("image_svg"))
    if not has_raster and not has_vector:
        out.append(Finding("M-S07", "warning",
                           "no background: neither panel.image_data nor panel.image_svg is "
                           "present. A Maskin panel is unreadable without its artwork - say "
                           "explicitly that the background is supplied separately."))
    if has_raster and panel.get("converted") != "true":
        out.append(Finding("M-S07", "warning",
                           f'panel.image_data is present but converted is '
                           f'{panel.get("converted")!r}; an embedded raster background travels '
                           'with converted "true"'))
    if not objects:
        counts = envelope.get("counts") or {}
        if any(counts.get(k) for k in ("single_objects", "containers", "graphics")):
            out.append(Finding("M-S07", "error",
                               "this is a background-only patch (no objects) but counts are "
                               f"not all zero: {counts}"))
        if not has_raster and not has_vector:
            out.append(Finding("M-S07", "error",
                               "a background-only patch with no background changes nothing"))


def detect_mode(objects):
    """A generated demo emits the literal "driver_id" on every object; a
    production export never does - an unlinked object in a real export carries
    an EMPTY driver_id. A panel with no objects at all is a background-only
    patch, which is authored output, so it is judged as a demo."""
    if not objects:
        return "demo"
    return "demo" if any(o.get("driver_id") == "driver_id" for o in objects) else "production"


def check_unlinked_demo(envelope, objects, out):
    panel = envelope.get("panel") or {}
    for key, holder in (("source_plant_id", envelope), ("plant_id", panel)):
        if holder.get(key):
            out.append(Finding("M-S08", "error",
                               f"{key} must be empty on an unlinked demo, got "
                               f"{holder.get(key)!r}"))
    for obj in objects:
        name = obj.get("name")
        if obj.get("linked") != "false":
            out.append(Finding("M-S08", "error",
                               f'{name}: linked must be "false" on an unlinked demo, got '
                               f'{obj.get("linked")!r}'))
        for field in ("id", "driver_id"):
            if obj.get(field) != "driver_id":
                out.append(Finding("M-S08", "error",
                                   f'{name}: {field} must be the literal "driver_id", got '
                                   f'{obj.get(field)!r}'))
        for field in ("link_name", "link_tag", "unit_id", "unit_ref", "sub_group"):
            if obj.get(field):
                out.append(Finding("M-S08", "error",
                                   f"{name}: {field} must be empty on an unlinked demo, got "
                                   f"{obj.get(field)!r}"))
        if not (obj.get("alias_text") or "").strip():
            out.append(Finding("M-S08", "error",
                               f"{name}: alias_text is empty. On Maskin the alias IS the "
                               "Danfoss parameter name and it is what a human relinks by - an "
                               "unlinked demo without aliases cannot be linked afterwards."))


def check_production_export(objects, out):
    """The mirror image of the demo contract. Only the two host literals are
    invariant: the host emits `id` and `link_name` on every exported object
    regardless of linking, and sets linked="true" whenever driver_id is not the
    placeholder - which an EMPTY driver_id is not. On the 10229 export all 66
    objects are linked="true" and two of them have no binding at all."""
    for obj in objects:
        name = obj.get("name")
        for field, literal in (("id", "driver_id"), ("link_name", "link_name")):
            if obj.get(field) != literal:
                out.append(Finding("M-S08", "error",
                                   f'{name}: {field} is the host literal "{literal}" on every '
                                   f"exported object, got {obj.get(field)!r}"))
        if obj.get("linked") not in ("true", "false"):
            out.append(Finding("M-S08", "error",
                               f'{name}: linked must be "true" or "false", got '
                               f'{obj.get("linked")!r}'))


def check_residue(envelope, objects, out):
    """Sanitization residue in an artifact that is meant to be committed.

    M-S08 already forbids live bindings on the objects. This catches the three
    places a plant leaks through the envelope instead, which a per-object check
    walks straight past. Only meaningful for authored artifacts - a production
    export is supposed to name its plant.
    """
    panel = envelope.get("panel") or {}
    saved_by = (panel.get("saved_by") or "").strip()
    if PERSON.match(saved_by):
        out.append(Finding("M-S10", "error",
                           f"panel.saved_by is the live identity {saved_by!r}. Committed "
                           'artifacts carry "" or a generator marker, never the person who '
                           "saved the source panel."))
    for key in ("org_image_name", "image_name", "panel_name"):
        value = panel.get(key) or envelope.get(key) or ""
        if PLANT_PREFIX.match(str(value)):
            out.append(Finding("M-S10", "warning",
                               f"{key}={value!r} still starts with the source plant id"))
    for obj in objects:
        driver = obj.get("driver_id") or ""
        if PLANT_PREFIX.match(driver):
            out.append(Finding("M-S10", "error",
                               f"{obj.get('name')}: driver_id {driver!r} is a live plant "
                               "binding"))
        if UNIT_ID.match(obj.get("unit_id") or ""):
            out.append(Finding("M-S10", "error",
                               f"{obj.get('name')}: unit_id {obj.get('unit_id')!r} is a live "
                               "unit address"))


def check_encoding(objects, out):
    for obj in objects:
        for field in ("tag_text", "alias_text"):
            text = obj.get(field) or ""
            if re.search(r"\bgr\s?C\b", text):
                out.append(Finding("M-S09", "error",
                                   f'{obj.get("name")}: {field} uses the degraded ASCII form '
                                   f'{text!r}; emit UTF-8 "°C"'))


# --------------------------------------------------------------------------
# Maskin relationships - every Maskin panel
# --------------------------------------------------------------------------

def check_palette(objects, palette, out):
    if not palette:
        return
    for obj in objects:
        if obj.get("obj_id") not in palette:
            out.append(Finding("M-G01", "error",
                               f'{obj.get("name")}: obj_id {obj.get("obj_id")!r} is not in the '
                               "object palette; an unknown id renders as a broken "
                               "undefined-class box"))


def check_band_ownership(objects, bands, out):
    if not bands:
        return
    owner = {}
    for band, spec in bands.items():
        for obj_id in spec.get("obj_ids", []):
            owner.setdefault(obj_id, set()).add(band)
    for obj in objects:
        expected = owner.get(obj.get("obj_id"))
        actual = str(obj.get("zIndex"))
        if expected and actual != "default" and actual not in expected:
            out.append(Finding("M-G02", "warning",
                               f"{obj.get('name')} ({obj.get('obj_id')}) is at z {actual}; the "
                               f"Maskin reference puts this object family at "
                               f"{sorted(expected)}"))


def check_setpoint_pill(objects, spec, out):
    if not spec:
        return
    markers = [m.lower() for m in spec.get("alias_markers", [])]
    severity = spec.get("severity", "warning")
    for obj in objects:
        alias = (obj.get("alias_text") or "").lower()
        marked = any(m in alias for m in markers)
        if obj.get("obj_id") == VALUE_PILL and marked:
            out.append(Finding("M-G03", severity,
                               f"{obj.get('name')} {obj.get('alias_text')!r} reads as a "
                               f"setpoint or reference but uses {VALUE_PILL}; the measured "
                               f"reference draws those on {SETPOINT_PILL}"))
        if obj.get("obj_id") == SETPOINT_PILL and not marked:
            out.append(Finding("M-G03", severity,
                               f"{obj.get('name')} {obj.get('alias_text')!r} uses the setpoint "
                               f"pill {SETPOINT_PILL} but does not read as a setpoint or "
                               "reference; confirm it against the artwork"))


def check_pill_size(objects, out):
    for obj in objects:
        if obj.get("obj_id") not in (VALUE_PILL, SETPOINT_PILL):
            continue
        size = (px(obj, "posWidth"), px(obj, "posHeight"))
        if size != PILL_SIZE:
            out.append(Finding("M-G07", "warning",
                               f"{obj.get('name')} ({obj.get('obj_id')}) is {size[0]}x{size[1]}; "
                               f"every value pill on the measured Maskin reference is "
                               f"{PILL_SIZE[0]}x{PILL_SIZE[1]}. Catalogue dimensions are "
                               "toolbox defaults, not placement geometry."))


def compressors(objects):
    """{(index, side): {row: obj}} for every C<n> <side> <row> alias present."""
    found = collections.defaultdict(dict)
    for obj in objects:
        match = COMPRESSOR_ALIAS.match(obj.get("alias_text") or "")
        if match:
            index, side, row = match.groups()
            found[(int(index), side)][row] = obj
    return found


def check_compressor_columns(objects, required, optional, out):
    banks = compressors(objects)
    for (index, side), rows in sorted(banks.items()):
        missing = [row for row in required if row not in rows]
        if missing:
            out.append(Finding("M-G04", "error",
                               f"compressor C{index} {side} is missing {', '.join(missing)}. A "
                               "compressor column is an atomic cluster - status, capacity and "
                               "runtime travel together."))
        extra = [row for row in rows if row not in required and row not in optional]
        if extra:
            out.append(Finding("M-G04", "warning",
                               f"compressor C{index} {side} carries unrecognised rows: {extra}"))
    for side in ("MT", "LT"):
        present = sorted(i for (i, s) in banks if s == side)
        if present and present != list(range(1, len(present) + 1)):
            out.append(Finding("M-G04", "warning",
                               f"{side} compressors are numbered {present}; a gap usually means "
                               "a column was copied without its neighbours"))


def check_duplicates(objects, mode, out):
    aliases = collections.Counter(o.get("alias_text") for o in objects if o.get("alias_text"))
    for alias, count in sorted(aliases.items()):
        if count > 1:
            where = ", ".join(f"{o['name']}({px(o, 'posLeft')},{px(o, 'posTop')})"
                              for o in objects if o.get("alias_text") == alias)
            out.append(Finding("M-G05", "warning",
                               f"{count} objects share alias_text {alias!r}: {where}. Two boxes "
                               "on one parameter render the same number twice - confirm it is "
                               "intended before shipping."))
    if mode == "production":
        drivers = collections.Counter(o.get("driver_id") for o in objects if o.get("driver_id"))
        for driver, count in sorted(drivers.items()):
            if count > 1:
                out.append(Finding("M-G05", "warning",
                                   f"{count} objects share driver_id {driver!r}"))


def check_suction_groups(objects, required_roles, out):
    """A suction group that exists must carry its readouts.

    Presence is decided by the group's own control-status strip, not by a
    guess: if the panel has no `Control status LT` it is not claiming an LT
    circuit and its absent LT readouts are not a defect.
    """
    aliases = {o.get("alias_text") or "" for o in objects}
    for side in ("MT", "LT"):
        if f"Control status {side}" not in aliases:
            continue
        for role in required_roles:
            if role == "Control status":
                continue
            if not any(a.startswith(role) and a.endswith(side) for a in aliases):
                out.append(Finding("M-G06", "warning",
                                   f"the {side} suction group has a control-status strip but no "
                                   f"{role!r} readout; the measured reference carries one"))


# --------------------------------------------------------------------------
# Template geometry - only with --profile
# --------------------------------------------------------------------------

def check_profile_vocabulary(objects, profile, out):
    expected = collections.Counter(o["obj_id"] for o in profile.get("objects", []))
    actual = collections.Counter(o.get("obj_id") for o in objects)
    for obj_id in sorted(set(expected) | set(actual)):
        if expected[obj_id] != actual[obj_id]:
            out.append(Finding("M-P01", "error",
                               f"{profile['scope']} carries {expected[obj_id]} x {obj_id}, this "
                               f"panel carries {actual[obj_id]}"))


def check_profile_geometry(objects, profile, out):
    """Compare by role key, never by array index."""
    def key(entry):
        return (entry["obj_id"], entry["alias_text"], entry["tag_text"])

    expected = collections.defaultdict(list)
    for entry in profile.get("objects", []):
        expected[key(entry)].append(
            (entry["left"], entry["top"], entry["width"], entry["height"], entry["zIndex"]))
    actual = collections.defaultdict(list)
    for obj in objects:
        actual[role_key(obj)].append(
            (px(obj, "posLeft"), px(obj, "posTop"), px(obj, "posWidth"),
             px(obj, "posHeight"), str(obj.get("zIndex"))))

    for role in sorted(expected, key=lambda r: (r[1] or "", r[0] or "")):
        want = sorted(expected[role])
        have = sorted(actual.get(role, []))
        if not have:
            out.append(Finding("M-P02", "error",
                               f"{profile['scope']} role {role[1]!r} ({role[0]}) is missing"))
        elif want != have:
            out.append(Finding("M-P02", "error",
                               f"{profile['scope']} role {role[1]!r} ({role[0]}) should be at "
                               f"{want}, found {have}"))
    for role in sorted(actual, key=lambda r: (r[1] or "", r[0] or "")):
        if role not in expected:
            out.append(Finding("M-P02", "warning",
                               f"role {role[1]!r} ({role[0]}) is not part of "
                               f"{profile['scope']}"))


def check_profile_compressors(objects, profile, out):
    measured = profile.get("compressor_columns") or {}
    banks = compressors(objects)
    for side, rows in sorted(measured.items()):
        for row, spec in sorted(rows.items()):
            for cell in spec.get("cells", []):
                obj = banks.get((cell["compressor"], side), {}).get(
                    {"status": "status", "capacity": "capacity",
                     "runtime": "Runtime total", "vsd": "VSD 1 speed"}[row])
                if obj is None:
                    out.append(Finding("M-P03", "error",
                                       f"{profile['scope']}: C{cell['compressor']} {side} {row} "
                                       "is missing"))
                    continue
                have = (px(obj, "posLeft"), px(obj, "posTop"))
                want = (cell["left"], cell["top"])
                if have != want:
                    out.append(Finding("M-P03", "error",
                                       f"{profile['scope']}: C{cell['compressor']} {side} {row} "
                                       f"is at {have}, measured {want}"))


def check_profile_absences(objects, profile, out):
    absent = (profile.get("absent_by_design") or {}).get("roles", [])
    aliases = {o.get("alias_text") for o in objects}
    for role in absent:
        if role in aliases:
            out.append(Finding("M-P04", "error",
                               f"{profile['scope']} does not carry {role!r}: "
                               + (profile.get("absent_by_design") or {}).get("why", "")))


def check_profile_canvas(envelope, profile, out):
    panel = envelope.get("panel") or {}
    want = profile.get("canvas")
    have = [as_int(panel.get("panel_width")), as_int(panel.get("panel_height"))]
    if want and have != want:
        out.append(Finding("M-P05", "error",
                           f"{profile['scope']} is drawn on {want[0]}x{want[1]}, this panel "
                           f"declares {have[0]}x{have[1]}"))
    background = profile.get("background") or {}
    if background.get("image_data_chars") and not panel.get("image_data"):
        out.append(Finding("M-P05", "warning",
                           f"{profile['scope']} travels with an embedded raster background and "
                           "this panel has none; every coordinate in the profile was measured "
                           "against that artwork"))


def check_profile(envelope, objects, profile, out):
    check_profile_canvas(envelope, profile, out)
    check_profile_vocabulary(objects, profile, out)
    check_profile_geometry(objects, profile, out)
    check_profile_compressors(objects, profile, out)
    check_profile_absences(objects, profile, out)


# --------------------------------------------------------------------------
# Compare - a candidate against the source it was derived from (M-C*)
# --------------------------------------------------------------------------

# What each declared patch is ALLOWED to change. Everything not named here is
# reported, which is the opposite of how the M-S/M-G checks work: those name the
# defect, these name the permission.
PATCH_SCOPES = {
    "compressor-addition": {
        "objects": "compare",
        "fields": (),
        "added": "compressor-columns",
        "background": "must-change",
        "description": ("a compressor added to an existing bank: complete new "
                        "compressor columns, NO field difference on any object that "
                        "already existed, and background artwork that actually changed"),
    },
    "background-only": {
        "objects": "empty",
        "fields": (),
        "added": "none",
        "background": "must-change",
        "description": ("a class-4 patch: zero counts, three empty arrays, and a "
                        "background that differs from the source"),
    },
    "position": {
        "objects": "compare",
        "fields": ("posLeft", "posTop"),
        "added": "none",
        "background": "must-not-change",
        "description": "a pure move: posLeft/posTop on existing objects, nothing else",
    },
    "none": {
        "objects": "compare",
        "fields": (),
        "added": "none",
        "background": "must-not-change",
        "description": ("a no-op: the candidate must be field-identical to the source "
                        "on every matched object, add nothing, and keep the background"),
    },
}

# Written by the export, not by the author, so a difference here is not evidence
# that a patch escaped its scope. Named explicitly so the exemption is auditable.
EXPORT_ONLY_ENVELOPE_FIELDS = ("exported_at", "generator")


def pair_by_role(source_objects, candidate_objects):
    """Match two documents' objects by role key, never by array index.

    Insert renames every object from the live canvas child index, so `object_7`
    in the source and `object_7` in the candidate are unrelated. A role key can
    legitimately repeat (E9 carries `Suction temp. To-MT` twice), so equal keys
    pair in array order and the surplus falls out as dropped or added.
    """
    src_by_key = collections.defaultdict(list)
    for obj in source_objects:
        src_by_key[role_key(obj)].append(obj)
    cand_by_key = collections.defaultdict(list)
    for obj in candidate_objects:
        cand_by_key[role_key(obj)].append(obj)

    pairs, dropped, added = [], [], []
    for key in src_by_key:
        src_list, cand_list = src_by_key[key], cand_by_key.get(key, [])
        for index, src_obj in enumerate(src_list):
            if index < len(cand_list):
                pairs.append((src_obj, cand_list[index]))
            else:
                dropped.append(src_obj)
        added.extend(cand_list[len(src_list):])
    for key, cand_list in cand_by_key.items():
        if key not in src_by_key:
            added.extend(cand_list)
    return pairs, dropped, added


def check_patch_scope(pairs, scope, scope_name, findings):
    """M-C04: prove the patch changed only what it was allowed to change.

    The risk in "add a fourth compressor" is not that the three new objects land
    wrongly - a render shows that. It is that something ELSE moved: a pill
    nudged, a zIndex normalized, an alias tidied, a tag_text trimmed. Each is
    invisible in a diff of 69 objects and together they are a rewrite wearing a
    patch's clothes.
    """
    allowed = scope["fields"]
    escapes = collections.Counter()
    detail = []
    for src, cand in pairs:
        for field in OBJECT_FIELDS:
            before, after = src.get(field), cand.get(field)
            if before == after or field in allowed:
                continue
            escapes[field] += 1
            if len(detail) < 12:
                detail.append(f"{src.get('alias_text') or src.get('name')}.{field}: "
                              f"{before!r} -> {after!r}")
    if not escapes:
        findings.append(Finding("M-C04", "info",
                                f"patch scope {scope_name!r} held on every pre-existing "
                                f"object: differences are confined to "
                                f"{scope['description']}"))
        return
    summary = ", ".join(f"{field} x{count}" for field, count in escapes.most_common())
    findings.append(Finding("M-C04", "error",
                            f"patch scope {scope_name!r} was declared, which permits "
                            f"{scope['description']}, but {sum(escapes.values())} field "
                            f"difference(s) escaped it: {summary}. "
                            + "; ".join(detail)))


def check_added_objects(added, scope, findings):
    """M-C02: what may be added, and what an addition must carry."""
    if not added:
        return
    names = ", ".join(f"{o.get('alias_text') or o.get('name')}" for o in added[:10])
    policy = scope["added"] if scope else None

    if policy == "none":
        findings.append(Finding("M-C02", "error",
                                f"{len(added)} object(s) added: {names}. The declared patch "
                                f"scope adds nothing"))
        return

    if policy == "compressor-columns":
        blank = [o for o in added if not (o.get("alias_text") or "").strip()]
        if blank:
            findings.append(Finding("M-C02", "error",
                                    f"{len(blank)} added object(s) carry an empty alias_text "
                                    f"({', '.join(str(o.get('name')) for o in blank[:6])}). On "
                                    f"Maskin the alias IS the parameter name and the only "
                                    f"relink key: an object added without one can never be "
                                    f"linked, by anyone, ever (M-A08). A new compressor row "
                                    f"takes the grammar alias 'C<n> <MT|LT> <role>' even when "
                                    f"the plant parameter behind it is unknown - the unknown "
                                    f"part is reported as a linking gap, not left blank"))
        foreign = [o for o in added
                   if (o.get("alias_text") or "").strip()
                   and not COMPRESSOR_ALIAS.match(o.get("alias_text") or "")]
        if foreign:
            findings.append(Finding("M-C02", "error",
                                    f"{len(foreign)} added object(s) are not compressor rows: "
                                    f"{', '.join(str(o.get('alias_text')) for o in foreign[:6])}. "
                                    f"Scope 'compressor-addition' adds compressor columns and "
                                    f"nothing else"))
        return

    findings.append(Finding("M-C02", "warning",
                            f"{len(added)} object(s) added: {names}. Legitimate for a class-3 "
                            f"extension; declare --patch-scope to have it checked"))


def check_compare_compressors(source_objects, candidate_objects, required, optional, findings):
    """M-C03: columns are atomic across the pair, and a clone imports no row the
    machine does not have."""
    before, after = compressors(source_objects), compressors(candidate_objects)

    for key in sorted(before):
        missing = [row for row in before[key] if row not in after.get(key, {})]
        if missing:
            findings.append(Finding("M-C03", "error",
                                    f"compressor C{key[0]} {key[1]} lost {', '.join(missing)}. "
                                    f"The source column is the inventory; an edit that thins it "
                                    f"is a defect even when the panel still renders"))

    for key in sorted(set(after) - set(before)):
        rows = after[key]
        missing = [row for row in required if row not in rows]
        if missing:
            findings.append(Finding("M-C03", "error",
                                    f"new compressor C{key[0]} {key[1]} is missing "
                                    f"{', '.join(missing)}; a column is placed whole or not at "
                                    f"all"))
        extra = [row for row in rows if row not in required and row not in optional]
        if extra:
            findings.append(Finding("M-C03", "warning",
                                    f"new compressor C{key[0]} {key[1]} carries unrecognised "
                                    f"rows: {extra}"))
        for row in rows:
            if row in optional and not any(row in before[src] for src in before
                                           if src[1] == key[1]):
                findings.append(Finding("M-C03", "error",
                                        f"new compressor C{key[0]} {key[1]} carries {row!r} and "
                                        f"no existing {key[1]} compressor has one. That row was "
                                        f"imported from a clone source, not measured from the "
                                        f"machine - evidence decides whether a compressor has a "
                                        f"VSD, never the column you happened to copy"))


def check_compare_background(source_panel, candidate_panel, scope, findings):
    """M-C05: the artwork side of the pair."""
    before = source_panel.get("image_data") or source_panel.get("image_svg") or ""
    after = candidate_panel.get("image_data") or candidate_panel.get("image_svg") or ""
    policy = (scope or {}).get("background", "any")
    changed = before != after

    if before and not after:
        findings.append(Finding("M-C05", "error",
                                "the source carried an embedded background and the candidate "
                                "does not. Every coordinate in the source was measured against "
                                "that artwork"))
        return
    if policy == "must-change" and not changed:
        findings.append(Finding("M-C05", "error",
                                f"the background is byte-identical to the source "
                                f"({len(before)} chars), and the declared scope is "
                                f"{scope['description']}. Objects were added over artwork that "
                                f"does not draw them: no compressor symbol, no pipe branch, no "
                                f"pills, no labels (M-A06)"))
    elif policy == "must-not-change" and changed:
        findings.append(Finding("M-C05", "error",
                                f"the background changed ({len(before)} chars -> {len(after)}) "
                                f"and the declared scope is {scope['description']}"))
    elif changed:
        findings.append(Finding("M-C05", "info",
                                f"background changed: {len(before)} chars -> {len(after)}. "
                                f"Only a native-size render decides whether the new artwork "
                                f"connects (M-A03, M-A05) - this compares lengths, not pixels"))

    for field in ("panel_width", "panel_height"):
        if as_int(source_panel.get(field)) != as_int(candidate_panel.get(field)):
            findings.append(Finding("M-C05", "error",
                                    f"panel.{field}: {source_panel.get(field)!r} -> "
                                    f"{candidate_panel.get(field)!r}; every coordinate in the "
                                    f"source means something different now"))


def compare(source_doc, candidate_doc, rules, findings, patch_scope=None):
    """Diff a candidate against the source it was derived from.

    Class 3 says "preserve everything you were not asked to change". Nothing in
    the single-document checks can see that - they judge the candidate alone. So
    every claim of the form "I changed only X" is unproven until this runs.
    """
    scope = None
    if patch_scope is not None:
        scope = PATCH_SCOPES.get(patch_scope)
        if scope is None:
            findings.append(Finding("M-C04", "error",
                                    f"unknown --patch-scope {patch_scope!r}; defined: "
                                    f"{', '.join(sorted(PATCH_SCOPES))}"))
            return findings

    source_envelope = envelope_of(source_doc)
    candidate_envelope = envelope_of(candidate_doc)
    source_panel = source_envelope.get("panel") or {}
    candidate_panel = candidate_envelope.get("panel") or {}
    source_objects = objects_of(source_envelope)
    candidate_objects = objects_of(candidate_envelope)

    maskin = (rules.get("panel_types") or {}).get("maskin") or {}
    required = (maskin.get("required_roles") or {}).get("per_compressor", [])
    optional = (maskin.get("required_roles") or {}).get("per_compressor_optional", [])

    check_compare_background(source_panel, candidate_panel, scope, findings)

    if scope and scope["objects"] == "empty":
        counts = candidate_envelope.get("counts") or {}
        offenders = [name for name in ("single_objects", "containers", "graphics")
                     if counts.get(name) or (candidate_panel.get(name) or [])]
        if offenders:
            findings.append(Finding("M-C01", "error",
                                    f"scope 'background-only' means zero counts and three empty "
                                    f"arrays; this document carries {', '.join(offenders)}. "
                                    f"Insert appends, so a populated document dropped on the "
                                    f"canvas that already holds these objects duplicates every "
                                    f"one of them"))
        else:
            findings.append(Finding("M-C01", "info",
                                    f"background-only patch: {len(source_objects)} source "
                                    f"objects deliberately not carried, canvas untouched"))
        return findings

    pairs, dropped, added = pair_by_role(source_objects, candidate_objects)

    if dropped:
        names = ", ".join(str(o.get("alias_text") or o.get("name")) for o in dropped[:10])
        findings.append(Finding("M-C01", "error",
                                f"{len(dropped)} object(s) present in the source are missing "
                                f"from the candidate: {names}"
                                f"{' ...' if len(dropped) > 10 else ''}. Matched by role key "
                                f"(obj_id + alias_text + tag_text), so this is not an ordering "
                                f"artifact"))

    check_added_objects(added, scope, findings)
    check_compare_compressors(source_objects, candidate_objects, required, optional, findings)

    if scope:
        check_patch_scope(pairs, scope, patch_scope, findings)
    else:
        moved = [(s, c) for s, c in pairs
                 if any(s.get(f) != c.get(f) for f in OBJECT_FIELDS)]
        if moved:
            detail = "; ".join(
                f"{s.get('alias_text') or s.get('name')}: "
                + ", ".join(f for f in OBJECT_FIELDS if s.get(f) != c.get(f))
                for s, c in moved[:8])
            findings.append(Finding("M-C04", "warning",
                                    f"{len(moved)} pre-existing object(s) differ from the "
                                    f"source: {detail}. Declare --patch-scope to turn this into "
                                    f"a pass/fail check"))

    findings.append(Finding("M-C00", "info",
                            f"source {len(source_objects)} objects, candidate "
                            f"{len(candidate_objects)}; {len(pairs)} matched by role, "
                            f"{len(dropped)} dropped, {len(added)} added"))
    return findings


def validate_pair(source_doc, candidate_doc, profile_name=None, rules=None, palette=None,
                  mode=None, patch_scope=None):
    rules = rules if rules is not None else load_rules()
    palette = palette if palette is not None else load_palette()
    findings = validate(candidate_doc, profile_name, rules=rules, palette=palette, mode=mode)
    compare(source_doc, candidate_doc, rules, findings, patch_scope=patch_scope)
    return findings


# --------------------------------------------------------------------------

def validate(document, profile_name=None, rules=None, palette=None, mode=None):
    rules = rules if rules is not None else load_rules()
    palette = palette if palette is not None else load_palette()
    findings = []

    envelope = envelope_of(document)
    objects = objects_of(envelope)

    maskin = (rules.get("panel_types") or {}).get("maskin") or {}
    canvas_rule = maskin.get("canvas") or {}
    canvas = (canvas_rule.get("width", 1400), canvas_rule.get("height", 750))
    bands = (maskin.get("z_indexes") or {}).get("bands") or {}
    required_rows = (maskin.get("required_roles") or {}).get("per_compressor", [])
    optional_rows = (maskin.get("required_roles") or {}).get("per_compressor_optional", [])
    group_roles = (maskin.get("required_roles") or {}).get("per_suction_group", [])

    mode = detect_mode(objects) if mode is None else mode

    check_envelope(envelope, findings)
    check_counts(envelope, findings)
    check_background(envelope, objects, mode, findings)
    if not objects:
        # A background-only patch is a legitimate deliverable, not an empty
        # panel. check_background has already judged it.
        check_residue(envelope, objects, findings)
        findings.append(Finding("M-S01", "info",
                                "no objects: judged as a background-only patch"))
        return findings

    check_fields_and_names(objects, findings)
    check_geometry(objects, canvas, findings)
    check_z_bands(objects, bands, findings)

    if mode == "demo":
        check_unlinked_demo(envelope, objects, findings)
        check_residue(envelope, objects, findings)
    else:
        check_production_export(objects, findings)

    check_encoding(objects, findings)
    check_palette(objects, palette, findings)
    check_band_ownership(objects, bands, findings)
    check_setpoint_pill(objects, maskin.get("setpoint_pill"), findings)
    check_pill_size(objects, findings)
    check_compressor_columns(objects, required_rows, optional_rows, findings)
    check_duplicates(objects, mode, findings)
    check_suction_groups(objects, group_roles, findings)

    if profile_name:
        profile = (rules.get("profiles") or {}).get(profile_name)
        if profile is None:
            findings.append(Finding("M-P00", "error",
                                    f"unknown profile {profile_name!r}; documentation-rules.json "
                                    f"defines {sorted((rules.get('profiles') or {}).keys())}"))
        elif profile.get("panel_type") != "maskin":
            findings.append(Finding("M-P00", "error",
                                    f"profile {profile_name!r} is not a Maskin profile"))
        else:
            check_profile(envelope, objects, profile, findings)

    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("panel", nargs="?", type=pathlib.Path,
                        help="panel to check")
    parser.add_argument("--compare", nargs=2, type=pathlib.Path,
                        metavar=("SOURCE.json", "CANDIDATE.json"),
                        help="validate the candidate AND diff it against the source. Use this "
                             "whenever an export was supplied - it is the only mechanical proof "
                             "that everything you were not asked to change survived (M-C*)")
    parser.add_argument("--patch-scope", default=None, choices=sorted(PATCH_SCOPES),
                        help="in --compare, assert that the candidate differs from the source "
                             "ONLY within this scope (M-C04)")
    parser.add_argument("--profile", default=None,
                        help="apply a named template profile from documentation-rules.json "
                             "(TEMPLATE-10229)")
    parser.add_argument("--mode", choices=("demo", "production"), default=None,
                        help="binding contract to check. Default: detect from the driver_id "
                             "placeholder - a generated demo emits the literal \"driver_id\", a "
                             "production export leaves an unlinked object's driver_id empty.")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)

    if bool(args.compare) == bool(args.panel):
        parser.error("give exactly one of PANEL.json / --compare SOURCE.json CANDIDATE.json")
    if args.patch_scope and not args.compare:
        parser.error("--patch-scope compares a candidate against a source; it needs "
                     "--compare SOURCE.json CANDIDATE.json")

    if args.compare:
        source_path, subject = args.compare
        source_doc = json.loads(source_path.read_text(encoding="utf-8"))
        document = json.loads(subject.read_text(encoding="utf-8"))
        findings = validate_pair(source_doc, document, args.profile, mode=args.mode,
                                 patch_scope=args.patch_scope)
    else:
        subject = args.panel
        document = json.loads(subject.read_text(encoding="utf-8"))
        findings = validate(document, args.profile, mode=args.mode)

    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]
    if args.as_json:
        print(json.dumps([f.as_dict() for f in findings], ensure_ascii=False, indent=2))
    else:
        for finding in findings:
            print(finding)
        print(f"\n{len(errors)} error(s), {len(warnings)} warning(s) in {subject}")
        print("Structural only. Visual QA at native size is a separate, required step - "
              "see MASKIN-QA-CHECKLIST.md stage C.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
