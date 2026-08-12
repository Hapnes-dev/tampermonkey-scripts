#!/usr/bin/env python3
"""Read plant parameter evidence without normalizing binding values.

Supported inputs: ``.xlsx``, ``.csv``, ``.json`` and the repository's
``iw_gen_driver_parameters`` ``.sql`` dump. Header spelling is normalized only
to locate columns. Cell values, especially ``driver_id`` and ``alias_text``,
remain exact strings so a validator can distinguish exact, normalized-only and
different values without silently authorizing a fuzzy match.

No third-party dependency and no network access.
"""

from __future__ import annotations

import csv
import importlib.util
import io
import json
import pathlib
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET


ROOT = pathlib.Path(__file__).resolve().parent
XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

CANONICAL_FIELDS = (
    "driver_id",
    "unit_id",
    "unit_name",
    "alias_text",
    "parameter_description",
    "application",
    "parameter_type",
    "hardware_datatype",
    "att",
    "eng_unit",
    "format_extra",
    "object_role",
    "controller_identity",
)

HEADER_ALIASES = {
    "driver_id": {
        "driver_id", "driverid", "parameter_driver_id", "parameter_id",
        "parameterid", "binding_id", "bindingid",
    },
    "unit_id": {
        "unit_id", "unitid", "controller_unit_id", "controllerunitid",
    },
    "unit_name": {
        "unit_name", "unitname", "controller_name", "controllername",
        "regulator_name", "regulatorname",
    },
    "alias_text": {
        "alias_text", "aliastext", "alias", "parameter_alias", "parameteralias",
        "selector_text", "selectortext", "chosen_name", "chosenname",
    },
    "parameter_description": {
        "parameter_description", "parameterdescription", "description",
        "parameter_text", "parametertext", "signal_description",
        "signaldescription",
    },
    "application": {"application", "app", "parameter_application"},
    "parameter_type": {
        "parameter_type", "parametertype", "datatype", "data_type",
        "value_type", "valuetype", "type",
    },
    "hardware_datatype": {
        "hardware_datatype", "hardwaredatatype", "hardware_type",
        "hardwaretype", "hw_datatype", "hwdatatype",
    },
    "att": {
        "att", "access", "access_type", "accesstype", "read_write",
        "readwrite", "rw",
    },
    "eng_unit": {
        "eng_unit", "engunit", "engineering_unit", "engineeringunit", "unit",
    },
    "format_extra": {
        "format_extra", "formatextra", "allowed_values", "allowedvalues",
        "value_map", "valuemap",
    },
    "object_role": {
        "object_role", "objectrole", "panel_role", "panelrole", "signal_role",
        "signalrole", "role",
    },
    "controller_identity": {
        "controller_identity", "controlleridentity", "controller_id",
        "controllerid", "regulator_identity", "regulatoridentity",
    },
}

HEADER_TO_FIELD = {
    alias: field
    for field, aliases in HEADER_ALIASES.items()
    for alias in aliases
}


class ParameterSourceError(ValueError):
    """The supplied parameter evidence cannot be interpreted deterministically."""


def normalize_header(value):
    """Normalize a heading, never a parameter value."""
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = re.sub(r"[^0-9a-zæøå]+", "_", text, flags=re.I)
    return text.strip("_")


def _text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def canonicalize_row(row):
    """Map known heading variants while preserving every cell value exactly."""
    if not isinstance(row, dict):
        return None
    result = {field: "" for field in CANONICAL_FIELDS}
    for key, value in row.items():
        normalized = normalize_header(key)
        field = HEADER_TO_FIELD.get(normalized)
        if field is None and normalized in result:
            field = normalized
        if field and not result[field]:
            result[field] = _text(value)
    if not result["parameter_description"]:
        result["parameter_description"] = result["alias_text"]
    if not result["alias_text"]:
        result["alias_text"] = result["parameter_description"]
    if not result["controller_identity"]:
        result["controller_identity"] = result["unit_id"]
    return result


def _rows_from_dicts(rows):
    canonical, malformed = [], 0
    for row in rows:
        converted = canonicalize_row(row)
        if converted is None:
            malformed += 1
        else:
            canonical.append(converted)
    return canonical, malformed


def _load_json(path):
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = next(
            (data[key] for key in ("rows", "parameters", "data")
             if isinstance(data.get(key), list)),
            None,
        )
        if rows is None:
            raise ParameterSourceError(
                f"{path.name}: JSON must be an array or carry rows/parameters/data"
            )
    else:
        raise ParameterSourceError(f"{path.name}: JSON parameter source is not an object or array")
    return _rows_from_dicts(rows)


def _load_csv(path):
    text = path.read_text(encoding="utf-8-sig")
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return _rows_from_dicts(csv.DictReader(io.StringIO(text), dialect=dialect))


def _shared_strings(archive):
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join(node.text or "" for node in item.findall(f".//{{{XLSX_NS}}}t"))
        for item in root.findall(f"{{{XLSX_NS}}}si")
    ]


def _column_index(reference):
    letters = re.match(r"[A-Za-z]+", reference or "")
    if not letters:
        return None
    value = 0
    for character in letters.group().upper():
        value = value * 26 + ord(character) - 64
    return value - 1


def _xlsx_cell(cell, shared):
    kind = cell.get("t")
    if kind == "inlineStr":
        return "".join(
            node.text or "" for node in cell.findall(f".//{{{XLSX_NS}}}t")
        )
    value = cell.find(f"{{{XLSX_NS}}}v")
    raw = "" if value is None or value.text is None else value.text
    if kind == "s":
        try:
            return shared[int(raw)]
        except (ValueError, IndexError):
            return raw
    return raw


def _xlsx_rows(archive, member, shared):
    root = ET.fromstring(archive.read(member))
    output = []
    for row in root.findall(f".//{{{XLSX_NS}}}sheetData/{{{XLSX_NS}}}row"):
        values = {}
        for cell in row.findall(f"{{{XLSX_NS}}}c"):
            index = _column_index(cell.get("r"))
            if index is not None:
                values[index] = _xlsx_cell(cell, shared)
        if not values:
            output.append([])
            continue
        output.append([values.get(index, "") for index in range(max(values) + 1)])
    return output


def _table_from_xlsx_rows(rows):
    for header_index, header in enumerate(rows):
        mapped = [
            HEADER_TO_FIELD.get(normalize_header(value), normalize_header(value))
            for value in header
        ]
        if "driver_id" not in mapped:
            continue
        dictionaries = []
        for values in rows[header_index + 1:]:
            if not any(str(value).strip() for value in values):
                continue
            dictionaries.append({
                header[column]: values[column] if column < len(values) else ""
                for column in range(len(header))
                if str(header[column]).strip()
            })
        return dictionaries
    return None


def _load_xlsx(path):
    dictionaries, malformed = [], 0
    try:
        with zipfile.ZipFile(path) as archive:
            shared = _shared_strings(archive)
            members = sorted(
                name for name in archive.namelist()
                if re.fullmatch(r"xl/worksheets/[^/]+\.xml", name)
            )
            for member in members:
                table = _table_from_xlsx_rows(_xlsx_rows(archive, member, shared))
                if table is not None:
                    dictionaries.extend(table)
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        raise ParameterSourceError(f"{path.name}: invalid XLSX: {exc}") from exc
    if not dictionaries:
        raise ParameterSourceError(
            f"{path.name}: no worksheet contains a driver_id column"
        )
    rows, bad = _rows_from_dicts(dictionaries)
    return rows, malformed + bad


def _load_sql(path):
    """Reuse the repository's live iw_gen_driver_parameters parser."""
    builder_path = ROOT / "build-romkontroll-fixture.py"
    spec = importlib.util.spec_from_file_location(
        "parameter_source_romkontroll_builder", builder_path
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    rows, malformed = module.parse_sql(path)
    canonical, extra_bad = _rows_from_dicts(rows)
    return canonical, malformed + extra_bad


def load_parameter_source(path):
    """Return canonical rows plus source metadata.

    Driver and alias values are not rewritten, case-folded or whitespace
    normalized. An exact-match validator must operate on the returned strings.
    """
    path = pathlib.Path(path)
    if not path.is_file():
        raise ParameterSourceError(f"parameter source does not exist: {path}")
    suffix = path.suffix.lower()
    loaders = {
        ".json": _load_json,
        ".csv": _load_csv,
        ".tsv": _load_csv,
        ".xlsx": _load_xlsx,
        ".sql": _load_sql,
    }
    loader = loaders.get(suffix)
    if loader is None:
        raise ParameterSourceError(
            f"{path.name}: unsupported parameter source {suffix or '(no extension)'}; "
            "use .xlsx, .csv, .json or .sql"
        )
    rows, malformed = loader(path)
    if not rows:
        raise ParameterSourceError(f"{path.name}: yielded no parameter rows")
    if not any(row.get("driver_id") for row in rows):
        raise ParameterSourceError(f"{path.name}: yielded no non-empty driver_id values")
    return {
        "path": str(path),
        "label": path.name,
        "kind": suffix.lstrip("."),
        "rows": rows,
        "malformed": malformed,
    }
