IWMAC MASKIN PREFLIGHT. Machine room, CO2 booster. Work every step before
emitting JSON.

1 PRECEDENCE, highest first. Never average two conflicting coordinates.
  1 panel JSON or screenshot supplied with this task  2 production export of the
  same panel and machine type  3 MASKIN-GENERATION-CONTRACT.md  4 panel rules in
  the reference CLAUDE.md  5 AI-BRIEFING.txt  6 PANEL-TYPE-GUIDE.md
  7 DESIGN-OBJECT-CATALOG.md  8 generic visual advice. Say which rank you worked
  from. A supplied export IS the geometric template. The catalogue's sizes are
  toolbox defaults, not placement geometry: use it to check that an obj_id
  exists, never to decide how big an object is.

2 NAME THE CLASS, and the profile, before placing anything.
  1 new unlinked demo  2 linked copy for another plant  3 modification of a
  supplied export  4 background-only patch. Class 3 emits the ENTIRE supplied
  document with only the named objects changed, never just the new objects.
  Class 4 emits zero counts and three empty arrays. The only profile with
  complete measured geometry is TEMPLATE-10229: AK-PC 782A, 3 MT plus 3 LT
  compressors, VSD on C1 only, gas cooler, receiver, heat recovery. If none fits,
  say so and name what you cannot cover.

3 NEVER INVENT a coordinate, obj_id, driver id, unit id, parameter alias, plant
  id, file path or navigation target. Missing evidence is reported, not filled
  in. Copy obj_id spelling exactly, including V3_81x21_enebled_disabled_nrm.

4 BACKGROUND OWNS ALL ARTWORK. Dynamic objects own live values only. The
  background draws the enclosure, pipes, equipment symbols, every static label,
  the EMPTY white value pills and the DARKER GREY setpoint pills. Never bake a
  live number or state into artwork. Never draw a value box that an object will
  also render. Light skin only: never draw a dark Maskin, redraw it light.
  NEVER EMIT panel.image_svg_trace. The export writes it as AI input and the host
  deletes it on insert. If you author new artwork, the template coordinates no
  longer apply, and you must say so.

5 STRUCTURE. All 17 fields on every object: obj_id, name, id, posWidth,
  posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag,
  sub_group, driver_id, unit_id, unit_ref, alias_text. counts equal array
  lengths. names are object_0 to object_N, sequential, no gaps or duplicates.
  Integer pixels inside 1400 x 750. containers and graphics empty.

6 Z-INDEX BANDS, strings, never mixed with "default". 110 custom json and
  no-connection boxes. 360 AK-PC status strips. 375 alarms, LEDs, pumps.
  1000 enable/disable strip. 1100 value and setpoint pills. THESE ARE NOT THE
  VENTILATION BANDS. The reference CLAUDE.md list, 110 values and 1100 labels, is
  ventilation-scoped; using it here puts every pill under the artwork.

7 OBJECT BY ROLE. Measurement: number_v3_value_only 50x20 z1100. Setpoint or
  reference: number_v3_white_value_only 50x20 z1100. Compressor run state:
  V3_akpc_772_781_781A_783_contr 81x21 z360. Suction group control state:
  V3_akpc_782A_suct 81x21 z360. Condenser control state:
  V3_akpc_783_781A_782A_cond 81x21 z360. OK/alarm: V3_ok_alarm_nrm 61x21 z375.
  Enable/disable: V3_81x21_enebled_disabled_nrm 81x21 z1000. Valve LED:
  V3_led_13px_circ_grey_green 13x13 z375. Pump: V3_21px_single_pump_grey_green_down
  21x21 z375. Two objects are deliberately NOT value pills because the artwork
  under them differs: Hr pump speed is number_v3_custom_json_obj 40x20 z110 on a
  tan pill, u17 Ther Air is number_v3_60px_no_conn 62x22 z110 in the information
  panel. Substituting a generic value box for either is a defect even though both
  substitutes are legal palette ids.

8 SETPOINT PILL RULE. The white pill marks a setpoint. The markers are
  reference, ref., consumer request and ctrl. The marker is NOT plain request:
  Requested cap. MT, Requested cap. LT and Cond. requested cap. are measurements
  and use the normal value pill.

9 CLUSTERS ARE ATOMIC. Place every member or none, and relocate with ONE vector.
  Compressor: status, capacity, Runtime total, plus VSD 1 speed ONLY where the
  machine has a VSD. On TEMPLATE-10229 only C1 has one, so cloning C1 to build a
  C4 imports a VSD row the machine does not have. Clone C3. Measured horizontal
  pitch is 79 to 82 px with 1 px vertical drift; reuse a pitch from a named pair
  and say which, never average them into a constant.
  Suction group, eight required readouts per suffix MT and LT: Control status,
  Running capacity, Requested cap., Suction temp. To-, Suction ref. To-,
  Superheat, Ss-, Sd-.
  Heat recovery: pump, speed, LED, four Shr sensors, two setpoints, enable strip.
  Right-hand status column at x about 1170: u17 Ther Air y58, DI1 alarm y86,
  Control status MT y210, Control status LT y238, Cond. control status y267,
  Hr enable y325.

10 MT TO LT IS NOT ONE PANEL VECTOR. Only the compressor columns translate, by
   about 0 plus 325. The suction readouts each move differently: Sd by 369,313
   and Ss by minus 71,324. Applying a compressor vector panel-wide moves seven
   readouts onto empty artwork.

11 EVERY PILL LANDS ON A DRAWN PILL. A pill floating on white artwork, half on
   its drawn pill, or sharing one drawn pill with another object is a defect. Two
   adjacent pills are correct only where the artwork drew two, as on the MT
   suction row. No validator can check this. Only a render can.

12 ALIAS IS THE LINK KEY. On Maskin alias_text IS the Danfoss parameter name, and
   a production panel resolved 64 of 64 objects by exact string match. Take names
   from maskin-akpc-link-map.json. Never rename an alias to make it prettier and
   never strip it during sanitization: a renamed or missing alias is an
   unlinkable object.

13 A NEW DEMO IS UNLINKED. id and driver_id are the literal string driver_id,
   linked is false, and link_name, link_tag, sub_group, unit_id, unit_ref,
   source_plant_id, plant_id and saved_by are empty. A production export never
   emits the literal driver_id: its unlinked objects carry an EMPTY driver_id
   instead, and the host then marks them linked true, which is host behaviour and
   not a defect. Object count is not a quality target; role coverage is.

14 PRESERVE PRODUCTION, INCLUDING ITS ANOMALIES. On TEMPLATE-10229: three objects
   carry tag_text of a single space, two are linked true with an empty driver_id,
   and Suction temp. To-MT appears twice on the two adjacent pills the artwork
   labels To and To offset, sharing one driver id, where the LT row binds its
   second pill to To opt. offset LT. Report these. Do not silently tidy them.
   Any corrective is advisory and needs the plant's own parameter dump.

15 TEXT IS UTF-8. Keep the degree sign, the cubic-metre sign and the Norwegian
   letters. Write the real symbols, never gr C or m3. If a transport mangles it,
   fix the transport, never degrade the panel text.

16 VERIFY IN ORDER. a Re-parse the emitted JSON from disk. b Run
   validate-maskin-panel.py PANEL.json --profile TEMPLATE-10229, dropping the
   profile only when none applies and saying so; zero errors is the bar, and
   warnings are read, not ignored. c Render at native 1400 x 750 with the REAL
   background and the dynamic-object overlay, then inspect the full panel plus
   one crop per role: MT bank, LT bank, MT suction, LT suction, heat recovery,
   receiver, gas cooler, alarm and IO. Move the pointer away first, because a
   hover tooltip is not panel content. d Compare by role key, obj_id plus
   alias_text plus tag_text, NEVER by array index; two exports of one panel order
   their objects differently. e Run validate-visual-correctness.py PANEL.json
   (--source when a production export was supplied): no live object may cover
   descriptive text, and state values fit their longest allowed display value,
   never the current reading (VISUAL-CORRECTNESS-CONTRACT.md, GLOBAL). f On a
   visual failure RESTART from the retained source export or the sanitized
   fixture rather than patching a chain of compensating edits.

17 INSERT APPENDS. It never clears the canvas, and the host renames every object
   from the live canvas child index. A full panel document belongs on an EMPTY
   canvas unless duplication is intended. Say this when delivering one.

18 REPORT the class, the precedence rank, the profile, every role you moved,
   added or removed with its vector or reason, which pitch you reused and from
   which pair, the exact validator command and output, the crops you inspected,
   and everything you could not verify. A stated gap is a valid deliverable and a
   guess is not. Passing validation is not evidence the panel is correct: the
   validator cannot see the drawing.

19 EXTENDING A COMPRESSOR BANK IS AN ORDERED PROCEDURE, and the order is the
   rule: adding a compressor is class 3 and class 4 at once, one full document
   plus one background-only patch. a Retain the original source background
   untouched; every retry starts from it, never from the damaged derivative,
   because repeated edits to a derivative accumulate raster damage nobody can
   attribute afterwards. b Measure the column you are actually copying, the
   nearest role match, not C1. c Measure the discharge and the suction header
   SEPARATELY: they legitimately differ in thickness on the same panel, so each
   stays source-driven and neither number is reused for the other. d Fix ONE
   translation vector from a NAMED pair and apply that same vector to the
   compressor symbol, the upper discharge branch, the lower suction branch, the
   status artwork, the static labels, the empty pills AND the dynamic objects;
   a second vector anywhere is the defect. e EXTEND THE ARTWORK FIRST, before
   any object exists. f Copy every source pixel's alpha VERBATIM and never
   multiply it: a mask is BINARY. A soft, feathered or opacity-scaled mask
   fades the whole clone together, and that uniformity is the tell. Reproduce
   every row the source has, including partially transparent antialiasing rows,
   or the copy comes out thinner and harder-edged. g Connect the new branches
   continuously to the existing headers, then look at the BACKGROUND ALONE at
   native size: a gap is invisible under the objects that will cover it.
   h Place the objects last. On ANY visual failure go back to a, not to e.

20 AN OBJECT ALWAYS CARRIES AN ALIAS. An unknown plant parameter is never a
   reason for alias_text "": the alias is the relink key, so an object without
   one can never be linked by anyone, ever. Give it the role's alias in the
   grammar C n MT or LT role, emit it unlinked, and REPORT the gap as
   unresolved. maskin-akpc-link-map.json covers C1 to C3 only; a fourth
   compressor's Danfoss parameters are NOT in it. The group anatomy suggests
   the continuation, and suggesting is not evidence: leave it open until that
   plant's own parameter dump is supplied.
