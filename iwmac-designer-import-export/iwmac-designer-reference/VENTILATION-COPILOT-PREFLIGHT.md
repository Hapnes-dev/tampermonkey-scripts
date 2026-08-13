IWMAC VENTILASJON PREFLIGHT. Work every step before emitting JSON.

1 PRECEDENCE, highest first. Never average two conflicting coordinates.
  1 panel JSON or screenshot supplied with this task  2 production export of
  the same panel and system type  3 VENTILATION-GEOMETRY-CONTRACT.md  4 panel
  rules in the reference CLAUDE.md  5 AI-BRIEFING.txt  6 PANEL-TYPE-GUIDE.md
  7 DESIGN-OBJECT-CATALOG.md  8 generic visual advice. Say which rank you
  worked from. A supplied export IS the geometric template.

2 NAME THE CASE, and the profile, before placing anything: new demo, copy of a
  production panel, edit of a supplied export, or background-only (Ventilasjon
  has no artwork, so say so and stop). Profiles with measured geometry:
  PROFILE-9099-ROTOR-DEMO, PROFILE-BINARY-FILTER-BACNET. If none fits, say so.

2b DECISION FLOW. Answer in order.
  1 User-supplied JSON present? Yes: patch that exact file (newest wins). No:
    select a named production template or profile. Never rebuild from memory.
    A missing workspace copy is not a deleted SharePoint file.
  2 Filter numeric Pa or binary Normal/Alarm? Numeric:
    numberV3_filter_with_diff_press. Binary: number_v3_filter_only plus one
    verified alarm. Do not fabricate Pa. Do not stretch the icon.
  3 BACnet ualarm requested or proven by the selected reference? Yes: read
    CLAUDE.md host facts, then add bacnet_ualarm_v1 per the authoring-guide
    matrix. No: keep the documented explicit alarm/fault strategy.
  4 Sibling panel for sidebar alignment? Yes: clone geometry by semantic role
    only. No: keep this panel's own sidebar geometry.
  5 Requested role absent from the parameter inventory? Leave unlinked or
    remove when source-truth cleanup is requested. Never invent the link.
  6 A component moved? Move the complete functional cluster (one vector).
  7 Before delivery: compare with source, validate, render, inspect crops,
    report exact changes and unresolved gaps.

2c WRONG vs CORRECT.
  Stretch filter to cross a duct / preserve size and move it.
  Move filter, leave alarm / move body + QD + alarm together.
  Keep RT600/RT601 with no inventory / keep empty number_360_room only.
  Copy 360.002 bindings / copy sidebar geometry only.
  Generic alarm circles when BACnet was requested / bacnet_ualarm_v1.
  ualarm on every linked object / evidence matrix (no sidebar setpoints).
  Match by array index / match by semantic role.
  Rebuild from memory / patch the newest supplied export.

3 NEVER INVENT a coordinate, obj_id, driver id, unit id, parameter alias, file
  path or navigation target. Missing evidence is reported, not filled in.
  Remove a navigation object whose target is unknown. Copy obj_id spelling
  exactly: numberV3_filter_with_diff_press, numberV3_outside_temp,
  V3_58px_fan_left_nrm, number_v3_cooler_2-way.

4 STRUCTURE. All 17 fields on every object: obj_id, name, id, posWidth,
  posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag,
  sub_group, driver_id, unit_id, unit_ref, alias_text. counts equal array
  lengths. names are object_0 to object_N, sequential, no gaps or duplicates.
  Integer pixels inside 1400 x 750. containers and graphics empty, no
  panel.image_svg, and the blank sidebar background is kept.

5 Z-INDEX BANDS, strings, never mixed with "default": 5 ducts, pipes,
  connectors, sidebar header bars. 15 dummy arrows. 20 sub-page navigation.
  40 equipment bodies. 110 value, setpoint and json boxes, filter, outside
  temperature. 300 dummy 2-way motor. 375 alarms, LEDs, pumps, valves.
  1100 text labels.

6 CLUSTERS ARE ATOMIC. Place every member or none, and relocate with ONE vector.
  Fan: body, airflow, motor output, alarm.
  Filter: inventory-driven — numberV3_filter_with_diff_press (numeric Pa) or
    number_v3_filter_only (binary guard) plus ONE alarm. Never fabricate Pa.
    Alarm travels with the body. Size is source-scoped; do not stretch.
  Rotor: rotor, alarm, output, efficiency, profile-supported temperatures only,
    and no decorative Rotor or VGV text.
  Cooling: body, supported temperatures, cooling output, alarm.
  Water heating: body, temperatures, output, alarm, circulation pump, 3-way
    valve. SB510 % without the pump and the valve is a defect.
  Electric heater: body, output, profile-supported alarm and status roles, and a
    run-status LED fully inside the body, clear of the tag and the value.
  Bypass: the duct stays continuous. Overlay the damper, never shorten the duct.

7 ATTACH EVERY VALUE: the connector edge must visibly meet what the value
  describes, be that a duct, a component, a valve or a damper. A box with
  nothing under its stub is a floating bubble and a defect. con_down sits ABOVE
  the target and points down, con_top sits BELOW and points up, con_left sits
  RIGHT of it and points left, con_right sits LEFT and points right.

8 ONE OWNER PER THING. One position value per damper, using the production horizontal
  damper objects where the profile does, not a generic dummy. One alarm per guarded
  component, beside or above it, clear of tags and captions. One object per piece of
  text: no free-standing caption repeating what an equipment or value object already
  renders, and KA502, Cool, Rotor, VGV and Kurver are the repeat offenders. Build
  each sidebar section once: no duplicate row label, value object or coordinate.

9 TEXT is UTF-8. Keep the degree sign, the cubic-metre sign and the Norwegian
  letters. Write RT401 °C with the real symbol, never gr C. If a transport
  mangles it, fix the transport, never degrade the panel text.

10 A NEW DEMO IS UNLINKED. id and driver_id are the literal string driver_id,
   linked is false, and link_name, link_tag, sub_group, unit_id, unit_ref,
   source_plant_id and plant_id are empty. Keep alias_text: it is what a human
   links by afterwards. Object count is not a quality target; role coverage is.

11 VERIFY IN ORDER. a Re-parse the JSON. b Run validate-ventilation-panel.py
   panel.json --profile PROFILE-9099-ROTOR-DEMO or PROFILE-BINARY-FILTER-BACNET,
   plus --compare SOURCE CANDIDATE --patch-scope when this is a modification,
   plus --sibling-sidebar when a sibling panel was named; dropping --profile
   only when no profile applies and saying so; zero errors is the bar. c Render
   at native 1400 x 750 and inspect the whole panel plus zoomed crops of the
   inlet dampers, both fans, rotor and bypass, both filters and their alarms,
   cooling coil, water heating coil, electric heater, room endpoint and every
   sidebar section, pointer moved away, because a hover tooltip is not panel
   content. d Reject overlapping or duplicated labels, detached values, stubs
   pointing into empty space, incomplete clusters, stretched symbols, orphaned
   filter alarms, duplicate ualarms, sidebar movement when geometry clone was
   requested. e Run validate-visual-correctness.py panel.json: the four
   deliberate overlap classes are live-over-ARTWORK; no live object may cover
   descriptive TEXT, and state values fit their longest allowed display value
   (VISUAL-CORRECTNESS-CONTRACT.md, GLOBAL). On a visual failure RESTART from
   the retained source export rather than patching a chain of compensating
   edits. Owners: geometry contract, authoring guide §11–§14, CLAUDE.md §13c
   for host .Ualarm behaviour. AI-BRIEFING.txt is a pointer, not a second owner.

12 REPORT the case, the precedence rank, the profile, every role you moved and
   why, and everything you could not verify. A stated gap is a valid deliverable
   and a guess is not; passing validation is not evidence the panel is correct.
