#!/usr/bin/env python3
"""Build the seven Oversikt negative fixtures from the committed E15 fixture.

    python build-oversikt-negatives.py --list
    python build-oversikt-negatives.py -o survey-tmp/oversikt-negative
    python build-oversikt-negatives.py --only nine-cluster-reconstruction

Each negative is the plant-10113 fixture with EXACTLY ONE rule broken, so a
validator finding can be attributed to one cause. They exist because the
2026-08-10 incident was not a malformed panel - every failed attempt was
structurally valid JSON. The defects were coverage and placement defects, and
nothing in the kit could see them.

    dashboard-regrouping        all 72 objects, all bindings intact, clusters
                                re-laid onto a tidy 90px grid. The v1 failure.
    nine-cluster-reconstruction 9 of 21 clusters rebuilt, 12 silently dropped.
                                The v2 failure.
    cluster-out-of-room         one cluster translated off the case it monitors.
    duplicate-cluster           one controller rendered twice.
    stripped-links              layout "correction" that blanked every binding.
    missing-background          objects preserved, embedded store plan dropped.
    forced-four-object          the six 2-member clusters padded to four with
                                invented cooling and defrost bindings.

WHY THESE ARE GENERATED AND NOT COMMITTED
-----------------------------------------
Each one embeds the same 48 kB store-plan PNG. Committing seven near-identical
copies would add most of a megabyte of base64 to the repository to express
seven one-line differences, and base64 does not delta-compress. The mutation
is the artifact worth versioning, so the mutation is what is committed - the
same reasoning that makes tests/test_maskin_10229_contract.py mutate its
fixture in memory rather than ship a file per defect.

tests/test_oversikt_10113_contract.py imports this module and builds the
documents in memory. The CLI writes them to disk when a human or an assistant
needs to run the validator against a file by hand; the default output directory
is survey-tmp/, which .gitignore already excludes.

forced-four-object contains driver ids that name parameters those controllers
do not expose. That is the defect being modelled, on purpose. Do not copy an
object out of that document into anything real.
"""

from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FIXTURE_PATH = ROOT / "reference_data" / "oversikt-10113-sanitized.json"
DEFAULT_OUT = ROOT / "survey-tmp" / "oversikt-negative"


def _load_fixture_builder():
    spec = importlib.util.spec_from_file_location(
        "build_oversikt_fixture", ROOT / "build-oversikt-fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURE_BUILDER = _load_fixture_builder()
CLUSTER_ROLES = FIXTURE_BUILDER.CLUSTER_ROLES
ROLE_OF_OBJ_ID = FIXTURE_BUILDER.ROLE_OF_OBJ_ID
OBJ_ID_OF_ROLE = {role: obj_id for role, obj_id in CLUSTER_ROLES}
as_int = FIXTURE_BUILDER.as_int
envelope_of = FIXTURE_BUILDER.envelope_of
inventory = FIXTURE_BUILDER.inventory


def source():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def objects_of(document):
    return envelope_of(document)["panel"]["single_objects"]


def renumber(document):
    """Rename objects sequentially, as the host does on insert."""
    for index, obj in enumerate(objects_of(document)):
        obj["name"] = f"object_{index}"
    return document


def recount(document):
    env = envelope_of(document)
    counts = env.get("counts")
    if isinstance(counts, dict):
        counts["single_objects"] = len(env["panel"]["single_objects"])
        counts["containers"] = len(env["panel"].get("containers") or [])
        counts["graphics"] = len(env["panel"].get("graphics") or [])
    return document


def translate(members, dx, dy):
    for obj in members:
        obj["posLeft"] = as_int(obj["posLeft"]) + dx
        obj["posTop"] = as_int(obj["posTop"]) + dy


def note(document, text):
    envelope_of(document)["_negative_fixture"] = text
    return document


# --------------------------------------------------------------------------
# The seven mutations
# --------------------------------------------------------------------------

def dashboard_regrouping():
    """v1: a store map flattened into dashboard cards.

    Every object, every binding and the background survive. Only the geometry
    changes - each cluster is moved as a unit onto a 90px grid, in controller
    order, exactly as the CLUSTER KIT hand-off mode lays parts out. That is the
    point: the panel is defensible on every count the old kit could check, and
    it has still lost the only information an Oversikt carries.
    """
    document = source()
    clusters = inventory(objects_of(document))
    for index, entry in enumerate(clusters.values()):
        column, row = index % 6, index // 6
        left, top, _, _ = entry["bbox"]
        translate(entry["members"], 40 + column * 90 - left, 60 + row * 90 - top)
    return note(document, "dashboard-regrouping: clusters re-laid on a 90px grid")


def nine_cluster_reconstruction(keep=9):
    """v2: production appearance imitated, most of the store not rebuilt."""
    document = source()
    panel = envelope_of(document)["panel"]
    clusters = inventory(panel["single_objects"])
    survivors = list(clusters)[:keep]
    panel["single_objects"] = [
        obj for entry in clusters.values() if entry["key"] in survivors
        for obj in entry["members"]
    ]
    return note(recount(renumber(document)),
                f"nine-cluster-reconstruction: {keep} of {len(clusters)} "
                f"clusters kept, the rest silently dropped")


def cluster_out_of_room(controller="000:030", dx=400, dy=300):
    """One cluster translated off the case it monitors, cohesion intact."""
    document = source()
    clusters = inventory(objects_of(document))
    if controller not in clusters:
        raise KeyError(controller)
    translate(clusters[controller]["members"], dx, dy)
    return note(document, f"cluster-out-of-room: {controller} moved by "
                          f"({dx},{dy}) onto unrelated artwork")


def duplicate_cluster(controller="000:012", dx=0, dy=90):
    """One controller rendered twice - two positions claiming one case."""
    document = source()
    panel = envelope_of(document)["panel"]
    clusters = inventory(panel["single_objects"])
    if controller not in clusters:
        raise KeyError(controller)
    twin = copy.deepcopy(clusters[controller]["members"])
    translate(twin, dx, dy)
    panel["single_objects"].extend(twin)
    return note(recount(renumber(document)),
                f"duplicate-cluster: {controller} emitted twice")


def stripped_links():
    """A layout pass that blanked every binding it touched.

    The panel still renders. Every symbol is dead, and nothing in the JSON
    looks wrong - which is precisely why this needs a validator and not a
    reviewer's eye.
    """
    document = source()
    for obj in objects_of(document):
        obj["driver_id"] = "driver_id"
        obj["unit_id"] = ""
        obj["alias_text"] = ""
        obj["linked"] = "false"
    return note(document, "stripped-links: every binding blanked during a "
                          "layout correction")


def missing_background():
    """Objects preserved, the store plan they were placed against dropped."""
    document = source()
    env = envelope_of(document)
    env["panel"].pop("image_data", None)
    env["panel"].pop("converted", None)
    if "background_embedded" in env:
        env["background_embedded"] = False
    return note(document, "missing-background: embedded store plan dropped, "
                          "objects left floating")


def forced_four_object():
    """Partial clusters padded to four members with invented bindings.

    Six controllers on this panel expose no cooling or defrost relay. Assuming
    every cluster has four members produces twelve objects bound to parameters
    that do not exist - they render, they never update, and no count is wrong.
    """
    document = source()
    panel = envelope_of(document)["panel"]
    clusters = inventory(panel["single_objects"])
    invented = []
    for entry in clusters.values():
        if set(entry["roles"]) >= {"cooling", "defrost"}:
            continue
        value = next((o for o in entry["members"]
                      if ROLE_OF_OBJ_ID.get(o["obj_id"]) == "value"), None)
        if value is None:
            continue
        left, top, _, _ = entry["bbox"]
        for role, tail, alias in (("cooling", "9001", "u58 Comp1/LLSV"),
                                  ("defrost", "9002", "u60 Def. relay")):
            fake = copy.deepcopy(value)
            fake.update({
                "obj_id": OBJ_ID_OF_ROLE[role],
                "posWidth": 28,
                "posHeight": 28,
                "posLeft": left + 7,
                "posTop": top + 58,
                "zIndex": "375",
                "tag_text": "",
                "alias_text": alias,
                "driver_id": "_".join(value["driver_id"].split("_")[:5] + ["0", "0", tail]),
            })
            invented.append(fake)
    panel["single_objects"].extend(invented)
    return note(recount(renumber(document)),
                f"forced-four-object: {len(invented)} cooling/defrost objects "
                f"invented on partial clusters")


NEGATIVES = {
    "dashboard-regrouping": dashboard_regrouping,
    "nine-cluster-reconstruction": nine_cluster_reconstruction,
    "cluster-out-of-room": cluster_out_of_room,
    "duplicate-cluster": duplicate_cluster,
    "stripped-links": stripped_links,
    "missing-background": missing_background,
    "forced-four-object": forced_four_object,
}


def build(name):
    return NEGATIVES[name]()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("-o", "--output", type=pathlib.Path, default=DEFAULT_OUT,
                        help=f"output directory (default {DEFAULT_OUT})")
    parser.add_argument("--only", action="append", choices=sorted(NEGATIVES),
                        help="build one negative; repeatable")
    parser.add_argument("--list", action="store_true",
                        help="list the negatives and exit")
    args = parser.parse_args(argv)

    if args.list:
        for name in sorted(NEGATIVES):
            first = (NEGATIVES[name].__doc__ or "").strip().split("\n")[0]
            print(f"{name:30} {first}")
        return 0

    args.output.mkdir(parents=True, exist_ok=True)
    for name in (args.only or sorted(NEGATIVES)):
        document = build(name)
        path = args.output / f"{name}.json"
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        print(f"{path} - {len(objects_of(document))} objects, "
              f"{len(inventory(objects_of(document)))} clusters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
