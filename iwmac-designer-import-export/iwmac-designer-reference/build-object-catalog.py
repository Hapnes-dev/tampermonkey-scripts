#!/usr/bin/env python3
"""Build DESIGN-OBJECT-CATALOG.md + reference_data/design-object-catalog.json.

Joins three live dumps that already ship in reference_data/:

  all-design-objects.json  - the 820 toolbox/palette entries (what you can place)
  controls-registry.json   - the 1769 render definitions (how an object draws)
  plant-panel-survey*.json  - per-panel obj_id census from real compiled panels

and emits one document that names every placeable object, says what it looks
like, and says how often production actually uses it and on which panel type.

Deterministic, offline, no network. Re-run after a new palette dump:

    python build-object-catalog.py
"""

from __future__ import annotations

import collections
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "reference_data")

# --------------------------------------------------------------------------
# panel-name -> panel type (the survey stores the operator's own panel names)
# --------------------------------------------------------------------------
PANEL_TYPES = [
    ("Spjeldliste", ("spjeld",)),
    ("Ventilasjon", ("ventilasjon", "ventilation", "aggregat")),
    ("Oversikt", ("oversikt", "översikt", "overview", "butikk", "plan ")),
    ("Maskin", ("maskin",)),
    ("Energi", ("energi", "ecomeeter", "effekt")),
    ("Romkontroll", ("rom", "romtype", "kjøl", "frys", "disk")),
    ("VGV/varmegjenvinning", ("vgv", "varmegjenvinning", "gjenvinn")),
    ("Varme/bereder", ("varme", "bereder", "tørrkjøler", "torrkjoler", "akkumul")),
    ("Kondens/waterloop", ("kondens", "waterloop", "hydroloop", "vannloop")),
    ("Kurver", ("kurve",)),
]


def panel_type(name: str) -> str:
    low = (name or "").lower()
    for label, needles in PANEL_TYPES:
        if any(n in low for n in needles):
            return label
    return "Annet"


# --------------------------------------------------------------------------
# vocabulary: obj_id / asset-filename tokens -> plain words
# --------------------------------------------------------------------------
FAMILY_BY_FOLDER = {
    "V3/valves": "Valve",
    "V3/indicators": "Indicator / LED",
    "V3/buttons": "Button",
    "/V3/buttons": "Button",
    "V3/link_buttons": "Page-link button",
    "navigation_buttons": "Page-link button",
    "V3/refrigeration/status_symbols": "Refrigeration status symbol",
    "V3/refrigeration/status_symbols/danfoss": "Danfoss status symbol",
    "V3/refrigeration/status_symbols/evaporator": "Evaporator status symbol",
    "V3/roomcontrol": "Room-control symbol",
    "V3/hvac/fans": "Fan (HVAC)",
    "V3/hvac/dampers": "Damper",
    "V3/fans": "Fan",
    "V3/pumps": "Pump",
    "V3/compressors": "Compressor",
    "V3/ibt/digitals": "IBT digital symbol",
    "V3/bacnet": "BACnet symbol",
    "V3/svg": "SVG symbol",
    "V3/ecomeeter/gauge_positive": "Energy gauge (positive)",
    "V3/ecomeeter/gauge_negative": "Energy gauge (negative)",
    "V3/ecomeeter/gauge_plus_minus": "Energy gauge (+/-)",
    "V3/V3clima_led": "Clima LED",
    "V3/assets": "Text asset",
    "/V3/assets": "Text asset",
}

FAMILY_BY_OBJTYPE = {
    "Label": "Text label",
    "TextBox": "Value box",
    "TextBox-With-Tag": "Value box with tag",
    "TextBox-with-connector": "Value box with duct/pipe connector",
    "Connectors": "Duct / pipe connector piece",
    "Circular": "Circular status symbol",
    "Square": "Square status symbol",
    "Statussymbols": "Status symbol",
    "Solenoid-valves": "Solenoid valve",
    "3Way-on-off": "3-way valve (on/off)",
    "Heatexchangers": "Heat exchanger",
    "Load": "Load / consumer symbol",
    "Fans": "Fan",
    "Dummy-Objects": "Dummy (drawing-only) object",
    "link-Page-Buttons": "Page-link button",
}

# object_type values that describe the object better than its asset folder does
OBJTYPE_WINS = {
    "Label", "TextBox", "TextBox-With-Tag", "TextBox-with-connector", "Connectors",
    "Dummy-Objects", "link-Page-Buttons", "Load", "Heatexchangers", "Fans",
    "Solenoid-valves", "3Way-on-off",
}

# negations must be read before the string is split on underscores
NEGATIONS = [
    ("no_conn", "noconn"), ("no_con", "noconn"), ("no_tag", "notag"),
    ("no_txt", "notag"), ("_off_", "_off_"),
]

TOKENS = {
    "noconn": "no connector", "notag": "no tag text",
    "arrow": "arrow", "transp": "transparent overlay", "blank": "blank",
    "defrost": "defrost", "cooling": "cooling", "suct": "suction group",
    "cond": "condensing group", "contr": "controller", "evap": "evaporator",
    "eveporator": "evaporator", "receiver": "receiver", "gascooler": "gas cooler",
    "akpc": "Danfoss AK-PC pack controller", "ekc": "Danfoss EKC case controller",
    "mt": "MT (medium temperature)", "lt": "LT (low temperature)",
    "ht": "HT (high temperature)", "iwt": "IWT", "plugin": "plugin",
    "disktype": "display-case type", "disk": "display case",
    "val": "value", "value": "value", "only": "value only",
    "sp": "setpoint", "act": "actual", "state": "state", "states": "state",
    "ok": "OK", "enebled": "enabled/disabled", "enabled": "enabled/disabled",
    "circ": "circular", "sensor": "sensor", "vav": "VAV", "flow": "air flow",
    "rc": "room control", "box": "box", "single": "single", "double": "double",
    "prev": "previous page", "previous": "previous page", "next": "next page",
    "nrm": "normal state",
    "inv": "inverted",
    "hor": "horizontal", "horis": "horizontal", "horiz": "horizontal",
    "vert": "vertical", "vertikal": "vertical",
    "con": "with connector", "conn": "with connector", "no_conn": "no connector",
    "sup": "supply", "supply": "supply", "exh": "exhaust", "exhaust": "exhaust",
    "fresh": "fresh air", "resirc": "recirculation", "recirc": "recirculation",
    "damp": "damper", "damper": "damper",
    "filter": "filter", "diff": "differential", "press": "pressure",
    "fan": "fan", "vifte": "fan", "pump": "pump", "comp": "compressor",
    "heater": "heater", "cooler": "cooler", "coil": "coil",
    "el": "electric", "gbv": "gas bypass valve", "hv": "high-pressure valve",
    "3way": "3-way", "2way": "2-way", "3w": "3-way", "2w": "2-way",
    "valve": "valve", "ventil": "valve", "sol": "solenoid",
    "alarm": "alarm", "bell": "alarm bell", "circular": "circular",
    "square": "square", "led": "LED", "lamp": "lamp",
    "btn": "button", "link": "link", "sub_page": "sub-page",
    "home": "home", "left": "left", "right": "right", "up": "up", "down": "down",
    "top": "top", "bottom": "bottom", "mid": "middle", "center": "centre",
    "header": "header", "footer": "footer", "label": "label",
    "bold": "bold", "norm": "normal weight", "italic": "italic",
    "dark": "dark styling", "grey": "grey", "green": "green", "red": "red",
    "blue": "blue", "yellow": "yellow", "orange": "orange", "white": "white",
    "json": "JSON-plugin object", "obj": "object", "dummy": "drawing-only dummy",
    "tag": "tag text", "txt": "text", "temp": "temperature",
    "outside": "outdoor", "room": "room", "co2": "CO2", "rh": "humidity",
    "motor": "motor", "status": "status", "kurver": "curves/trend page",
    "aux": "auxiliary", "cb": "circuit breaker", "vg": "VG", "vb": "VB",
    "kb": "KB", "gauge": "gauge", "meter": "meter", "pdf": "PDF document link",
    "pipe": "pipe", "duct": "duct", "connector": "connector",
    "open": "open", "closed": "closed", "on": "on", "off": "off",
}

SIZE_RE = re.compile(r"(?<![\dx])(\d{1,4})x(\d{1,4})(?![\dx])")
PX_RE = re.compile(r"(\d{1,4})px")

# --------------------------------------------------------------------------
# curated shortlist: the object the fleet actually reaches for, per task.
# Every id here is asserted against the palette at build time, so this table
# cannot drift away from the designer.
# --------------------------------------------------------------------------
PICK_BY_TASK = [
    ("Plain text on the panel",
     ["number_v3_label_11px_norm", "number_v3_label_8px_norm", "number_v3_label_12px_bold"],
     "11px normal is the fleet default; 12px bold for emphasis."),
    ("Section header bar",
     ["number_v3_header_grey75", "number_v3_header_grey50", "number_v3_header_grey25"],
     "grey75 is the standard; the lighter greys are rare."),
    ("A live value with no box (Maskin, Energi)",
     ["number_v3_value_only", "number_v3_white_value_only"],
     "The single most-placed object in the fleet. Value only, styled by CSS."),
    ("A live value sitting ON a duct or pipe run",
     ["number_v3_R_45px_con_top", "number_v3_R_45px_con_down",
      "number_v3_R_45px_con_left", "number_v3_R_45px_con_right"],
     "The connector points at the run: con_top sits below it, con_down above it."),
    ("A live value away from the run",
     ["number_v3_R_45px_no_conn_tag_up_center", "number_v3_R_60px_no_conn_tag_up_center",
      "number_v3_60px_dark_no_conn"],
     "60px dark is the Ventilasjon standard value box."),
    ("A case / room tile on Oversikt",
     ["number_v3_40px_no_conn_no_tag", "V3_R_34px_circular_alarm_nrm",
      "V3_R_28px_circular_cooling_nrm", "V3_R_28px_circular_defrost_nrm"],
     "The four objects an Oversikt is built from - one value tile plus the three state circles."),
    ("Alarm indication",
     ["V3_R_34px_circular_alarm_nrm", "V3_ok_alarm_nrm"],
     "Place the bell NEXT TO the component it guards, not on it."),
    ("Status LED",
     ["V3_led_13px_circ_grey_green", "V3_led_21px_circ_grey_red",
      "V3_led_21px_square_grey_green", "V3_81x21_enebled_disabled_nrm"],
     "grey/green = running, grey/red = fault, the 81x21 strip = enabled/disabled."),
    ("Air handling: fans",
     ["V3_58px_fan_left_nrm", "V3_58px_fan_right_nrm"],
     "Direction follows the airflow of the run it sits on."),
    ("Air handling: dampers",
     ["V3_horis_damper_flow-left_nrm", "V3_horis_damper_flow-right_nrm",
      "V3_vert_damper_flow-up_nrm"],
     "Horizontal on horizontal runs; the vertical one for recirculation legs."),
    ("Air handling: duct runs",
     ["number_v3_fresh_pipe_horisontal", "number_v3_supply_pipe_horisontal",
      "number_v3_exhaust_pipe_horisontal", "number_v3_supply_pipe_vertical",
      "number_v3_exhaust_pipe_vertical"],
     "Stretch posWidth/posHeight along the run - one object per run, not a chain."),
    ("Air handling: filter",
     ["numberV3_filter_with_diff_press", "number_v3_filter_only"],
     "The diff-press variant carries the QD tag. Note the capital V - copy the id verbatim."),
    ("Air handling: heating and cooling coils",
     ["number_v3_heater_3_way", "number_v3_el_heater", "number_v3_cooler_2-way"],
     "Purpose-built coil bodies drawn ACROSS the run they condition (heights 85-210 px) "
     "- never a plain value box or a generic valve. The hyphen in _2-way is real."),
    ("Air handling: heat recovery",
     ["number_360_vg_rot", "number_360_room"],
     "The rotor spans both duct runs (60x343 in the reference); the room symbol closes "
     "the supply end. Both belong to the z=40 equipment band."),
    ("Air handling: crossovers and recirculation",
     ["number_v3_exhaust_connector_up", "number_v3_supply_connector_down",
      "number_v3_dummy_resirc_damp_hor", "number_v3_dummy_resirc_damp_vert"],
     "The connectors join a horizontal run to the vertical crossover column; the resirc "
     "dummies are the recirculation damper symbols a vent panel actually uses."),
    ("Ventilasjon sidebar row",
     ["number_v3_header_grey75", "number_v3_60px_dark_no_conn",
      "number_v3_60px_dark_no_conn_no_tag", "number_v3_label_11px_norm"],
     "Header bar 250x20 spanning the section, label on the left of the row, value boxes "
     "in one or two columns on the right, 25 px pitch. The _no_tag variant is for rows "
     "whose label already names the value."),
    ("Outside-air reference",
     ["numberV3_outside_temp"],
     "The outdoor-temperature block at the fresh-air inlet. Capital V again."),
    ("Refrigeration: pack controller",
     ["V3_akpc_772_781_781A_783_contr", "V3_akpc_782A_suct", "V3_akpc_783_781A_782A_cond"],
     "Danfoss AK-PC blocks - controller, suction group, condensing group."),
    ("Refrigeration: compressors and pumps",
     ["V3_co2_compressor_31x35_nrm", "V3_21px_single_pump_grey_green_down",
      "V3_21px_single_pump_grey_green_up"],
     "Pump direction = flow direction."),
    ("Room control values",
     ["number_v3_rc_load_vav_60", "number_v3_rc_air_flow_val_60",
      "number_v3_rc_air_flow_sp_60", "number_v3_rc_temp_48", "number_v3_rc_temp_sp_48"],
     "Purpose-built room boxes - do not rebuild them from plain value boxes."),
    ("Navigation to another panel",
     ["sub_page_link_btn_home", "sub_page_link_btn_left", "sub_page_link_btn_right",
      "sub_page_80_24_kurver_btn", "sub_page_v3_header_link_grey75",
      "previous_page_tekn_box_no"],
     "The nav row belongs bottom-right; kurver goes to the trend page."),
    ("Link to a document",
     ["file_pdf"],
     "driver_id AND file_pdf both hold /iw_plants/iw_<plant>/files/<name>.pdf."),
    ("Values fed by the JSON plugin",
     ["number_v3_60px_json_obj", "number_v3_custom_json_obj"],
     "Only when the plant actually runs the JSON plugin."),
]


def humanize(obj_id: str, asset: str | None) -> str:
    """Plain-language modifiers derived from the id and the asset filename."""
    base = os.path.splitext(os.path.basename(asset or ""))[0]
    text = f"{obj_id} {base}".lower()
    for src, dst in NEGATIONS:
        text = text.replace(src, dst)

    words: list[str] = []
    seen: set[str] = set()
    for chunk in re.split(r"[^a-z0-9]+", text):
        if not chunk:
            continue
        for token in (chunk, chunk.rstrip("s")):
            word = TOKENS.get(token)
            if word and word not in seen:
                seen.add(word)
                words.append(word)
                break

    # "no connector" wins over "with connector"; drop the bare duplicate
    if "no connector" in seen and "with connector" in seen:
        words.remove("with connector")
    if "no tag text" in seen and "tag text" in seen:
        words.remove("tag text")
    if "with connector" in seen and "connector" in seen:
        words.remove("connector")

    if not words:
        pretty = re.sub(r"^\d+x\d+[_-]?", "", base).replace("_", " ").replace("-", " ")
        pretty = re.sub(r"\s+", " ", pretty).strip()
        return pretty
    return ", ".join(words)


def states_of(reg: dict) -> str:
    """Name the status images an object switches between."""
    arr = reg.get("status_array")
    if not isinstance(arr, list) or not arr:
        return ""
    names = [os.path.splitext(os.path.basename(str(p)))[0] for p in arr]
    if len(names) > 1:
        prefix = os.path.commonprefix(names)
        cut = prefix.rfind("_") + 1
        trimmed = [n[cut:] or n for n in names]
        if len(set(trimmed)) == len(trimmed):
            names = trimmed
    return f"{len(arr)}: " + "/".join(names)


# --------------------------------------------------------------------------
def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def build_usage():
    """obj_id -> {'total', 'panels', 'by_type': Counter} from the fleet surveys."""
    usage = collections.defaultdict(
        lambda: {"total": 0, "panels": 0, "by_type": collections.Counter()}
    )
    panels_scanned = 0
    sources = []
    for fname in ("plant-panel-survey.json", "plant-panel-survey-meny-20.json"):
        path = os.path.join(DATA, fname)
        if not os.path.exists(path):
            continue
        sources.append(fname)
        for plant in load(fname)["plants"].values():
            for panel in plant.get("panels") or []:
                census = panel.get("census")
                if not census:
                    continue
                panels_scanned += 1
                ptype = panel_type(panel.get("name", ""))
                for obj_id, count in census.items():
                    rec = usage[obj_id]
                    rec["total"] += count
                    rec["panels"] += 1
                    rec["by_type"][ptype] += count
    return usage, panels_scanned, sources


def usage_cell(rec) -> str:
    if not rec:
        return "—"
    top = rec["by_type"].most_common(2)
    share = ", ".join(
        f"{t} {round(100 * c / rec['total'])}%" for t, c in top if rec["total"]
    )
    return f"{rec['total']:,} on {rec['panels']} panels · {share}"


def main() -> None:
    palette = load("all-design-objects.json")["all_design_objects"]
    registry = load("controls-registry.json")["controls"]
    usage, panels_scanned, sources = build_usage()

    by_id = {}
    for entry in palette:
        by_id.setdefault(entry["object_id"], entry)

    catalog = {}
    for obj_id, entry in by_id.items():
        reg = registry.get(obj_id) or {}
        asset = reg.get("file") or entry.get("base_image_path") or ""
        folder = "/".join(str(asset).split("/")[:-1])
        otype = entry.get("object_type") or ""
        if otype in OBJTYPE_WINS:
            family = FAMILY_BY_OBJTYPE[otype]
        else:
            family = (
                FAMILY_BY_FOLDER.get(folder)
                or FAMILY_BY_OBJTYPE.get(otype)
                or otype
                or "Object"
            )
        rec = usage.get(obj_id)
        catalog[obj_id] = {
            "object_id": obj_id,
            "designer_name": entry.get("object_name") or "",
            "menu": entry.get("menu_type") or "",
            "object_type": entry.get("object_type") or "",
            "family": family,
            "looks_like": humanize(obj_id, asset),
            "width": entry.get("width") or reg.get("width"),
            "height": entry.get("height") or reg.get("height"),
            "default_tag_text": entry.get("default_tag_txt")
            or reg.get("tag_text_default_text")
            or "",
            "has_tag": bool(reg.get("hasTag")),
            "can_link": bool(reg.get("canLink")),
            "only_tag_text": bool(reg.get("only_tag_text")),
            "states": states_of(reg),
            "asset": asset or None,
            "info": (entry.get("info") or "").strip(),
            "in_registry": obj_id in registry,
            "usage_total": rec["total"] if rec else 0,
            "usage_panels": rec["panels"] if rec else 0,
            "usage_by_panel_type": dict(rec["by_type"]) if rec else {},
        }

    out_json = {
        "_note": (
            "Enriched object catalog: every placeable designer object joined from "
            "all-design-objects.json (palette), controls-registry.json (render "
            f"definition) and the fleet surveys ({panels_scanned} real compiled "
            "panels). usage_* fields are production placements, not opinions. "
            "Generated by build-object-catalog.py - do not hand-edit."
        ),
        "generated_from": sources,
        "panels_scanned": panels_scanned,
        "count": len(catalog),
        "objects": catalog,
    }
    with open(
        os.path.join(DATA, "design-object-catalog.json"), "w", encoding="utf-8", newline="\n"
    ) as fh:
        json.dump(out_json, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    # ---------------------------------------------------------------- markdown
    live = [c for c in catalog.values() if not re.match(r"(Inactive|Outdated|__)", c["menu"])]
    dead = [c for c in catalog.values() if re.match(r"(Inactive|Outdated|__)", c["menu"])]

    menus = collections.defaultdict(list)
    for c in live:
        menus[c["menu"]].append(c)

    used_ids = {i for i, r in usage.items() if r["total"]}
    lines = []
    add = lines.append

    add("# IWMAC Designer — object catalog")
    add("")
    add(
        f"Every object the designer toolbox can place: **{len(catalog)} distinct "
        f"`obj_id`s** across {len(menus)} menu categories, each with what it is, "
        "what it draws, whether it can carry a value, and how often the real fleet "
        f"actually uses it ({panels_scanned} compiled production panels)."
    )
    add("")
    add(
        "Generated by [build-object-catalog.py](build-object-catalog.py) from "
        "`reference_data/all-design-objects.json` (palette), "
        "`reference_data/controls-registry.json` (render definitions) and the fleet "
        "surveys. Machine-readable twin: "
        "[reference_data/design-object-catalog.json](reference_data/design-object-catalog.json). "
        "**Do not hand-edit either file — re-run the script.**"
    )
    add("")
    add("## Rules")
    add("")
    add(
        "1. **Only these ids exist.** An `obj_id` that is not in this catalog does "
        "not render — the designer draws nothing. Never invent one, never guess a "
        "plural or a size variant."
    )
    add("2. **Copy the id verbatim**, including case and underscores.")
    add(
        "3. **`Link` = can carry a `driver_id`.** `Link: no` objects are decoration "
        "or navigation — giving them a driver does nothing."
    )
    add(
        "4. **`Tag` = the object shows `tag_text`** (the instrument code such as "
        "`RT401 °C`). Objects with `Tag: no` show nothing but their own graphic."
    )
    add(
        "5. **`W×H` is the placement size in pixels** on the 1400×750 canvas. "
        "Pipe/duct pieces are meant to be stretched along their run (`posWidth`); "
        "symbols are not."
    )
    add(
        "6. **`Production use` is evidence, not advice** — placements counted in "
        "the survey. `—` means the fleet never places it; prefer a used object when "
        "one fits."
    )
    add(
        "7. **This catalog answers *which id*, never *where*.** Picking valid ids "
        "is not enough to produce a panel that looks like production — the "
        "geometry is a separate contract. For a **Ventilasjon (360.NNN)** panel, "
        "take every position, size and z-index from a real export "
        "(`reference_data/real-vent-panel-example.json`; measured skeleton and "
        "cluster offsets in [AI-BRIEFING.txt](AI-BRIEFING.txt) §7a) — objects only "
        "on the `00-blank-sidebar-1400x750` background, never an authored "
        "`image_svg`. Choosing ids from this list and inventing the layout is what "
        "produces a generic dashboard. And when the user supplies their own panel "
        "JSON, that file outranks every reference here and becomes the authoritative "
        "geometric template - clone its geometry, z-indexes and object vocabulary, "
        "sanitize only the parameter bindings, and keep `alias_text`. Rules and QA "
        "checklists: [CLAUDE.md](CLAUDE.md), *Ventilation panel fidelity and "
        "template-matching rules*."
    )
    add("")

    add("## Pick by task")
    add("")
    add(
        "The object the fleet actually reaches for, per job. Counts in brackets are "
        "production placements; the first id in each row is the default choice."
    )
    add("")
    add("| I need to… | Use | Notes |")
    add("|---|---|---|")
    for task, ids, note in PICK_BY_TASK:
        cells = []
        for obj_id in ids:
            if obj_id not in catalog:
                raise SystemExit(f"PICK_BY_TASK references a missing obj_id: {obj_id}")
            total = catalog[obj_id]["usage_total"]
            cells.append(f"`{obj_id}` ({total:,})" if total else f"`{obj_id}`")
        add(f"| {task} | {' · '.join(cells)} | {note} |")
    add("")

    add("## Menu categories")
    add("")
    add("| Menu | Objects | What lives here |")
    add("|---|---|---|")
    menu_blurb = {
        "Text": "labels, value boxes and the duct/pipe connector boxes the layouts are drawn with",
        "IBT": "IBT (building-automation) symbols: digitals, heat exchangers, loads",
        "RoomControl": "room / refrigeration-case symbols and their status graphics",
        "Refrigeration": "compressors, condensers, evaporators, receivers, refrigeration status symbols",
        "Valves": "solenoid, 2-way, 3-way and expansion valves",
        "LED": "LEDs and small status indicators",
        "Buttons": "buttons, page links and document links",
        "Danfoss": "Danfoss-specific status symbols",
        "Refrigeration_Cont": "refrigeration container objects",
        "Groups": "grouping helper",
        "Led": "LED (stray single entry, same as LED)",
    }
    for menu, items in sorted(menus.items(), key=lambda kv: -len(kv[1])):
        add(f"| **{menu}** | {len(items)} | {menu_blurb.get(menu, '—')} |")
    add("")
    add(
        f"Plus {len(dead)} inactive/outdated entries in "
        "[Appendix A](#appendix-a--inactive-and-outdated--never-place-these)."
    )
    add("")

    for menu, items in sorted(menus.items(), key=lambda kv: -len(kv[1])):
        add(f"## {menu} ({len(items)})")
        add("")
        by_type = collections.defaultdict(list)
        for c in items:
            by_type[c["object_type"] or "Other"].append(c)
        for otype, group in sorted(by_type.items(), key=lambda kv: -len(kv[1])):
            group.sort(key=lambda c: (-c["usage_total"], c["object_id"]))
            add(f"### {menu} · {otype} ({len(group)})")
            add("")
            add("| `obj_id` | Designer name | What it is | W×H | Tag | Link | States | Production use |")
            add("|---|---|---|---|---|---|---|---|")
            for c in group:
                looks = c["looks_like"] or ""
                what = c["family"] + (f" — {looks}" if looks else "")
                if c["info"]:
                    what += f" ({c['info']})"
                tag = c["default_tag_text"] if c["has_tag"] else "no"
                add(
                    f"| `{c['object_id']}` | {c['designer_name'] or '—'} | {what} | "
                    f"{c['width']}×{c['height']} | {tag or 'yes'} | "
                    f"{'yes' if c['can_link'] else 'no'} | {c['states'] or '—'} | "
                    f"{usage_cell(usage.get(c['object_id']))} |"
                )
            add("")

    add("## Appendix A — inactive and outdated (never place these)")
    add("")
    add(
        "The toolbox still carries them, the fleet does not use them, and new panels "
        "must not either."
    )
    add("")
    add("| `obj_id` | Menu | Designer name | Production use |")
    add("|---|---|---|---|")
    for c in sorted(dead, key=lambda c: (c["menu"], c["object_id"])):
        add(
            f"| `{c['object_id']}` | {c['menu']} | {c['designer_name'] or '—'} | "
            f"{usage_cell(usage.get(c['object_id']))} |"
        )
    add("")

    missing_reg = sorted(c["object_id"] for c in catalog.values() if not c["in_registry"])
    add("## Appendix B — palette entries with no render definition")
    add("")
    add(
        f"{len(missing_reg)} palette ids have no entry in `controls-registry.json`, "
        "so their size and states are unknown. Treat them as unsupported unless a "
        "real production panel already uses one."
    )
    add("")
    for obj_id in missing_reg:
        rec = usage.get(obj_id)
        add(f"- `{obj_id}` — {usage_cell(rec)}")
    add("")

    unseen = [c for c in live if c["object_id"] not in used_ids]
    add("## Appendix C — active but never seen in production")
    add("")
    add(
        f"{len(unseen)} of the {len(live)} active objects appear on none of the "
        f"{panels_scanned} surveyed panels. They are legal, but a reviewer will ask "
        "why the fleet pattern was not used instead."
    )
    add("")
    add(
        "<details><summary>List</summary>"
    )
    add("")
    for c in sorted(unseen, key=lambda c: (c["menu"], c["object_id"])):
        add(f"- `{c['object_id']}` ({c['menu']} · {c['object_type']})")
    add("")
    add("</details>")
    add("")

    with open(
        os.path.join(HERE, "DESIGN-OBJECT-CATALOG.md"), "w", encoding="utf-8", newline="\n"
    ) as fh:
        fh.write("\n".join(lines))

    print(
        f"catalog: {len(catalog)} objects, {len(menus)} menus, "
        f"{panels_scanned} panels scanned, {len(used_ids)} ids seen in production"
    )


if __name__ == "__main__":
    main()
