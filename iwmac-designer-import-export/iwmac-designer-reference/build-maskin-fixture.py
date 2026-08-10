#!/usr/bin/env python3
"""Derive the sanitized TEMPLATE-10229 Maskin fixture from a production export.

    python build-maskin-fixture.py SOURCE.json -o reference_data/maskin-10229-sanitized.json
    python build-maskin-fixture.py SOURCE.json --report

WHY THIS IS A SCRIPT AND NOT A HAND-EDITED FILE.

The fixture must be provably a *mechanical* derivative of the export it came
from: every coordinate, size, zIndex, alias, tag and the background survive
byte-for-byte, and only the fields in SANITIZE below are touched. A hand-edited
copy cannot be checked for that. Re-run this script against the retained source
and diff, and the claim is testable.

The source export carries live plant bindings and is deliberately NOT committed.
It lives in the operator's own Downloads folder; the evidence table in
MASKIN-GENERATION-CONTRACT.md names it. Nothing in this repository reads it
except this script, on demand.

``--report`` prints the measured analysis that MASKIN-GENERATION-CONTRACT.md
quotes. Regenerate the report rather than retyping a number into the contract.

No network access. Reads only the paths given on the command line.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "reference_data" / "maskin-10229-sanitized.json"

OBJECT_FIELDS = (
    "obj_id", "name", "id", "posWidth", "posHeight", "posLeft", "posTop",
    "zIndex", "tag_text", "linked", "link_name", "link_tag", "sub_group",
    "driver_id", "unit_id", "unit_ref", "alias_text",
)

# The sanitization contract, as data. Left column: what is replaced. Right
# column: the replacement. Everything NOT listed here is copied verbatim - that
# is the point, and the regression test asserts it field by field.
SANITIZE_OBJECT = {
    "id": "driver_id",          # host literal on export; the demo placeholder
    "driver_id": "driver_id",   # 64 live plant-prefixed bindings
    "linked": "false",          # demo contract; the host re-derives it on load
    "link_name": "",            # host literal "link_name" in the export
    "link_tag": "",
    "unit_id": "",              # 000:060 - the live AK-PC unit address
    "unit_ref": "",
    "sub_group": "",
}

# Preserved deliberately, and named here so the intent is auditable:
PRESERVE_OBJECT = ("obj_id", "name", "posWidth", "posHeight", "posLeft",
                   "posTop", "zIndex", "tag_text", "alias_text")

SANITIZE_ENVELOPE = {
    "source_plant_id": "",
    "generator": "TEMPLATE-10229 fixture (build-maskin-fixture.py)",
}

SANITIZE_PANEL = {
    "plant_id": "",
    "saved_by": "",
    # Embeds the plant id and names a file on the host that this repository has
    # no copy of. Blanked rather than renamed: inventing a filename would be a
    # fabricated file path.
    "org_image_name": "",
    "image_name": "",
}

# Dropped, not sanitized. image_svg_trace is 2.24 MB of automatic vector trace
# that Export writes as AI *input* and Insert deletes again
# (IWMAC-Designer-Import-Export.user.js: `delete doc.image_svg_trace;`). It is
# not part of the panel document, it is not needed to render the fixture, and
# committing it would make the fixture 19x larger than its own background.
DROP_PANEL = ("image_svg_trace",)

FIXTURE_NOTE = (
    "SANITIZED PRODUCTION-STYLE FIXTURE - scope TEMPLATE-10229. Derived "
    "mechanically from a plant-10229 'Maskin' export (IWDIE v1.7.0, 66 objects) "
    "by build-maskin-fixture.py, which replaces ONLY the binding fields listed "
    "in its SANITIZE tables. Geometry, obj_id, sizes, zIndex, ordering, "
    "tag_text, alias_text and the background image_data are byte-identical to "
    "that export, so this file is authoritative for Maskin GEOMETRY and is a "
    "demo - NOT a production export - for BINDINGS: id and driver_id are the "
    "literal placeholder, linked is \"false\", and every link/unit field is "
    "empty. panel.image_svg_trace was dropped (Insert deletes it anyway). The "
    "aliases are kept on purpose: they are the Danfoss AK-PC parameter names a "
    "human relinks by, and reference_data/maskin-akpc-link-map.json maps them. "
    "See MASKIN-GENERATION-CONTRACT.md."
)


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


# --------------------------------------------------------------------------
# Sanitization
# --------------------------------------------------------------------------

def sanitize(document):
    source = envelope_of(document)
    panel = source["panel"]

    out_panel = {}
    for key, value in panel.items():
        if key in DROP_PANEL:
            continue
        if key in SANITIZE_PANEL:
            out_panel[key] = SANITIZE_PANEL[key]
        elif key == "single_objects":
            out_panel[key] = [sanitize_object(o) for o in value]
        else:
            out_panel[key] = value

    envelope = {}
    for key, value in source.items():
        if key in SANITIZE_ENVELOPE:
            envelope[key] = SANITIZE_ENVELOPE[key]
        elif key == "panel":
            envelope[key] = out_panel
        else:
            envelope[key] = value

    return {"_note": FIXTURE_NOTE, "envelope": envelope}


def sanitize_object(obj):
    out = {}
    for key, value in obj.items():
        out[key] = SANITIZE_OBJECT.get(key, value) if key in SANITIZE_OBJECT else value
    return out


def residue(document, plant_id, unit_ids):
    """Every reason this document is still not safe to commit, as a list.

    Scans the panel document and the envelope's binding fields - not the whole
    file. ``_note`` and ``generator`` are fixture provenance and name the
    TEMPLATE-10229 scope on purpose, as does the filename. A plant *number* in
    a provenance string is not a live binding; a plant-prefixed driver id
    inside an object is.

    ``image_data`` is excluded because it is base64: a five-byte coincidence
    inside 124 KB of PNG would be a false positive, and the background is
    artwork that carries no binding.
    """
    envelope = envelope_of(document)
    scanned = {key: envelope.get(key) for key in ("source_plant_id", "panel_name")}
    panel = dict(envelope.get("panel") or {})
    panel.pop("image_data", None)
    scanned["panel"] = panel
    text = json.dumps(scanned, ensure_ascii=False)
    problems = []
    if plant_id and plant_id in text:
        problems.append(f"source plant id {plant_id!r} still appears")
    for unit in unit_ids:
        if unit and unit in text:
            problems.append(f"unit id {unit!r} still appears")
    objects = envelope_of(document)["panel"]["single_objects"]
    for obj in objects:
        for field, expected in SANITIZE_OBJECT.items():
            if obj.get(field) != expected:
                problems.append(f"{obj.get('name')}.{field} is {obj.get(field)!r}, "
                                f"expected {expected!r}")
    return problems


# --------------------------------------------------------------------------
# Measurement report
# --------------------------------------------------------------------------

# Operational roles, as an ordered rule list over alias_text. Every rule is a
# (role, predicate) pair and every object must match exactly one; the report
# fails loudly on an unclassified or doubly-classified alias rather than
# quietly dropping it into an "other" bucket.
ROLE_RULES = (
    ("MT compressor column", lambda a: a.startswith(("C1 MT", "C2 MT", "C3 MT"))),
    ("LT compressor column", lambda a: a.startswith(("C1 LT", "C2 LT", "C3 LT"))),
    ("MT suction group", lambda a: a.endswith("MT") or a.endswith("To-MT")),
    ("LT suction group", lambda a: a.endswith("LT") or a.endswith("To-LT")),
    ("Heat recovery", lambda a: a.startswith(("Shr", "Hr ", "HR ", "V3hr"))),
    ("Receiver", lambda a: a.startswith(("Prec", "Vrec"))),
    ("High pressure / gas cooler",
     lambda a: a in ("Pc", "Tc", "Sc3", "Sgc", "Shp", "Pgc", "Pgc reference",
                     "Vhp OD", "V3gc")
     or a.startswith("Cond.")),
    ("Alarm / IO", lambda a: a in ("--- DI1 Alarm", "u17 Ther Air")),
)


def classify(alias):
    hits = [role for role, test in ROLE_RULES if test(alias)]
    return hits


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

    w("\nOBJ_ID FREQUENCY\n")
    sizes = collections.defaultdict(set)
    for obj in objects:
        sizes[obj["obj_id"]].add((as_int(obj["posWidth"]), as_int(obj["posHeight"])))
    for obj_id, count in collections.Counter(o["obj_id"] for o in objects).most_common():
        dims = ", ".join(f"{a}x{b}" for a, b in sorted(sizes[obj_id]))
        w(f"  {count:3d}  {obj_id:36s} {dims}\n")

    w("\nZ-INDEX BANDS\n")
    by_z = collections.defaultdict(collections.Counter)
    for obj in objects:
        by_z[str(obj["zIndex"])][obj["obj_id"]] += 1
    for z in sorted(by_z, key=lambda v: (as_int(v) is None, as_int(v) or 0)):
        total = sum(by_z[z].values())
        w(f"  z {z:6s} {total:3d} objects: "
          + ", ".join(f"{k} x{v}" for k, v in by_z[z].most_common()) + "\n")

    w("\nFIELD UNIFORMITY\n")
    for field in OBJECT_FIELDS:
        counter = collections.Counter(repr(o.get(field)) for o in objects)
        if field in ("name", "posLeft", "posTop", "alias_text", "driver_id"):
            w(f"  {field:12s} {len(counter)} distinct values\n")
        else:
            w(f"  {field:12s} " + ", ".join(f"{v} x{n}" for v, n in counter.most_common(4)) + "\n")

    w("\nBOUNDS AND STRUCTURE\n")
    lefts = [as_int(o["posLeft"]) for o in objects]
    tops = [as_int(o["posTop"]) for o in objects]
    rights = [as_int(o["posLeft"]) + as_int(o["posWidth"]) for o in objects]
    bottoms = [as_int(o["posTop"]) + as_int(o["posHeight"]) for o in objects]
    w(f"  left  {min(lefts)}..{max(lefts)}   right edge max {max(rights)}\n")
    w(f"  top   {min(tops)}..{max(tops)}   bottom edge max {max(bottoms)}\n")
    names = [o["name"] for o in objects]
    w(f"  names sequential object_0..object_{len(objects) - 1}: "
      f"{names == [f'object_{i}' for i in range(len(objects))]}\n")
    missing = {o["name"]: [f for f in OBJECT_FIELDS if f not in o] for o in objects}
    w(f"  objects missing any of the 17 fields: "
      f"{[n for n, m in missing.items() if m] or 'none'}\n")
    coords = collections.Counter((as_int(o["posLeft"]), as_int(o["posTop"])) for o in objects)
    w(f"  repeated (left,top): {[c for c, n in coords.items() if n > 1] or 'none'}\n")

    w("\nANOMALIES\n")
    found = False
    for obj in objects:
        flags = []
        if obj.get("linked") == "true" and not obj.get("driver_id"):
            flags.append("linked=true with empty driver_id")
        if obj.get("tag_text") not in ("", None):
            flags.append(f"tag_text={obj['tag_text']!r}")
        if flags:
            found = True
            w(f"  {obj['name']:10s} {obj['alias_text']!r}: {'; '.join(flags)}\n")
    dupe_alias = [a for a, n in collections.Counter(o["alias_text"] for o in objects).items() if n > 1]
    dupe_driver = [d for d, n in collections.Counter(
        o["driver_id"] for o in objects if o.get("driver_id")).items() if n > 1]
    if dupe_alias:
        found = True
        w(f"  duplicate alias_text: {dupe_alias}\n")
    if dupe_driver:
        found = True
        w(f"  duplicate driver_id: {dupe_driver}\n")
    if not found:
        w("  none\n")

    w("\nROLES\n")
    buckets = collections.defaultdict(list)
    bad = []
    for obj in objects:
        hits = classify(obj["alias_text"])
        if len(hits) != 1:
            bad.append((obj["name"], obj["alias_text"], hits))
        buckets[hits[0] if hits else "UNCLASSIFIED"].append(obj)
    for role, _ in ROLE_RULES:
        members = buckets.get(role, [])
        w(f"  {role} ({len(members)})\n")
        for obj in sorted(members, key=lambda o: (as_int(o["posTop"]), as_int(o["posLeft"]))):
            w(f"      {obj['alias_text']:24s} {obj['obj_id']:36s} "
              f"({as_int(obj['posLeft'])},{as_int(obj['posTop'])}) "
              f"{as_int(obj['posWidth'])}x{as_int(obj['posHeight'])} z{obj['zIndex']}\n")
    if bad:
        w(f"  !! not classified exactly once: {bad}\n")

    w("\nCOMPRESSOR COLUMNS\n")
    for side in ("MT", "LT"):
        w(f"  {side}\n")
        for row, suffix in (("status", "status"), ("capacity", "capacity"),
                            ("runtime", "Runtime total"), ("vsd", "VSD 1 speed")):
            cells = []
            for n in (1, 2, 3):
                alias = f"C{n} {side} {suffix}"
                hit = next((o for o in objects if o["alias_text"] == alias), None)
                cells.append((n, hit))
            present = [(n, o) for n, o in cells if o]
            if not present:
                continue
            positions = " ".join(
                f"C{n}({as_int(o['posLeft'])},{as_int(o['posTop'])})" for n, o in present)
            deltas = " ".join(
                f"C{a[0]}->C{b[0]} ({as_int(b[1]['posLeft']) - as_int(a[1]['posLeft'])},"
                f"{as_int(b[1]['posTop']) - as_int(a[1]['posTop'])})"
                for a, b in zip(present, present[1:]))
            w(f"    {row:9s} {present[0][1]['obj_id']:36s} {positions}   {deltas}\n")

    w("\nMT -> LT TRANSLATION BY ROLE\n")
    index = {o["alias_text"]: o for o in objects if o["alias_text"] != "Suction temp. To-MT"}
    for mt_alias, obj in sorted(index.items(), key=lambda kv: kv[0]):
        if " MT" not in mt_alias and not mt_alias.endswith("-MT"):
            continue
        lt_alias = mt_alias.replace("MT", "LT")
        other = index.get(lt_alias)
        if not other:
            continue
        w(f"  {mt_alias:24s} -> {lt_alias:24s} "
          f"({as_int(other['posLeft']) - as_int(obj['posLeft'])},"
          f"{as_int(other['posTop']) - as_int(obj['posTop'])})\n")

    w("\nDRIVER ID STRUCTURE (source export only)\n")
    prefixes = collections.Counter()
    params = collections.Counter()
    for obj in objects:
        driver = obj.get("driver_id") or ""
        if not driver:
            continue
        parts = driver.split("_")
        prefixes["_".join(parts[:-2])] += 1
        params[parts[-2]] += 1
    for prefix, count in prefixes.most_common():
        w(f"  {count:3d}  {prefix}_<param>_<index>\n")
    w(f"  parameter groups: {sorted(params, key=lambda p: int(p) if p.isdigit() else 0)}\n")


# --------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source", type=pathlib.Path,
                        help="the retained production export (not committed)")
    parser.add_argument("-o", "--output", type=pathlib.Path, default=None,
                        help=f"write the sanitized fixture here (default {DEFAULT_OUT})")
    parser.add_argument("--report", action="store_true",
                        help="print the measured analysis instead of writing a fixture")
    args = parser.parse_args(argv)

    document = json.loads(args.source.read_text(encoding="utf-8"))

    if args.report:
        report(document)
        return 0

    source_env = envelope_of(document)
    plant_id = source_env.get("source_plant_id") or (source_env.get("panel") or {}).get("plant_id")
    unit_ids = {o.get("unit_id") for o in source_env["panel"]["single_objects"] if o.get("unit_id")}

    fixture = sanitize(document)
    problems = residue(fixture, plant_id, unit_ids)
    if problems:
        for problem in problems:
            print(f"REFUSING TO WRITE: {problem}", file=sys.stderr)
        return 1

    target = args.output or DEFAULT_OUT
    target.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    objects = fixture["envelope"]["panel"]["single_objects"]
    print(f"wrote {target} - {len(objects)} objects, {target.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
