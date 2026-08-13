#!/usr/bin/env python3
"""Idempotent BACnet ualarm migration for a Ventilasjon panel JSON.

    python migrate-ventilation-bacnet-alarms.py PANEL.json -o OUT.json
        [--offset-dx 23 --offset-dy -26]
        [--reference REFERENCE.json]

Adds bacnet_ualarm_v1 next to eligible process objects. Running the same
command twice must not add a second object, must not append .Ualarm twice, and
must not move an already-correct alarm.

Eligibility is the Ventilasjon policy in VENTILATION-AUTHORING-GUIDE.md, not
"every linked object". Sidebar commands, setpoints, selectors, navigation,
labels and empty room placeholders are skipped. A --reference panel, when
given, supplies per-role (dx, dy) from existing ualarm geometry; otherwise the
default offset is the CASE-4743-360008 filter measurement and is labelled as
such in the report.

This helper never invents a driver_id. The ualarm copies the main object's
verified driver_id; host bacCheck appends .Ualarm on save. A userscript export
already carries the suffix — the helper preserves a single suffix and refuses
to write .Ualarm.Ualarm.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def load_validator():
    spec = importlib.util.spec_from_file_location(
        "validate_ventilation_panel", ROOT / "validate-ventilation-panel.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = load_validator()

UALARM_SIZE = (35, 31)
UALARM_Z = "375"
# CASE-4743-360008 filter cluster, screenshot-and-export scoped. Not a global offset.
DEFAULT_OFFSET = (23, -26)

def replacement_targets(objects, sidebar_x):
    """Default conversion: each generic alarm's nearest linked process object.

    Temperatures, airflows, setpoints and sidebar controls are not scanned.
    That over-eager sweep is the case-study failure this helper exists to stop.
    """
    targets = []
    for alarm in objects:
        if not validator.is_generic_alarm(alarm):
            continue
        best = None
        for obj in objects:
            if obj is alarm or validator.is_alarm(obj) or validator.is_label(obj):
                continue
            if validator.is_sidebar_object(obj, sidebar_x):
                continue
            driver = obj.get("driver_id") or ""
            if not driver or driver == "driver_id":
                continue
            base, stripped = validator.ualarm_base(driver)
            if stripped or not base:
                continue
            if validator.looks_like_sidebar_command(obj):
                continue
            distance = validator.rect_distance(alarm, obj)
            if best is None or distance < best[0]:
                best = (distance, obj, alarm)
        if best is not None:
            targets.append(best)
    return targets


def offsets_from_reference(reference_objects):
    """dx, dy from each ualarm to its matching base-driver main object."""
    mains = {}
    for obj in reference_objects:
        if validator.is_bacnet_ualarm(obj):
            continue
        base, _ = validator.ualarm_base(obj.get("driver_id") or "")
        if base:
            mains.setdefault(base, []).append(obj)
    table = {}
    for alarm in reference_objects:
        if not validator.is_bacnet_ualarm(alarm):
            continue
        base, _ = validator.ualarm_base(alarm.get("driver_id") or "")
        candidates = mains.get(base) or []
        if len(candidates) != 1:
            continue
        main = candidates[0]
        table[validator.vent_role_key(main)] = (
            validator.px(alarm, "posLeft") - validator.px(main, "posLeft"),
            validator.px(alarm, "posTop") - validator.px(main, "posTop"),
        )
    return table


def existing_ualarm_bases(objects):
    found = {}
    for obj in objects:
        if not validator.is_bacnet_ualarm(obj):
            continue
        base, _ = validator.ualarm_base(obj.get("driver_id") or "")
        found.setdefault(base, []).append(obj)
    return found


def make_ualarm(main, dx, dy, suffix_in_json):
    base, _ = validator.ualarm_base(main.get("driver_id") or "")
    driver = base + validator.UALARM_SUFFIX if suffix_in_json else base
    return {
        "obj_id": "bacnet_ualarm_v1",
        "name": "object_tmp",
        "id": "driver_id",
        "posWidth": UALARM_SIZE[0],
        "posHeight": UALARM_SIZE[1],
        "posLeft": validator.px(main, "posLeft") + dx,
        "posTop": validator.px(main, "posTop") + dy,
        "zIndex": UALARM_Z,
        "tag_text": "",
        "linked": "true",
        "link_name": "link_name",
        "link_tag": "",
        "sub_group": "",
        "driver_id": driver,
        "unit_id": main.get("unit_id") or "",
        "unit_ref": main.get("unit_ref") or "",
        "alias_text": main.get("alias_text") or "",
    }


def renumber(document):
    envelope = validator.envelope_of(document)
    objects = envelope["panel"]["single_objects"]
    for index, item in enumerate(objects):
        item["name"] = "object_%d" % index
    envelope.setdefault("counts", {})
    envelope["counts"]["single_objects"] = len(objects)
    envelope["counts"].setdefault("containers", 0)
    envelope["counts"].setdefault("graphics", 0)
    return document


def migrate(document, dx=DEFAULT_OFFSET[0], dy=DEFAULT_OFFSET[1],
            reference_doc=None, suffix_in_json=True):
    """Return (document, report). Second call with the same inputs is a no-op."""
    document = copy.deepcopy(document)
    envelope = validator.envelope_of(document)
    objects = envelope["panel"]["single_objects"]
    sidebar_x = validator.SIDEBAR_DEFAULT_X
    offset_table = {}
    if reference_doc is not None:
        offset_table = offsets_from_reference(
            validator.objects_of(validator.envelope_of(reference_doc)))
    present = existing_ualarm_bases(objects)
    added = 0
    skipped = []
    drop_generic = []
    for _distance, obj, generic in replacement_targets(objects, sidebar_x):
        base, _ = validator.ualarm_base(obj.get("driver_id") or "")
        if present.get(base):
            skipped.append(base)
            drop_generic.append(generic)
            continue
        key = validator.vent_role_key(obj)
        off = offset_table.get(key, (dx, dy))
        alarm = make_ualarm(obj, off[0], off[1], suffix_in_json=suffix_in_json)
        objects.append(alarm)
        present.setdefault(base, []).append(alarm)
        drop_generic.append(generic)
        added += 1
    for generic in drop_generic:
        if generic in objects:
            objects.remove(generic)
    renumber(document)
    return document, {"added": added, "already_present": len(skipped),
                      "removed_generic": len(drop_generic)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("panel", type=pathlib.Path)
    parser.add_argument("-o", "--output", type=pathlib.Path, required=True)
    parser.add_argument("--offset-dx", type=int, default=DEFAULT_OFFSET[0])
    parser.add_argument("--offset-dy", type=int, default=DEFAULT_OFFSET[1])
    parser.add_argument("--reference", type=pathlib.Path, default=None,
                        help="production panel whose ualarm offsets are copied by role")
    parser.add_argument("--omit-ualarm-suffix", action="store_true",
                        help="write the base driver_id only. Insert via load_new_ver_objects "
                             "runs checkDriver, so base and one suffix both round-trip. "
                             "Required for container items (that loader skips checkDriver). "
                             "bacCheck concatenates .Ualarm on save if the DOM already has it")
    args = parser.parse_args(argv)

    document = json.loads(args.panel.read_text(encoding="utf-8"))
    reference_doc = None
    if args.reference:
        reference_doc = json.loads(args.reference.read_text(encoding="utf-8"))
    result, report = migrate(
        document, dx=args.offset_dx, dy=args.offset_dy,
        reference_doc=reference_doc, suffix_in_json=not args.omit_ualarm_suffix)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print("added {added} bacnet_ualarm_v1; {already_present} already present; "
          "removed {removed_generic} generic alarm(s)".format(**report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
