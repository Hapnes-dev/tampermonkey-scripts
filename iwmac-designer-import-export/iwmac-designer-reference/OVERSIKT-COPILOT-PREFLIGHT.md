IWMAC OVERSIKT PREFLIGHT. Store overview, case positions, byggeplan. Terms this
covers: Oversikt, store overview, case-position panel, byggeplan, disk, display
case, cabinet, cold room, freeze room, controller cluster, alarm, temperature,
cooling, defrost. Work every step before emitting JSON.

1 AN OVERSIKT IS A MAP, NOT A DASHBOARD. It is a drawing of the store with one
  controller cluster placed ON each display case, cold room or freezer room it
  monitors. The information is WHERE each reading sits. Grouping the same
  objects into tidy cards, rows, columns or a legend destroys the only thing the
  panel type exists to show, even when every object and every binding is
  otherwise correct. A grid of cards is a CLUSTER KIT hand-off and must be
  labelled a kit, never delivered as a finished panel.

2 PRECEDENCE, highest first. Never average two conflicting coordinates.
  1 panel JSON or screenshot supplied with this task  2 production export of the
  same panel and system type  3 OVERSIKT-GENERATION-CONTRACT.md  4 panel rules
  in the reference CLAUDE.md  5 AI-BRIEFING.txt  6 PANEL-TYPE-GUIDE.md
  7 DESIGN-OBJECT-CATALOG.md  8 generic visual advice. Say which rank you worked
  from. A PDF, a byggeplan drawing or a screenshot is NOT rank 1 or 2: it
  describes the store, not the panel. The catalogue proves an obj_id exists; it
  never decides placement or size.

3 ROUTE THE INPUT, and name the row you picked.
  PDF only, produce an explicitly UNLINKED DRAFT with the missing evidence
  disclosed by name. Screenshot only, an unlinked draft with the image-to-canvas
  scale factor stated as a number. Background image plus equipment list, one
  cluster per listed position anchored on the artwork feature that matches its
  name. Production JSON supplied, the ENTIRE supplied document with only the
  named change applied: PRESERVE AND PATCH, NEVER REBUILD. Production JSON plus
  a PDF or screenshot, the supplied JSON patched only where the secondary source
  proves a specific difference, each patch named individually.

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

9 BACKGROUND OWNS THE STATIC STORE. Walls, room outlines, cabinet and case
  boxes, aisles, room-name captions, the store title. DESIGNER OBJECTS OWN THE
  LIVE SYMBOLS ONLY. Never bake a live value, an alarm colour or a dynamic
  symbol into the artwork, and never draw a value box that an object will also
  render. Light store-plan artwork only: never introduce a dark background. An
  Oversikt with no embedded background is not an Oversikt.

10 PRESERVE THE BACKGROUND AND THE BINDINGS THROUGH EVERY EDIT. panel.image_data,
   panel.converted, panel.org_image_name, panel.image_name and the canvas
   dimensions survive verbatim, as do every object's driver_id, unit_id,
   link_name, link_tag, sub_group, unit_ref, alias_text, zIndex, geometry, the
   array order and the object_N names. A LAYOUT CORRECTION NEVER CLEARS A
   BINDING: a blanked driver id leaves an object that renders and reads nothing,
   and the JSON still looks fine. Strip bindings only when the task explicitly
   asks for a reusable unlinked reference. NEVER EMIT panel.image_svg_trace; the
   export writes it as AI input and the host deletes it on insert.

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
   store overview. Zero errors is the bar, and warnings are read, not ignored.
   c Render with render-oversikt-panel.py, using --source to draw the source
   clusters as dashed ghosts underneath; the preview must embed the REAL
   background and all objects. Move the pointer away first, because a hover
   tooltip is not panel content. d Compare BY CONTROLLER AND ROLE, never by
   array index: two exports of one panel order their objects differently.

18 A CLEAN VALIDATOR RUN IS NECESSARY, NEVER SUFFICIENT. A reduced panel is
   well-formed: nine tidy clusters with correct bindings and a real background
   pass every structural check, because nothing inside a document says how many
   clusters the store has. Only the comparison against the source, or the named
   profile, can catch it.

19 INSERT APPENDS. It never clears the canvas, and the host renames every object
   from the live canvas child index. A full panel document belongs on an EMPTY
   canvas unless duplication is intended. Say this when delivering one.

20 REPORT the input class, the precedence rank, the coverage matrix source
   against candidate, the per-type counts labelled as evidence and not as
   targets, every cluster added, removed, moved or relinked with its reason, the
   exact validator commands and their output, the render you inspected and what
   you checked in it, and every evidence gap stated as a gap. A stated gap is a
   valid deliverable and a guess is not.
