#!/usr/bin/env python3
"""Regenerate the single-file Maskin knowledge bundle from its live owners.

    python build-maskin-knowledge.py            # rewrite the bundle
    python build-maskin-knowledge.py --check    # exit 1 if it is out of date

Reads the generated Maskin rule blocks, the Copilot preflight, the QA
checklist, the AI briefing's envelope templates, and the AK-PC link map.  It
does not own or restate any Maskin rule: every fact in the output is read from
one of those sources at run time.  Literal text in this file is limited to
section headings and structural connecting prose.

No network access. Reads and writes only inside the reference directory.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
BUNDLE_PATH = ROOT / "MASKIN-KNOWLEDGE-BUNDLE.md"
RULES_PATH = ROOT / "documentation-rules.json"
PREFLIGHT_PATH = ROOT / "MASKIN-COPILOT-PREFLIGHT.md"
QA_PATH = ROOT / "MASKIN-QA-CHECKLIST.md"
BRIEFING_PATH = ROOT / "AI-BRIEFING.txt"
LINK_MAP_PATH = ROOT / "reference_data" / "maskin-akpc-link-map.json"

SOURCE_PATHS = (
    RULES_PATH,
    PREFLIGHT_PATH,
    QA_PATH,
    BRIEFING_PATH,
    LINK_MAP_PATH,
)

PANEL_KEYS = (
    "identity",
    "owner_document",
    "canvas",
    "background",
    "composition",
    "z_indexes",
    "object_vocabulary",
    "roles",
    "setpoint_pill",
    "compressor_columns",
    "role_translations_mt_to_lt",
    "absent_by_design",
    "anomalies",
    "bindings",
    "sanitization",
    "request_classes",
    "insert_semantics",
    "required_roles",
    "artwork",
    "compare",
    "qa",
    "evidence_required",
)


def _markdown_text(value):
    return (value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br>"))


def _scalar(value):
    if isinstance(value, str):
        if value == "":
            return '""'
        return _markdown_text(value)
    return json.dumps(value, ensure_ascii=False)


def _inline_value(value):
    if isinstance(value, dict):
        if not value:
            return "{}"
        return "<br>".join(
            f"{_markdown_text(str(key))}: {_inline_value(item)}"
            for key, item in value.items())
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(item, (dict, list)) for item in value):
            return _markdown_text(json.dumps(value, ensure_ascii=False))
        return "<br>".join(_inline_value(item) for item in value)
    return _scalar(value)


def _table_cell(value):
    return _inline_value(value).replace("|", "\\|")


def render_table(headers, rows):
    """Render rows as a Markdown table without owning any cell value."""
    lines = [
        "| " + " | ".join(_table_cell(header) for header in headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    for row in rows:
        if len(row) != len(headers):
            raise SystemExit("Markdown table row does not match its header")
        lines.append("| " + " | ".join(_table_cell(cell) for cell in row) + " |")
    return lines


def render_bullets(value, indent=0):
    """Render nested mappings/lists as labelled Markdown bullets."""
    prefix = "  " * indent + "- "
    lines = []
    if isinstance(value, dict):
        if not value:
            return [prefix + "{}"]
        for key, item in value.items():
            label = f"**{_markdown_text(str(key))}**"
            if isinstance(item, (dict, list)):
                lines.append(prefix + label)
                lines.extend(render_bullets(item, indent + 1))
            else:
                lines.append(prefix + label + " — " + _scalar(item))
        return lines
    if isinstance(value, list):
        if not value:
            return [prefix + "[]"]
        for index, item in enumerate(value, start=1):
            if isinstance(item, (dict, list)):
                lines.append(prefix + f"**item {index}**")
                lines.extend(render_bullets(item, indent + 1))
            else:
                lines.append(prefix + _scalar(item))
        return lines
    return [prefix + _scalar(value)]


def _extract_preflight_rules(text):
    matches = list(re.finditer(r"(?ms)^(\d{1,2}) .+?(?=^\d{1,2} |\Z)", text))
    numbers = [int(match.group(1)) for match in matches]
    if numbers != list(range(1, 21)):
        raise SystemExit(
            "MASKIN-COPILOT-PREFLIGHT.md must contain numbered rules 1..20")
    return [match.group(0).rstrip() for match in matches]


def _extract_braced_block(text, marker):
    marker_at = text.find(marker)
    if marker_at < 0:
        raise SystemExit(f"AI-BRIEFING.txt marker not found: {marker}")
    start = text.find("{", marker_at)
    if start < 0:
        raise SystemExit(f"AI-BRIEFING.txt block not found after: {marker}")
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    raise SystemExit(f"AI-BRIEFING.txt block is unclosed after: {marker}")


def _extract_qa(text):
    stages = re.findall(r"(?m)^## (Stage .+)$", text)
    commands = [match.rstrip() for match in re.findall(
        r"(?ms)^```bash\s*\n(.*?)^```$", text)]
    if not stages:
        raise SystemExit("MASKIN-QA-CHECKLIST.md has no stage headings")
    if not commands:
        raise SystemExit("MASKIN-QA-CHECKLIST.md has no bash command blocks")
    return stages, commands


def _evidence_entries(rules, maskin, profile):
    named = set(re.findall(
        r"\bE\d+\b",
        json.dumps([maskin, profile], ensure_ascii=False),
    ))
    named.update(f"E{number}" for number in range(9, 14))
    missing = named.difference(rules["evidence"])
    if missing:
        raise SystemExit(f"evidence entries are missing: {sorted(missing)}")
    return {
        name: rules["evidence"][name]
        for name in sorted(named, key=lambda item: int(item[1:]))
    }


def _role_inventory(maskin, profile):
    by_alias = collections.defaultdict(list)
    for obj in profile["objects"]:
        by_alias[obj["alias_text"]].append(obj)
    for objects in by_alias.values():
        objects.sort(key=lambda obj: (obj["top"], obj["left"], obj["name"]))

    used = collections.Counter()
    sections = []
    for role, details in maskin["roles"].items():
        rows = []
        for alias in details["aliases"]:
            occurrence = used[alias]
            try:
                obj = by_alias[alias][occurrence]
            except IndexError:
                raise SystemExit(
                    f"profile object missing for role {role!r}, alias {alias!r}")
            used[alias] += 1
            rows.append((obj["name"], obj["obj_id"], obj["alias_text"],
                         obj["tag_text"], obj["left"], obj["top"],
                         obj["width"], obj["height"], obj["zIndex"]))
        sections.extend([
            f"### {_table_cell(role)}",
            "",
            *render_bullets({key: value for key, value in details.items()
                             if key != "aliases"}),
            "- **aliases** — one row per source entry in the table below.",
            "",
            *render_table(
                ("name", "obj_id", "alias_text", "tag_text", "left", "top",
                 "width", "height", "zIndex"), rows),
            "",
        ])

    if sum(used.values()) != len(profile["objects"]):
        raise SystemExit("role inventory does not consume every profile object")
    return sections


def _vocabulary_table(vocabulary):
    rows = [
        (obj_id, details["count_E10"], details["sizes"], details["z_bands"])
        for obj_id, details in vocabulary.items()
    ]
    return render_table(("obj_id", "count_E10", "sizes", "z_bands"), rows)


def _evidence_table(evidence):
    rows = []
    for evidence_id, record in evidence.items():
        details = {key: value for key, value in record.items()
                   if key not in {"file", "role"}}
        rows.append((evidence_id, record.get("file", ""),
                     record.get("role", ""), details))
    return render_table(("id", "file", "role / what it is", "other fields"),
                        rows)


def _compressor_columns(maskin, profile):
    block = maskin["compressor_columns"]
    measured = block["measured"]
    if measured != profile["compressor_columns"]:
        raise SystemExit("panel and profile compressor columns disagree")

    lines = [
        "- **compressor_columns.measured** — one table per suction level below.",
        "- **profiles.TEMPLATE-10229.compressor_columns** — the same measured "
        "tables below.",
        f"- **scope** — {_scalar(block['scope'])}",
        f"- **evidence** — {_inline_value(block['evidence'])}",
        f"- **rule** — {_scalar(block['rule'])}",
        f"- **pitch_note** — {_scalar(block['pitch_note'])}",
        "",
    ]
    for side, roles in measured.items():
        rows = []
        pitches = {}
        for role, details in roles.items():
            for cell in details["cells"]:
                rows.append((role, cell["compressor"], cell["obj_id"],
                             cell["left"], cell["top"], cell["zIndex"]))
            pitches[role] = details["pitch"]
        lines.extend([
            f"#### {_table_cell(side)}",
            "",
            f"- **cells** — one row per measured cell; **pitch** — "
            f"{_inline_value(pitches)}",
            "",
            *render_table(("role", "compressor", "obj_id", "left", "top",
                           "zIndex"), rows),
            "",
        ])
    return lines


def _role_translations(maskin, profile):
    block = maskin["role_translations_mt_to_lt"]
    measured = block["measured"]
    if measured != profile["role_translations_mt_to_lt"]:
        raise SystemExit("panel and profile MT-to-LT translations disagree")

    by_alias = collections.defaultdict(list)
    for obj in profile["objects"]:
        by_alias[obj["alias_text"]].append(obj)

    rows = []
    for role, details in measured.items():
        mt_objects = by_alias[role]
        lt_objects = by_alias[details["to"]]
        if len(mt_objects) != 1 or len(lt_objects) != 1:
            raise SystemExit(f"translation role is not unique: {role}")
        mt = mt_objects[0]
        lt = lt_objects[0]
        rows.append((role, details["to"], f"({mt['left']}, {mt['top']})",
                     f"({lt['left']}, {lt['top']})",
                     f"({details['delta'][0]}, {details['delta'][1]})"))

    return [
        "- **role_translations_mt_to_lt**",
        "- **measured** — one row per source role below.",
        "- **profiles.TEMPLATE-10229.role_translations_mt_to_lt** — the same "
        "measured rows below.",
        *render_bullets({key: value for key, value in block.items()
                         if key not in {"measured", "note"}}),
        "",
        *render_table(("role", "to", "MT coordinate", "LT coordinate", "delta"),
                      rows),
        "",
        *render_bullets({"note": block["note"]}),
    ]


def _anomalies(maskin, profile):
    anomalies = maskin["anomalies"]
    if anomalies != profile["anomalies"]:
        raise SystemExit("panel and profile anomalies disagree")
    rows = [(entry["object"], entry["alias"], entry["finding"],
             entry["treatment"]) for entry in anomalies]
    return [
        "- **anomalies** — one row per recorded anomaly below.",
        "- **profiles.TEMPLATE-10229.anomalies** — the same rows below.",
        "",
        *render_table(("object", "alias", "finding", "treatment"), rows),
    ]


def _link_map(link_map):
    signals = link_map["canonical_signals"]
    rows = [(alias, values[0], values[1])
            for alias, values in signals.items() if alias != "_comment"]
    return [
        *render_bullets({"_note": link_map["_note"]}),
        "",
        "### relink_recipe",
        "",
        *[_scalar(step) for step in link_map["relink_recipe"]],
        "",
        *render_bullets({"driver_id_anatomy": link_map["driver_id_anatomy"]}),
        "",
        "### canonical_signals",
        "",
        *render_bullets({"_comment": signals["_comment"]}),
        "",
        *render_table(("alias", "obj_id", "parameter tail"), rows),
    ]


def _artwork(block):
    metadata = {key: value for key, value in block.items()
                if key not in {"rules", "reproduce_per_source"}}
    rows = [(rule_id, details["rule"], details["defect"], details["scope"])
            for rule_id, details in block["rules"].items()]
    return [
        "- **artwork**",
        *render_bullets(metadata),
        "",
        "### rules",
        "",
        *render_table(("id", "rule", "defect", "scope"), rows),
        "",
        "### reproduce_per_source",
        "",
        *render_bullets(block["reproduce_per_source"]),
    ]


def _compare(block):
    metadata = {key: value for key, value in block.items()
                if key not in {"rules", "patch_scopes"}}
    return [
        "- **compare**",
        *render_bullets(metadata),
        "",
        "### rules",
        "",
        *render_table(("id", "rule"), block["rules"].items()),
        "",
        "### patch_scopes",
        "",
        *render_table(("scope", "contract"), block["patch_scopes"].items()),
    ]


def render_bundle():
    rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    preflight_text = PREFLIGHT_PATH.read_text(encoding="utf-8")
    qa_text = QA_PATH.read_text(encoding="utf-8")
    briefing_text = BRIEFING_PATH.read_text(encoding="utf-8")
    link_map = json.loads(LINK_MAP_PATH.read_text(encoding="utf-8"))

    maskin = rules["panel_types"]["maskin"]
    profile = rules["profiles"]["TEMPLATE-10229"]
    if tuple(maskin) != PANEL_KEYS:
        raise SystemExit(
            "panel_types.maskin keys changed; update the structural renderer")

    preflight_rules = _extract_preflight_rules(preflight_text)
    qa_stages, qa_commands = _extract_qa(qa_text)
    envelope = _extract_braced_block(
        briefing_text, "2. THE OUTPUT FILE - EXACT SHAPE (NORMATIVE)")
    object_template = _extract_braced_block(
        briefing_text, "3. THE OBJECT ENTRY - COPY THIS TEMPLATE EXACTLY")
    evidence = _evidence_entries(rules, maskin, profile)

    source_names = [path.relative_to(ROOT).as_posix() for path in SOURCE_PATHS]
    profile_metadata = {
        key: value for key, value in profile.items()
        if key not in {
            "objects", "compressor_columns", "role_translations_mt_to_lt",
            "absent_by_design", "anomalies",
        }
    }
    if maskin["absent_by_design"] != profile["absent_by_design"]:
        raise SystemExit("panel and profile absent-by-design roles disagree")

    precedence_rows = []
    for entry in rules["source_precedence"]:
        if "rank" in entry:
            precedence_rows.append((entry["rank"], "source", entry["source"]))
        else:
            precedence_rows.append(("", "rule", entry["rule"]))
    scope_rows = [(name, rules["scope_tags"][name])
                  for name in ("MASKIN", "TEMPLATE-10229", "GLOBAL")]

    lines = [
        "# Maskin knowledge bundle",
        "",
        "> **GENERATED — DO NOT HAND-EDIT.** Rebuild with "
        "`python build-maskin-knowledge.py` and verify with "
        "`python build-maskin-knowledge.py --check`.",
        "",
        "This is a single-file rendering of the live owners listed below. On "
        "any conflict, follow the rendered source precedence and the owner "
        "named by the relevant rule block.",
        "",
        "## Build sources",
        "",
        *[f"- `{name}`" for name in source_names],
        "",
        "## Source precedence",
        "",
        *render_table(("rank", "entry key", "source / rule"), precedence_rows),
        "",
        "## Scope tags used here",
        "",
        *render_table(("scope", "definition"), scope_rows),
        "",
        "## Global invariants",
        "",
        *render_bullets(rules["global_invariants"]),
        "",
        "## Evidence records referenced here",
        "",
        *_evidence_table(evidence),
        "",
        "## Copy source and negative example",
        "",
        "### File to copy",
        "",
        *render_bullets(rules["evidence"]["E10"]),
        "",
        "### Negative example",
        "",
        *render_bullets(rules["evidence"]["E11"]),
        "",
        "## The 20 preflight rules — verbatim",
        "",
    ]
    for rule in preflight_rules:
        lines.extend([rule, ""])

    lines.extend([
        "## Envelope shape",
        "",
        "Kept as JSON because the nested envelope shape itself is normative.",
        "",
        "```json",
        envelope,
        "```",
        "",
        "## The 17-field object template",
        "",
        "Kept as JSON because this is the literal object shape to copy.",
        "",
        "```json",
        object_template,
        "```",
        "",
        "## Maskin identity, canvas, composition, background, and z bands",
        "",
        "### Identity",
        "",
        *render_bullets({"identity": maskin["identity"]}),
        "",
        "### Owner document",
        "",
        *render_bullets({"owner_document": maskin["owner_document"]}),
        "",
        "### Canvas",
        "",
        *render_bullets({"canvas": maskin["canvas"]}),
        "",
        "### Composition",
        "",
        *render_bullets({"composition": maskin["composition"]}),
        "",
        "### Background",
        "",
        *render_bullets({"background": maskin["background"]}),
        "",
        "### Z indexes",
        "",
        *render_bullets({"z_indexes": maskin["z_indexes"]}),
        "",
        "## TEMPLATE-10229 profile metadata",
        "",
        *render_bullets(profile_metadata),
        "",
        "## Object vocabulary",
        "",
        "- **object_vocabulary** — one row per source entry below.",
        "",
        *_vocabulary_table(maskin["object_vocabulary"]),
        "",
        "## Role inventory with TEMPLATE-10229 coordinates",
        "",
        "- **roles** — one section per source role cluster below.",
        "- **profiles.TEMPLATE-10229.objects** — one table row per profile "
        "object below.",
        "",
        *_role_inventory(maskin, profile),
        "## Required and absent roles",
        "",
        "### Required roles",
        "",
        *render_bullets({"required_roles": maskin["required_roles"]}),
        "",
        "### Absent by design",
        "",
        *render_bullets({"absent_by_design": maskin["absent_by_design"]}),
        "- **profiles.TEMPLATE-10229.absent_by_design** — the same source "
        "values above.",
        "",
        "## Compressor columns and MT-to-LT translations",
        "",
        "### Compressor columns",
        "",
        *_compressor_columns(maskin, profile),
        "",
        "### MT-to-LT role translations",
        "",
        *_role_translations(maskin, profile),
        "",
        "## Setpoint pill",
        "",
        *render_bullets({"setpoint_pill": maskin["setpoint_pill"]}),
        "",
        "## Recorded anomalies",
        "",
        *_anomalies(maskin, profile),
        "",
        "## Request, sanitization, binding, and insert contracts",
        "",
        "### Request classes",
        "",
        *render_bullets({"request_classes": maskin["request_classes"]}),
        "",
        "### Sanitization",
        "",
        *render_bullets({"sanitization": maskin["sanitization"]}),
        "",
        "### Bindings",
        "",
        *render_bullets({"bindings": maskin["bindings"]}),
        "",
        "### Insert semantics",
        "",
        *render_bullets({"insert_semantics": maskin["insert_semantics"]}),
        "",
        "## Alias-to-Danfoss parameter map",
        "",
        *_link_map(link_map),
        "",
        "## Artwork rules M-A01–M-A09",
        "",
        *_artwork(maskin["artwork"]),
        "",
        "## Compare rules M-C01–M-C05",
        "",
        *_compare(maskin["compare"]),
        "",
        "## QA rule block",
        "",
        *render_bullets({"qa": maskin["qa"]}),
        "",
        "## Evidence still required",
        "",
        *render_bullets({"evidence_required": maskin["evidence_required"]}),
        "",
        "## QA stages",
        "",
        *[f"- {stage}" for stage in qa_stages],
        "",
        "## Exact QA commands",
        "",
    ])
    for command in qa_commands:
        lines.extend(["```bash", command, "```", ""])

    return "\n".join(lines).rstrip() + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if MASKIN-KNOWLEDGE-BUNDLE.md is out of date")
    args = parser.parse_args(argv)

    updated = render_bundle()
    current = (BUNDLE_PATH.read_text(encoding="utf-8")
               if BUNDLE_PATH.exists() else None)

    if args.check:
        if updated != current:
            print("MASKIN-KNOWLEDGE-BUNDLE.md is out of date; run "
                  "build-maskin-knowledge.py", file=sys.stderr)
            return 1
        print("MASKIN-KNOWLEDGE-BUNDLE.md is up to date")
        return 0

    BUNDLE_PATH.write_text(updated, encoding="utf-8")
    print(f"wrote {BUNDLE_PATH} from {len(SOURCE_PATHS)} source documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
