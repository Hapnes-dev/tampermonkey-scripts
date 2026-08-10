#!/usr/bin/env python3
"""Build the nine Romkontroll negative fixtures from the committed E19 fixture.

    python build-romkontroll-negatives.py --list
    python build-romkontroll-negatives.py -o survey-tmp/romkontroll-negative
    python build-romkontroll-negatives.py --only placeholder-overview

Each negative breaks ONE rule of ROMKONTROLL-GENERATION-CONTRACT.md, so a
validator finding can be attributed to one cause. Two of them are the
2026-08-10 rejections rebuilt from the fixture; the other seven are the
mistakes that rejection made plausible.

    dataset-not-a-panel      a custom dataset with correct room analysis and no
                             envelope at all. Contract section 13.1, the v1
                             failure.
    placeholder-overview     a correct envelope around 59 labels and headings,
                             every binding withheld, no container. Contract
                             section 13.2, the v2 failure.
    container-dropped        the full 1553 objects with the table container
                             deleted - the grid the objects sit in, gone.
    non-custom-unique-id     unique_id without "custom_", so the container
                             silently vanishes on Insert and nothing says so.
    text-sorted-rooms        a 1000-series room sorted as text, landing above
                             the 200-series.
    column-dropped           one signal column removed from the grid while
                             num_of_col still claims 34.
    compressed-to-viewport   the canvas objects rescaled to fit 1400x750,
                             leaving every one of them outside its own cell.
    half-linked              100 objects placeholdered inside an otherwise
                             linked panel - neither a template nor a panel.
    constructed-driver-ids   identifiers built by concatenating plausible
                             parts instead of copied from the dump. Only
                             --source-sql can see this one.

WHY THESE ARE GENERATED AND NOT COMMITTED
-----------------------------------------
The fixture is 1.2 MB. Nine near-identical copies would add ten megabytes to
the repository to express nine small differences, and base64 backgrounds do not
delta-compress. The mutation is the artifact worth versioning, so the mutation
is what is committed - the same reasoning as build-oversikt-negatives.py.

tests/test_romkontroll_8653_contract.py imports this module and builds the
documents in memory. The CLI writes them to disk when a human or an assistant
wants to run the validator against a file by hand; the default output directory
is survey-tmp/, which .gitignore already excludes.

constructed-driver-ids contains identifiers that name parameters no controller
exposes. That is the defect being modelled, on purpose. Do not copy an object
out of that document into anything real.
"""

from __future__ import annotations

import argparse
import collections
import copy
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FIXTURE_PATH = ROOT / "reference_data" / "romkontroll-8653-sanitized.json"
DEFAULT_OUT = ROOT / "survey-tmp" / "romkontroll-negative"

CANVAS = (1400, 750)


def _load_fixture_builder():
    spec = importlib.util.spec_from_file_location(
        "build_romkontroll_fixture", ROOT / "build-romkontroll-fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_BF = None


def bf():
    global _BF
    if _BF is None:
        _BF = _load_fixture_builder()
    return _BF


_FIXTURE = None


def fixture():
    """The committed E19 envelope, deep-copied per call so mutations cannot leak."""
    global _FIXTURE
    if _FIXTURE is None:
        document = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        _FIXTURE = bf().envelope_of(document)
    return copy.deepcopy(_FIXTURE)


def recount(envelope):
    """counts must always describe the arrays, or R-S6 masks the real defect."""
    panel = envelope["panel"]
    envelope["counts"] = {
        "single_objects": len(panel["single_objects"]),
        "containers": len(panel["containers"]),
        "graphics": len(panel["graphics"]),
    }
    return envelope


def geometry(envelope):
    return bf().table_geometry(envelope)


def rooms_by_floor(envelope):
    labels = bf().room_labels(geometry(envelope))
    grouped = collections.defaultdict(list)
    for index in sorted(labels):
        room = str(labels[index]).strip()
        grouped[room[0]].append(room)
    return grouped


# --------------------------------------------------------------------------
# the two rejected generations, rebuilt from the fixture
# --------------------------------------------------------------------------


def dataset_not_a_panel():
    """A custom dataset: correct room analysis, not a panel document."""
    envelope = fixture()
    grouped = rooms_by_floor(envelope)
    controllers = []
    for floor in sorted(grouped):
        for room in grouped[floor]:
            controllers.append({
                "romnummer": room,
                "plan": int(floor),
                "type": "Hotellrom",
            })
    return {
        "schema_version": "1.0",
        "kilde": "iw_gen_driver_parameters",
        "utvalg": "alle romkontrollere",
        "plan_tolkning": "forste siffer i romnummeret er etasjen",
        "antall_romkontrollere": len(controllers),
        "planoversikt": [
            {"plan": int(floor), "antall": len(grouped[floor])} for floor in sorted(grouped)
        ],
        "romkontrollere": controllers,
    }


def placeholder_overview():
    """A correct envelope around headings and labels, every binding withheld."""
    envelope = fixture()
    grid = geometry(envelope)
    labels = bf().room_labels(grid)
    captions = [c["title"] for c in grid["columns"][:9]]

    objects = []

    def add(obj_id, tag_text, width, height, left, top):
        objects.append({
            "obj_id": obj_id,
            "name": f"object_{len(objects)}",
            "id": "driver_id",
            "posWidth": width,
            "posHeight": height,
            "posLeft": left,
            "posTop": top,
            "zIndex": "default",
            "tag_text": tag_text,
            "linked": "false",
            "link_name": "",
            "link_tag": "",
            "sub_group": "",
            "driver_id": "driver_id",
            "unit_id": "",
            "unit_ref": "",
            "alias_text": tag_text,
        })

    for column, caption in enumerate(captions):
        add("number_v3_header_grey75", caption, 100, 25, 20 + column * 150, 20)
    for row, index in enumerate(sorted(labels)):
        add("number_v3_label_11px_norm", str(labels[index]), 50, 15, 20, 60 + row * 13)

    panel = envelope["panel"]
    panel["single_objects"] = objects
    panel["containers"] = []
    panel["graphics"] = []
    panel["plant_id"] = ""
    panel["saved_by"] = "copilot"
    panel["converted"] = "false"
    panel.pop("image_data", None)
    envelope["source_plant_id"] = ""
    envelope["generator"] = "M365 Copilot"
    envelope["background_embedded"] = False
    return recount(envelope)


# --------------------------------------------------------------------------
# one rule each
# --------------------------------------------------------------------------


def container_dropped():
    """The 1553 objects kept, the table container deleted."""
    envelope = fixture()
    envelope["panel"]["containers"] = []
    return recount(envelope)


def non_custom_unique_id():
    """unique_id without "custom_" - the container vanishes on Insert, silently."""
    envelope = fixture()
    envelope["panel"]["containers"][0]["unique_id"] = "template_0"
    return envelope


def text_sorted_rooms():
    """A 1000-series room sorted as text, so it lands above the 200-series."""
    envelope = fixture()
    grid = geometry(envelope)
    first_row = grid["rows"][0]
    label_column = grid["columns"][0]
    cell = grid["cells"][(label_column["rel_left"], first_row["rel_top"])]
    cell["tag_text"] = "1002"
    return envelope


def column_dropped():
    """One signal column removed while num_of_col still claims 34."""
    envelope = fixture()
    grid = geometry(envelope)
    container = envelope["panel"]["containers"][0]
    victim = grid["columns"][-1]
    container["items"] = [
        item for item in container["items"]
        if bf().as_int(item.get("posLeft")) != victim["rel_left"]
    ]
    keep = []
    for obj in envelope["panel"]["single_objects"]:
        left = bf().as_int(obj.get("posLeft"))
        if victim["abs_left"] <= left < victim["abs_left"] + victim["width"]:
            continue
        keep.append(obj)
    for index, obj in enumerate(keep):
        obj["name"] = f"object_{index}"
    envelope["panel"]["single_objects"] = keep
    return recount(envelope)


def compressed_to_viewport():
    """The canvas objects rescaled to fit 1400x750, out of the cells they belong to."""
    envelope = fixture()
    objects = envelope["panel"]["single_objects"]
    right = max(bf().as_int(o["posLeft"]) + bf().as_int(o["posWidth"]) for o in objects)
    bottom = max(bf().as_int(o["posTop"]) + bf().as_int(o["posHeight"]) for o in objects)
    scale_x = CANVAS[0] / right
    scale_y = CANVAS[1] / bottom
    for obj in objects:
        obj["posLeft"] = int(bf().as_int(obj["posLeft"]) * scale_x)
        obj["posTop"] = int(bf().as_int(obj["posTop"]) * scale_y)
    return envelope


def half_linked():
    """100 objects placeholdered inside an otherwise linked panel."""
    envelope = fixture()
    for obj in envelope["panel"]["single_objects"][:100]:
        obj["driver_id"] = "driver_id"
        obj["unit_id"] = ""
        obj["linked"] = "false"
    return envelope


def constructed_driver_ids():
    """Identifiers built by concatenating plausible parts instead of copied."""
    envelope = fixture()
    for obj in envelope["panel"]["single_objects"]:
        driver_id = str(obj.get("driver_id") or "")
        if not driver_id:
            continue
        parts = driver_id.split("_")
        parts[-1] = str(bf().as_int(parts[-1]) + 1) if parts[-1].isdigit() else parts[-1] + "1"
        obj["driver_id"] = "_".join(parts)
    return envelope


NEGATIVES = {
    "dataset-not-a-panel": dataset_not_a_panel,
    "placeholder-overview": placeholder_overview,
    "container-dropped": container_dropped,
    "non-custom-unique-id": non_custom_unique_id,
    "text-sorted-rooms": text_sorted_rooms,
    "column-dropped": column_dropped,
    "compressed-to-viewport": compressed_to_viewport,
    "half-linked": half_linked,
    "constructed-driver-ids": constructed_driver_ids,
}

# The rule each negative must trip, by validator id. The test asserts these
# fire as errors; consequential findings alongside them are expected and are
# not asserted, because a mutation has consequences and pinning all of them
# would make the test a change-detector instead of a contract.
EXPECTED = {
    "dataset-not-a-panel": ("R-S2", "R-S3", "R-S4"),
    "placeholder-overview": ("R-S10", "R-S11", "R-T1"),
    "container-dropped": ("R-T1",),
    "non-custom-unique-id": ("R-T2",),
    "text-sorted-rooms": ("R-T12",),
    "column-dropped": ("R-T4",),
    "compressed-to-viewport": ("R-T10",),
    "half-linked": ("R-B3",),
    "constructed-driver-ids": ("R-B6",),
}

# constructed-driver-ids is invisible without the plant's parameter dump: a
# well-formed identifier that names nothing is indistinguishable from a real
# one until something resolves it. That is the whole argument for --source-sql.
NEEDS_SQL = ("constructed-driver-ids",)


def build(name):
    return NEGATIVES[name]()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("-o", "--output", type=pathlib.Path, default=DEFAULT_OUT,
                        help=f"output directory (default {DEFAULT_OUT})")
    parser.add_argument("--only", action="append", choices=sorted(NEGATIVES),
                        help="build one negative (repeatable)")
    parser.add_argument("--list", action="store_true", help="list them and exit")
    args = parser.parse_args(argv)

    if args.list:
        for name in sorted(NEGATIVES):
            first = (NEGATIVES[name].__doc__ or "").strip().split("\n")[0]
            flag = "  [needs --source-sql]" if name in NEEDS_SQL else ""
            print(f"{name:24s} {' '.join(EXPECTED[name]):20s} {first}{flag}")
        return 0

    args.output.mkdir(parents=True, exist_ok=True)
    for name in (args.only or sorted(NEGATIVES)):
        document = build(name)
        path = args.output / f"{name}.json"
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print(f"{path}  ({path.stat().st_size:,} bytes)  expect {' '.join(EXPECTED[name])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
