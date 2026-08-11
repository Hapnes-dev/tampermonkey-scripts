#!/usr/bin/env python3
"""Regenerate the Oversikt blocks of documentation-rules.json from the fixture.

    python build-oversikt-rules.py            # rewrite documentation-rules.json
    python build-oversikt-rules.py --check    # exit 1 if the file is out of date

Owns four regions of documentation-rules.json and nothing else:

    scope_tags.OVERSIKT, scope_tags.TEMPLATE-10113
    evidence.E14 .. evidence.E17, evidence.E22
    panel_types.oversikt
    profiles.TEMPLATE-10113

Every geometry number and every cluster is READ FROM
reference_data/oversikt-10113-sanitized.json at run time, so the
machine-readable contract cannot drift away from the fixture the validator
checks against. Prose - identity, routing, scope wording - is literal here,
because this script is the generator and editing the generator is the sanctioned
way to change generated output.

The cluster-role classification and the controller-identity rule are imported
from build-oversikt-fixture.py rather than restated, so there is exactly one
definition of what a controller cluster is.

No network access. Reads and writes only inside the reference directory.
"""

from __future__ import annotations

import argparse
import collections
import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"
FIXTURE_PATH = ROOT / "reference_data" / "oversikt-10113-sanitized.json"
PROFILE = "TEMPLATE-10113"


def _load_fixture_builder():
    spec = importlib.util.spec_from_file_location(
        "build_oversikt_fixture", ROOT / "build-oversikt-fixture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURE_BUILDER = _load_fixture_builder()
CLUSTER_ROLES = FIXTURE_BUILDER.CLUSTER_ROLES
ROLE_OF_OBJ_ID = FIXTURE_BUILDER.ROLE_OF_OBJ_ID
as_int = FIXTURE_BUILDER.as_int
envelope_of = FIXTURE_BUILDER.envelope_of
inventory = FIXTURE_BUILDER.inventory


# --------------------------------------------------------------------------
# Literal prose
# --------------------------------------------------------------------------

SCOPE_TAGS = {
    "OVERSIKT": (
        "Applies to Oversikt / store-overview panels - the spatial floor-plan "
        "panel type, including case-position panels and byggeplan-derived "
        "overviews. Confirmed on the plant-10113 production export (E14/E15) "
        "and on the 194-panel drawing survey. Does NOT apply to the "
        "navigation-hub Oversikt of a hotel panel set, which is an icon-tile "
        "menu and shares only the name."
    ),
    PROFILE: (
        "Geometry and cluster inventory of ONE named Oversikt: the plant-10113 "
        "store overview, 1400x750, 72 objects in 21 controller clusters over an "
        "embedded store-plan PNG. Reproduce it when repairing or copying THAT "
        "panel. Never treat its counts as a target for another store - a store "
        "has as many clusters as it has cooling positions."
    ),
}

IDENTITY = {
    "name": "Oversikt / store overview",
    "owner_document": "OVERSIKT-GENERATION-CONTRACT.md",
    "description": (
        "The spatial floor-plan panel: a drawing of the store, with one "
        "controller cluster placed ON each display case, cold room or freezer "
        "room it monitors. Search terms that name this panel type: Oversikt, "
        "store overview, case-position, byggeplan, disk, display case, cabinet, "
        "cold room, freeze room, controller cluster."
    ),
    "not_a_dashboard": (
        "An Oversikt is a MAP, not a dashboard. Its information content is "
        "WHERE each reading sits. Grouping the same objects into tidy cards, "
        "rows or a legend destroys the only thing the panel type exists to "
        "show, even when every object and every binding is otherwise correct."
    ),
    "controller": {
        "families_measured_on_E14": [
            "<plant>_AK3_AKC_... - Danfoss AK-CC case controllers on an AK3 "
            "gateway, unit_id NNN:NNN (60 of 72 objects)",
            "<plant>_EVDEVO_IJMODBUS_... - Carel EVD Evolution driver, unit_id "
            "CNN (6 of 72)",
            "<plant>_SLV_SLV_... - a third controller family, unit_id UNN (6 of 72)",
        ],
        "note": (
            "Recorded as measured. Do not infer a controller family from a "
            "store's name, and do not assume a store has only one."
        ),
    },
    "linking": (
        "unit_id IS the controller identity. Group by it first; fall back to "
        "the normalized driver-id prefix only where unit_id is empty. Never "
        "group by proximity when identity fields are present - proximity merges "
        "two adjacent cases into one cluster and splits one case whose symbols "
        "were nudged apart."
    ),
}

CLUSTER_RULES = {
    "definition": (
        "A controller cluster is every dynamic object bound to one case or room "
        "controller, placed together on the physical position that controller "
        "serves. It is the unit an Oversikt is counted in."
    ),
    "identity": {
        "primary": "unit_id",
        "fallback": (
            "the first five underscore-separated fields of driver_id "
            "(plant, system, driver family, line, address) - the controller, "
            "with the parameter tail dropped"
        ),
        "never": (
            "spatial proximity, alias text, or array adjacency. Proximity is a "
            "REPORTING aid: use it to say where a cluster landed, never to "
            "decide which cluster an object belongs to."
        ),
        "measured_on_E15": "21 of 21 clusters resolved from unit_id alone",
    },
    "roles": [
        {"role": role, "obj_id": obj_id} for role, obj_id in CLUSTER_ROLES
    ],
    "atomicity": (
        "Place every member of a cluster or none, and relocate a cluster with "
        "ONE vector. A cluster half-moved is worse than a cluster not moved: it "
        "reads as two positions."
    ),
    "partial_clusters_are_legitimate": (
        "A cluster is NOT required to have four members. On E15, 15 clusters "
        "carry all four roles and 6 carry alarm + value only - because those "
        "controllers expose no cooling or defrost relay to read. Coverage is "
        "derived from the SOURCE, never forced to four. Adding a cooling or "
        "defrost symbol to a two-member cluster invents a binding."
    ),
    "placement": (
        "Two levels, and they are NOT the same rule. CLUSTER level: every "
        "member of a cluster sits together on the case, cabinet or room that "
        "controller monitors in the background artwork; a cluster on empty "
        "floor, in a margin, or in a grid of cards is a defect even if its "
        "bindings are perfect. VALUE level: within that, the temperature/value "
        "object is centered on the equipment footprint itself - see "
        "value_centering. Satisfying the cluster level does not satisfy the "
        "value level: a cluster can be 'on the case' with its value box on the "
        "case's edge, on the equipment label, or on the cluster's own "
        "bounding-box center, and all three are defects."
    ),
    "anchor_object": (
        "The value object is the cluster's ANCHOR. Position it first, on the "
        "equipment center, then place the other roles at the offsets the "
        "SOURCE panel uses relative to it. Measured on E15 (21 clusters) and "
        "independently on E22 (32 clusters): the value box is the cluster's "
        "left edge and the alarm bell sits 35 px above it - E15 alarm "
        "(dx+4,dy-35) from the value box, E22 alarm (dx+5,dy-35) on 32 of 32. "
        "What generalizes is the ANCHOR RELATIONSHIP, not the pixel offsets; "
        "read those from the panel in hand."
    ),
}

# The seven terms. They are separate concepts and the documentation set may
# never use one where it means another - that interchangeability is the
# ambiguity that produced the 2026-08-11 correction.
GEOMETRY_TERMS = {
    "_note": (
        "Seven distinct geometric concepts. Use these names verbatim. Two of "
        "them are about the ARTWORK, three about the OBJECTS, one about "
        "IDENTITY and one about the absence of evidence, and collapsing any "
        "two of them is a defect in the document, not a matter of style."
    ),
    "equipment_footprint": (
        "The visible physical outline, in the background artwork, of the case, "
        "cabinet, cold room, freezer room or other equipment that ONE "
        "controller monitors: the drawn blue box, room rectangle or cabinet "
        "outline. It is a property of the ARTWORK. A panel JSON does not "
        "contain it, and no script can derive it from one."
    ),
    "equipment_center": (
        "The geometric center of the equipment footprint, expressed in "
        "PANEL-CANVAS coordinates. If the footprint was measured on an image "
        "of a different resolution, it is the scaled center - see "
        "value_centering.scale."
    ),
    "value_anchor": (
        "The position of the temperature/value object "
        "(number_v3_40px_no_conn_no_tag on both measured panels): its top-left "
        "corner, such that the object's own center coincides with the "
        "equipment center. This is the coordinate the centering rule computes."
    ),
    "controller_cluster_geometry": (
        "The relative arrangement of one controller's objects - alarm, value, "
        "cooling, defrost - and the bounding box they span. Cluster cohesion "
        "still applies (O-G03). The cluster BOUNDING-BOX CENTER IS NOT THE "
        "EQUIPMENT CENTER and must never be substituted for it: on both "
        "measured panels the cluster extends ~35 px above and ~50 px below the "
        "value box, so its bounding-box center sits well below the value box "
        "the rule is about."
    ),
    "label_anchor": (
        "The position of a text label in the artwork - the equipment name, the "
        "regulator name, a room caption, an OCR hit. It is IDENTITY EVIDENCE: "
        "it tells you WHICH controller belongs to which footprint. It is NOT "
        "PLACEMENT GEOMETRY. Centering a value object on a label is the "
        "specific defect the 2026-08-11 correction was issued against."
    ),
    "combined_footprint": (
        "The union of two or more visibly connected physical sections served "
        "by ONE controller - an A/B case, a two-door cabinet on one regulator. "
        "The value object is centered on the union, NOT on either half. Use it "
        "only where supplied evidence establishes the controller-to-sections "
        "relationship; a shared wall in the drawing is not by itself evidence "
        "that one controller serves both."
    ),
    "unmeasurable_target": (
        "The state in which the footprint, or the controller-to-footprint "
        "relationship, cannot be established from the supplied evidence. It is "
        "a REPORTABLE OUTCOME, not a licence to approximate. Name the "
        "controller, name what is missing, and leave the object where the "
        "source put it."
    ),
}

VALUE_CENTERING = {
    "rule": (
        "Identify the visible physical footprint of the case, cabinet, cold "
        "room, freezer room or other equipment the controller monitors, and "
        "center the temperature/value object on THAT footprint - unless a "
        "higher-precedence supplied production panel proves a different "
        "placement."
    ),
    "scope": "OVERSIKT",
    "evidence": ["E22"],
    "validator": "O-G08",
    "never_center_on": [
        "the equipment label or the regulator name (that is a label_anchor - "
        "identity evidence, not geometry)",
        "the controller cluster's bounding box",
        "an approximate text or OCR coordinate",
        "empty floor space, an aisle, or a margin",
        "the nearest artwork feature when the footprint boundary is not "
        "visually established",
    ],
    "formula": {
        "given": ("value object width w and height h, and the measured "
                  "footprint (x, y, width, height) in panel-canvas coordinates"),
        "value_left": "round(x + (width - w) / 2)",
        "value_top": "round(y + (height - h) / 2)",
        "rounding": (
            "HALF UP, on .5 exactly. Python's built-in round() is banker's "
            "rounding and returns 2 for round(2.5); use floor(value + 0.5). "
            "The validator's half_up() helper is the reference implementation."
        ),
    },
    "object_size": (
        "Use the SOURCE-PROVEN object size. number_v3_40px_no_conn_no_tag "
        "measures 42x22 on both E15 and E22, but that is a measurement of two "
        "panels, not a constant: never silently force 42x22 onto a "
        "higher-precedence supplied panel that uses another size. Read w and h "
        "off the object being moved."
    ),
    "scale": {
        "rule": (
            "The computed center must be in PANEL-CANVAS coordinates. If the "
            "footprint was measured on a PNG or screenshot at another "
            "resolution, state the scale factors and apply them before "
            "computing the final integer position."
        ),
        "scale_x": "panel_width / image_width",
        "scale_y": "panel_height / image_height",
        "apply_to": (
            "the footprint, or its center - either order, as long as it is "
            "stated. Do not scale the object's own width and height: the "
            "object is already in canvas pixels."
        ),
        "state_it": (
            "Both resolutions and both factors go in the delivery. A "
            "coordinate quoted without the resolution it was measured at is "
            "not evidence."
        ),
    },
    "combined_sections": (
        "Where one controller visibly serves a combined A/B case or a "
        "multi-section cabinet, center on the UNION of the controlled "
        "sections. Only when supplied evidence establishes that relationship - "
        "otherwise it is an unmeasurable_target."
    ),
    "no_footprint_no_coordinate": (
        "If the footprint or the controller-to-footprint relationship cannot "
        "be established, report the evidence gap. Do not infer a box from a "
        "nearby controller label, and do not invent a coordinate. A stated gap "
        "is a deliverable."
    ),
    "precedence": (
        "A supplied production JSON stays rank 1. Do NOT 'correct' a "
        "production position merely because it is not geometrically centered. "
        "Move it only when the user explicitly asks, or when higher-ranked "
        "evidence proves the current position wrong. Record the anomaly "
        "instead - that is what section 9 is for."
    ),
    "what_no_script_can_prove": (
        "A panel JSON contains no equipment-box boundaries. validate-oversikt-"
        "panel.py can only check centering when measured footprints are "
        "supplied with --footprints; without that flag it says so and proves "
        "nothing about centering. See footprint_evidence."
    ),
}

FOOTPRINT_EVIDENCE = {
    "_note": (
        "The optional sidecar that lets a script check value centering. It is "
        "a MEASUREMENT RECORD made by a human (or by a measuring tool) against "
        "the artwork, and it is evidence in exactly the sense the source-"
        "precedence table means: it can be wrong, it must name where it came "
        "from, and it never outranks a supplied production export."
    ),
    "file_format": "iwmac-oversikt-footprints, version 1",
    "generator": "build-oversikt-footprints.py",
    "consumed_by": [
        "validate-oversikt-panel.py --footprints FOOTPRINTS.json (O-G08..O-G10)",
        "render-oversikt-panel.py --footprints FOOTPRINTS.json (draws the "
        "measured box and its center under the objects)",
    ],
    "record_fields": {
        "unit_id": "the controller this footprint belongs to; matched exactly",
        "source": ("where the measurement came from: background-image, "
                   "screenshot, store-plan-pdf, supplied-panel, or measured-"
                   "by-hand"),
        "source_image_size": "[width, height] of the image measured on",
        "panel_size": "[width, height] of the panel canvas",
        "footprint": ("{left, top, width, height} of the equipment outline, in "
                      "SOURCE-IMAGE coordinates"),
        "value_object_size": "[w, h] of the value object being centered",
        "expected_value_position": ("optional {left, top}; when present it is "
                                    "cross-checked against the computed "
                                    "center, so a typo in the measurement is "
                                    "caught rather than enforced"),
        "evidence_note": ("free text: what was measured and how. An empty note "
                          "on a hand measurement is reported"),
        "production_proven": ("optional true - this position is proven by a "
                              "supplied production export. Deviation is then "
                              "reported as info, never as an error, because "
                              "rank 1 outranks a measurement"),
    },
    "synthetic_records_are_not_geometry": (
        "build-oversikt-footprints.py --synthetic derives a footprint by "
        "expanding each value object around its own center. That is TEST "
        "INSTRUMENTATION: it makes a pass case and a fail case runnable "
        "without shipping store artwork. It proves nothing about any store and "
        "must never be presented as a measurement."
    ),
}

COVERAGE = {
    "rule": (
        "Before editing or emitting an Oversikt, build the coverage matrix: one "
        "row per controller, columns alarm / value / cooling / defrost / label / "
        "source coordinate / background target / equipment footprint / value "
        "center. The matrix is derived from the highest-ranked source "
        "available, and it is completed BEFORE any object is written."
    ),
    "matrix_columns": [
        "controller", "alarm", "value", "cooling", "defrost", "label",
        "source coordinate", "background target", "equipment footprint",
        "value center",
    ],
    "footprint_column": (
        "equipment footprint and value center are the two columns the "
        "2026-08-11 correction added. Fill them with the measured footprint in "
        "panel-canvas coordinates and the value position it implies, or with "
        "the word UNMEASURED. A row that says UNMEASURED is a stated gap; a row "
        "with a plausible-looking coordinate and no measurement behind it is an "
        "invention."
    ),
    "counts_are_evidence_not_targets": (
        "Report per-type counts, and never treat them as a quota. 21/21/15/15 "
        "is what plant 10113 has. Another store has whatever its controllers "
        "expose. A candidate is judged against ITS OWN source, not against this "
        "fixture."
    ),
    "hard_stop": (
        "No final panel may be emitted until the cluster inventory is complete. "
        "If the inventory cannot be completed from the supplied evidence, the "
        "deliverable is the inventory plus a named gap, not a panel."
    ),
}

INPUT_ROUTING = {
    "_note": (
        "The decision tree. Read the inputs first, then pick exactly one row, "
        "then say in the delivery which row you used."
    ),
    "PDF only": {
        "have": "equipment and room names, no coordinates in panel pixel space",
        "produce": (
            "an explicitly UNLINKED DRAFT: clusters named from the plan's own "
            "labels, no driver ids, no unit ids, and a disclosed list of what "
            "the PDF could not supply"
        ),
        "must_not": (
            "present the draft as a finished panel, invent plant/tag/link data, "
            "or claim a coordinate the plan does not contain"
        ),
    },
    "screenshot only": {
        "have": "positions in image pixels, no bindings",
        "produce": (
            "an EXPLICITLY UNLINKED DRAFT whose geometry is read off the "
            "screenshot and scaled to the panel canvas, with scale_x and "
            "scale_y stated, plus a list of every unresolved "
            "controller-to-footprint relationship and every footprint whose "
            "boundary could not be established"
        ),
        "must_not": (
            "guess a driver id from a rendered value, present the draft as "
            "linked, or quote a coordinate without the resolution it was "
            "measured at"
        ),
    },
    "background image + equipment list": {
        "have": "artwork and an inventory, no measured coordinates",
        "produce": (
            "one cluster per listed position, anchored on the artwork feature "
            "that matches its name; unlinked unless bindings were supplied"
        ),
        "must_not": (
            "fall back to a tidy grid when the artwork identifies the positions"
        ),
    },
    "PNG + parameter workbook, no panel JSON": {
        "have": (
            "store artwork with identifiable physical positions, and a plant "
            "parameter workbook carrying driver_id, unit_id, alias and "
            "regulator information"
        ),
        "produce": (
            "a LINKED panel - but only when the workbook supplies VERBATIM "
            "binding evidence and the artwork supplies identifiable physical "
            "positions. State the image-to-canvas scale. Derive every value "
            "position from the EQUIPMENT FOOTPRINT (see value_centering), not "
            "from the label coordinate that identified the controller."
        ),
        "must_not": (
            "transcribe a binding approximately, center a value object on the "
            "label that named its controller, or emit a cluster for a "
            "controller whose footprint could not be established - report that "
            "one as an unmeasurable_target instead"
        ),
    },
    "production JSON supplied": {
        "have": "everything - geometry, ordering, bindings, background",
        "produce": (
            "the ENTIRE supplied document with only the named change applied. "
            "PRESERVE AND PATCH. Never rebuild."
        ),
        "must_not": (
            "emit only the changed objects, re-derive coordinates, renumber "
            "objects, or drop a cluster you were not asked to remove"
        ),
    },
    "production JSON + PDF or screenshot": {
        "have": "an authoritative panel plus a secondary description of it",
        "produce": (
            "the supplied JSON, patched only where the secondary source proves "
            "a specific difference, each patch named individually. Use the "
            "image ONLY to prove specific target coordinates - a measured "
            "footprint for a named controller - and record that measurement so "
            "it can be re-checked."
        ),
        "must_not": (
            "reconstruct the panel from the image, or let the PDF reduce it. A "
            "PDF may identify equipment and room names; it may NOT silently "
            "override or reduce a supplied production export. If the PDF shows "
            "fewer positions than the JSON contains, the PDF is incomplete - "
            "report the discrepancy, keep the clusters."
        ),
    },
    "two panel JSON files": {
        "have": "two exports that may or may not be the same panel",
        "produce": (
            "a COMPARISON FIRST - validate-oversikt-panel.py --compare A.json "
            "B.json. If they are functionally identical except for export "
            "metadata (exported_at, generator, saved_by, image_svg_trace), "
            "choose ONE as the source and say in the delivery which one and "
            "why."
        ),
        "must_not": (
            "merge geometry from both. A merged panel has no source, so no "
            "later --compare can check it, and neither original is any longer "
            "evidence for what it contains."
        ),
    },
    "panel JSON + verbal placement correction": {
        "have": (
            "an authoritative panel and a sentence describing what is wrong "
            "with it - 'the temperature bubble must be in the center of every "
            "box'"
        ),
        "produce": (
            "ONLY the named change, applied to every object the sentence "
            "covers, with a source-to-candidate field diff proving nothing "
            "else moved (see preserve_and_patch.patch_scope)."
        ),
        "must_not": (
            "widen the correction to objects it did not name, or - when the "
            "correction says 'like this' and points at visual evidence not "
            "present in the task - pretend that image_svg_trace or the "
            "embedded image_data proves an unmeasured coordinate. Name the "
            "missing evidence instead."
        ),
    },
}

PRESERVE_AND_PATCH = {
    "rule": (
        "When a production JSON is supplied it is the geometric and "
        "object-coverage template. Start from that document, change the named "
        "objects, and emit the whole thing."
    ),
    "preserve_verbatim": [
        "panel.image_data, panel.converted, panel.org_image_name, "
        "panel.image_name and the canvas dimensions",
        "every object's obj_id, posLeft, posTop, posWidth, posHeight and zIndex "
        "unless that object is the one being moved",
        "driver_id, unit_id, link_name, link_tag, sub_group, unit_ref and "
        "alias_text on every object",
        "array order, and the object_N names that follow it",
        "known anomalies - an inverted cluster, a tag_text of a single space, "
        "a duplicated alias. Report them; do not tidy them.",
    ],
    "steps": [
        "1. Treat the supplied JSON as THE SOURCE DOCUMENT. It is rank 1. "
        "Nothing else in the task outranks it, including the drawing it was "
        "made from.",
        "2. Inventory every object by controller and by role before changing "
        "anything. If the inventory cannot be completed, stop and deliver the "
        "inventory plus the named gap (coverage.hard_stop).",
        "3. Identify the objects the request actually affects - for a "
        "centering correction, the value objects and only those.",
        "4. Recalculate ONLY posLeft and posTop on those objects, from the "
        "measured equipment footprint (value_centering.formula).",
        "5. Preserve every other field on those objects byte-for-byte as far "
        "as serialization permits - including posWidth, posHeight, zIndex, "
        "tag_text and the string form of every numeric field.",
        "6. Preserve every non-target object completely unchanged.",
        "7. Preserve driver_id, unit_id, alias_text, obj_id, name, linked, "
        "link_name, link_tag, sub_group, unit_ref, zIndex, posWidth, "
        "posHeight, array order, counts, canvas dimensions, background fields "
        "and image_data.",
        "8. Do NOT rebuild from the PNG or the workbook. When a panel JSON is "
        "supplied and the request is a geometry patch, the panel JSON is the "
        "document being edited.",
        "9. Remove an export-only field ONLY where the host contract requires "
        "its removal for insert-ready JSON - image_svg_trace is the one such "
        "field. Record that removal as a HOST-CONSISTENCY action, listed "
        "separately from the geometry correction, so the delivery does not "
        "read as if the correction dropped half a megabyte of the document.",
    ],
    "patch_scope": {
        "rule": (
            "Diff the candidate against the source field by field, matched by "
            "controller and role, and prove the patch stayed inside its scope."
        ),
        "permitted_for_a_centering_patch": (
            "posLeft and posTop on temperature/value objects, and nothing "
            "else. No field difference at all on any other object."
        ),
        "everything_else": (
            "Any other difference FAILS QA unless it is disclosed and "
            "justified separately in the delivery. 'The exporter wrote it that "
            "way' is a justification only when the field is named in "
            "export_only_fields."
        ),
        "export_only_fields": ["panel.image_svg_trace", "envelope.exported_at",
                               "envelope.generator"],
        "validator": "O-C16",
        "command": ("python validate-oversikt-panel.py --compare SOURCE.json "
                    "CANDIDATE.json --patch-scope value-position"),
    },
    "never_blank_a_binding": (
        "A layout correction never clears driver_id, unit_id or alias_text. "
        "Blanking a real binding turns a working object into one that renders "
        "and reads nothing, and the failure is invisible in the JSON. Strip "
        "bindings ONLY when the task explicitly asks for a reusable, "
        "unlinked reference."
    ),
    "background_preservation": (
        "image_data, converted, org_image_name, the canvas dimensions and any "
        "transparency survive every edit. A candidate without the source's "
        "background is not the same panel, whatever its objects say. "
        "image_svg_trace is the one exception: it is export-only AI input, the "
        "host deletes it on insert, and it must not be re-emitted."
    ),
}

SANITIZATION = {
    "profile": "masked production reference",
    "why_not_the_unlinked_demo_contract": (
        "The unlinked demo contract (global_invariants.unlinked_demo_contract, "
        "used by TEMPLATE-10229) blanks unit_id and driver_id. On an Oversikt "
        "that deletes controller identity, which IS the structure the reference "
        "exists to carry. Oversikt references are masked instead, exactly as "
        "reference_data/real-vent-panel-example.json is."
    ),
    "mask": {
        "driver_id": "leading plant field only, replaced with NNNNN",
        "envelope.source_plant_id": "",
        "panel.plant_id": "",
        "panel.saved_by": "",
        "panel.org_image_name": "",
        "panel.image_name": "",
    },
    "preserve": [
        "unit_id - a bus address with no plant behind it binds to nothing",
        "linked, link_name, link_tag, sub_group, unit_ref - host literals",
        "alias_text - what a human relinks by",
        "all geometry, zIndex, tag_text, array order and image_data",
    ],
    "drop": ["panel.image_svg_trace"],
    "owner": "build-oversikt-fixture.py",
}

BACKGROUND = {
    "ownership": (
        "The background owns the static store: walls, room outlines, cabinet "
        "and case boxes, aisles, room-name captions, the store title. Designer "
        "objects own the live symbols only - the alarm bell, the temperature "
        "box, the cooling symbol and the defrost symbol. Nothing else."
    ),
    "never": (
        "Never bake a live value, an alarm colour or a dynamic symbol into the "
        "artwork, and never draw a temperature box in artwork that an object "
        "will also render. A drawn value is frozen at the moment the picture "
        "was made and nobody can tell by looking."
    ),
    "skin": "Light store-plan artwork. Never introduce a dark background.",
    "fields": {
        "converted": (
            "\"true\" plus panel.image_data (a data: URI) is how a raster "
            "background travels in an export"
        ),
        "image_svg": (
            "AI-authored vector background. Validated by iwdieValidateSvg and "
            "converted by iwdieSvgToDataUrl on insert."
        ),
        "image_svg_trace": (
            "WRITTEN BY EXPORT, NEVER BY A GENERATOR. An automatic vector trace "
            "of the raster background, supplied to an AI as input; the insert "
            "path deletes it. Emitting it is a defect."
        ),
        "priority_on_insert": [
            "a background file picked in the dialog",
            "panel.image_svg",
            "panel.image_data",
        ],
    },
}

VERIFICATION = {
    "report_format": [
        "the input class from input_routing, named exactly",
        "the source precedence rank worked from",
        "the controller coverage matrix, source versus candidate",
        "per-type counts, labelled as evidence and not as targets",
        "every cluster added, removed, moved or relinked, with its reason",
        "for a centering correction: the measured footprint of every equipment "
        "position touched, the image resolution it was measured at, scale_x "
        "and scale_y, and the value position each footprint implies",
        "the exact validator commands run and their output",
        "the render inspected, and what was checked in it - at controller-"
        "level crops when the question is whether a value box is centered",
        "every evidence gap, stated as a gap",
    ],
    "commands": [
        "python validate-oversikt-panel.py PANEL.json --profile TEMPLATE-10113",
        "python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json",
        "python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json "
        "--patch-scope value-position",
        "python validate-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json",
        "python build-oversikt-footprints.py PANEL.json -o FOOTPRINTS.json",
        "python render-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json",
    ],
    "what_the_commands_cannot_do": (
        "Without --footprints nothing here can see the artwork, so nothing "
        "here can prove a value object is centered on its case. The validator "
        "says so at runtime rather than staying silent about it. Stage C of "
        "OVERSIKT-QA-CHECKLIST.md remains the answer, and for a centering "
        "question it is answered at controller-level crops, not on the whole "
        "canvas."
    ),
}

CONFLICTS = [
    {
        "id": "OV-C1",
        "topic": "case-cluster member offsets",
        "claim_a": {
            "source": "reference_data/panel-conventions.json -> the_case_cluster",
            "text": ("alarm (dx12,dy0), temp box (dx7,dy22), cooling (dx10,dy35), "
                     "defrost (dx28,dy38), footprint ~62x66"),
            "scope": "fleet median over 28 clusters mined from 16 stores",
        },
        "claim_b": {
            "source": "E15, measured",
            "text": ("alarm (dx4,dy0), value (dx0,dy35), cooling (dx7,dy58), "
                     "defrost (dx7,dy58), footprint 42x86"),
            "scope": PROFILE,
        },
        "resolution": (
            "Both are recorded; neither is averaged. The fleet figure is a "
            "median across stores and is not the geometry of any one panel - in "
            "particular it separates cooling and defrost, which on E15 are "
            "exactly coincident. When a production export is supplied, its own "
            "offsets win. The fleet figure is for a store with no export."
        ),
    },
    {
        "id": "OV-C2",
        "topic": "cluster placement",
        "claim_a": {
            "source": ("reference_data/panel-conventions.json -> ai_implications, "
                       "and AI-BRIEFING.txt section 7b MODE B"),
            "text": ("emit one case cluster per cooling position laid out in a "
                     "neat grid, 90px column pitch, 90px row pitch"),
            "scope": "CLUSTER KIT only - a tray of parts the human then drags",
        },
        "claim_b": {
            "source": "OVERSIKT-GENERATION-CONTRACT.md",
            "text": ("every cluster is anchored on the physical case or room it "
                     "monitors; a grid of cards is a defect"),
            "scope": "OVERSIKT - any panel presented as finished",
        },
        "resolution": (
            "Scoped, not merged. The 90px grid is legitimate for the CLUSTER KIT "
            "deliverable and only there, and a kit must be labelled a kit. A "
            "panel delivered as an Oversikt is spatial. This is the exact "
            "confusion behind the 2026-08-10 incident."
        ),
    },
    {
        "id": "OV-C3",
        "topic": "the 3-member partial cluster",
        "claim_a": {
            "source": "reference_data/panel-conventions.json -> the_case_cluster",
            "text": "11 occurrences of a 3-member variant without the cooling symbol",
            "scope": "fleet",
        },
        "claim_b": {
            "source": "E15, measured",
            "text": "6 occurrences of a 2-member variant: alarm + value only",
            "scope": PROFILE,
        },
        "resolution": (
            "Both are real and neither generalizes. The rule that generalizes is "
            "the one both support: cluster membership is whatever the controller "
            "exposes, and is read from the source rather than assumed."
        ),
    },
    {
        "id": "OV-C4",
        "topic": "what the value object is positioned against",
        "claim_a": {
            "source": "E15 cluster anatomy, measured",
            "text": ("the value object sits at (dx0,dy35) from the cluster "
                     "bounding-box top-left - i.e. its position is stated "
                     "relative to the CLUSTER"),
            "scope": PROFILE,
        },
        "claim_b": {
            "source": ("OVERSIKT-GENERATION-CONTRACT.md value-centering rule, "
                       "from the 2026-08-11 correction (E22)"),
            "text": ("the value object is positioned on the EQUIPMENT "
                     "FOOTPRINT's center; the rest of the cluster is then "
                     "placed relative to IT"),
            "scope": "OVERSIKT",
        },
        "resolution": (
            "Scoped, not merged, and the direction of derivation is the whole "
            "point. The E15 anatomy is a MEASUREMENT of how one finished panel "
            "is arranged internally, and it stays exactly as measured - do not "
            "'correct' E15, and do not recompute its coordinates from a "
            "footprint nobody measured. The centering rule is a CONSTRUCTION "
            "rule for deciding where the value object goes in the first place. "
            "Read together: compute the value position from the equipment "
            "center, then lay out the other roles at the offsets the source "
            "panel uses relative to the value object. The two claims describe "
            "the same finished geometry from opposite ends and must never be "
            "averaged into 'center the cluster'."
        ),
    },
]

EVIDENCE = {
    "E14": {
        "file": ("Coop_Prix_Breiviken_complete_disks.json (user Downloads, "
                 "plant 10113, NOT committed)"),
        "committed": False,
        "why_not_committed": (
            "Carries a live plant id and 72 real driver ids; repo policy masks "
            "reference JSONs before commit."
        ),
        "sanitized": False,
        "panel": "Oversikt",
        "generator": "M365 Copilot - preserved production export",
        "role": (
            "The production export supplied with the 2026-08-10 Oversikt "
            "documentation task, and the panel the incident was about. Highest "
            "precedence source for TEMPLATE-10113."
        ),
    },
    "E15": {
        "file": "reference_data/oversikt-10113-sanitized.json",
        "committed": True,
        "sanitized": True,
        "masked_not_unlinked": True,
        "panel": "Oversikt",
        "derived_from": "E14",
        "role": (
            "E14 with the plant number masked to NNNNN inside every driver id "
            "and the plant/author/background-filename fields blanked, and "
            "nothing else touched: same 72 objects, same 21 clusters, same "
            "geometry, sizes, zIndex, tag_text, alias_text, unit_id, array order "
            "and byte-identical image_data. The committed TEMPLATE-10113 "
            "reference. Produced by build-oversikt-fixture.py."
        ),
        "dropped": ["panel.image_svg_trace"],
    },
    "E16": {
        "file": ("Coop_Prix_Breiviken_overview.json and "
                 "Coop_Prix_Breiviken_overview_v2.json (user Downloads, NOT committed)"),
        "committed": False,
        "kind": "negative example",
        "role": (
            "The two failed attempts at the same panel. v1 (10 624 bytes, "
            "background_embedded false) regrouped the store into dashboard-style "
            "blocks from a store-layout PDF. v2 (54 227 bytes, 1400x750, "
            "background embedded) imitated the production appearance but rebuilt "
            "only 9 of the 21 controller clusters, some off their positions. "
            "Their shapes are reproduced, without customer data, as the "
            "committed negative fixtures in E17."
        ),
    },
    "E17": {
        "file": "build-oversikt-negatives.py (generator committed, output not)",
        "committed": "the generator, not the documents",
        "sanitized": True,
        "derived_from": "E15",
        "role": (
            "Seven synthetic negatives derived from E15, each breaking exactly "
            "one rule: dashboard regrouping, nine-cluster reconstruction, a "
            "cluster moved out of its room, a duplicated cluster, stripped "
            "links, a missing embedded background, and a forced four-object "
            "assumption that invents cooling and defrost bindings on partial "
            "clusters. tests/test_oversikt_10113_contract.py builds them in "
            "memory; the CLI writes them to survey-tmp/ for hand runs."
        ),
        "why_the_documents_are_not_committed": (
            "Each embeds the same 48 kB store-plan PNG, and base64 does not "
            "delta-compress - seven copies would add most of a megabyte to "
            "express seven one-line differences. The mutation is the artifact "
            "worth versioning. Same reasoning as "
            "tests/test_maskin_10229_contract.py, which mutates its fixture in "
            "memory rather than shipping a file per defect."
        ),
        "warning": (
            "forced-four-object deliberately contains driver ids naming "
            "parameters those controllers do not expose. Never copy an object "
            "out of it."
        ),
    },
    "E22": {
        "file": ("iwmac-panel_10240_oversikt_20260811-1308.json (user "
                 "Downloads, plant 10240, NOT committed)"),
        "committed": False,
        "why_not_committed": (
            "Carries a live plant id and 128 real driver ids; repo policy "
            "masks reference JSONs before commit. No masked fixture was "
            "derived from it either - the repository already has one measured "
            "Oversikt profile, and a second would invite exactly the "
            "cross-store averaging OV-C1 forbids."
        ),
        "sanitized": False,
        "panel": "Oversikt",
        "role": (
            "The 2026-08-11 value-centering correction, and the evidence "
            "behind panel_types.oversikt.value_centering. A different store "
            "from E14/E15: 1400x750, 128 objects in 32 controller clusters, "
            "all four roles on all 32, one AK3_AKC controller family, "
            "image_data 64 214 chars, image_svg_trace present (806 506 chars) "
            "because it is an EXPORT - which is why validate-oversikt-panel.py "
            "reports O-S08 on it and why an insert-ready result derived from "
            "it must drop that field."
        ),
        "what_it_proves": [
            "The correction was 'the temperature bubble must be in the center "
            "of every box' - a VALUE-object rule, not a cluster rule. The "
            "first attempt had correct bindings and complete clusters and was "
            "still wrong, because the objects were built around approximate "
            "label or cluster anchors.",
            "The value object is the cluster anchor: alarm at (dx+5,dy-35) "
            "from the value box on 32 of 32 clusters, corroborating E15's "
            "(dx+4,dy-35) across a different store.",
            "The value object measures 42x22 here as on E15 - two panels, not "
            "a constant.",
        ],
        "what_it_does_NOT_prove": (
            "No coordinate in it generalizes to another plant. The equipment "
            "footprints it was centered against are properties of the 10240 "
            "store plan and were not recorded as a committed measurement; the "
            "panel alone does not contain them."
        ),
    },
}


# --------------------------------------------------------------------------
# Measured blocks
# --------------------------------------------------------------------------

def load_fixture():
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def objects_of(document):
    return envelope_of(document)["panel"]["single_objects"]


def measured_vocabulary(objects):
    sizes = collections.defaultdict(set)
    bands = collections.defaultdict(set)
    for obj in objects:
        sizes[obj["obj_id"]].add((as_int(obj["posWidth"]), as_int(obj["posHeight"])))
        bands[obj["obj_id"]].add(str(obj["zIndex"]))
    counts = collections.Counter(o["obj_id"] for o in objects)
    out = {}
    for role, obj_id in CLUSTER_ROLES:
        if obj_id not in counts:
            continue
        out[obj_id] = {
            "role": role,
            "count_E15": counts[obj_id],
            "sizes": [f"{w}x{h}" for w, h in sorted(sizes[obj_id])],
            "z_bands": sorted(bands[obj_id]),
            "aliases_E15": [
                alias for alias, _ in collections.Counter(
                    o["alias_text"] for o in objects if o["obj_id"] == obj_id
                ).most_common()
            ],
        }
    return out


def measured_bands(objects):
    by_z = collections.defaultdict(collections.Counter)
    for obj in objects:
        by_z[str(obj["zIndex"])][obj["obj_id"]] += 1
    return {
        z: {"count_E15": sum(c.values()), "obj_ids": sorted(c)}
        for z, c in sorted(by_z.items(), key=lambda kv: as_int(kv[0]) or 0)
    }


def measured_anatomy(clusters):
    offsets = collections.defaultdict(collections.Counter)
    for entry in clusters.values():
        left, top, _, _ = entry["bbox"]
        for obj in entry["members"]:
            role = ROLE_OF_OBJ_ID.get(obj["obj_id"], obj["obj_id"])
            offsets[role][(as_int(obj["posLeft"]) - left,
                           as_int(obj["posTop"]) - top)] += 1
    anatomy = {}
    for role, _ in CLUSTER_ROLES:
        seen = offsets.get(role)
        if not seen:
            continue
        anatomy[role] = {
            "offsets_from_cluster_top_left": [
                {"dx": dx, "dy": dy, "count": n} for (dx, dy), n in seen.most_common()
            ],
            "dominant": list(seen.most_common(1)[0][0]),
        }
    footprints = collections.Counter()
    for entry in clusters.values():
        left, top, right, bottom = entry["bbox"]
        shape = tuple(sorted(entry["roles"]))
        footprints[(shape, right - left, bottom - top)] += 1
    anatomy["_footprints"] = [
        {"roles": list(shape), "width": w, "height": h, "count": n}
        for (shape, w, h), n in footprints.most_common()
    ]
    anatomy["_warning"] = (
        "These are the offsets THIS panel used, measured, not a construction "
        "rule for another store. Never average them with the fleet medians in "
        "panel-conventions.json - see conflicts OV-C1."
    )
    return anatomy


def measured_clusters(clusters):
    out = []
    for entry in clusters.values():
        left, top, right, bottom = entry["bbox"]
        out.append({
            "controller": entry["key"],
            "identity_from": entry["origin"],
            "roles": {role: entry["roles"].get(role, 0) for role, _ in CLUSTER_ROLES},
            "members": len(entry["members"]),
            "bbox": [left, top, right, bottom],
            "size": [right - left, bottom - top],
            "objects": sorted(o["name"] for o in entry["members"]),
        })
    return out


def measured_anomalies(objects, clusters):
    anomalies = []
    coincident = collections.defaultdict(list)
    for obj in objects:
        coincident[(as_int(obj["posLeft"]), as_int(obj["posTop"]))].append(obj)
    pairs = [(pos, objs) for pos, objs in sorted(coincident.items()) if len(objs) > 1]
    if pairs:
        anomalies.append({
            "finding": (
                f"{len(pairs)} coordinate pairs carry two coincident objects; in "
                f"every case the pair is cooling + defrost on one controller"
            ),
            "treatment": (
                "DELIBERATE, not an overlap defect. The two 28x28 refrigeration "
                "symbols share one position and the host renders whichever state "
                "is active. An overlap check that reports these is reporting "
                "noise; a candidate that separates them has changed the panel."
            ),
            "positions": [list(pos) for pos, _ in pairs],
        })
    for entry in clusters.values():
        alarm = next((o for o in entry["members"]
                      if ROLE_OF_OBJ_ID.get(o["obj_id"]) == "alarm"), None)
        value = next((o for o in entry["members"]
                      if ROLE_OF_OBJ_ID.get(o["obj_id"]) == "value"), None)
        if alarm and value and as_int(alarm["posTop"]) > as_int(value["posTop"]):
            anomalies.append({
                "controller": entry["key"],
                "finding": (
                    f"the alarm bell sits BELOW the value box "
                    f"(alarm y={as_int(alarm['posTop'])}, "
                    f"value y={as_int(value['posTop'])}) - the cluster is inverted"
                ),
                "treatment": (
                    "preserved verbatim in E15; the artwork under it is what "
                    "decides. Do not normalise it away when copying this panel."
                ),
            })
    boxes = [(o, (as_int(o["posLeft"]), as_int(o["posTop"]),
                  as_int(o["posLeft"]) + as_int(o["posWidth"]),
                  as_int(o["posTop"]) + as_int(o["posHeight"]))) for o in objects]
    crossing = []
    for i, (a, (al, at, ar, ab)) in enumerate(boxes):
        for b, (bl, bt, br, bb) in boxes[i + 1:]:
            over_w, over_h = min(ar, br) - max(al, bl), min(ab, bb) - max(at, bt)
            if over_w <= 2 or over_h <= 2:
                continue
            if a["unit_id"] == b["unit_id"]:
                continue
            crossing.append({
                "objects": [a["name"], b["name"]],
                "controllers": [a["unit_id"], b["unit_id"]],
                "roles": [ROLE_OF_OBJ_ID.get(a["obj_id"], a["obj_id"]),
                          ROLE_OF_OBJ_ID.get(b["obj_id"], b["obj_id"])],
                "overlap": [over_w, over_h],
            })
    if crossing:
        anomalies.append({
            "finding": (f"{len(crossing)} pair(s) of objects belonging to DIFFERENT "
                        f"controllers overlap by more than a hairline"),
            "treatment": (
                "preserved verbatim in E15. Two cases stand close enough on the "
                "plan that their symbols clip; the store, not the panel, decides "
                "that. Reported as a warning, never silently corrected - moving "
                "one of them moves a cluster off its case."
            ),
            "pairs": crossing,
        })

    spaced = sum(1 for o in objects if o["tag_text"] == " ")
    if spaced:
        anomalies.append({
            "finding": (f"{spaced} objects carry a tag_text of a single space, "
                        f"not an empty string"),
            "treatment": "preserved verbatim in E15; do not normalise it away",
        })
    return anomalies


def composition(objects, clusters):
    shapes = collections.Counter(tuple(sorted(c["roles"])) for c in clusters.values())
    return {
        "single_objects": len(objects),
        "containers": 0,
        "graphics": 0,
        "distinct_obj_ids": len({o["obj_id"] for o in objects}),
        "controller_clusters": len(clusters),
        "cluster_shapes": [
            {"roles": list(shape), "count": n} for shape, n in shapes.most_common()
        ],
        "scope": PROFILE,
        "evidence": ["E14", "E15"],
        "note": (
            "Fleet median is 132 objects across 44 Oversikt panels "
            "(PANEL-TYPE-GUIDE.md). 72 is this panel. NEITHER IS A TARGET: a "
            "store has as many clusters as it has cooling positions, and the "
            "only correct count for a candidate is the count its own source "
            "proves."
        ),
    }


def panel_type_block(document):
    objects = objects_of(document)
    clusters = inventory(objects)
    return {
        "identity": IDENTITY,
        "owner_document": "OVERSIKT-GENERATION-CONTRACT.md",
        "canvas": {
            "width": 1400,
            "height": 750,
            "scope": "OVERSIKT",
            "evidence": ["E14", "E15"],
            "override": "Match the plant if a supplied export says otherwise.",
        },
        "background": BACKGROUND,
        "composition": composition(objects, clusters),
        "z_indexes": {
            "mode": ("explicit bands OR the literal string \"default\" - never "
                     "mixed in one panel"),
            "bands": measured_bands(objects),
            "scope": "OVERSIKT",
            "evidence": ["E14", "E15"],
            "conflict": (
                "These are NOT the Maskin bands and NOT the Ventilasjon bands. "
                "On E15 the value box is 110 and all three circular symbols are "
                "375, so the symbols draw OVER the value box where they overlap. "
                "The bands are per panel type."
            ),
        },
        "object_vocabulary": measured_vocabulary(objects),
        "geometry_terms": GEOMETRY_TERMS,
        "cluster": dict(CLUSTER_RULES, anatomy_E15=measured_anatomy(clusters)),
        "value_centering": VALUE_CENTERING,
        "footprint_evidence": FOOTPRINT_EVIDENCE,
        "coverage": COVERAGE,
        "input_routing": INPUT_ROUTING,
        "preserve_and_patch": PRESERVE_AND_PATCH,
        "sanitization": SANITIZATION,
        "verification": VERIFICATION,
        "conflicts": CONFLICTS,
        "anomalies": measured_anomalies(objects, clusters),
    }


def profile_block(document):
    env = envelope_of(document)
    panel = env["panel"]
    objects = objects_of(document)
    clusters = inventory(objects)
    return {
        "title": "Plant-10113 store overview (Coop Prix Breiviken)",
        "scope": PROFILE,
        "evidence": ["E14", "E15"],
        "derived_from": (f"{FIXTURE_PATH.relative_to(ROOT).as_posix()}, generated "
                         f"by build-oversikt-rules.py"),
        "panel_type": "oversikt",
        "canvas": [as_int(panel["panel_width"]), as_int(panel["panel_height"])],
        "object_count": len(objects),
        "cluster_count": len(clusters),
        "distinct_obj_ids": len({o["obj_id"] for o in objects}),
        "background": {
            "converted": panel.get("converted"),
            "image_data_chars": len(panel.get("image_data") or ""),
            "image_svg": bool(panel.get("image_svg")),
            "note": (
                "The store-plan raster travels with the fixture. It is the "
                "artwork every coordinate below was measured against; rendering "
                "a candidate on any other background answers a different "
                "question."
            ),
        },
        "applies_when": (
            "The task supplies this panel, names TEMPLATE-10113, or asks for a "
            "repair or copy of the 10113 store overview. It does NOT apply to "
            "another store: another store has different cases, a different plan "
            "and a different number of controllers."
        ),
        "objects": [
            {
                "name": obj["name"],
                "obj_id": obj["obj_id"],
                "role": ROLE_OF_OBJ_ID.get(obj["obj_id"], "-"),
                "unit_id": obj["unit_id"],
                "alias_text": obj["alias_text"],
                "tag_text": obj["tag_text"],
                "left": as_int(obj["posLeft"]),
                "top": as_int(obj["posTop"]),
                "width": as_int(obj["posWidth"]),
                "height": as_int(obj["posHeight"]),
                "zIndex": str(obj["zIndex"]),
            }
            for obj in objects
        ],
        "clusters": measured_clusters(clusters),
        "cluster_anatomy": measured_anatomy(clusters),
        "anomalies": measured_anomalies(objects, clusters),
    }


def apply(rules):
    document = load_fixture()
    rules.setdefault("scope_tags", {}).update(SCOPE_TAGS)
    rules.setdefault("evidence", {}).update(EVIDENCE)
    rules.setdefault("panel_types", {})["oversikt"] = panel_type_block(document)
    rules.setdefault("profiles", {})[PROFILE] = profile_block(document)
    return rules


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if documentation-rules.json is out of date")
    args = parser.parse_args(argv)

    current = RULES_PATH.read_text(encoding="utf-8")
    rules = apply(json.loads(current))
    updated = json.dumps(rules, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        if updated != current:
            print("documentation-rules.json is out of date; run "
                  "build-oversikt-rules.py", file=sys.stderr)
            return 1
        print("documentation-rules.json is up to date")
        return 0

    RULES_PATH.write_text(updated, encoding="utf-8")
    print(f"wrote {RULES_PATH} - panel_types.oversikt and profiles.{PROFILE} "
          f"regenerated from "
          f"{rules['profiles'][PROFILE]['object_count']} fixture objects in "
          f"{rules['profiles'][PROFILE]['cluster_count']} clusters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
