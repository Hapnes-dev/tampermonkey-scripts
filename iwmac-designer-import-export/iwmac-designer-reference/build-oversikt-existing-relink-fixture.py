#!/usr/bin/env python3
"""Build the sanitized existing-Oversikt relink regression fixture."""

from __future__ import annotations

import argparse
import json
import pathlib


ROOT = pathlib.Path(__file__).resolve().parent
OUTPUT = ROOT / "tests" / "fixtures" / "oversikt-existing-relink" / "case.json"
VISUAL_FIELDS = (
    "obj_id", "name", "posLeft", "posTop", "posWidth", "posHeight", "zIndex",
)
ROLE_DEFS = {
    "alarm": ("V3_R_34px_circular_alarm_nrm", 34, 34, 4, 0, "375"),
    "value": ("number_v3_40px_no_conn_no_tag", 42, 22, 0, 35, "110"),
    "cooling": ("V3_R_28px_circular_cooling_nrm", 28, 28, 7, 58, "375"),
    "defrost": ("V3_R_28px_circular_defrost_nrm", 28, 28, 7, 58, "375"),
}
ROLE_ROWS = {
    "value": ("2576", "u56 Display air", "Analog values", "float"),
    "cooling": ("2510", "u58 Comp1/LLSV", "Digital IO", "boolean"),
    "defrost": ("2512", "u60 Def. relay", "Digital IO", "boolean"),
}
CLUSTERS = (
    ("K51", 90, 100, 100, "20011"),
    ("K4A", 30, 240, 140, "20012"),
    ("K4B", 29, 380, 180, "20016"),
    ("K3B", 32, 520, 220, "20009"),
    ("K3C", 33, 660, 260, "20017"),
    ("K3D", None, 800, 300, None),
)


def object_record(name, role, left, top, label):
    obj_id, width, height, dx, dy, z_index = ROLE_DEFS[role]
    return {
        "obj_id": obj_id,
        "name": name,
        "id": "driver_id",
        "posWidth": width,
        "posHeight": height,
        "posLeft": left + dx,
        "posTop": top + dy,
        "zIndex": z_index,
        "tag_text": " " if role == "value" else "",
        "linked": "true",
        "link_name": "link_name",
        "link_tag": "",
        "sub_group": "A",
        "driver_id": f"NNNNN_AK2_OLD_{label}_{role}",
        "unit_id": f"001:{label}",
        "unit_ref": "",
        "alias_text": {
            "alarm": "Old high temperature alarm",
            "value": "u56 Display air",
            "cooling": "u58 Comp1/LLSV",
            "defrost": "u60 Def. relay",
        }[role],
    }


def parameter_row(label, index, role, alarm_suffix):
    if role == "alarm":
        suffix, alias, application, parameter_type = (
            alarm_suffix,
            f"{label} high temperature alarm",
            "Digital IO",
            "boolean",
        )
    else:
        suffix, alias, application, parameter_type = ROLE_ROWS[role]
    return {
        "driver_id": f"NNNNN_AK3_AKC_0_{index}_0_0_{suffix}",
        "unit_id": f"000:{index:03d}",
        "unit_name": f"Fixture equipment {label}",
        "alias_text": alias,
        "application": application,
        "parameter_type": parameter_type,
        "hardware_datatype": "HW_FLOAT" if role == "value" else "HW_ENUM",
        "att": "r",
        "eng_unit": "°C" if role == "value" else "",
        "object_role": role,
        "equipment_label": label,
    }


def build():
    objects = []
    parameters = []
    repair_plan = []
    index = 0
    for label, controller_index, left, top, alarm_suffix in CLUSTERS:
        for role in ("alarm", "value", "cooling", "defrost"):
            name = f"object_{index}"
            objects.append(object_record(name, role, left, top, label))
            if controller_index is not None:
                row = parameter_row(label, controller_index, role, alarm_suffix)
                parameters.append(row)
                repair_plan.append({
                    "equipment_label": label,
                    "object_name": name,
                    "role": role,
                    "driver_id": row["driver_id"],
                    "unit_id": row["unit_id"],
                    "alias_text": row["alias_text"],
                    "linked": "true",
                })
            index += 1

    objects.append({
        "obj_id": "number_v3_label_12px_bold",
        "name": f"object_{index}",
        "id": "driver_id",
        "posWidth": 120,
        "posHeight": 20,
        "posLeft": 1000,
        "posTop": 100,
        "zIndex": "1100",
        "tag_text": "Fixture static label",
        "linked": "false",
        "link_name": "",
        "link_tag": "",
        "sub_group": "",
        "driver_id": "driver_id",
        "unit_id": "",
        "unit_ref": "",
        "alias_text": "Fixture static label",
    })

    source = {
        "format": "iwmac-designer-panel",
        "version": 1,
        "generator": "sanitized-existing-relink-fixture",
        "source_plant_id": "",
        "panel_name": "Oversikt existing relink fixture",
        "panel_width": "1400px",
        "panel_height": "750px",
        "counts": {
            "single_objects": len(objects),
            "containers": 0,
            "graphics": 0,
        },
        "background_embedded": True,
        "panel": {
            "plant_id": "",
            "panel_name": "Oversikt existing relink fixture",
            "panel_width": "1400px",
            "panel_height": "750px",
            "org_image_name": "",
            "image_name": "",
            "saved_by": "",
            "converted": "true",
            "image_data": "data:image/png;base64,U1lOVEhFVElDLVJFTElOSw==",
            "single_objects": objects,
            "containers": [],
            "graphics": [],
        },
    }
    return {
        "_note": (
            "SANITIZED SYNTHETIC CASE-RELINK-A SHAPE. Labels are retained because "
            "they are the regression inputs; plant, customer, personal and real "
            "driver data are absent. Coordinates are synthetic."
        ),
        "scope": "SYNTHETIC-CASE-RELINK-A-20260812",
        "visual_fields": list(VISUAL_FIELDS),
        "source_panel": source,
        "parameters": {
            "format": "iwmac-parameter-source",
            "version": 1,
            "rows": parameters,
        },
        "repair_plan": repair_plan,
        "expected": {
            "verified_equipment": ["K51", "K4A", "K4B", "K3B", "K3C"],
            "unresolved_equipment": ["K3D"],
            "unchanged_object": "object_24",
            "alarm_suffixes": {
                label: suffix
                for label, _, _, _, suffix in CLUSTERS
                if suffix is not None
            },
        },
    }


def render():
    return json.dumps(build(), ensure_ascii=False, indent=2) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    expected = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            print(f"{OUTPUT.relative_to(ROOT)} is out of date")
            return 1
        print(f"{OUTPUT.relative_to(ROOT)} is up to date")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(expected, encoding="utf-8", newline="\n")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
