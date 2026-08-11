#!/usr/bin/env python3
"""Build the miniature raster fixture for equipment removal and circuit rerouting.

    python build-maskin-removal-fixture.py            # rewrite the fixture
    python build-maskin-removal-fixture.py --check    # exit 1 if it is stale
    python build-maskin-removal-fixture.py --emit-negatives DIR

WHAT THIS FIXTURE IS, AND WHAT IT IS NOT.

It is a 96 x 64 instrumented miniature that carries, in the smallest drawing
that can hold them all, every feature the removal-and-rerouting workflow has to
get right: a receiver vessel next to a removable heat exchanger, a yellow liquid
line with an antialiased three-row profile, a cyan riser whose vertical profile
is NOT its own horizontal profile, an upper horizontal-to-riser junction, a
lower riser-to-header junction, an intentional non-connected crossing carried
over by a bypass, transparent background pixels beside opaque ones, and dark
text pixels one row from the erase target.

It is NOT production geometry. Every coordinate, colour and alpha here is
instrumentation, chosen so a test can assert on an exact pixel. Nothing in it
describes a real machine room, and no number from it may be quoted as a Maskin
fact - the same standing that E13 has in MASKIN-GENERATION-CONTRACT.md.

THE NEGATIVES ARE FUNCTIONS, NOT FILES. Each `defect_*` below applies exactly
one defect to a copy of the good `after` raster, and the tests call them
directly. Committing ten more 110 KB rasters would add nothing a named mutator
does not already give, and would make the single-defect claim unauditable - as
functions, the defect is the diff. `--emit-negatives` writes them out anyway
when a human wants to look at one.

No network access. Reads and writes only inside the reference directory.
"""

from __future__ import annotations

import argparse
import copy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FIXTURES = ROOT / "tests" / "fixtures" / "maskin-equipment-removal"

WIDTH, HEIGHT = 96, 64

BG = [238, 241, 244, 255]
TRANSPARENT = [0, 0, 0, 0]

YELLOW = (235, 196, 45)
CYAN = (40, 190, 220)

# Two profiles per circuit, measured separately, because that is the rule this
# fixture exists to make falsifiable: the cyan header is opaque-opaque-faint
# top-down and the cyan riser is faint-opaque-opaque left-right. A generic
# "2 px" line matches neither.
YELLOW_H = [96, 255, 255]
YELLOW_V = [96, 255, 255]
CYAN_H = [255, 255, 80]
CYAN_V = [80, 255, 255]

OUTLINE = [70, 74, 80, 255]
RECEIVER_FILL = [214, 219, 226, 255]
LEVEL_BAR = [90, 150, 200, 255]
HX_FILL = [150, 154, 160, 255]
TEXT = [24, 26, 30, 255]

RECEIVER = {"name": "receiver vessel", "x": 74, "y": 22, "width": 18, "height": 23,
            "kind": "equipment cluster"}
HEAT_EXCHANGER = {"name": "internal heat exchanger", "x": 40, "y": 38,
                  "width": 14, "height": 10}
LABEL = {"name": "Liq. consumer label", "x": 30, "y": 33, "width": 9, "height": 3,
         "kind": "text"}
SUCTION_HEADER = {"name": "M-T Suct. header", "x": 28, "y": 50, "width": 65,
                  "height": 3, "kind": "pipe"}

TRANSPARENT_PATCHES = [
    {"name": "lower-left blank canvas", "x": 0, "y": 56, "width": 18, "height": 8},
    {"name": "upper-right sidebar blank", "x": 84, "y": 0, "width": 12, "height": 9},
]

EDIT_MASKS = [
    {"name": "internal heat exchanger removal", "x": 40, "y": 38,
     "width": 14, "height": 10},
    {"name": "old liquid drop into the heat exchanger", "x": 46, "y": 28,
     "width": 3, "height": 10},
    {"name": "new liquid route to the receiver, with its bypass", "x": 49,
     "y": 19, "width": 25, "height": 12},
]

CROSSING_OVERLAP = {"x": 59, "y": 19, "width": 3, "height": 3}


# --------------------------------------------------------------------------
# Drawing primitives
# --------------------------------------------------------------------------

def blank():
    return {"width": WIDTH, "height": HEIGHT,
            "pixels": [[list(BG) for _ in range(WIDTH)] for _ in range(HEIGHT)]}


def put(raster, x, y, rgba):
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        raster["pixels"][y][x] = list(rgba)


def fill(raster, box, rgba):
    for y in range(box["y"], box["y"] + box["height"]):
        for x in range(box["x"], box["x"] + box["width"]):
            put(raster, x, y, rgba)


def run(raster, rgb, profile, start, orientation, length, blend=True):
    """Draw one pipe run with its measured per-row (or per-column) alpha.

    `blend` keeps the higher alpha where two runs of the same circuit meet, so a
    corner between an antialiasing row and an opaque row comes out solid rather
    than faint - which is what the source does at its own corners, and what
    makes the difference between a bend and a hairline break.
    """
    x0, y0 = start
    for offset, alpha in enumerate(profile):
        for step in range(length):
            x = x0 + (step if orientation == "horizontal" else offset)
            y = y0 + (offset if orientation == "horizontal" else step)
            existing = raster["pixels"][y][x] if 0 <= x < WIDTH and 0 <= y < HEIGHT else None
            if (blend and existing is not None
                    and tuple(existing[:3]) == tuple(rgb) and existing[3] >= alpha):
                continue
            put(raster, x, y, list(rgb) + [alpha])


def draw_receiver(raster):
    """One vessel, drawn as a dozen strokes and protected as one component."""
    fill(raster, RECEIVER, OUTLINE)
    fill(raster, {"x": RECEIVER["x"] + 1, "y": RECEIVER["y"] + 1,
                  "width": RECEIVER["width"] - 2, "height": RECEIVER["height"] - 2},
         RECEIVER_FILL)
    for corner in ((RECEIVER["x"], RECEIVER["y"]),
                   (RECEIVER["x"] + RECEIVER["width"] - 1, RECEIVER["y"]),
                   (RECEIVER["x"], RECEIVER["y"] + RECEIVER["height"] - 1),
                   (RECEIVER["x"] + RECEIVER["width"] - 1,
                    RECEIVER["y"] + RECEIVER["height"] - 1)):
        put(raster, corner[0], corner[1], BG)
    for x in range(RECEIVER["x"] + 2, RECEIVER["x"] + RECEIVER["width"] - 2):
        put(raster, x, 36, OUTLINE)
    fill(raster, {"x": 87, "y": 26, "width": 2, "height": 8}, LEVEL_BAR)


def draw_heat_exchanger(raster):
    fill(raster, HEAT_EXCHANGER, OUTLINE)
    fill(raster, {"x": HEAT_EXCHANGER["x"] + 1, "y": HEAT_EXCHANGER["y"] + 1,
                  "width": HEAT_EXCHANGER["width"] - 2,
                  "height": HEAT_EXCHANGER["height"] - 2}, HX_FILL)
    for y in range(HEAT_EXCHANGER["y"] + 2, HEAT_EXCHANGER["y"] + 8, 2):
        for x in range(HEAT_EXCHANGER["x"] + 2,
                       HEAT_EXCHANGER["x"] + HEAT_EXCHANGER["width"] - 2):
            put(raster, x, y, OUTLINE)


def draw_label(raster):
    for index, x in enumerate(range(LABEL["x"], LABEL["x"] + LABEL["width"])):
        for y in range(LABEL["y"], LABEL["y"] + LABEL["height"]):
            if index % 3 != 2 or y != LABEL["y"] + 1:
                put(raster, x, y, TEXT)


def draw_common(raster):
    """Everything both images share: the suction circuit, the vessel, the text."""
    run(raster, CYAN, CYAN_H, (18, 10), "horizontal", 44)
    run(raster, CYAN, CYAN_V, (59, 10), "vertical", 42)
    run(raster, CYAN, CYAN_H, (28, 50), "horizontal", 65)
    draw_receiver(raster)
    draw_label(raster)


def build_before():
    raster = blank()
    for patch in TRANSPARENT_PATCHES:
        fill(raster, patch, TRANSPARENT)
    draw_common(raster)
    draw_heat_exchanger(raster)
    # The liquid line stops at the heat exchanger: left run, then the drop.
    run(raster, YELLOW, YELLOW_H, (8, 28), "horizontal", 41)
    run(raster, YELLOW, YELLOW_V, (46, 28), "vertical", 10)
    return raster


def build_after():
    raster = blank()
    draw_common(raster)
    # The liquid line now reaches the receiver directly, and the bypass carries
    # it over the suction riser. Cyan is drawn first: the yellow crosses on top
    # inside CROSSING_OVERLAP and nowhere else.
    run(raster, YELLOW, YELLOW_H, (8, 28), "horizontal", 50)
    run(raster, YELLOW, YELLOW_V, (55, 19), "vertical", 12)
    run(raster, YELLOW, YELLOW_H, (55, 19), "horizontal", 12)
    run(raster, YELLOW, YELLOW_V, (64, 19), "vertical", 12)
    run(raster, YELLOW, YELLOW_H, (64, 28), "horizontal", 10)
    return raster


# --------------------------------------------------------------------------
# The circuit-routing inventory and junction ledger, as data
# --------------------------------------------------------------------------

def profile_rows(alphas, orientation):
    key = "dy" if orientation == "horizontal" else "dx"
    return [{key: index, "alpha": alpha} for index, alpha in enumerate(alphas)]


def build_expectations():
    return {
        "_note": (
            "Instrumented 96x64 miniature for the equipment-removal and "
            "circuit-rerouting workflow. Every value is test instrumentation, "
            "not Maskin geometry: no coordinate, colour, alpha or thickness "
            "here describes a real machine room, and none may be quoted as a "
            "default. Generated by build-maskin-removal-fixture.py; do not "
            "hand-edit. Rules: MASKIN-GENERATION-CONTRACT.md section 17."),
        "canvas": {"width": WIDTH, "height": HEIGHT},
        "background": {
            "requested_rgba": BG,
            "transparent_rgba": TRANSPARENT,
            "dark_artwork_max_channel": 96,
            "sample_points": [[2, 2], [46, 4], [92, 16], [4, 60], [46, 62],
                              [90, 62], [8, 58], [90, 4]],
            "note": ("The last two sample points sit inside the areas that were "
                     "transparent before the edit. Transparency is not a "
                     "colour: it shows whatever the host puts behind it, which "
                     "is how a panel asked for light arrives black."),
        },
        "artwork_colours": [
            {"name": "equipment outline", "rgba": OUTLINE},
            {"name": "receiver fill", "rgba": RECEIVER_FILL},
            {"name": "receiver level bar", "rgba": LEVEL_BAR},
            {"name": "heat-exchanger fill", "rgba": HX_FILL},
            {"name": "static label glyphs", "rgba": TEXT},
        ],
        "protected_regions": [RECEIVER, LABEL, SUCTION_HEADER],
        "removed_component": HEAT_EXCHANGER,
        "edit_masks": EDIT_MASKS,
        "background_conversion": {
            "applies": True,
            "from_rgba": TRANSPARENT,
            "to_rgba": BG,
            "regions": TRANSPARENT_PATCHES,
            "note": ("Reported as its own diff scope. Flattening the canvas and "
                     "removing the heat exchanger are two operations; one number "
                     "covering both hides whichever is smaller."),
        },
        "circuits": {
            "liquid yellow": {
                "role": "receiver / liquid line to the consumers",
                "rgb": list(YELLOW),
                "horizontal_profile": profile_rows(YELLOW_H, "horizontal"),
                "vertical_profile": profile_rows(YELLOW_V, "vertical"),
                "start_anchor": {"point": [8, 29], "what": "left canvas edge"},
                "end_anchor": {"point": [73, 29],
                               "what": "receiver vessel left wall (termination)"},
                "bends": [[55, 28], [66, 21], [66, 28]],
                "bridged_by": [],
                "samples": [
                    {"name": "horizontal run", "orientation": "horizontal",
                     "reference_start": [12, 28], "repaired_start": [67, 28],
                     "length": 7},
                    {"name": "bypass leg", "orientation": "vertical",
                     "reference_start": [55, 22], "repaired_start": [64, 22],
                     "length": 6},
                ],
            },
            "mt suction cyan": {
                "role": "MT suction",
                "rgb": list(CYAN),
                "horizontal_profile": profile_rows(CYAN_H, "horizontal"),
                "vertical_profile": profile_rows(CYAN_V, "vertical"),
                "start_anchor": {"point": [20, 10], "what": "upper suction segment"},
                "end_anchor": {"point": [88, 50], "what": "M-T Suct. header exit"},
                "bends": [[59, 10], [59, 50]],
                "bridged_by": [CROSSING_OVERLAP],
                "samples": [
                    {"name": "header", "orientation": "horizontal",
                     "reference_start": [30, 50], "repaired_start": [80, 50],
                     "length": 10},
                    {"name": "riser", "orientation": "vertical",
                     "reference_start": [59, 24], "repaired_start": [59, 40],
                     "length": 8},
                ],
            },
        },
        "junctions": [
            {"name": "upper suction segment to riser",
             "circuit": "mt suction cyan", "kind": "junction",
             "endpoint_a": [20, 10], "endpoint_b": [60, 30],
             "overlap": {"x": 59, "y": 10, "width": 3, "height": 3}},
            {"name": "riser to M-T Suct. header",
             "circuit": "mt suction cyan", "kind": "junction",
             "endpoint_a": [60, 40], "endpoint_b": [88, 50],
             "overlap": {"x": 59, "y": 50, "width": 3, "height": 3}},
        ],
        "crossings": [
            {"name": "liquid line over the MT suction riser",
             "over": "liquid yellow", "under": "mt suction cyan",
             "connected": False,
             "bypass": {"x": 55, "y": 19, "width": 12, "height": 9},
             "straight_through_window": {"x": 58, "y": 27, "width": 6, "height": 4},
             "overlap": CROSSING_OVERLAP,
             "approach_a": [12, 29], "approach_b": [72, 29],
             "note": ("The bypass is the reader's only evidence that these two "
                      "circuits do not connect. Its legs, span and returning "
                      "segment carry the liquid line's own measured profile.")},
        ],
        "connectivity": {
            "same_component": [
                {"circuit": "mt suction cyan",
                 "anchors": [[20, 10], [60, 30], [88, 50]]},
                {"circuit": "liquid yellow",
                 "anchors": [[12, 29], [56, 24], [72, 29]]},
            ],
        },
        "visual_qa": {
            "zoom_factor": 8,
            "crops": [
                {"name": "receiver", "x": 68, "y": 18, "width": 28, "height": 30},
                {"name": "removed heat exchanger", "x": 34, "y": 32,
                 "width": 26, "height": 22},
                {"name": "crossing - liquid over suction riser", "x": 50, "y": 15,
                 "width": 22, "height": 20},
                {"name": "junction - upper suction to riser", "x": 52, "y": 5,
                 "width": 16, "height": 14},
                {"name": "junction - riser to M-T Suct. header", "x": 52,
                 "y": 44, "width": 16, "height": 14},
            ],
        },
    }


# --------------------------------------------------------------------------
# Panel documents - the JSON half of the same edit
# --------------------------------------------------------------------------

OBJECTS = [
    ("V3_akpc_782A_suct", 9, 3, 18, 4, "360", "Control status MT"),
    ("number_v3_white_value_only", 6, 3, 76, 24, "1100", "Prec reference"),
    ("number_v3_value_only", 6, 3, 76, 28, "1100", "Prec"),
    ("number_v3_value_only", 6, 3, 76, 38, "1100", "Vrec OD"),
    ("number_v3_value_only", 6, 3, 30, 4, "1100", "Sd-MT"),
]


def panel_document(image_data, objects=True):
    single = []
    for index, (obj_id, w, h, left, top, z, alias) in enumerate(OBJECTS if objects else []):
        single.append({
            "obj_id": obj_id, "name": f"object_{index}", "id": "driver_id",
            "posWidth": w, "posHeight": h, "posLeft": left, "posTop": top,
            "zIndex": z, "tag_text": "", "linked": "false", "link_name": "",
            "link_tag": "", "sub_group": "", "driver_id": "driver_id",
            "unit_id": "", "unit_ref": "", "alias_text": alias,
        })
    return {
        "format": "iwmac-designer-panel",
        "version": 1,
        "generator": "masked-regression-fixture",
        "source_plant_id": "",
        "panel_name": "Maskin masked removal fixture",
        "counts": {"single_objects": len(single), "containers": 0, "graphics": 0},
        "background_embedded": True,
        "panel": {
            "plant_id": "",
            "panel_name": "Maskin masked removal fixture",
            "panel_width": f"{WIDTH}px",
            "panel_height": f"{HEIGHT}px",
            "org_image_name": "masked-maskin.png",
            "image_name": "",
            "saved_by": "",
            "converted": "true",
            "image_data": image_data,
            "single_objects": single,
            "containers": [],
            "graphics": [],
        },
    }


# --------------------------------------------------------------------------
# The negatives - exactly one defect each
# --------------------------------------------------------------------------

def defect_receiver_clipped(raster):
    """An erase rectangle sized for the equipment took the vessel's corner."""
    fill(raster, {"x": 74, "y": 40, "width": 4, "height": 5}, BG)
    return raster


def defect_transparent_rendered_black(raster):
    """Cleanup used opaque black where the request asked for the light canvas."""
    for patch in TRANSPARENT_PATCHES:
        fill(raster, patch, [0, 0, 0, 255])
    return raster


def defect_dark_residue_on_pipe(raster):
    """Erase-and-redraw left opaque cleanup pixels sitting on the bypass span."""
    put(raster, 58, 20, [30, 32, 36, 255])
    put(raster, 58, 21, [30, 32, 36, 255])
    return raster


def defect_inconsistent_cross_section(raster):
    """The repaired run came back as two opaque rows: the faint row was dropped."""
    for x in range(66, 74):
        put(raster, x, 28, BG)
    return raster


def defect_missing_bypass(raster):
    """The new route was drawn straight through the riser it crosses."""
    for y in range(19, 31):
        for x in range(55, 67):
            put(raster, x, y, BG)
    run(raster, CYAN, CYAN_V, (59, 10), "vertical", 42)
    run(raster, YELLOW, YELLOW_H, (8, 28), "horizontal", 66)
    return raster


def defect_bypass_thickness(raster):
    """The bypass leg was redrawn at a guessed width, without its faint column."""
    for y in range(22, 28):
        put(raster, 64, y, BG)
    return raster


def defect_upper_junction_gap(raster):
    """A cleared corridor left the horizontal one column short of the riser."""
    for y in range(10, 13):
        put(raster, 58, y, BG)
    return raster


def defect_lower_junction_gap(raster):
    """The riser stops one row short of the header it is supposed to join."""
    for x in range(59, 62):
        put(raster, x, 49, BG)
    return raster


def defect_only_antialiasing_touches(raster):
    """The faint column still reaches the header; the opaque centreline does not."""
    put(raster, 60, 49, BG)
    put(raster, 61, 49, BG)
    return raster


def defect_unrelated_artwork_changed(raster):
    """A pixel of the untouched upper suction segment moved with the edit."""
    put(raster, 24, 11, BG)
    return raster


NEGATIVES = {
    "receiver-clipped-by-erase-mask": defect_receiver_clipped,
    "transparent-background-rendered-black": defect_transparent_rendered_black,
    "dark-residue-on-liquid-line": defect_dark_residue_on_pipe,
    "inconsistent-pipe-cross-section": defect_inconsistent_cross_section,
    "missing-bypass-at-crossing": defect_missing_bypass,
    "bypass-with-inconsistent-thickness": defect_bypass_thickness,
    "upper-junction-gap": defect_upper_junction_gap,
    "lower-junction-gap": defect_lower_junction_gap,
    "only-antialiasing-touches": defect_only_antialiasing_touches,
    "unrelated-artwork-changed": defect_unrelated_artwork_changed,
}


def negative(name):
    raster = build_after()
    return NEGATIVES[name](raster)


# --------------------------------------------------------------------------

def artefacts():
    return {
        "raster-before.json": build_before(),
        "raster-after.json": build_after(),
        "expectations.json": build_expectations(),
        "source-panel.json": panel_document("fixture:raster-before.json"),
        "artwork-only-full-panel.json": panel_document("fixture:raster-after.json"),
        "background-only-patch.json": panel_document("fixture:raster-after.json",
                                                     objects=False),
    }


def serialise(value):
    """One raster row per line, so a defect diffs as the rows it touched.

    A pixel-per-line dump of a 96 x 64 image is 6 144 hunks and unreviewable;
    a single-line dump is one. A row is the unit a human reads a raster in.
    """
    if isinstance(value, dict) and "pixels" in value:
        rows = ",\n  ".join(json.dumps(row, ensure_ascii=False)
                            for row in value["pixels"])
        head = {key: item for key, item in value.items() if key != "pixels"}
        prefix = "".join(f' "{key}": {json.dumps(item)},\n'
                         for key, item in head.items())
        return "{\n" + prefix + ' "pixels": [\n  ' + rows + "\n ]\n}\n"
    return json.dumps(value, ensure_ascii=False, indent=1) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if any committed artefact is out of date")
    parser.add_argument("--emit-negatives", type=pathlib.Path, default=None,
                        help="write the single-defect rasters to a directory "
                             "for inspection; they are NOT committed")
    args = parser.parse_args(argv)

    if args.emit_negatives:
        args.emit_negatives.mkdir(parents=True, exist_ok=True)
        for name in NEGATIVES:
            path = args.emit_negatives / f"{name}.json"
            path.write_text(serialise(negative(name)), encoding="utf-8")
        print(f"wrote {len(NEGATIVES)} single-defect rasters to {args.emit_negatives}")
        return 0

    FIXTURES.mkdir(parents=True, exist_ok=True)
    stale = []
    for name, value in artefacts().items():
        path = FIXTURES / name
        updated = serialise(value)
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if args.check:
            if updated != current:
                stale.append(name)
            continue
        path.write_text(updated, encoding="utf-8")

    if args.check:
        if stale:
            print("stale fixture(s): " + ", ".join(stale)
                  + "; run build-maskin-removal-fixture.py", file=sys.stderr)
            return 1
        print(f"{len(artefacts())} equipment-removal fixture artefacts are up to date")
        return 0

    print(f"wrote {len(artefacts())} artefacts to {FIXTURES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
