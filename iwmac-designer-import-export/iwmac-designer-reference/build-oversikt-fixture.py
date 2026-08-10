#!/usr/bin/env python3
"""Derive the masked TEMPLATE-10113 Oversikt fixture from a production export.

    python build-oversikt-fixture.py SOURCE.json -o reference_data/oversikt-10113-sanitized.json
    python build-oversikt-fixture.py SOURCE.json --report

WHY THIS IS A SCRIPT AND NOT A HAND-EDITED FILE.

The fixture must be provably a *mechanical* derivative of the export it came
from: every coordinate, size, zIndex, alias, tag, array position and the
background survive byte-for-byte, and only the fields in the MASK tables below
are touched. A hand-edited copy cannot be checked for that. Re-run this script
against the retained source and diff, and the claim is testable.

WHY THIS MASKS AND DOES NOT UNLINK.

build-maskin-fixture.py applies the *unlinked demo contract*: it replaces every
binding with the literal placeholder. That is right for a geometry template and
wrong here. An Oversikt is not a flat object list - it is a set of controller
clusters, and the thing this fixture has to prove is that all 21 of them survive
a round trip. Controller identity lives in ``unit_id`` and in the driver id, so
blanking those would delete the very structure the fixture exists to carry.

So this script follows the repo's other convention instead - the one already
used by reference_data/real-vent-panel-example.json and
real-spjeldliste-example.json: a MASKED production reference. The live plant
number is replaced with ``NNNNN`` in every driver id, the plant id, author and
background filename are blanked, and the bus addresses and parameter suffixes
are preserved. A driver id whose plant field is ``NNNNN`` binds to nothing; the
cluster structure it encodes is still readable.

``--report`` prints the measured analysis that OVERSIKT-GENERATION-CONTRACT.md
quotes. Regenerate the report rather than retyping a number into the contract.

The source export carries the live plant id and 72 real driver ids and is
deliberately NOT committed. The evidence table in
OVERSIKT-GENERATION-CONTRACT.md names it. Nothing in this repository reads it
except this script, on demand.

No network access. Reads only the paths given on the command line.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "reference_data" / "oversikt-10113-sanitized.json"

OBJECT_FIELDS = (
    "obj_id", "name", "id", "posWidth", "posHeight", "posLeft", "posTop",
    "zIndex", "tag_text", "linked", "link_name", "link_tag", "sub_group",
    "driver_id", "unit_id", "unit_ref", "alias_text",
)

MASKED_PLANT = "NNNNN"

# The four object families an Oversikt cluster is built from, in the order the
# coverage matrix prints them. This mapping is the ONLY place the four roles are
# tied to obj_ids in this script; the validator reads the same mapping from
# documentation-rules.json.
CLUSTER_ROLES = (
    ("alarm", "V3_R_34px_circular_alarm_nrm"),
    ("value", "number_v3_40px_no_conn_no_tag"),
    ("cooling", "V3_R_28px_circular_cooling_nrm"),
    ("defrost", "V3_R_28px_circular_defrost_nrm"),
)
ROLE_OF_OBJ_ID = {obj_id: role for role, obj_id in CLUSTER_ROLES}

# Preserved deliberately, and named here so the intent is auditable. Note that
# unit_id, linked, link_name and the parameter tail of driver_id are on this
# list and NOT on the mask list - see the module docstring.
PRESERVE_OBJECT = (
    "obj_id", "name", "id", "posWidth", "posHeight", "posLeft", "posTop",
    "zIndex", "tag_text", "linked", "link_name", "link_tag", "sub_group",
    "unit_id", "unit_ref", "alias_text",
)

MASK_ENVELOPE = {
    "source_plant_id": "",
    "generator": "TEMPLATE-10113 fixture (build-oversikt-fixture.py)",
}

MASK_PANEL = {
    "plant_id": "",
    # firstname.lastname of the operator who saved the export.
    "saved_by": "",
    # Embeds the plant id and names a file on the host that this repository has
    # no copy of. Blanked rather than renamed: inventing a filename would be a
    # fabricated file path.
    "org_image_name": "",
    "image_name": "",
}

# Dropped, not masked. image_svg_trace is half a megabyte of automatic vector
# trace that Export writes as AI *input* and Insert deletes again
# (IWMAC-Designer-Import-Export.user.js: `delete doc.image_svg_trace;`). It is
# not part of the panel document and it is not needed to render the fixture.
DROP_PANEL = ("image_svg_trace",)

FIXTURE_NOTE = (
    "MASKED PRODUCTION REFERENCE - scope TEMPLATE-10113. Derived mechanically "
    "from a plant-10113 'Oversikt' export (72 objects, 21 controller clusters) "
    "by build-oversikt-fixture.py, which replaces ONLY the plant number inside "
    "each driver_id (with NNNNN) and the envelope/panel fields listed in its "
    "MASK tables. Geometry, obj_id, sizes, zIndex, ordering, tag_text, "
    "alias_text, unit_id and the background image_data are byte-identical to "
    "that export, so this file is authoritative for Oversikt GEOMETRY and for "
    "CLUSTER STRUCTURE. It is NOT a linkable panel: every driver id names plant "
    "NNNNN, which does not exist. panel.image_svg_trace was dropped (Insert "
    "deletes it anyway). unit_id is preserved on purpose - it is the controller "
    "identity the coverage matrix groups by, and a bus address with no plant "
    "behind it binds to nothing. The counts recorded here describe THIS PANEL, "
    "not a target for any other store. See OVERSIKT-GENERATION-CONTRACT.md."
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


def controller_key(obj):
    """The cluster this object belongs to, and where that came from.

    Precedence is unit_id first, normalized driver prefix second, and nothing
    third. It is deliberately NOT spatial: proximity groups a cluster that is
    already correct and merges two that are not.

    The driver-id fallback takes the first five underscore-separated fields -
    plant, system, driver family, line, address - which is the controller. The
    remaining fields are the parameter, and dropping them is what makes four
    objects on one controller share one key.
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


def mask_object(obj, plant_id):
    out = {}
    for key, value in obj.items():
        out[key] = mask_driver_id(value, plant_id) if key == "driver_id" else value
    return out


def residue(document, plant_id):
    """Every reason this document is still not safe to commit, as a list.

    ``image_data`` is excluded because it is base64: a five-byte coincidence
    inside 48 KB of PNG would be a false positive, and the background is artwork
    that carries no binding. ``_note``, ``generator`` and the filename name the
    plant on purpose - the scope tag IS ``TEMPLATE-10113`` - and a plant number
    in a provenance string is not a live binding; a plant-prefixed driver id
    inside an object is. Same exclusion, same reason, as build-maskin-fixture.py.
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
    if plant_id and plant_id in text:
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
# Measurement report
# --------------------------------------------------------------------------

def inventory(objects):
    """Group objects into controller clusters. Returns an ordered dict.

    Ordering is by first appearance in the array, so the report reads in the
    same order as the document and a diff of two reports lines up.
    """
    clusters = collections.OrderedDict()
    for index, obj in enumerate(objects):
        key, origin = controller_key(obj)
        entry = clusters.setdefault(
            key, {"key": key, "origin": origin, "members": [], "first_index": index})
        entry["members"].append(obj)
    for entry in clusters.values():
        members = entry["members"]
        lefts = [as_int(o["posLeft"]) for o in members]
        tops = [as_int(o["posTop"]) for o in members]
        rights = [as_int(o["posLeft"]) + as_int(o["posWidth"]) for o in members]
        bottoms = [as_int(o["posTop"]) + as_int(o["posHeight"]) for o in members]
        entry["bbox"] = (min(lefts), min(tops), max(rights), max(bottoms))
        entry["roles"] = collections.Counter(
            ROLE_OF_OBJ_ID.get(o["obj_id"], o["obj_id"]) for o in members)
    return clusters


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
        w(f"  {count:3d}  {obj_id:34s} {dims:10s} role={ROLE_OF_OBJ_ID.get(obj_id, '-')}\n")

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
        if field in ("name", "posLeft", "posTop", "driver_id", "unit_id"):
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

    clusters = inventory(objects)
    w(f"\nCONTROLLER INVENTORY - {len(clusters)} clusters, {len(objects)} objects\n")
    origins = collections.Counter(c["origin"] for c in clusters.values())
    w(f"  identity source: {dict(origins)}\n")
    shape = collections.Counter(
        tuple(sorted(c["roles"])) for c in clusters.values())
    for combo, count in shape.most_common():
        w(f"  {count:3d} clusters with roles {list(combo)}\n")

    w("\nCOVERAGE MATRIX\n")
    header = "  " + "controller".ljust(12) + "src".ljust(11)
    header += "".join(role.ljust(9) for role, _ in CLUSTER_ROLES)
    w(header + "bbox\n")
    for entry in clusters.values():
        cells = "".join(
            (str(entry["roles"].get(role, 0)) if entry["roles"].get(role) else "-").ljust(9)
            for role, _ in CLUSTER_ROLES)
        left, top, right, bottom = entry["bbox"]
        w(f"  {str(entry['key']):12s}{entry['origin']:11s}{cells}"
          f"({left},{top})-({right},{bottom}) {right - left}x{bottom - top}\n")

    w("\nCLUSTER ANATOMY - offsets from the cluster bounding box top-left\n")
    offsets = collections.defaultdict(list)
    for entry in clusters.values():
        left, top, _, _ = entry["bbox"]
        for obj in entry["members"]:
            role = ROLE_OF_OBJ_ID.get(obj["obj_id"], obj["obj_id"])
            offsets[role].append((as_int(obj["posLeft"]) - left, as_int(obj["posTop"]) - top))
    for role, _ in CLUSTER_ROLES:
        seen = collections.Counter(offsets.get(role, []))
        if not seen:
            continue
        spread = ", ".join(f"({a},{b}) x{n}" for (a, b), n in seen.most_common())
        w(f"  {role:9s} {spread}\n")
    w("  NOTE: these are the offsets THIS panel used. They are a measurement of\n"
      "  one export, not a construction rule for another store.\n")

    w("\nALIAS VOCABULARY BY ROLE\n")
    for role, obj_id in CLUSTER_ROLES:
        aliases = collections.Counter(
            o["alias_text"] for o in objects if o["obj_id"] == obj_id)
        w(f"  {role:9s} " + "; ".join(f"{a!r} x{n}" for a, n in aliases.most_common()) + "\n")

    w("\nDRIVER ID FAMILIES\n")
    families = collections.Counter()
    for obj in objects:
        parts = (obj.get("driver_id") or "").split("_")
        if len(parts) >= 3:
            families["_".join(parts[1:3])] += 1
    for family, count in families.most_common():
        w(f"  {count:3d}  <plant>_{family}_...\n")

    w("\nANOMALIES\n")
    found = []
    coincident = collections.defaultdict(list)
    for obj in objects:
        coincident[(as_int(obj["posLeft"]), as_int(obj["posTop"]))].append(obj)
    stacked = {pos: objs for pos, objs in coincident.items() if len(objs) > 1}
    for pos, objs in sorted(stacked.items()):
        roles = sorted(ROLE_OF_OBJ_ID.get(o["obj_id"], o["obj_id"]) for o in objs)
        key = controller_key(objs[0])[0]
        found.append(f"coincident at {pos}: {roles} on controller {key}")
    for entry in clusters.values():
        alarm = next((o for o in entry["members"]
                      if ROLE_OF_OBJ_ID.get(o["obj_id"]) == "alarm"), None)
        value = next((o for o in entry["members"]
                      if ROLE_OF_OBJ_ID.get(o["obj_id"]) == "value"), None)
        if alarm and value and as_int(alarm["posTop"]) > as_int(value["posTop"]):
            found.append(f"controller {entry['key']}: alarm sits BELOW the value box "
                         f"(alarm y={as_int(alarm['posTop'])}, "
                         f"value y={as_int(value['posTop'])}) - inverted cluster")
    dupe_driver = [d for d, n in collections.Counter(
        o["driver_id"] for o in objects if o.get("driver_id")).items() if n > 1]
    if dupe_driver:
        found.append(f"duplicate driver_id: {dupe_driver}")
    w(f"  {len(stacked)} coincident coordinate pairs "
      f"({len(stacked)} of them cooling/defrost - deliberate, not an overlap defect)\n"
      if stacked else "")
    for line in found:
        w(f"  {line}\n")
    if not found:
        w("  none\n")


# --------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source", type=pathlib.Path,
                        help="the retained production export (not committed)")
    parser.add_argument("-o", "--output", type=pathlib.Path, default=None,
                        help=f"write the masked fixture here (default {DEFAULT_OUT})")
    parser.add_argument("--report", action="store_true",
                        help="print the measured analysis instead of writing a fixture")
    args = parser.parse_args(argv)

    document = json.loads(args.source.read_text(encoding="utf-8"))

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
    target.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
    objects = fixture["envelope"]["panel"]["single_objects"]
    clusters = inventory(objects)
    print(f"wrote {target} - {len(objects)} objects, {len(clusters)} controller "
          f"clusters, {target.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
