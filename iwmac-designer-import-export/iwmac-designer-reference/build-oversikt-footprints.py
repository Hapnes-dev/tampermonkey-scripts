#!/usr/bin/env python3
"""Build an `iwmac-oversikt-footprints` sidecar for validate-oversikt-panel.py.

    python build-oversikt-footprints.py PANEL.json
    python build-oversikt-footprints.py PANEL.json -o footprints.json
    python build-oversikt-footprints.py PANEL.json --only 000:067 --only 000:011
    python build-oversikt-footprints.py PANEL.json --synthetic --margin 24

WHY THIS FILE EXISTS
--------------------
A panel JSON says where every object is. It does not say where the refrigeration
box, cabinet, display case or cold room is - that lives in the artwork, and the
only machine-readable form of the artwork a panel carries is an opaque base64
PNG. So "is the temperature bubble in the centre of the box?" is not a question
a structural validator can answer from a panel alone, and O-G08 refuses to
pretend otherwise. It answers it only against footprints somebody measured.

This script produces the file those measurements go in. It cannot measure
anything: it emits the half of the record the panel does prove - the controller
list, each value object's real size, the canvas, and the natural resolution of
the embedded background read out of the PNG header - and leaves the footprint
zeroed for a human or an assistant that can see the image.

    A TEMPLATE THAT HAS NOT BEEN FILLED IN DOES NOT VALIDATE. Every record
    starts 0x0, and O-G09 rejects a zero-width footprint because it has no
    centre. That is the intended behaviour. An unmeasured template must fail
    loudly rather than quietly report that nothing is wrong.

--synthetic: TEST INSTRUMENTATION, NOT GEOMETRY
----------------------------------------------
--synthetic back-derives each footprint by expanding the value object around its
own centre by --margin pixels. The result passes O-G08 by construction, which is
exactly what a test of the centering checker needs and exactly what makes it
worthless as evidence: it was derived FROM the placement it claims to verify. It
proves the arithmetic, never the panel. The output is stamped `"synthetic":
true` and carries `source: "synthetic-back-derived"` so it can never be mistaken
for a measurement, and O-G09 records with that source should never be quoted in
a QA report. Do not commit one next to a real panel.

MEASURING FOR REAL
------------------
Open the background at its native size, put a rectangle around the visible
physical equipment - the blue box, the case outline, the room - and record its
left/top/width/height in THAT image's pixels, with the resolution it was
measured at. Not the label, not the regulator name, not the cluster bounding
box, not the empty floor beside it. If a controller serves a combined A/B case
and the evidence shows one footprint, record the UNION as one record; if the
evidence does not show it, leave the controller out. A controller with no record
is reported by O-G09 as an evidence gap, which is the honest outcome - it is
never reported as a pass.

See OVERSIKT-GENERATION-CONTRACT.md value_centering, and stage C of
OVERSIKT-QA-CHECKLIST.md for the visual check this file supplements rather than
replaces.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import pathlib
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FOOTPRINT_FORMAT = "iwmac-oversikt-footprints"
FOOTPRINT_VERSION = 1
DEFAULT_MARGIN = 24


def _load_fixture_builder():
    spec = importlib.util.spec_from_file_location(
        "build_oversikt_fixture", ROOT / "build-oversikt-fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURE_BUILDER = _load_fixture_builder()
ROLE_OF_OBJ_ID = FIXTURE_BUILDER.ROLE_OF_OBJ_ID
as_int = FIXTURE_BUILDER.as_int
envelope_of = FIXTURE_BUILDER.envelope_of
inventory = FIXTURE_BUILDER.inventory


def half_up(value):
    """Round .5 away from zero. Mirrors validate-oversikt-panel.half_up().

    Kept in both files on purpose: the validator must not import a generator to
    do its arithmetic, and a template whose expected_value_position disagreed
    with the checker by one pixel would look like a measurement error.
    """
    return int(value + 0.5) if value >= 0 else -int(-value + 0.5)


def png_size(data_uri):
    """Natural pixel size of an embedded PNG, straight out of its IHDR chunk.

    The one thing about the background a panel genuinely proves. Returns None
    for an SVG background, a JPEG, a truncated payload, or no background at all
    - in which case the resolution has to be stated by whoever measured, and
    O-G10 will insist on it.
    """
    if not isinstance(data_uri, str) or not data_uri:
        return None
    payload = data_uri.split(",", 1)[1] if "," in data_uri else data_uri
    try:
        raw = base64.b64decode(payload)
    except Exception:
        return None
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", raw[16:24])
    return [int(width), int(height)]


def canvas_of(envelope):
    panel = envelope.get("panel") or {}
    return [as_int(panel.get("panel_width")), as_int(panel.get("panel_height"))]


def value_object(entry):
    for obj in entry.get("members", []):
        if ROLE_OF_OBJ_ID.get(obj.get("obj_id")) == "value":
            return obj
    return None


def controllers(document):
    """Every identified cluster in panel order, with its value object.

    A cluster whose controller could not be identified is skipped - a footprint
    keyed on nothing cannot be matched back to anything - and so is one with no
    value object, because there is then nothing to centre.
    """
    envelope = envelope_of(document)
    clusters = inventory(envelope["panel"]["single_objects"])
    found = []
    for entry in clusters.values():
        if entry["key"] is None:
            continue
        value = value_object(entry)
        if value is None:
            continue
        found.append((str(entry["key"]), value, entry))
    return envelope, found


def build(document, synthetic=False, margin=DEFAULT_MARGIN, only=None,
          production_proven=False, measured_by=""):
    envelope, found = controllers(document)
    panel = envelope.get("panel") or {}
    canvas = canvas_of(envelope)
    image_size = png_size(panel.get("image_data"))
    wanted = {str(unit) for unit in (only or [])}

    if synthetic:
        # Canvas space, so scale_x and scale_y are exactly 1 and the footprint
        # round-trips without rounding. Synthetic geometry has no other frame.
        image_size = list(canvas)

    records = []
    for unit, value, _entry in found:
        if wanted and unit not in wanted:
            continue
        size = [as_int(value.get("posWidth")), as_int(value.get("posHeight"))]
        record = {
            "unit_id": unit,
            "footprint": {"left": 0, "top": 0, "width": 0, "height": 0},
            "value_object_size": size,
            "evidence_note": "",
        }
        if synthetic:
            left, top = as_int(value.get("posLeft")), as_int(value.get("posTop"))
            record["footprint"] = {
                "left": left - margin,
                "top": top - margin,
                "width": size[0] + 2 * margin,
                "height": size[1] + 2 * margin,
            }
            record["expected_value_position"] = {"left": left, "top": top}
            record["evidence_note"] = (
                f"SYNTHETIC: the value object expanded by {margin}px around its own "
                f"centre. Derived from the placement it appears to verify - it "
                f"proves the checker's arithmetic, never this panel")
        if production_proven:
            record["production_proven"] = True
        records.append(record)

    missing = sorted(wanted - {record["unit_id"] for record in records})
    if missing:
        raise SystemExit(f"no identified cluster with a value object for: "
                         f"{', '.join(missing)}")

    document_out = {
        "format": FOOTPRINT_FORMAT,
        "version": FOOTPRINT_VERSION,
        "panel": panel.get("panel_name") or envelope.get("panel_name") or "",
        "panel_size": canvas,
        "source": "synthetic-back-derived" if synthetic else "background-image",
        "source_image_size": image_size,
        "measured_by": measured_by,
        "_note": _header_note(synthetic, image_size, canvas, margin),
    }
    if synthetic:
        document_out["synthetic"] = True
    if production_proven:
        document_out["_production_proven"] = (
            "Every record is stamped production_proven: this file RECORDS the "
            "geometry of a supplied production export, it does not propose a "
            "correction to it. O-G08 downgrades every verdict to info.")
    document_out["records"] = records
    return document_out


def _header_note(synthetic, image_size, canvas, margin):
    if synthetic:
        return (f"SYNTHETIC TEST INSTRUMENTATION - NOT A MEASUREMENT. Each footprint "
                f"is the value object expanded by {margin}px around its own centre, in "
                f"canvas space, so O-G08 passes by construction. Never quote this file "
                f"as evidence and never commit it beside a real panel.")
    note = ("Measure each footprint on the background at its native size: the visible "
            "physical box, cabinet, case or room - never the text label, the regulator "
            "name, the cluster bounding box or the floor beside it. Coordinates are in "
            "source_image_size pixels; the validator scales them onto panel_size. Leave "
            "a controller out rather than guessing - an omission is reported as an "
            "evidence gap, a guess is reported as a pass.")
    if image_size is None:
        return note + (" source_image_size could NOT be read from this panel (no "
                       "embedded PNG) - state the resolution you measured at before "
                       "this file means anything.")
    if image_size != canvas:
        return note + (f" source_image_size {image_size[0]}x{image_size[1]} was read "
                       f"from the embedded PNG header and differs from the "
                       f"{canvas[0]}x{canvas[1]} canvas: the background is displayed "
                       f"scaled, so measure on the image, not on a screenshot of the "
                       f"canvas.")
    return note + (f" source_image_size {image_size[0]}x{image_size[1]} was read from "
                   f"the embedded PNG header and matches the canvas, so the scale is "
                   f"1:1 - but only if you measure on the image itself.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n")[0],
        epilog="A template that has not been filled in does not validate, on purpose.")
    parser.add_argument("panel", type=pathlib.Path, help="the panel JSON to describe")
    parser.add_argument("-o", "--output", type=pathlib.Path,
                        help="write here instead of stdout")
    parser.add_argument("--only", action="append", metavar="UNIT_ID",
                        help="emit one controller; repeatable")
    parser.add_argument("--synthetic", action="store_true",
                        help="back-derive footprints from the value objects "
                             "(test instrumentation - never evidence)")
    parser.add_argument("--margin", type=int, default=DEFAULT_MARGIN,
                        help=f"--synthetic expansion in px (default {DEFAULT_MARGIN})")
    parser.add_argument("--production-proven", action="store_true",
                        help="stamp every record production_proven: record a supplied "
                             "production export's geometry without proposing to change it")
    parser.add_argument("--measured-by", default="",
                        help="who measured, and how - goes in the header")
    args = parser.parse_args(argv)

    if args.margin < 0:
        parser.error("--margin cannot be negative")
    if args.synthetic and args.production_proven:
        parser.error("--synthetic geometry is derived from the panel, so it cannot also "
                     "be production_proven. Pick one.")

    document = json.loads(args.panel.read_text(encoding="utf-8"))
    built = build(document, synthetic=args.synthetic, margin=args.margin,
                  only=args.only, production_proven=args.production_proven,
                  measured_by=args.measured_by)
    text = json.dumps(built, ensure_ascii=False, indent=2) + "\n"

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
        kind = "synthetic" if args.synthetic else "template"
        print(f"{args.output} - {len(built['records'])} {kind} record(s)",
              file=sys.stderr)
        if not args.synthetic:
            print("Every footprint is 0x0 until measured, and O-G09 rejects a 0x0 box.",
                  file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
