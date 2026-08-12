#!/usr/bin/env python3
"""Materialize sanitized Oversikt link-verification regression fixtures.

    python build-oversikt-linking-negatives.py --list
    python build-oversikt-linking-negatives.py --out survey-tmp/oversikt-linking

The committed artifact is the compact mutation manifest. Generated panels are
for inspection only: each repeats the same base document and therefore carries
no extra evidence. No live plant or customer data is read.
"""

from __future__ import annotations

import argparse
import copy
import json
import pathlib


ROOT = pathlib.Path(__file__).resolve().parent
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "oversikt-linking"
PANEL_PATH = FIXTURE_DIR / "verified-panel.json"
CASES_PATH = FIXTURE_DIR / "incident-cases.json"


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _objects(document):
    return document["panel"]["single_objects"]


CASE_LIST = _load(CASES_PATH)["cases"]
NEGATIVES = {case["id"]: case for case in CASE_LIST}


def build(case_id):
    if case_id not in NEGATIVES:
        raise KeyError(f"unknown negative {case_id!r}; choose {sorted(NEGATIVES)}")
    case = NEGATIVES[case_id]
    document = copy.deepcopy(_load(PANEL_PATH))
    by_name = {obj["name"]: obj for obj in _objects(document)}

    for mutation in case.get("mutations", []):
        by_name[mutation["object"]][mutation["field"]] = mutation["value"]
    if case.get("claim"):
        document["linking_status"] = case["claim"]
    if case.get("rename_start") is not None:
        for index, obj in enumerate(_objects(document)):
            obj["name"] = f"object_{case['rename_start'] + index}"
    if case.get("reverse_array"):
        _objects(document).reverse()

    document["generator"] = f"sanitized-linking-negative:{case_id}"
    return document


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args(argv)

    if args.list:
        for case_id, case in NEGATIVES.items():
            print(f"{case_id:42s} {case['requirement']}")
        return 0
    if args.out is None:
        parser.error("give --list or --out DIRECTORY")

    args.out.mkdir(parents=True, exist_ok=True)
    for case_id in NEGATIVES:
        path = args.out / f"{case_id}.json"
        path.write_text(
            json.dumps(build(case_id), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
