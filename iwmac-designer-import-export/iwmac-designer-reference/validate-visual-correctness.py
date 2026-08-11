#!/usr/bin/env python3
"""Generic visual-correctness validator for IWMAC Designer panels. Scope GLOBAL.

Usage:
    python validate-visual-correctness.py PANEL.json
    python validate-visual-correctness.py PANEL.json --source SOURCE.json
    python validate-visual-correctness.py PANEL.json --allowed-values VALUES.json
    python validate-visual-correctness.py PANEL.json --require-analysis ANALYSIS.json
    python validate-visual-correctness.py ... --json-report

Panel-type-agnostic: it runs on any ``iwmac-designer-panel`` document (enveloped
or bare ``panel``), on every panel type, and it complements the per-type
validators — it replaces none of them. The prose contract is
VISUAL-CORRECTNESS-CONTRACT.md; the machine-readable form is
documentation-rules.json -> global_invariants.visual_correctness, which this
file reads for its tunable constants so the contract, the data and the code
cannot drift apart.

Three rule namespaces:

    VC-T*  text protection. A live object (value, icon, symbol, navigation)
           must never overlap a nonblank descriptive-text rectangle unless the
           supplied source proves that exact overlap (contract SS3).
    VC-W*  width from allowed values. A value object must fit the longest
           allowed display value from the supplied map, never merely the
           current value (contract SS5).
    VC-A*  analysis-block completeness, only with --require-analysis
           (contract SS2, items A1..A12).

Roles are classified from reference_data/design-object-catalog.json
(only_tag_text / can_link / states) with documented name-pattern fallbacks for
obj_ids the catalog does not carry — or carries without either flag, as it
does for navigation and artwork entries. Container-relative child coordinates are
converted to panel-absolute before any intersection test (child absolute =
container left/top + child posLeft/posTop).

WHAT THIS CANNOT DO. Text drawn inside the background artwork has no rectangle
in the JSON, so a collision with background text is invisible here — exactly as
equipment footprints are invisible to validate-oversikt-panel.py (O-G08). The
width check is a conservative floor detector using a per-character estimate,
not a typesetter: it can prove "cannot fit", never "fits pixel-perfectly". A
clean run is a necessary condition, never evidence that the panel is correct.

Exit status is 0 when no finding has severity ``error``, 1 otherwise. This file
performs no network access and reads nothing outside the reference directory
except the files named on the command line.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"
CATALOG_PATH = ROOT / "reference_data" / "design-object-catalog.json"

# Defaults; overridden by documentation-rules.json when present, then by flags.
DEFAULTS = {
    "char_px": 7.0,          # conservative width per character at the 13 px font
    "pad_px": 6.0,           # left+right padding inside a value object
    "proof_tolerance_px": 2, # relative-offset tolerance for source-proven pairs
}

# Fallback role patterns for obj_ids absent from the catalog. Documented in
# VISUAL-CORRECTNESS-CONTRACT.md SS6; the catalog always wins when it has the id.
TEXT_PATTERNS = ("label", "headline", "header", "textbox", "only_text")
LIVE_PATTERNS = ("number_", "analog", "digital", "alarm", "led_", "status",
                 "symbol", "cool", "defrost", "fan", "valve", "pump", "link",
                 "nav", "button", "arrow", "setpoint", "state")

ANALYSIS_KEYS = tuple("A%d" % i for i in range(1, 13))


class Finding(object):
    __slots__ = ("rule", "severity", "message")

    def __init__(self, rule, severity, message):
        self.rule = rule
        self.severity = severity
        self.message = message

    def as_dict(self):
        return {"rule": self.rule, "severity": self.severity,
                "message": self.message}


# ---------------------------------------------------------------- loading

def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_constants():
    constants = dict(DEFAULTS)
    try:
        rules = load_json(RULES_PATH)
        block = rules.get("global_invariants", {}).get("visual_correctness", {})
        estimator = block.get("width_estimator", {})
        for key in ("char_px", "pad_px"):
            if isinstance(estimator.get(key), (int, float)):
                constants[key] = float(estimator[key])
        proof = block.get("text_protection", {}).get("proof_tolerance_px")
        if isinstance(proof, (int, float)):
            constants["proof_tolerance_px"] = int(proof)
    except (OSError, ValueError, KeyError):
        pass
    return constants


def load_catalog():
    try:
        return load_json(CATALOG_PATH).get("objects", {})
    except (OSError, ValueError):
        return {}


def extract_panel(document):
    """Accept {envelope:{panel}}, {panel:...}, or a bare panel dict."""
    if not isinstance(document, dict):
        return None
    if isinstance(document.get("envelope"), dict):
        document = document["envelope"]
    if isinstance(document.get("panel"), dict):
        return document["panel"]
    if "single_objects" in document or "containers" in document:
        return document
    return None


# ---------------------------------------------------------------- geometry

def to_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def rect_of(obj, dx=0.0, dy=0.0):
    left = to_float(obj.get("posLeft"))
    top = to_float(obj.get("posTop"))
    width = to_float(obj.get("posWidth"))
    height = to_float(obj.get("posHeight"))
    if None in (left, top, width, height) or width <= 0 or height <= 0:
        return None
    return (left + dx, top + dy, width, height)


def intersection(a, b):
    """Positive-area overlap of two (left, top, width, height) rects, or None."""
    ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    if ox > 0 and oy > 0:
        return (ox, oy)
    return None


def collect_elements(panel, findings=None):
    """Flatten single_objects and container children into one absolute list.

    Each element: {obj_id, name, rect, text, raw, where} where rect is
    panel-absolute and text is the element's own nonblank display text ("" when
    none). Elements without usable geometry are skipped — the per-type
    validators own geometry-parses-cleanly findings. A container whose own
    left/top cannot be read has no resolvable origin: its children are skipped
    entirely, never assumed to sit at (0,0), and when ``findings`` is given
    the skip is reported as a VC-S01 warning.
    """
    elements = []
    for obj in panel.get("single_objects") or []:
        if not isinstance(obj, dict):
            continue
        rect = rect_of(obj)
        if rect is None:
            continue
        elements.append({
            "obj_id": str(obj.get("obj_id") or ""),
            "name": str(obj.get("name") or ""),
            "rect": rect,
            "text": str(obj.get("tag_text") or "").strip(),
            "raw": obj,
            "where": "canvas",
        })
    for container in panel.get("containers") or []:
        if not isinstance(container, dict):
            continue
        cname = str(container.get("name") or container.get("unique_id") or
                    "container")
        base_x = to_float(container.get("left"),
                          to_float(container.get("posLeft")))
        base_y = to_float(container.get("top"),
                          to_float(container.get("posTop")))
        if base_x is None or base_y is None:
            if findings is not None:
                findings.append(Finding(
                    "VC-S01", "warning",
                    "container '%s' carries no readable left/top origin; its "
                    "children were skipped, not assumed to sit at (0,0)"
                    % cname))
            continue
        for key, children in container.items():
            if not isinstance(children, list):
                continue
            for child in children:
                if not isinstance(child, dict):
                    continue
                rect = rect_of(child, base_x, base_y)
                if rect is None:
                    continue
                text = str(child.get("tag_text") or child.get("title") or
                           child.get("text") or "").strip()
                elements.append({
                    "obj_id": str(child.get("obj_id") or ""),
                    "name": str(child.get("name") or
                                child.get("unique_id") or "item"),
                    "rect": rect,
                    "text": text,
                    "raw": child,
                    "where": "%s.%s" % (cname, key),
                })
    return elements


# ---------------------------------------------------------------- roles

def classify(element, catalog):
    """Return 'text', 'live' or 'other' for one flattened element.

    The catalog decides when it knows the obj_id: text-only objects are text,
    linkable or stateful objects are live. Name patterns are the documented
    fallback — both for ids the catalog lacks and for catalog entries that
    carry neither flag (navigation and artwork entries do). An element with
    no obj_id but nonblank text (a container cell) is text.
    """
    obj_id = element["obj_id"]
    entry = catalog.get(obj_id)
    if isinstance(entry, dict):
        if entry.get("only_tag_text"):
            return "text" if element["text"] else "other"
        if entry.get("can_link") or entry.get("states"):
            return "live"
        # Known id, neither flag: fall through to the name patterns instead
        # of declaring the element unclassifiable.
    lowered = obj_id.lower()
    if any(pattern in lowered for pattern in TEXT_PATTERNS):
        return "text" if element["text"] else "other"
    if any(pattern in lowered for pattern in LIVE_PATTERNS):
        return "live"
    if not obj_id and element["text"]:
        return "text"
    return "other"


# ---------------------------------------------------------------- VC-T

def pair_signature(first, second, role_a, role_b):
    """(obj_id_a, obj_id_b, dx, dy, roles) for one overlapping pair.

    dx/dy are the offset from the first to the second element of the sorted
    pair, and roles is the sorted role multiset, so the signature is
    order-independent and position-independent — 'the same role pair in the
    same relative arrangement' (contract SS3.2). Object names are deliberately
    absent: the host renumbers object_N from the live canvas index on every
    insert, so obj_id plus relative offset is the only portable identity.
    """
    pair = sorted((first, second), key=lambda e: (e["obj_id"],
                                                  e["rect"][0],
                                                  e["rect"][1]))
    return (pair[0]["obj_id"], pair[1]["obj_id"],
            pair[1]["rect"][0] - pair[0]["rect"][0],
            pair[1]["rect"][1] - pair[0]["rect"][1],
            "+".join(sorted((role_a, role_b))))


def overlap_signatures(panel, catalog):
    """Signatures of every overlapping element pair in a panel."""
    signatures = []
    elements = collect_elements(panel)
    roles = [classify(element, catalog) for element in elements]
    for index_a in range(len(elements)):
        for index_b in range(index_a + 1, len(elements)):
            first, second = elements[index_a], elements[index_b]
            if intersection(first["rect"], second["rect"]) is None:
                continue
            signatures.append(pair_signature(first, second,
                                             roles[index_a], roles[index_b]))
    return signatures


def proven_by_source(signature, source_signatures, tolerance):
    """True when the source shows the same pair, arrangement AND role pair.

    The role component is what stops a blank source label (role 'other') from
    proving a candidate overlap where that label now carries text (role
    'text'): the production panel proved live-over-blank, not live-over-text.
    """
    for candidate in source_signatures:
        if (signature[0] == candidate[0] and signature[1] == candidate[1] and
                abs(signature[2] - candidate[2]) <= tolerance and
                abs(signature[3] - candidate[3]) <= tolerance and
                signature[4] == candidate[4]):
            return True
    return False


def check_text_protection(panel, catalog, source_panel, constants, findings):
    elements = collect_elements(panel, findings)
    if not elements:
        findings.append(Finding("VC-S01", "warning",
                                "panel has no geometrically usable objects; "
                                "nothing to check"))
        return
    source_signatures = (overlap_signatures(source_panel, catalog)
                         if source_panel else [])
    tolerance = constants["proof_tolerance_px"]
    roles_by_index = [classify(element, catalog) for element in elements]
    for index_a in range(len(elements)):
        for index_b in range(index_a + 1, len(elements)):
            first, second = elements[index_a], elements[index_b]
            overlap = intersection(first["rect"], second["rect"])
            if overlap is None:
                continue
            role_a = roles_by_index[index_a]
            role_b = roles_by_index[index_b]
            roles = {role_a, role_b}
            signature = pair_signature(first, second, role_a, role_b)
            proven = proven_by_source(signature, source_signatures, tolerance)
            described = ("%s '%s' and %s '%s' overlap %.0fx%.0f px"
                         % (first["obj_id"] or first["where"], first["name"],
                            second["obj_id"] or second["where"],
                            second["name"], overlap[0], overlap[1]))
            if roles == {"live", "text"}:
                text_el = first if role_a == "text" else second
                if proven:
                    findings.append(Finding("VC-T03", "info",
                                            described + " over text %r - "
                                            "proven by the supplied source"
                                            % text_el["text"][:40]))
                else:
                    findings.append(Finding("VC-T01", "error",
                                            described + " - a live object "
                                            "covers descriptive text %r; no "
                                            "supplied source proves this "
                                            "overlap (contract SS3)"
                                            % text_el["text"][:40]))
            elif roles == {"live"}:
                coincident = (first["rect"] == second["rect"])
                if proven:
                    findings.append(Finding("VC-T03", "info",
                                            described + " - proven by the "
                                            "supplied source"))
                elif coincident:
                    findings.append(Finding("VC-T03", "info",
                                            described + " - exactly "
                                            "coincident stack (documented "
                                            "production pattern)"))
                else:
                    findings.append(Finding("VC-T02", "warning",
                                            described + " - live objects "
                                            "overlap and no supplied source "
                                            "proves it (contract SS3.2)"))


# ---------------------------------------------------------------- VC-W

RANGE_PATTERN = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)\s*$")


def display_labels(values):
    """All display strings from an allowed-values declaration.

    Accepts a list of labels, or a string: either 'value = label' pairs
    separated by a spaced '/', by ';', ',' or newlines (the dominant
    production form, E23: '0 = OFF / 1 = ON'), or a numeric range 'a to b',
    which yields the widest bound rendering. A slash with no surrounding
    whitespace is part of the label ('0 = Heat/Cool / 1 = Off'), which is
    why the bare '/' is not a separator.
    """
    if isinstance(values, list):
        return [str(v) for v in values if str(v).strip()]
    text = str(values or "").strip()
    if not text:
        return []
    match = RANGE_PATTERN.match(text)
    if match:
        return [max(match.group(1), match.group(2), key=len)]
    labels = []
    for part in re.split(r"\s+/\s+|[;,\n]", text):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            label = part.split("=", 1)[1].strip()
            if label:
                labels.append(label)
        else:
            labels.append(part)
    return labels


def match_element(element, spec):
    """True when one allowed-values match spec selects this element."""
    if not isinstance(spec, dict) or not spec:
        return False
    raw = element.get("raw") or {}
    checks = {
        "obj_id": lambda v: element["obj_id"] == v,
        "name": lambda v: element["name"] == v,
        "alias_text": lambda v: str(raw.get("alias_text") or "") == v,
        "alias_text_contains":
            lambda v: v in str(raw.get("alias_text") or ""),
        "driver_id_contains":
            lambda v: v in str(raw.get("driver_id") or ""),
    }
    for key, expected in spec.items():
        probe = checks.get(key)
        if probe is None or not probe(str(expected)):
            return False
    return True


def check_widths(panel, catalog, allowed_values, constants, findings):
    maps = allowed_values.get("maps")
    if not isinstance(maps, list) or not maps:
        findings.append(Finding("VC-W02", "warning",
                                "--allowed-values file carries no maps[]"))
        return
    # Container children are included: a value cell inside a table container
    # must fit its longest allowed value exactly as a canvas object must.
    elements = collect_elements(panel)
    char_px = constants["char_px"]
    pad_px = constants["pad_px"]
    for index, entry in enumerate(maps):
        spec = entry.get("match") if isinstance(entry, dict) else None
        labels = display_labels(entry.get("values")) if isinstance(entry, dict) else []
        if not spec or not labels:
            findings.append(Finding("VC-W02", "warning",
                                    "maps[%d] lacks a match spec or parseable "
                                    "values; nothing checked" % index))
            continue
        matched = [el for el in elements if match_element(el, spec)]
        if not matched:
            findings.append(Finding("VC-W02", "info",
                                    "maps[%d] (%s) matched no object"
                                    % (index, json.dumps(spec, sort_keys=True))))
            continue
        longest = max(labels, key=len)
        required = math.ceil(len(longest) * char_px + pad_px)
        for element in matched:
            width = element["rect"][2]
            if required > width:
                findings.append(Finding(
                    "VC-W01", "error",
                    "%s '%s' is %.0f px wide but the longest allowed display "
                    "value %r needs about %d px (%d chars x %.1f px + %.0f px "
                    "padding). Size for every allowed value, never the "
                    "current one (contract SS5)."
                    % (element["obj_id"], element["name"], width,
                       longest, required, len(longest), char_px, pad_px)))


# ---------------------------------------------------------------- VC-A

def check_analysis(analysis, findings):
    if not isinstance(analysis, dict):
        findings.append(Finding("VC-A01", "error",
                                "analysis file is not a JSON object"))
        return
    missing = [key for key in ANALYSIS_KEYS
               if not str(analysis.get(key) or "").strip()]
    if missing:
        findings.append(Finding("VC-A01", "error",
                                "analysis block is missing or blank for: %s "
                                "(contract SS2 requires A1..A12)"
                                % ", ".join(missing)))


# ---------------------------------------------------------------- driver

def run(panel, source_panel=None, allowed_values=None, analysis=None,
        constants=None):
    constants = constants or load_constants()
    catalog = load_catalog()
    findings = []
    check_text_protection(panel, catalog, source_panel, constants, findings)
    if allowed_values is not None:
        check_widths(panel, catalog, allowed_values, constants, findings)
    if analysis is not None:
        check_analysis(analysis, findings)
    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("panel", help="candidate panel JSON")
    parser.add_argument("--source", help="supplied production export that can "
                                         "prove an overlap intentional")
    parser.add_argument("--allowed-values",
                        help="JSON file: {maps: [{match: {...}, values: "
                             "'0 = OFF / 1 = ON'}]}")
    parser.add_argument("--require-analysis",
                        help="JSON file carrying the SS2 analysis block "
                             "(keys A1..A12)")
    parser.add_argument("--char-px", type=float,
                        help="width estimate per character (default from "
                             "documentation-rules.json)")
    parser.add_argument("--pad-px", type=float,
                        help="padding added to the width estimate")
    parser.add_argument("--json-report", action="store_true")
    args = parser.parse_args(argv)

    if args.char_px is not None and (not math.isfinite(args.char_px) or
                                     args.char_px <= 0):
        parser.error("--char-px must be a finite number > 0")
    if args.pad_px is not None and (not math.isfinite(args.pad_px) or
                                    args.pad_px < 0):
        parser.error("--pad-px must be a finite number >= 0")

    constants = load_constants()
    if args.char_px is not None:
        constants["char_px"] = args.char_px
    if args.pad_px is not None:
        constants["pad_px"] = args.pad_px

    def structural_failure(message):
        """Report a cannot-even-start failure in the requested format."""
        finding = Finding("VC-S01", "error", message)
        if args.json_report:
            print(json.dumps({"findings": [finding.as_dict()],
                              "errors": 1, "warnings": 0}, indent=2))
        else:
            print("VC-S01 error: %s" % message)
            print("1 finding(s), 1 error(s)")
        return 1

    try:
        panel = extract_panel(load_json(args.panel))
    except (OSError, ValueError) as exc:
        return structural_failure("%s cannot be read as JSON: %s"
                                  % (args.panel, exc))
    if panel is None:
        return structural_failure("%s carries no panel document" % args.panel)
    source_panel = None
    if args.source:
        try:
            source_panel = extract_panel(load_json(args.source))
        except (OSError, ValueError) as exc:
            return structural_failure("--source %s cannot be read as JSON: %s"
                                      % (args.source, exc))
        if source_panel is None:
            return structural_failure("--source %s carries no panel document"
                                      % args.source)
    try:
        allowed_values = (load_json(args.allowed_values)
                          if args.allowed_values else None)
        analysis = (load_json(args.require_analysis)
                    if args.require_analysis else None)
    except (OSError, ValueError) as exc:
        return structural_failure("sidecar file cannot be read as JSON: %s"
                                  % exc)

    findings = run(panel, source_panel, allowed_values, analysis, constants)
    errors = sum(1 for finding in findings if finding.severity == "error")
    if args.json_report:
        print(json.dumps({"findings": [f.as_dict() for f in findings],
                          "errors": errors,
                          "warnings": sum(1 for f in findings
                                          if f.severity == "warning")},
                         indent=2))
    else:
        for finding in findings:
            print("%s %s: %s" % (finding.rule, finding.severity,
                                 finding.message))
        print("%d finding(s), %d error(s)" % (len(findings), errors))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
