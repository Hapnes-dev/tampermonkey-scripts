IWMAC OVERSIKT PREFLIGHT. Store overview, case positions, byggeplan. Terms this
covers: Oversikt, store overview, case-position panel, byggeplan, disk, display
case, cabinet, cold room, freeze room, controller cluster, alarm, temperature,
cooling, defrost. Work every step before emitting JSON.

LINKING — READ BEFORE RULE 1. Terms are defined once in AI-BRIEFING.txt §8b;
use them unchanged.

L1 linked = "true" is NOT proof of a correct binding.
L2 A non-empty, plant-prefixed or syntactically plausible driver_id is NOT proof.
L3 Resolve EVERY intended link exactly and uniquely in the supplied
   plant-specific parameter source; that source is mandatory for its scope.
L4 Verify driver_id, unit_id, controller identity, exact alias/parameter
   meaning, object role, access and datatype where supplied — together.
L5 NEVER construct, prefix-edit, suffix-match or transform driver IDs. NEVER
   infer AK2→AK3, 001:→000:, controller indexes or group digits.
L6 An unmatched, ambiguous or semantically incompatible object is UNRESOLVED,
   not finished. Fuzzy search may suggest candidates; it never authorizes one.
L7 Report intended, structurally linked, source-resolved, semantically verified
   and unresolved counts separately, plus the full binding matrix and evidence.
L8 NEVER say fully linked, linked-ready, production-ready or verified unless
   every intended link is semantically verified. Binding proof alone still does
   not prove production readiness.
L9 Preserve geometry, obj_id, object names, array order, zIndex and background
   while repairing bindings. "Preserve and patch" does NOT preserve a
   known-unverified link.
L10 Compare Oversikt controller clusters and alarm/value/cooling/defrost roles,
    NEVER array indexes or spatial proximity. Preserve object_10000-style names.

RELINK EXISTING PANEL. Trigger on: "link these objects", "link out these disks",
"find the objects on this picture", "these need linking", "I placed them where
they should be", "use this updated JSON", "match the screenshot to the parameter
Excel", "repair missing links on an Oversikt panel".

R1 CLASSIFY: binding-only, placement-only, binding+placement,
   add-missing-clusters, or validation/report-only. A newer user-corrected JSON
   means BINDING-ONLY unless the user explicitly asks for a layout change.
R2 NEWEST PANEL FIRST. It owns positions, dimensions, zIndex, order, names,
   background and object types. Screenshot/background identifies labels and
   relationships. Workbook owns exact unit/parameter/driver/type/access/index.
   NEVER average, re-space or replace corrected placement.
R3 INSPECT image_data first, image_svg_trace second, then enumerate all
   single_objects and match them spatially. Separate baked labels/rectangles
   from live objects. NEVER duplicate background artwork.
R4 MATCH ROLE + POSITION using geometry, obj_id, alias, driver, unit, label
   proximity and screenshot. NEVER use array position, last object, object_N,
   highest unit or rightmost object as equipment identity.
R5 PRESERVE in binding-only work: posLeft, posTop, posWidth, posHeight, zIndex,
   obj_id, name, order, arrays, metadata and background. Only exact-proven
   driver_id/unit_id/alias_text/linked may change. image_svg_trace is export-only
   input and is not emitted.
R6 OPEN ONE EQUIPMENT'S FULL WORKBOOK ROW SET. Minimal case/whitespace or
   evidence-backed display-suffix normalization locates candidates only.
   Resolve role from parameter name/group. COPY WHOLE DRIVER IDs. Copy unit_id
   only from evidence. Record every alarm choice and reason.
R7 MISSING UNIT = PER-CLUSTER STOP. NEVER infer next index, clone the prior unit,
   adapt a similar name or fabricate an id. Leave it unchanged/unlinked, report
   the exact label, continue independent verified clusters.
R8 REUSE nearby compatible live objects first. Add only genuinely absent live
   roles with valid obj_ids, sizes and evidence-backed relative offsets.
R9 VALIDATE exact workbook ids, role/equipment/family/unit agreement, counts,
   names, fields, duplicates, missing roles, unchanged visuals/background.
R10 RETURN importable panel JSON first; optional report second. Report unmatched
    labels. Partial is valid; partial is NEVER "fully linked".

Run:
  python validate-oversikt-panel.py --compare NEWEST-CORRECTED.json
    CANDIDATE.json --patch-scope binding-repair
    --parameters PARAMETERS.xlsx --task oversikt-existing-panel-relink
    --json-report

BAD: linked="true" + non-empty driver_id => valid.
GOOD: driver_id resolves exactly and uniquely in the supplied source; resolved
unit_id equals panel unit_id; controller identity and exact parameter meaning
match the display/alarm/cooling/defrost role; access/datatype are suitable =>
source-resolved and semantically verified.

HARD STOP: if any intended role is unresolved, deliver the verified subset,
matrix, exact source coverage, unresolved controllers/roles and missing
evidence. Retain unresolved original binding fields byte-for-byte and label them
UNVERIFIED in the external report; the panel schema has no verification field.
Run:
  python validate-oversikt-panel.py PANEL.json --parameters PARAMETERS.xlsx
For a repair, also:
  python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json
    --patch-scope binding-repair --parameters PARAMETERS.xlsx

1 AN OVERSIKT IS A MAP, NOT A DASHBOARD. It is a drawing of the store with one
  controller cluster placed ON each display case, cold room or freezer room it
  monitors. The information is WHERE each reading sits. Grouping the same
  objects into tidy cards, rows, columns or a legend destroys the only thing the
  panel type exists to show, even when every object and every binding is
  otherwise correct. A grid of cards is a CLUSTER KIT hand-off and must be
  labelled a kit, never delivered as a finished panel.

2 PRECEDENCE, highest first. Never average two conflicting coordinates.
  1 newest panel JSON supplied with this task  2 production export of the same
  panel and system type  3 current screenshot/background, for identifying
  equipment and visual relationships but NEVER for replacing corrected JSON
  coordinates  4 current plant workbook, authoritative for bindings only
  5 OVERSIKT-GENERATION-CONTRACT.md  6 panel rules in the reference CLAUDE.md
  7 AI-BRIEFING.txt  8 PANEL-TYPE-GUIDE.md  9 DESIGN-OBJECT-CATALOG.md
  10 generic visual advice. Say which rank and which evidence domain you used.
  A PDF or byggeplan drawing describes the store, not exact panel geometry.
  The catalogue proves an obj_id exists; it never decides placement or size.

3 ROUTE THE INPUT, and name the row you picked.
  PDF only, produce an explicitly UNLINKED DRAFT with the missing evidence
  disclosed by name. Screenshot or PNG only, an unlinked draft with the
  image-to-canvas scale factor stated as a number; a rendered picture of a panel
  is not the panel, so no binding, no obj_id and no z-index is proven by it.
  Background image plus a parameter workbook and no panel JSON, build: one
  cluster per instrumented position, every binding copied verbatim from the
  workbook, every value object centered on its measured footprint, and every
  position whose footprint you could not measure reported as a gap. Production
  JSON supplied, the ENTIRE supplied document with only the named change
  applied: PRESERVE AND PATCH, NEVER REBUILD. Production JSON plus a PDF,
  screenshot or PNG, the supplied JSON patched only where the secondary source
  proves a specific difference, each patch named individually - the image is
  evidence for COORDINATES, never a reason to rebuild. Two panel JSON files,
  compare them first and say which one you worked from and why; NEVER merge
  geometry from both, because a panel assembled from two sources matches neither
  store. Panel JSON plus a verbal placement correction, apply ONLY the named
  change; if "like this" points at visual evidence you were not given, name the
  missing evidence instead of pretending the SVG trace or the embedded image
  proves a coordinate you never measured.

4 THE PDF MAY NOT REDUCE THE PANEL. A store-layout drawing routinely omits
  instrumented positions and shows equipment that was never instrumented. If the
  PDF shows fewer positions than the JSON contains, THE PDF IS INCOMPLETE:
  report the discrepancy and KEEP THE CLUSTERS. This is the exact failure this
  document exists to prevent. A supplied export held 72 objects in 21 controller
  clusters; a rebuild from the PDF delivered 9 clusters, some off their
  positions, and it looked right.

5 INVENTORY BEFORE YOU EDIT. Build the controller inventory and the coverage
  matrix from the highest-ranked source BEFORE writing a single object. Columns:
  controller, alarm, value, cooling, defrost, label, source coordinate,
  background target. HARD STOP: no final panel until the inventory is complete.
  If it cannot be completed from the supplied evidence, the deliverable is the
  inventory plus a named gap, NOT a panel.

6 CONTROLLER IDENTITY. unit_id first, for example 000:011 or C50 or U86. Where
  unit_id is empty, fall back to the first five underscore fields of driver_id.
  NEVER group by spatial proximity when identity fields are present: proximity
  merges two adjacent cases into one cluster and splits one case whose symbols
  were nudged apart, and both mistakes look plausible on screen. Do not assume
  one controller family per store; the reference panel carries three.

7 COVERAGE IS DERIVED, NEVER FORCED TO FOUR. A cluster is every object bound to
  one controller: alarm bell, temperature or value box, cooling symbol, defrost
  symbol. On the reference panel 15 clusters carry all four roles and 6 carry
  alarm plus value only, because those controllers expose no cooling or defrost
  relay. Adding a cooling or defrost symbol to a two-member cluster INVENTS A
  BINDING. Report per-type counts and never treat them as a quota: counts are
  evidence, not targets, and a candidate is judged against ITS OWN source, never
  against another store or a fleet median.

8 CLUSTERS ARE ATOMIC AND SPATIAL. Place every member of a cluster or none, and
  relocate a cluster with ONE vector applied to every member. A cluster
  half-moved reads as two positions. Center or anchor each cluster on the case,
  cabinet or room it monitors in the background artwork. A cluster on empty
  floor, in a margin, or in a grid is a defect even if its bindings are perfect.

8b THE TEMPERATURE BUBBLE GOES IN THE CENTER OF THE BOX. Placing the cluster
  near the equipment is necessary and NOT sufficient. The value object
  (number_v3_40px_no_conn_no_tag) itself must be centered on the EQUIPMENT
  FOOTPRINT - the rectangle of the physical box, cabinet, case or room drawn in
  the artwork. Never center it on the equipment's text label, the regulator
  name, the cluster bounding box, an approximate or OCR coordinate, or empty
  floor. value_left = round_half_up(x + (width - w) / 2), value_top =
  round_half_up(y + (height - h) / 2), where (w, h) is THIS panel's value-object
  size - never silently force 42x22. Measured on the image and the canvas is a
  different size? State scale_x = panel_width / image_width and scale_y =
  panel_height / image_height and apply them first. A combined A/B case under
  one regulator is ONE footprint, the union, and only where evidence shows it -
  adjacency is not evidence. Alarm, cooling and defrost do not need the center;
  they hang off the value object. If the footprint cannot be established, report
  the evidence gap and emit no coordinate for that controller. A supplied
  production export still outranks this rule: do not "correct" a production
  position merely because it is not geometrically centered.

9 BACKGROUND OWNS THE STATIC STORE. Walls, room outlines, cabinet and case
  boxes, aisles, room-name captions, the store title. DESIGNER OBJECTS OWN THE
  LIVE SYMBOLS ONLY. Never bake a live value, an alarm colour or a dynamic
  symbol into the artwork, and never draw a value box that an object will also
  render. Light store-plan artwork only: never introduce a dark background. An
  Oversikt with no embedded background is not an Oversikt.

10 PRESERVE THE BACKGROUND THROUGH EVERY EDIT, AND PRESERVE BINDINGS THROUGH
   EVERY LAYOUT EDIT. panel.image_data,
   panel.converted, panel.org_image_name, panel.image_name and the canvas
   dimensions survive verbatim, as do every object's driver_id, unit_id,
   link_name, link_tag, sub_group, unit_ref, alias_text, zIndex, geometry, the
   array order and the object_N names. A LAYOUT CORRECTION NEVER CLEARS A
   BINDING: a blanked driver id leaves an object that renders and reads nothing,
   and the JSON still looks fine. Strip bindings only when the task explicitly
   asks for a reusable unlinked reference. A LINK/RELINK/VALIDATION task follows
   L1-L10 above: geometry stays fixed while source-proven binding fields change.
   NEVER EMIT panel.image_svg_trace; the export writes it as AI input and the
   host deletes it on insert.

11 NEVER INVENT a coordinate, obj_id, driver id, unit id, parameter alias, plant
   id, tag or navigation target. Driver ids are copied verbatim from the plant's
   parameter dump, never constructed: the group digits differ per driver type.
   An invented binding looks linked and is not. Missing evidence is reported, not
   filled in.

12 OBJECT BY ROLE, spelled exactly. Alarm bell
   V3_R_34px_circular_alarm_nrm 34x34 zIndex 375. Temperature or value box
   number_v3_40px_no_conn_no_tag 42x22 zIndex 110. Cooling symbol
   V3_R_28px_circular_cooling_nrm 28x28 zIndex 375. Defrost symbol
   V3_R_28px_circular_defrost_nrm 28x28 zIndex 375. An unknown obj_id renders as
   a broken undefined-class box. Substituting a generic value pill for a
   purpose-built symbol is a defect even though the substitute is a legal
   palette id. Cooling and defrost sharing one coordinate on the same controller
   is DELIBERATE, not an overlap defect: the host draws whichever state is
   active.

13 Z-INDEX BANDS, strings, never mixed with "default" in one panel. 110 the value
   box. 375 all three circular symbols. THESE ARE NOT THE MASKIN BANDS AND NOT
   THE VENTILATION BANDS; the bands are per panel type.

14 STRUCTURE. All 17 fields on every object: obj_id, name, id, posWidth,
   posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag,
   sub_group, driver_id, unit_id, unit_ref, alias_text. counts equal array
   lengths. names are object_0 to object_N, sequential, no gaps or duplicates.
   Integer pixels inside the canvas, normally 1400 x 750 but match the plant when
   a supplied export says otherwise. containers and graphics empty. Text is
   UTF-8: write the degree sign and the Norwegian letters, never gr C. If a
   transport mangles it, fix the transport, never degrade the panel text.

15 PRESERVE PRODUCTION ANOMALIES. Report them, do not tidy them. On the reference
   panel: 15 coincident cooling and defrost pairs, one cluster whose alarm sits
   below its value box, 21 objects with a tag_text of a single space, and two
   genuine cross-controller overlaps where two cases stand close on the plan.

16 A DRAFT SAYS IT IS A DRAFT. From a PDF or a screenshot alone, every binding is
   empty, the deliverable is labelled a draft in the delivery text, and the
   missing evidence is named: no plant id, no controller addresses, no parameter
   aliases, coordinates estimated at a stated scale.

17 VERIFY IN ORDER. a Re-parse the emitted JSON from disk. b Run
   validate-oversikt-panel.py PANEL.json, and WHENEVER A PRODUCTION EXPORT WAS
   SUPPLIED also run validate-oversikt-panel.py --compare SOURCE.json
   CANDIDATE.json; add --profile TEMPLATE-10113 when the panel is that named
   store overview, and --patch-scope value-position when the change was a
   centering patch. For linking, run --parameters and declare --patch-scope
   binding-repair. Zero errors is the bar, and warnings are read, not ignored.
   c Render with render-oversikt-panel.py, using --source to draw the source
   clusters as dashed ghosts underneath and --footprints to draw measured
   equipment boxes; the preview must embed the REAL background and all objects.
   Move the pointer away first, because a hover tooltip is not panel content.
   d Compare BY CONTROLLER AND ROLE, never by array index: two exports of one
   panel order their objects differently. e LOOK AT THE CONTROLLER-LEVEL CROPS.
   Whether each temperature bubble is on the centre of its box is a visual
   question, and this is where it gets answered.

17b A PANEL JSON CONTAINS NO EQUIPMENT-BOX BOUNDARIES, so no script can prove
   the bubble is on the box from the panel alone. Measure the footprints
   (build-oversikt-footprints.py emits the template; fill it in from the
   artwork) and pass them with --footprints to check centering; without that
   flag the validator reports that it proved NOTHING about centering, and that
   line is to be repeated in the delivery rather than replaced by "0 errors".
   The check is against SOMEBODY'S MEASUREMENT: it never proves the rectangle
   measured was the right rectangle.

17c DECLARE THE PATCH SCOPE. For a centering correction the only permitted
   object-level differences are posLeft and posTop on temperature/value
   objects, and NO field difference at all on any other object. A resized
   bubble, a rewritten alias, a re-bound driver id, a nudged alarm, a changed
   zIndex or a reordered array fails QA unless it is disclosed and justified
   separately. It does not travel under a geometry correction.

18 A CLEAN VALIDATOR RUN IS NECESSARY, NEVER SUFFICIENT. A reduced panel is
   well-formed: nine tidy clusters with correct bindings and a real background
   pass every structural check, because nothing inside a document says how many
   clusters the store has. Only the comparison against the source, or the named
   profile, can catch it. The same holds for placement: a panel whose every
   temperature bubble sits beside its case instead of on it passes every
   structural rule there is. Also run validate-visual-correctness.py PANEL.json,
   with --source when a production export was supplied: no live object may cover
   descriptive text (only the source can prove an overlap intentional), and a
   state value must fit its longest allowed display value, never merely the
   current reading (VISUAL-CORRECTNESS-CONTRACT.md, GLOBAL).

19 INSERT APPENDS. It never clears the canvas, and the host renames every object
   from the live canvas child index. A full panel document belongs on an EMPTY
   canvas unless duplication is intended. Say this when delivering one.

20 REPORT the input class, the precedence rank, the coverage matrix source
   against candidate, the per-type counts labelled as evidence and not as
   targets, every cluster added, removed, moved or relinked with its reason, the
   exact validator commands and their output, the render you inspected and what
   you checked in it, and every evidence gap stated as a gap. A stated gap is a
   valid deliverable and a guess is not.

20b REPORT THE FOOTPRINT EVIDENCE TOO. Where each equipment footprint came from
   and who measured it, at which image resolution and with which scale factors,
   which controllers are UNMEASURED, and - if you moved any value object - the
   before and after position of every one. Where no footprints were supplied,
   write that CENTERING WAS NOT VERIFIED in those words. Do not let "the
   validator reported 0 errors" stand in for it: the validator checked the rules
   it can check, and this is not one of them without the sidecar.
