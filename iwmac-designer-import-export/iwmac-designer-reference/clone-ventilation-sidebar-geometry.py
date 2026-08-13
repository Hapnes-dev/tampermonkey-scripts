#!/usr/bin/env python3
"""Copy right-sidebar geometry by semantic role from a sibling Ventilasjon panel.

    python clone-ventilation-sidebar-geometry.py TARGET.json SIBLING.json -o OUT.json

Copies posLeft, posTop, posWidth, posHeight (and zIndex only when --zindex is
set) from the sibling. Preserves the target's driver_id, unit_id, alias_text,
tag_text and system identity. Matching is by visible tag_text, then alias_text,
never by array index.

Designer has no CSS text-align field. Apparent label centring is object
geometry plus the object's own left-aligned rendering.
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

GEOMETRY_FIELDS = ("posLeft", "posTop", "posWidth", "posHeight")


def clone_sidebar(target_doc, sibling_doc, copy_zindex=False, roles=None):
    document = copy.deepcopy(target_doc)
    envelope = validator.envelope_of(document)
    objects = envelope["panel"]["single_objects"]
    sibling_objects = validator.objects_of(validator.envelope_of(sibling_doc))
    sidebar_x = validator.SIDEBAR_DEFAULT_X
    src_by = {}
    for obj in sibling_objects:
        if validator.is_sidebar_object(obj, sidebar_x):
            src_by.setdefault(validator.sidebar_role_key(obj), []).append(obj)
    copied = 0
    missing = []
    ambiguous = []
    for obj in objects:
        if not validator.is_sidebar_object(obj, sidebar_x):
            continue
        key = validator.sidebar_role_key(obj)
        if roles is not None and not (key[0] == "tag" and key[1] in roles):
            continue
        hits = src_by.get(key) or []
        if len(hits) != 1:
            (missing if not hits else ambiguous).append(key)
            continue
        src = hits[0]
        for field in GEOMETRY_FIELDS:
            obj[field] = src[field]
        if copy_zindex:
            obj["zIndex"] = src.get("zIndex")
        copied += 1
    return document, {"copied": copied, "missing": missing, "ambiguous": ambiguous}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("target", type=pathlib.Path)
    parser.add_argument("sibling", type=pathlib.Path)
    parser.add_argument("-o", "--output", type=pathlib.Path, required=True)
    parser.add_argument("--zindex", action="store_true",
                        help="also copy zIndex; off by default")
    parser.add_argument("--roles", default=None,
                        help="comma-separated tag_text roles to copy; default is every sidebar match")
    args = parser.parse_args(argv)

    target = json.loads(args.target.read_text(encoding="utf-8"))
    sibling = json.loads(args.sibling.read_text(encoding="utf-8"))
    roles = [item.strip() for item in args.roles.split(",")] if args.roles else None
    result, report = clone_sidebar(target, sibling, copy_zindex=args.zindex, roles=roles)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print("copied {copied} sidebar object(s)".format(**report))
    if report["missing"]:
        print("unmatched in sibling: %s" % report["missing"])
    if report["ambiguous"]:
        print("ambiguous in sibling: %s" % report["ambiguous"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
