#!/usr/bin/env python3
"""Deterministic validator for IWMAC Designer Ventilasjon panel JSON.

Usage:
    python validate-ventilation-panel.py PANEL.json [--profile PROFILE-9099-ROTOR-DEMO]
    python validate-ventilation-panel.py PANEL.json --json

The rules are data, not code: everything profile-specific is read from
``documentation-rules.json`` so the contract and the validator cannot drift
apart. Structural rules that hold for every Ventilasjon panel are implemented
here directly and carry a ``V-S``/``V-G`` id; profile-scoped geometry carries a
``V-P`` id and only runs when a profile is selected.

Exit status is 0 when no finding has severity ``error``, 1 otherwise. This file
performs no network access and reads nothing outside the reference directory.
"""

import argparse
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

# A value box carries its own tag; a label is free-standing text. The split
# decides which objects may be a connector source and which count as captions.
VALUE_PREFIXES = ("number_v3_R_", "number_v3_60px", "number_v3_custom", "numberV3_outside")
LABEL_PREFIXES = ("number_v3_label",)

CONNECTOR_DIRECTIONS = {
    # suffix -> (dx, dy): the direction the connector points, i.e. where the
    # target must be relative to the value box.
    "con_down": (0, 1),
    "con_top": (0, -1),
    "con_left": (-1, 0),
    "con_right": (1, 0),
}

# Calibrated against tests/fixtures/ventilation-9099-rotor-demo.json, whose 18
# connector objects all land in [-14, +4]: the stub is drawn inside the box, so
# a correctly attached value overlaps its target slightly. The window keeps 6 px
# of margin on each side. A floating bubble sits tens of pixels clear and fails.
CONNECTOR_GAP_MIN = -20
CONNECTOR_GAP_MAX = 10

# VENTILATION-QA-CHECKLIST.md C10: two sidebar rows whose rendered text is less
# than this far apart read as one block.
SIDEBAR_ROW_MIN_SEPARATION = 4

# Rendered glyph height of the 11 px and 8 px label objects. Six production
# labels carry posHeight 1 while rendering ~11 px of text, so overlap must be
# judged on the rendered extent, never on posHeight.
RENDERED_LABEL_HEIGHT = 11

# Arial advance widths in 1/1000 em - the standard published metrics, so the
# estimate is reproducible rather than tuned to a sample. Unknown characters take
# 556, the width of a digit and of most lowercase letters.
ARIAL_ADVANCE = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
    "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778, "H": 722,
    "I": 278, "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 778, "P": 667,
    "Q": 778, "R": 722, "S": 667, "T": 611, "U": 722, "V": 667, "W": 944, "X": 667,
    "Y": 667, "Z": 611,
    "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556,
    "i": 222, "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556,
    "q": 556, "r": 333, "s": 500, "t": 278, "u": 556, "v": 500, "w": 722, "x": 500,
    "y": 500, "z": 500,
    "æ": 889, "ø": 611, "å": 556, "Æ": 1000, "Ø": 778, "Å": 667,
    "°": 400, "²": 333, "³": 333,
}
DEFAULT_ADVANCE = 556
LABEL_FONT_PX = 11

# Two rendered widths were read off a screenshot: "Tilluft" 32 px, "Avtrekk"
# 40 px. They do NOT agree with the advance-width model (26 and 37), and they
# contradict production: A-Alarm and B-Alarm sit on a 45 px pitch on two
# independent plants, which caps "A-Alarm" near 41 px, while scaling the model
# to fit "Tilluft" would make it 48. So the two readings carry padding or
# reading error and are not sound enough to raise an error. They are kept for
# the centring rule, which has no other evidence, and every finding that rests
# on a width is a warning. Resolve by measuring at native scale - see
# open_evidence in PROFILE-9099-ROTOR-DEMO.
MEASURED_TEXT_WIDTH = {"Tilluft": 32, "Avtrekk": 40}

# Calibrated from the canonical fixture: the seven alarms sit between 0 and 27 px
# from the component they guard. 45 px leaves margin without letting a detached
# alarm pass.
ALARM_MAX_DISTANCE = 45

# A label's rendered extent is estimated, not measured - the width from Arial
# advance widths, the height because six production labels carry posHeight 1 or
# 2. An overlap smaller than this is inside the error bars of that estimate.
# Production reference E2 is why the value is not 1: its cooling alarm and its
# 'Cool' caption overlap by exactly 1 px under the estimated height, and that
# panel is evidence, not a candidate.
LABEL_OVERLAP_TOLERANCE = 3


def estimate_text_width(text, use_measured=False):
    """Rendered width of a label string in px, and whether it was measured.

    Returns (width, measured). measured is True only for the two screenshot
    readings, and only when the caller asks for them. No caller may raise an
    error on the strength of an estimated width alone.
    """
    text = (text or "").strip()
    if use_measured and text in MEASURED_TEXT_WIDTH:
        return MEASURED_TEXT_WIDTH[text], True
    em = sum(ARIAL_ADVANCE.get(ch, DEFAULT_ADVANCE) for ch in text)
    return int(round(em * LABEL_FONT_PX / 1000.0)), False


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


def px(obj, field):
    """Read one geometry field the way the host does - parseInt, so "120px" is
    120 and "196.5" is 196.

    Never raises. A malformed coordinate is reported once by V-S05; every other
    check then has to keep running, because a validator that dies on the input
    it is meant to judge reports nothing at all.
    """
    return as_int(obj.get(field)) or 0


def box(obj):
    left, top = px(obj, "posLeft"), px(obj, "posTop")
    return left, top, left + px(obj, "posWidth"), top + px(obj, "posHeight")


def rendered_box(obj):
    """Labels render text from posLeft; posWidth neither centres nor bounds it,
    and posHeight is unreliable. Bound both axes by the rendered glyph extent.

    Height grows to RENDERED_LABEL_HEIGHT because six production labels carry
    posHeight 1. Width *shrinks* to the text extent because the sidebar labels
    carry posWidth 50 on strings that render 32-40 px wide - taking posWidth as
    the extent is what made two labels sharing a row look like an overlap.
    """
    left, top, right, bottom = box(obj)
    if obj["obj_id"].startswith(LABEL_PREFIXES):
        text_width, _ = estimate_text_width(obj.get("tag_text") or obj.get("alias_text"))
        return (left, top,
                left + min(px(obj, "posWidth"), text_width) if text_width else right,
                top + max(px(obj, "posHeight"), RENDERED_LABEL_HEIGHT))
    return left, top, right, bottom


def is_value(obj):
    return obj["obj_id"].startswith(VALUE_PREFIXES)


def is_label(obj):
    return obj["obj_id"].startswith(LABEL_PREFIXES)


def is_alarm(obj):
    return obj["obj_id"].startswith("V3_R_34px_circular_alarm")


def connector_direction(obj):
    for suffix, vector in CONNECTOR_DIRECTIONS.items():
        if obj["obj_id"].endswith(suffix):
            return suffix, vector
    return None, None


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
    """Whether a coordinate is genuinely an integer.

    Deliberately stricter than as_int. parseInt reads "196.5" as 196, so the
    panel renders and nothing complains - but the contract requires integer
    coordinates, and a fractional value is a generator bug that would otherwise
    survive unnoticed.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return value == int(value)
    if isinstance(value, str):
        return bool(re.match(r"^\s*[-+]?\d+\s*$", value))
    return False


# --------------------------------------------------------------------------
# Structural rules — every Ventilasjon panel, no profile needed
# --------------------------------------------------------------------------

def check_envelope(envelope, out):
    if envelope.get("format") != "iwmac-designer-panel":
        out.append(Finding("V-S01", "error",
                           f'format must be exactly "iwmac-designer-panel", got {envelope.get("format")!r}'))
    if envelope.get("version") != 1:
        out.append(Finding("V-S01", "error", f'version must be 1, got {envelope.get("version")!r}'))
    panel = envelope.get("panel")
    if not isinstance(panel, dict):
        out.append(Finding("V-S01", "error", '"panel" must be an object'))
        return
    for key in ("containers", "graphics"):
        value = panel.get(key, [])
        if value:
            out.append(Finding("V-S07", "error",
                               f"panel.{key} must be empty on a Ventilasjon panel, got {len(value)} entries"))
    if "image_svg" in panel:
        out.append(Finding("V-S07", "error",
                           "panel.image_svg must not be present on a Ventilasjon panel"))


def check_counts(envelope, out):
    panel = envelope.get("panel") or {}
    declared = envelope.get("counts")
    if not isinstance(declared, dict):
        out.append(Finding("V-S02", "error", '"counts" must be an object'))
        return
    for key in ("single_objects", "containers", "graphics"):
        actual = len(panel.get(key) or [])
        if declared.get(key) != actual:
            out.append(Finding("V-S02", "error",
                               f"counts.{key} is {declared.get(key)!r} but the array holds {actual}"))


def check_fields_and_names(objects, out):
    for index, obj in enumerate(objects):
        missing = [f for f in OBJECT_FIELDS if f not in obj]
        if missing:
            out.append(Finding("V-S03", "error",
                               f"object at index {index} is missing {', '.join(missing)}"))
    names = [obj.get("name") for obj in objects]
    expected = [f"object_{i}" for i in range(len(objects))]
    if names != expected:
        first = next((i for i, (a, b) in enumerate(zip(names, expected)) if a != b), len(expected))
        out.append(Finding("V-S04", "error",
                           f"object names must be sequential object_0..object_{len(objects) - 1}; "
                           f"first divergence at index {first}: {names[first] if first < len(names) else 'missing'!r}"))
    duplicates = {n for n in names if names.count(n) > 1}
    if duplicates:
        out.append(Finding("V-S04", "error", f"duplicate object names: {sorted(duplicates)}"))


def check_geometry(envelope, objects, canvas, out):
    width, height = canvas
    for obj in objects:
        malformed = False
        for field in ("posLeft", "posTop", "posWidth", "posHeight"):
            if not is_integer_px(obj.get(field)):
                malformed = True
                out.append(Finding("V-S05", "error",
                                   f"{obj.get('name')}: {field}={obj.get(field)!r} is not an integer pixel value"))
        if malformed:
            continue
        left, top, right, bottom = box(obj)
        if left < 0 or top < 0 or right > width or bottom > height:
            out.append(Finding("V-S05", "warning",
                               f"{obj.get('name')} ({obj.get('obj_id')}) extends outside the "
                               f"{width}x{height} canvas: ({left},{top})-({right},{bottom})"))


def check_z_bands(objects, bands, out):
    values = {str(obj.get("zIndex")) for obj in objects}
    if "default" in values and len(values) > 1:
        out.append(Finding("V-S06", "error",
                           "zIndex mixes the literal \"default\" with explicit bands: "
                           f"{sorted(values)}. Use one mode for the whole panel."))
    if bands:
        unknown = sorted(v for v in values if v != "default" and v not in bands)
        if unknown:
            out.append(Finding("V-S06", "warning",
                               f"zIndex values outside the documented Ventilasjon bands {sorted(bands)}: {unknown}"))


def detect_mode(objects):
    """Whether this panel is a generated demo or a production export.

    The placeholder is the tell. A generated unlinked demo emits the literal
    string "driver_id" on every object; a production export never does - an
    unlinked object in a real export carries an EMPTY driver_id. That asymmetry
    is documented in the host reference and it discriminates cleanly, including
    when a single object of a demo has had a real binding leak back into it.
    """
    return "demo" if any(o.get("driver_id") == "driver_id" for o in objects) else "production"


def check_unlinked_demo(envelope, objects, out):
    panel = envelope.get("panel") or {}
    for key, holder in (("source_plant_id", envelope), ("plant_id", panel)):
        if holder.get(key):
            out.append(Finding("V-S08", "error",
                               f"{key} must be empty on an unlinked demo, got {holder.get(key)!r}"))
    for obj in objects:
        name = obj.get("name")
        if obj.get("linked") != "false":
            out.append(Finding("V-S08", "error",
                               f'{name}: linked must be "false" on an unlinked demo, got {obj.get("linked")!r}'))
        for field in ("id", "driver_id"):
            if obj.get(field) != "driver_id":
                out.append(Finding("V-S08", "error",
                                   f'{name}: {field} must be the literal "driver_id", got {obj.get(field)!r}'))
        for field in ("link_name", "link_tag", "unit_id", "unit_ref", "sub_group"):
            if obj.get(field):
                out.append(Finding("V-S08", "error",
                                   f"{name}: {field} must be empty on an unlinked demo, got {obj.get(field)!r}"))


def check_production_export(objects, out):
    """A production export obeys the mirror image of the demo contract, so the
    demo rules must not be pointed at one.

    Only two invariants survive contact with the evidence, and both hold on all
    194 objects of the two committed references: `id` and `link_name` are host
    literals emitted on every object regardless of linking.

    Three checks that look obvious were tried and removed, because production
    contradicts every one of them:

    * "linked true implies a driver id" - false. The host sets linked="true"
      whenever driver_id is not the literal placeholder (V3scripts.js:514), and
      an EMPTY driver_id is not the placeholder. So 45 of E2's objects and 37 of
      E3's are linked with no binding at all. That is host behaviour, not a
      defect.
    * "driver_id is plant-prefixed" - false. Navigation objects store the target
      panel's numeric id there ("1", "3", "6") and a pdf object stores a path.
    * "unit_ref is empty" - true in both references, but the field is documented
      as an optional stable ref, so two samples do not make a rule.
    """
    for obj in objects:
        name = obj.get("name")
        for field, literal in (("id", "driver_id"), ("link_name", "link_name")):
            if obj.get(field) != literal:
                out.append(Finding("V-S08", "error",
                                   f'{name}: {field} is the host literal "{literal}" on every exported '
                                   f"object, got {obj.get(field)!r}"))
        if obj.get("linked") not in ("true", "false"):
            out.append(Finding("V-S08", "error",
                               f'{name}: linked must be "true" or "false", got {obj.get("linked")!r}'))


def check_encoding(objects, out):
    for obj in objects:
        for field in ("tag_text", "alias_text"):
            text = obj.get(field) or ""
            if re.search(r"\bgr\s?C\b", text):
                out.append(Finding("V-S09", "error",
                                   f'{obj.get("name")}: {field} uses the degraded ASCII form {text!r}; '
                                   'emit UTF-8 "°C"'))


def check_palette(objects, palette, out):
    if not palette:
        return
    for obj in objects:
        if obj.get("obj_id") not in palette:
            out.append(Finding("V-G02", "error",
                               f'{obj.get("name")}: obj_id {obj.get("obj_id")!r} is not in the object '
                               "palette; an unknown id renders as a broken undefined-class box"))


# --------------------------------------------------------------------------
# Ventilation relationship rules
# --------------------------------------------------------------------------

def connector_targets(objects):
    """Ducts, equipment bodies, dampers, valves and pumps — the things a value
    may point at. Other values, labels and alarms are not targets."""
    return [o for o in objects
            if not is_value(o) and not is_label(o) and not is_alarm(o)
            and "dummy" not in o["obj_id"] and not o["obj_id"].startswith("V3_led")]


def check_connector_attachment(objects, out):
    targets = connector_targets(objects)
    for obj in objects:
        suffix, vector = connector_direction(obj)
        if not suffix:
            continue
        x0, y0, x1, y1 = box(obj)
        dx, dy = vector
        best = None
        for target in targets:
            tx0, ty0, tx1, ty1 = box(target)
            if dx == 0:
                if tx1 < x0 or tx0 > x1:
                    continue
                gap = ty0 - y1 if dy > 0 else y0 - ty1
            else:
                if ty1 < y0 or ty0 > y1:
                    continue
                gap = tx0 - x1 if dx > 0 else x0 - tx1
            if CONNECTOR_GAP_MIN <= gap <= CONNECTOR_GAP_MAX:
                if best is None or abs(gap) < abs(best[0]):
                    best = (gap, target)
        if best is None:
            out.append(Finding("V-G03", "error",
                               f'{obj.get("name")} ({obj.get("tag_text", "").strip() or obj["obj_id"]}) '
                               f"is a {suffix} value whose connector meets nothing: no duct, component, "
                               f"valve or damper lies within [{CONNECTOR_GAP_MIN},{CONNECTOR_GAP_MAX}] px "
                               "of the connector edge. A floating bubble is a defect."))


def check_duplicate_captions(objects, mode, out):
    """A value box already renders its own tag. A free-standing label repeating
    that code is the duplicate-caption defect.

    This judges a candidate panel, so it is an error on a generated demo. On a
    production export it drops to a warning: the export is the evidence, and
    both committed references really do carry separate 8px KA captions. Calling
    production reality an error would teach an agent to "fix" the thing it is
    supposed to be copying.
    """
    severity = "error" if mode == "demo" else "warning"
    value_codes = {}
    for obj in objects:
        if not is_value(obj):
            continue
        code = (obj.get("tag_text") or "").strip().split(" ")[0]
        if code:
            value_codes.setdefault(code, obj)
    for obj in objects:
        if not is_label(obj):
            continue
        text = (obj.get("tag_text") or "").strip()
        code = text.split(" ")[0]
        if code and code in value_codes:
            owner = value_codes[code]
            out.append(Finding("V-G04", severity,
                               f'{obj.get("name")}: free-standing caption {text!r} repeats the tag already '
                               f'rendered by {owner.get("name")} ({owner.get("tag_text")!r}). Remove the caption.'))
    # Two labels carrying the same text is a defect on any panel, production or
    # generated - nothing legitimately renders the same caption twice.
    seen = {}
    for obj in objects:
        if not is_label(obj):
            continue
        text = (obj.get("tag_text") or "").strip()
        if not text:
            continue
        if text in seen:
            out.append(Finding("V-G04", "error",
                               f'duplicate caption {text!r} at {obj.get("name")} and {seen[text]}'))
        else:
            seen[text] = obj.get("name")


def check_alarms(objects, mode, out):
    """One alarm per guarded role, beside the role it guards, clear of captions.

    The caption-overlap branch is the one that has to be judged carefully. It
    compares an exact alarm rectangle against an ESTIMATED label rectangle, so a
    marginal hit is an artifact of the estimate rather than a defect: it is only
    reported past LABEL_OVERLAP_TOLERANCE, and only as an error on a generated
    demo. On a production export it drops to a warning for the same reason
    check_duplicate_captions does - the export is the evidence, and telling an
    agent to "fix" its reference teaches exactly the wrong lesson.
    """
    severity = "error" if mode == "demo" else "warning"
    alarms = [o for o in objects if is_alarm(o)]
    guarded = connector_targets(objects)
    positions = {}
    nearest = {}
    for alarm in alarms:
        key = (alarm["posLeft"], alarm["posTop"])
        if key in positions:
            out.append(Finding("V-G05", "error",
                               f'two alarms occupy {key}: {positions[key]} and {alarm.get("name")}'))
        positions[key] = alarm.get("name")

        ax0, ay0, ax1, ay1 = box(alarm)
        near = None
        for target in guarded:
            tx0, ty0, tx1, ty1 = box(target)
            dx = max(tx0 - ax1, ax0 - tx1, 0)
            dy = max(ty0 - ay1, ay0 - ty1, 0)
            distance = max(dx, dy)
            if near is None or distance < near[0]:
                near = (distance, target)
        nearest[alarm.get("name")] = near[1].get("name") if near else None
        if near is None or near[0] > ALARM_MAX_DISTANCE:
            out.append(Finding("V-G05", "error",
                               f'{alarm.get("name")} ({(alarm.get("alias_text") or "")[:40]!r}) is '
                               f"{near[0] if near else 'infinitely'} px from the nearest component; an alarm "
                               f"must sit above or immediately beside the role it guards "
                               f"(<= {ALARM_MAX_DISTANCE} px)."))
        for label in objects:
            if not is_label(label):
                continue
            lx0, ly0, lx1, ly1 = rendered_box(label)
            overlap_x = min(ax1, lx1) - max(ax0, lx0)
            overlap_y = min(ay1, ly1) - max(ay0, ly0)
            if min(overlap_x, overlap_y) >= LABEL_OVERLAP_TOLERANCE:
                out.append(Finding("V-G05", severity,
                                   f'{alarm.get("name")} overlaps the caption {label.get("tag_text")!r} '
                                   f'({label.get("name")}) by {overlap_x}x{overlap_y} px'))

    # One alarm per guarded role - keyed on (alias, the component it stands
    # beside), not on the alias alone. The alias is the PARAMETER name, and a
    # unit with two identical components legitimately repeats it: production
    # reference E3 guards its extract and fresh-air dampers with two
    # 'Malf. damper' alarms 243 px apart. Two different dampers are two
    # different roles; only two alarms on the SAME component are the duplicate.
    aliases = {}
    for alarm in alarms:
        alias = (alarm.get("alias_text") or "").strip()
        if not alias:
            continue
        key = (alias, nearest.get(alarm.get("name")))
        if key in aliases:
            out.append(Finding("V-G05", "error",
                               f"two alarms guard the same role {alias!r} on {key[1]}: "
                               f"{aliases[key]} and {alarm.get('name')}"))
        aliases[key] = alarm.get("name")


def check_damper_values(objects, profile, out):
    """Damper position values.

    Two rules with different scopes, deliberately kept apart:

    GLOBAL - exactly one position value per KA code. A stale duplicate left
    behind by an edit is a defect on any plant.

    PROFILE - which object is an inlet damper, and which side its value sits on.
    Both production references disagree here: E2 uses recirculation dummies with
    con_top values above the duct, E3 and the 9099 profile use horizontal flow
    dampers with con_down values above the damper. All three are production-real,
    so the attachment check runs only when a profile names the damper objects.
    Hardcoding one plant's answer as the default is what the scope tags exist to
    prevent.
    """
    damper_ids = set((profile or {}).get("inlet_dampers", {}).get("accepted_obj_ids", []))
    dampers = [o for o in objects if o["obj_id"] in damper_ids] if damper_ids else []
    codes = {}
    for obj in objects:
        if not is_value(obj):
            continue
        code = (obj.get("tag_text") or "").strip().split(" ")[0]
        if re.fullmatch(r"KA\d{3}", code or ""):
            codes.setdefault(code, []).append(obj)
    for code, hits in codes.items():
        if len(hits) > 1:
            names = ", ".join(h.get("name") for h in hits)
            out.append(Finding("V-G07", "error",
                               f"{code} has {len(hits)} position values ({names}); exactly one is allowed. "
                               "A stale duplicate is a defect."))
    for damper in dampers:
        dx0, dy0, dx1, dy1 = box(damper)
        owners = []
        for obj in objects:
            # Only a value box can be a damper's position readout. Without this
            # filter the separate 8px KA captions some plants carry get counted
            # as malformed values.
            if not is_value(obj):
                continue
            suffix, _ = connector_direction(obj)
            code = (obj.get("tag_text") or "").strip().split(" ")[0]
            if not re.fullmatch(r"KA\d{3}", code or ""):
                continue
            vx0, vy0, vx1, vy1 = box(obj)
            if vx1 > dx0 - 40 and vx0 < dx1 + 40 and vy1 <= dy1:
                owners.append((obj, suffix))
        if not owners:
            out.append(Finding("V-G07", "error",
                               f'the damper {damper.get("name")} ({damper["obj_id"]}) at '
                               f"({dx0},{dy0}) has no position value above it"))
        for obj, suffix in owners:
            if suffix != "con_down":
                out.append(Finding("V-G07", "error",
                                   f'{obj.get("name")} ({obj.get("tag_text")!r}) must be a con_down object '
                                   f"above its damper, got {obj['obj_id']!r}"))


def check_sidebar(objects, sidebar_x, profile, mode, out):
    rows = [o for o in objects if px(o, "posLeft") >= sidebar_x]
    known_good = set()
    for entry in ((profile or {}).get("sidebar") or {}).get("known_good_rows", []):
        known_good.add((entry["y"], tuple(entry["captions"])))
    headers = {}
    for obj in rows:
        if not obj["obj_id"].startswith("number_v3_header"):
            continue
        text = (obj.get("tag_text") or "").strip()
        if text in headers:
            out.append(Finding("V-G06", "error",
                               f"sidebar section {text!r} is built twice: {headers[text]} and {obj.get('name')}"))
        headers[text] = obj.get("name")

    # An exact stacked duplicate is invisible on screen and doubles the object
    # count - a paste that landed in place. It is a defect to emit, so an error
    # on a demo; on a production export it is a warning, because production
    # really does ship this debris (E3 stacks its three navigation buttons) and
    # the same pattern is already recorded for the spjeldliste's repeated group
    # stripes. Report it so it is not copied; do not call the reference wrong.
    duplicate_severity = "error" if mode == "demo" else "warning"
    positions = {}
    for obj in rows:
        key = (obj["posLeft"], obj["posTop"], obj["obj_id"])
        if key in positions:
            out.append(Finding("V-G06", duplicate_severity,
                               f"two sidebar objects share {key[:2]} with the same obj_id: "
                               f"{positions[key]} and {obj.get('name')}"))
        positions[key] = obj.get("name")

    labels = sorted((o for o in rows if is_label(o)),
                    key=lambda o: (px(o, "posTop"), px(o, "posLeft")))

    # Vertical: consecutive rows must not close up. Two labels sharing a posTop
    # are a horizontal pair on one row (A-Alarm / B-Alarm), not two rows, and
    # comparing them vertically reports a nonsense negative separation.
    for first, second in zip(labels, labels[1:]):
        if px(first, "posTop") == px(second, "posTop"):
            continue
        fx0, fy0, fx1, fy1 = rendered_box(first)
        sx0, sy0, sx1, sy1 = rendered_box(second)
        if fx0 < sx1 and sx0 < fx1:
            separation = sy0 - fy1
            if separation < SIDEBAR_ROW_MIN_SEPARATION:
                out.append(Finding("V-G06", "error",
                                   f'sidebar rows {first.get("tag_text")!r} and {second.get("tag_text")!r} '
                                   f"are {separation} px apart on rendered text; the floor is "
                                   f"{SIDEBAR_ROW_MIN_SEPARATION} px"))

    # Horizontal: labels that do share a row must not run into each other. The
    # gap is measured on rendered text, so posWidth 50 on a 32 px string is not
    # an overlap. Estimated widths report as warnings.
    for first, second in zip(labels, labels[1:]):
        if px(first, "posTop") != px(second, "posTop"):
            continue
        captions = ((first.get("tag_text") or "").strip(), (second.get("tag_text") or "").strip())
        if (px(first, "posTop"), captions) in known_good:
            continue
        fx0, _, fx1, _ = rendered_box(first)
        sx0, _, _, _ = rendered_box(second)
        gap = sx0 - fx1
        if gap < SIDEBAR_ROW_MIN_SEPARATION:
            out.append(Finding("V-G06", "warning",
                               f"sidebar labels {captions[0]!r} and {captions[1]!r} share row "
                               f"y={first['posTop']} with a {gap} px gap on text width estimated from "
                               f"Arial metrics; the floor is {SIDEBAR_ROW_MIN_SEPARATION} px. Confirm at "
                               "native scale before moving anything - the estimate is not evidence."))


# --------------------------------------------------------------------------
# Profile-scoped geometry
# --------------------------------------------------------------------------

def resolve(objects, spec):
    """Find the one object a profile entry names.

    obj_id alone is not a key. A correct panel carries
    numberV3_filter_with_diff_press twice and SB520 % twice, so the profile
    discriminates with tag/alias and this resolver honours that. Returns
    (obj, reason) with exactly one of the two set.
    """
    accepted = spec.get("accepted_obj_ids") or ([spec["obj_id"]] if spec.get("obj_id") else [])
    hits = [o for o in objects if o["obj_id"] in accepted] if accepted else list(objects)
    if spec.get("tag"):
        hits = [o for o in hits if (o.get("tag_text") or "").strip() == spec["tag"]]
    if spec.get("tag_prefix"):
        hits = [o for o in hits
                if (o.get("tag_text") or "").strip().split(" ")[0] == spec["tag_prefix"]]
    if spec.get("alias"):
        hits = [o for o in hits if (o.get("alias_text") or "").strip() == spec["alias"]]
    if len(hits) == 1:
        return hits[0], None
    if not hits:
        return None, "missing"
    return None, "ambiguous - %d objects match (%s)" % (
        len(hits), ", ".join(str(h.get("name")) for h in hits))


def describe(spec):
    parts = [spec.get("obj_id") or " or ".join(spec.get("accepted_obj_ids", []))]
    if spec.get("tag"):
        parts.append("tag %r" % spec["tag"])
    if spec.get("alias"):
        parts.append("alias %r" % spec["alias"])
    return " / ".join(p for p in parts if p)


def check_offset(actual_obj, anchor, offset, label, rule, out):
    got = [px(actual_obj, "posLeft") - px(anchor, "posLeft"),
           px(actual_obj, "posTop") - px(anchor, "posTop")]
    if got != list(offset):
        out.append(Finding(rule, "error",
                           f"{label} sits at offset ({got[0]:+d},{got[1]:+d}) from its anchor; the "
                           f"profile records ({offset[0]:+d},{offset[1]:+d}). Relocate a cluster with "
                           "one translation vector applied to every member."))


def check_profile_clusters(objects, profile, out):
    for entry in profile.get("clusters", []):
        role = entry["role"]
        anchor, reason = resolve(objects, entry["anchor"])
        if anchor is None:
            if entry.get("required", True):
                out.append(Finding("V-P01", "error",
                                   f"cluster {role!r}: anchor {describe(entry['anchor'])} is {reason}"))
            continue
        expected = entry["anchor"].get("pos")
        if expected and [px(anchor, "posLeft"), px(anchor, "posTop")] != expected:
            out.append(Finding("V-P01", "error",
                               f'cluster {role!r}: anchor {entry["anchor"]["obj_id"]} is at '
                               f'({anchor["posLeft"]},{anchor["posTop"]}), the profile records '
                               f"({expected[0]},{expected[1]})"))
        for member in entry.get("members", []):
            member_obj, reason = resolve(objects, member)
            if member_obj is None:
                out.append(Finding("V-P02", "error",
                                   f'cluster {role!r} is incomplete: the {member["role"]} '
                                   f"({describe(member)}) is {reason}. A cluster is atomic - place "
                                   "every member or none."))
                continue
            if member.get("offset"):
                check_offset(member_obj, anchor, member["offset"],
                             f'cluster {role!r}: the {member["role"]}', "V-P02", out)


def check_profile_fixed(objects, profile, out):
    for entry in profile.get("fixed_objects", []):
        obj, reason = resolve(objects, entry)
        if obj is None:
            out.append(Finding("V-P04", "error",
                               f'{entry["role"]}: {describe(entry)} is {reason}'))
            continue
        if [px(obj, "posLeft"), px(obj, "posTop")] != entry["pos"]:
            out.append(Finding("V-P04", "error",
                               f'{entry["role"]}: {entry["obj_id"]} is at ({obj["posLeft"]},{obj["posTop"]}), '
                               f'the profile records ({entry["pos"][0]},{entry["pos"][1]}). Move it only on '
                               "evidence from a source that outranks this profile."))


def check_profile_led(objects, profile, out):
    led = profile.get("led_containment")
    if not led:
        return
    led_obj, reason = resolve(objects, led)
    body, _ = resolve(objects, {"obj_id": led["body_obj_id"]})
    if led_obj is None:
        out.append(Finding("V-P05", "error",
                           f'the run-status LED {led["obj_id"]!r} is {reason}'))
        return
    superseded = led.get("superseded_position")
    if superseded and [px(led_obj, "posLeft"), px(led_obj, "posTop")] == superseded:
        out.append(Finding("V-P05", "error",
                           f"the run-status LED is at the superseded position "
                           f"({superseded[0]},{superseded[1]}). {led.get('superseded_note', '')}"))
    if body is None:
        return
    bx0, by0, bx1, by1 = box(body)
    lx0, ly0, lx1, ly1 = box(led_obj)
    if not (bx0 <= lx0 and lx1 <= bx1 and by0 <= ly0 and ly1 <= by1):
        out.append(Finding("V-P05", "error",
                           f"the run-status LED ({lx0},{ly0})-({lx1},{ly1}) is not fully inside the "
                           f"{body['obj_id']} body ({bx0},{by0})-({bx1},{by1})"))
    check_offset(led_obj, body, led["offset"], "the run-status LED", "V-P05", out)


def check_profile_alarms(objects, profile, out):
    for entry in profile.get("alarms", []):
        alarm, reason = resolve(objects, entry)
        if alarm is None:
            out.append(Finding("V-P06", "error",
                               f'expected exactly one alarm for {entry["role"]!r}; it is {reason}'))
            continue
        if [px(alarm, "posLeft"), px(alarm, "posTop")] != entry["pos"]:
            out.append(Finding("V-P06", "error",
                               f'the {entry["role"]} alarm is at ({alarm["posLeft"]},{alarm["posTop"]}), '
                               f'the profile records ({entry["pos"][0]},{entry["pos"][1]})'))


def check_profile_dampers(objects, profile, out):
    dampers = profile.get("inlet_dampers") or {}
    for prohibited in dampers.get("prohibited_obj_ids", []):
        for obj in objects:
            if obj["obj_id"] == prohibited:
                out.append(Finding("V-P03", "error",
                                   f'{obj.get("name")} uses {prohibited!r}, which this profile prohibits '
                                   f"for an inlet damper. {dampers.get('prohibited_reason', '')}"))
    for entry in dampers.get("required", []):
        obj, reason = resolve(objects, entry)
        if obj is None:
            out.append(Finding("V-P03", "error",
                               f'the {entry["role"]} must use the production object {entry["obj_id"]!r}; '
                               f"it is {reason}."))
            continue
        if [px(obj, "posLeft"), px(obj, "posTop")] != entry["pos"]:
            out.append(Finding("V-P03", "error",
                               f'the {entry["role"]} is at ({obj["posLeft"]},{obj["posTop"]}), the profile '
                               f'records ({entry["pos"][0]},{entry["pos"][1]})'))
        value = entry.get("value")
        if not value:
            continue
        value_obj, reason = resolve(objects, value)
        if value_obj is None:
            out.append(Finding("V-P03", "error",
                               f'the {entry["role"]} position value ({describe(value)}) is {reason}'))
            continue
        suffix, _ = connector_direction(value_obj)
        if value.get("connector") and suffix != value["connector"]:
            out.append(Finding("V-P03", "error",
                               f'the {entry["role"]} position value must be a {value["connector"]} object '
                               f'above its damper, got {value_obj["obj_id"]!r}'))
        if value.get("offset_from_damper"):
            check_offset(value_obj, obj, value["offset_from_damper"],
                         f'the {entry["role"]} position value', "V-P03", out)


def check_profile_absences(objects, profile, out):
    """Roles this profile deliberately does not carry. Each entry's detect block
    says what would prove the role crept back in."""
    for entry in profile.get("absent_by_design", []):
        detect = entry.get("detect") or {}
        reason = entry.get("reason", "")
        offenders = []
        for obj in objects:
            text = (obj.get("tag_text") or "").strip()
            if any(obj["obj_id"].startswith(p) for p in detect.get("obj_id_prefixes", [])):
                offenders.append(obj)
            elif is_label(obj) and text in detect.get("label_texts", []):
                offenders.append(obj)
            elif is_label(obj) and any(text.startswith(p)
                                       for p in detect.get("label_text_prefixes", [])):
                offenders.append(obj)
            elif is_value(obj) and any(text.split(" ")[0].startswith(p)
                                       for p in detect.get("value_tag_prefixes", [])):
                offenders.append(obj)
        for obj in offenders:
            out.append(Finding("V-P07", "error",
                               f'{obj.get("name")} ({obj["obj_id"]}, tag {obj.get("tag_text")!r}) '
                               f'reintroduces {entry["role"]!r}, which this profile omits. {reason}'))


def check_profile_sidebar_centring(objects, profile, out):
    """A left-aligned caption is centred on its column by posLeft = centre - W/2,
    where W is the rendered text width. Only enforced where W was measured."""
    columns = ((profile.get("sidebar") or {}).get("value_columns") or {})
    for key, column in columns.items():
        caption = column.get("caption")
        centre = column.get("centre")
        if not caption or centre is None:
            continue
        hits = [o for o in objects if is_label(o) and (o.get("tag_text") or "").strip() == caption]
        if len(hits) != 1:
            out.append(Finding("V-P08", "error",
                               f"expected exactly one {caption!r} column caption, found {len(hits)}"))
            continue
        width, measured = estimate_text_width(caption, use_measured=True)
        expected = centre - width // 2
        actual = int(hits[0]["posLeft"])
        if actual != expected:
            out.append(Finding("V-P08", "warning",
                               f"the {key} column caption {caption!r} starts at x {actual}; centring it on "
                               f"{centre} with a rendered width of {width} px puts it at x {expected}"
                               + (" (width read off a screenshot - confirm at native scale)" if measured
                                  else " (width estimated from Arial metrics - measure it to confirm)")))


def check_profile(objects, profile, out):
    check_profile_clusters(objects, profile, out)
    check_profile_dampers(objects, profile, out)
    check_profile_fixed(objects, profile, out)
    check_profile_led(objects, profile, out)
    check_profile_alarms(objects, profile, out)
    check_profile_absences(objects, profile, out)
    check_profile_sidebar_centring(objects, profile, out)


# --------------------------------------------------------------------------

def validate(document, profile_name=None, rules=None, palette=None, mode=None):
    rules = rules if rules is not None else load_rules()
    palette = palette if palette is not None else load_palette()
    findings = []

    envelope = envelope_of(document)
    objects = objects_of(envelope)

    ventilation = (rules.get("panel_types") or {}).get("ventilation") or {}
    canvas_rule = ventilation.get("canvas") or {}
    canvas = (canvas_rule.get("width", 1400), canvas_rule.get("height", 750))
    bands = set((ventilation.get("z_indexes") or {}).get("bands", {}).keys())
    sidebar_x = (ventilation.get("sidebar") or {}).get("starts_at_x", 1150)

    check_envelope(envelope, findings)
    check_counts(envelope, findings)
    if not objects:
        findings.append(Finding("V-S01", "error", "panel.single_objects is empty"))
        return findings
    check_fields_and_names(objects, findings)
    check_geometry(envelope, objects, canvas, findings)
    check_z_bands(objects, bands, findings)

    # A generated demo and a production export obey mirror-image binding
    # contracts, so the mode has to be settled before either is checked.
    mode = detect_mode(objects) if mode is None else mode
    if mode == "demo":
        check_unlinked_demo(envelope, objects, findings)
    else:
        check_production_export(objects, findings)

    check_encoding(objects, findings)
    check_palette(objects, palette, findings)

    profile = None
    if profile_name:
        profile = (rules.get("profiles") or {}).get(profile_name)
        if profile is None:
            findings.append(Finding("V-P00", "error",
                                    f"unknown profile {profile_name!r}; documentation-rules.json defines "
                                    f"{sorted((rules.get('profiles') or {}).keys())}"))

    check_connector_attachment(objects, findings)
    check_duplicate_captions(objects, mode, findings)
    check_alarms(objects, mode, findings)
    check_damper_values(objects, profile, findings)
    check_sidebar(objects, sidebar_x, profile, mode, findings)

    if profile:
        check_profile(objects, profile, findings)

    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("panel", type=pathlib.Path)
    parser.add_argument("--profile", default=None,
                        help="apply a scoped geometry profile from documentation-rules.json")
    parser.add_argument("--mode", choices=("demo", "production"), default=None,
                        help="binding contract to check. Default: detect from the driver_id "
                             "placeholder - a generated demo emits the literal \"driver_id\", a "
                             "production export leaves an unlinked object's driver_id empty.")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)

    document = json.loads(args.panel.read_text(encoding="utf-8"))
    findings = validate(document, args.profile, mode=args.mode)

    errors = [f for f in findings if f.severity == "error"]
    if args.as_json:
        print(json.dumps([f.as_dict() for f in findings], ensure_ascii=False, indent=2))
    else:
        for finding in findings:
            print(finding)
        print(f"\n{len(errors)} error(s), {len(findings) - len(errors)} warning(s) in {args.panel}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
