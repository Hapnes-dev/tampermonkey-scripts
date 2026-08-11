# IWMAC panel types — how Coop Extra panels are built today

A per-panel-type style guide, mined 2026-08-08 from the live compiled panels of 41 Coop Extra plants (231+ panels). Raw data: [reference_data/plant-panel-survey.json](reference_data/plant-panel-survey.json). Per-plant inventory: [PLANT-PANEL-CATALOG.md](PLANT-PANEL-CATALOG.md). Written as a knowledge file for AI assistants (Copilot) helping colleagues build or copy panels.

**Common rules across all types (fleet-verified):**

- Canvas: **1400×750 px** is the standard. 1280×1024 only appears on older-era panels — do not build new ones at that size.
- Style era: **modern V3 objects only** — zero legacy `V2_*` objects anywhere in this fleet.
- Containers and graphics: **empty on almost every panel** — panels are flat `single_objects` over a background PNG. Three exceptions, all container-built: 9914's room-card panels, **list panels** (spjeldliste — one container per row) and the **room-control table** (one `table_container` holding the whole grid). Both table families are documented in the sections at the end.
- Backgrounds: nearly every panel has an embedded PNG background. Two families: a drawn schematic (Maskin, Energi, VGV, Kondens — 30–130 KB) or the ~6 KB blank canvas on which Ventilasjon panels draw their duct layout using objects.
- Backup convention: keep the old version as a hidden panel suffixed `_old` / `Gammel` / `_copy` — never overwrite history.
- Visibility: main panels `visible=1`; detail/backup panels `visible=4` (hidden from the list, reachable via navigation buttons).
- To copy a panel between plants: Export JSON on the source plant → Insert JSON on the target, accept the driver-id prefix rewrite, then re-link via the parameter selector (aliases carry over — see the linking notes per type).

---

## Oversikt (store overview) — every plant has one

The floor-plan panel: case clusters placed over the store layout PNG.

> **Where the Oversikt rules live (2026-08-10).** This section is the style
> summary and the fleet context. It does **not** own geometry, cluster or
> coverage rules — one live owner per rule.
>
> | You need | Read |
> |---|---|
> | A coordinate, a role, a z-band, a cluster rule, an anomaly — each with its evidence id and scope tag | [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) — **authoritative on any Oversikt conflict** |
> | The procedure for building, copying or repairing one | [OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md) |
> | The acceptance tests, stage by stage | [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md) |
> | The same rules as code | [documentation-rules.json](documentation-rules.json) → `python validate-oversikt-panel.py panel.json --profile TEMPLATE-10113`, plus `--footprints FOOTPRINTS.json` (built by [build-oversikt-footprints.py](build-oversikt-footprints.py)) when value centring has to be checked, and `--patch-scope value-position` on a centring patch |
> | A block to paste into a Copilot system prompt or upload as a knowledge file | [OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md) |
> | The file to copy | [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) |

Four rules that override everything below when they conflict with it:

- **A supplied production JSON outranks the fleet medians and example counts on
  this page.** The export is the geometric and object-coverage template; these
  statistics are context for a store that has no export. Never average the two.
- **An Oversikt is a MAP, not a dashboard.** Its information content is *where*
  each reading sits. Regrouping the same objects into cards, rows or a legend
  destroys the only thing the panel type exists to show, even when every object
  and binding is correct.
- **One logical cluster per cooling position / controller**, anchored on the case
  or room it monitors — with partial clusters wherever the *source* proves them.
  Cluster membership is whatever the controller exposes, not a fixed four.
  Anchoring the cluster near the equipment is level 1 and it is not sufficient:
  the temperature/value object itself belongs in the **visual centre of the
  equipment footprint** — the drawn box, cabinet, case or room — never on its
  text label (contract §7.1b, rule `O-G08`).
- **Visual similarity is not sufficient.** A panel that looks like production and
  omits controllers is a worse failure than one that looks wrong, because nobody
  catches it by looking. Complete controller coverage, verified against the
  source, is the acceptance test.

- **44 panels**, median **132 objects**, ~**95% driver-linked** — the most object-dense and most fully linked panel type.
- **The median is a fleet statistic, not a target.** The measured reference profile is 72 objects in 21 clusters; neither number is a pass mark. A store has as many clusters as it has cooling positions — build to the *controllers* the source proves and compare controller by controller.
- Built almost entirely from the four-object **case cluster** (one per cooling position):
  - `V3_R_34px_circular_alarm_nrm` — alarm bell (1,795 uses fleet-wide)
  - `number_v3_40px_no_conn_no_tag` — temperature box (1,769)
  - `V3_R_28px_circular_defrost_nrm` — defrost symbol (1,171)
  - `V3_R_28px_circular_cooling_nrm` — cooling symbol (970)
  - All four link to the same case controller.
  - **Not always four.** On the measured reference, 15 clusters carry all four roles and 6 carry alarm + temperature only — those controllers expose no cooling or defrost relay. Padding a partial cluster to four invents a binding. Contract §5.3.
- Trim: `number_v3_label_12px_bold` / `_11px_norm` labels, `V3_led_21px_circ_grey_red` LEDs, `number_v3_1440x95_footer_dark` footer bar, `number_v3_header_grey75` headers, occasional `number_v3_rc_temp_sp_60` room-temp boxes.
- Background: the store floor plan PNG (30–70 KB). It owns the static store — walls, room outlines, case boxes, captions; the objects own the live symbols only.
- **Best copy sources:** 9982 EXTRA Fauske (240 obj, 100% linked) · 9856 EXTRA Løten (215, 100%) · 9857 EXTRA Otta (207, 100%) · 9673 Extra Vennesla (206, 100%).

## Maskin (CO₂ rack / machine room) — every plant has one

The refrigeration-plant schematic: pack controller values drawn onto the machine drawing.

> **Where the Maskin rules live (2026-08-10).** This section is the style summary and the fleet context. It does **not** own geometry — one live owner per rule.
>
> | You need | Read |
> |---|---|
> | A coordinate, a role, a z-band, an anomaly — each with its evidence id and scope tag | [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) — **authoritative on any Maskin conflict** |
> | The procedure for authoring, copying or editing a Maskin panel | [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) |
> | The acceptance tests, stage by stage | [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) |
> | The same rules as code | [documentation-rules.json](documentation-rules.json) → `python validate-maskin-panel.py panel.json --profile TEMPLATE-10229` |
> | A block to paste into a Copilot system prompt or upload as a knowledge file | [MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md) |

- **39 panels**, median **59 objects**, ~**98% linked** — always fully linked when finished.
- **The median is a fleet statistic, not a target.** The measured reference profile is 66 objects; neither number is a pass mark. Build to the *roles* the reference contains and compare role by role.
- Object mix is value-dominated:
  - `number_v3_value_only` (1,422) — the white value pill, drawn EMPTY on the background artwork
  - `number_v3_white_value_only` (261) — the **setpoint / reference** pill, on a darker grey drawn pill
  - `V3_akpc_772_781_781A_783_contr` / `V3_akpc_782A_suct` / `V3_akpc_783_781A_782A_cond` — the Danfoss AK-PC pack-controller status strips (compressor / suction group / condenser)
  - `V3_led_13px_circ_grey_green`, `V3_81x21_enebled_disabled_nrm`, `V3_ok_alarm_nrm`, `V3_21px_single_pump_grey_green_down`, `V3_co2_compressor_31x35_nrm`
  - Two roles are deliberately **not** value pills because the artwork under them differs: `Hr pump speed` is `number_v3_custom_json_obj` on a tan pill, `u17 Ther Air` is `number_v3_60px_no_conn` in the information block. Substituting a generic value box for either is a defect even though both substitutes are legal palette ids.
- **Role inventory** — a Maskin is eight named clusters, not a flat object list (measured on TEMPLATE-10229, 66 objects; full geometry in the contract §5):
  1. **MT compressor column** — per compressor: status strip, capacity, Runtime total, plus a VSD speed row only where that machine has a VSD.
  2. **LT compressor column** — the same cluster, ~325 px lower.
  3. **MT suction group** — Control status, Running capacity, Requested cap., Suction temp. To-, Suction ref. To-, Superheat, Ss-, Sd-.
  4. **LT suction group** — the same eight readouts with the `LT` suffix.
  5. **Heat recovery** — pump, pump speed, valve LED, four `Shr` sensors, reference + consumer request, enable strip.
  6. **Receiver** — `Prec reference`, `Prec`, `Vrec OD`.
  7. **High pressure / gas cooler** — `Pc`, `Tc`, `Sgc`, `Sc3`, `Shp`, `Pgc` + reference, `Vhp OD`, `V3gc`, condenser control/capacity/requested cap.
  8. **Alarm / IO** — the right-hand information block (`u17 Ther Air`, `--- DI1 Alarm`) plus the control-status column at x ≈ 1170.
- Background: the Advansor-style CO₂ booster drawing (80–130 KB), embedded in `image_data` with `converted:"true"` — see [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) for the drawing doctrine and `maskin-light-template.ai` for the production template. **The background owns all artwork** — the enclosure, pipes, equipment symbols, every static label, and the EMPTY value pills the objects render into. Background colour follows the supplied export or the user's requirement — preserve a supplied background unless a change is asked for; the shipped `maskin-light-template.ai` is light, which describes that template rather than mandating a skin.
- Linking: aliases are Danfoss parameter names (`Pc`, `Sd-MT`, `Running capacity MT` …) — [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) is the canonical alias→parameter map (64/64 objects resolved by exact `alias_text` match on a production panel); relinking by alias is how a Maskin moves between plants. Never rename an alias, and never strip it during sanitization — that makes the object unrelinkable.
- **Named best references**, in precedence order:
  1. A panel JSON the user supplies with the task — it outranks everything here and **becomes the geometric template**.
  2. [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) — the committed 66-object production fixture (evidence `E10`): geometry, obj_ids, sizes, z-indexes, ordering, aliases and background preserved; every live binding removed. This is the file to copy.
  3. Fleet copy sources on the live host: 9643 EXTRA Kjerulfsgate (67, 100%) · 9683 Extra Havnesenteret (67, 100%) · 9982 EXTRA Fauske (64, 100%) · 9664 EXTRA Rakkestad (63, 100%).
  4. ⚠️ [reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json) is a **negative example**, not a template — an authored-SVG demo that lost three production roles, invented one, substituted two obj_ids, emitted `zIndex:"default"` throughout and placed 0 of 62 shared roles at the production coordinates. Contract §13 has the audit.

## Ventilasjon (360.NNN) — most plants

The air-handling-unit page: ducts, dampers, filters and sensors drawn **with objects** on a blank background.

- **34 panels**, median **92 objects**, ~**54% linked** — the many label/duct scaffold objects have no driver, which is normal; the *values* are what gets linked.
- **The median is a fleet statistic, not a target.** Do not build to 92 objects, and do not treat any object count as a pass mark. Build to the *roles* the reference panel contains, and compare object by object. A 102-object production panel rebuilt as 53 objects failed because it dropped 27 production roles — not because 53 is too few.
- Named `Ventilasjon`, `360.001 Ventilasjon`, `360.01 Ventilasjon`, or per-zone (`360.001 Utleiedel`, `360.002 Butikk`); multi-AHU plants get one panel per system.
- Object mix (scaffold + values):
  - `number_v3_label_11px_norm` (515) / `_8px_norm` (155) — labels everywhere
  - `number_v3_R_45px_con_down/_top/_left` (398) — the duct connector pieces the layout is drawn with
  - `number_v3_60px_dark_no_conn` (220) — dark value boxes
  - `V3_R_34px_circular_alarm_nrm` (196), `number_v3_60px_json_obj` / `number_v3_custom_json_obj` (165) — JSON plugin objects
  - `numberV3_filter_with_diff_press` (56), `number_v3_fresh_pipe_horisontal` (37), `number_v3_header_grey75` section headers
- Background contract: the ~6 KB blank (`00-blank-sidebar-1400x750`), embedded in `image_data` with `converted:"true"` — white drawing area, light-grey right sidebar starting at about **x 1150**. The drawing *is* the objects. **Objects only** means the ducts, equipment, values and controls are Designer objects; it does **not** mean "remove the standard embedded blank-sidebar raster" — preserve `org_image_name` and its `image_data` unless the user asks for a different background. Never author an SVG background for a Ventilasjon panel, and use only obj_ids that exist in the designer palette (`reference_data/all-design-objects.json`, named in plain language in [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md)).
- Reference exports already in the kit: `reference_data/real-vent-panel-example.json` (102 objects, OJEXHAUST) and `real-vent-panel-example-2.json` (92 objects / 39 distinct obj_ids, BACNET — adds horizontal dampers, a dummy 2-way motor, a status LED, the sub-page navigation row and a `file_pdf` document link). `real-vent-panel-linked-example.json` is a **duplicate export of the first, not a linked twin** (verified 2026-08-09: identical objects, only `exported_at` and `generator` differ) — both are already linked, so read the link contract off either one and do not diff them.
- **Layout, not just object mix.** A vent panel is a process schematic plus a right-hand control sidebar; the measured skeleton of the reference is the normative one — extract run at **(24,200) 1025×18**, supply run at **(24,442)+(337,442)** (242 px below it), cross-over column at **x 411**, rotor **(282,149) 60×343**, sidebar headers **250×20 at x 1150, y 0/165/357** with two setpoint columns at x 1260/1330. `con_down` boxes go **above** a run, `con_top` boxes **below**. Full contract, including the four request classes and the strip-the-source-plant rule: [AI-BRIEFING.txt](AI-BRIEFING.txt) §7a.
- **Production composition pattern.** Extract-air route on the **upper** horizontal line, supply-air route on the **lower** one, a vertical crossover / heat-recovery section between them, and conditioning equipment placed directly on or across the duct line it serves (cooler, then heating coil, then electric coil, then the supply fan, left to right). Labels and live values sit close to their sensor or equipment; alarm bells stand *beside* the component they guard, never on it. A dedicated right-hand control sidebar closes the panel. Keep this composition when adapting the panel to another AHU unless that unit's documented equipment sequence forces a structural change.
- **Sidebar anatomy.** Three `number_v3_header_grey75` bars 250×20 at **x 1150**, spanning the section width — *Status og vendere*, *Vifteregulering*, *Temperaturregulering*. Labels start at the left of each row (x 1160–1175); values and controls align in one or two columns on the right (setpoint boxes at x 1260 / 1330, the no-tag variant at x 1329). Row pitch is compact and consistent, 25 px inside a section. The three sections stay visually separated by their header bars — this sidebar is the strongest single signature of a production vent panel.
- **Key object families**, by role: duct runs `number_v3_fresh_/supply_/exhaust_pipe_horisontal` + `_vertical`; crossover connectors `number_v3_exhaust_connector_up` / `number_v3_supply_connector_down`; recirculation dampers `number_v3_dummy_resirc_damp_hor` / `_vert`; fans `V3_58px_fan_left_nrm` / `_right_nrm`; filter `numberV3_filter_with_diff_press`; heating `number_v3_heater_3_way` + `number_v3_el_heater`; cooling `number_v3_cooler_2-way`; heat recovery `number_360_vg_rot`; room symbol `number_360_room`; alarms `V3_R_34px_circular_alarm_nrm`; value connectors `number_v3_R_45px_con_down` (above a run) / `_con_top` (below it); sidebar controls `number_v3_60px_dark_no_conn`, `_no_conn_no_tag`, `number_v3_60px_json_obj`, `number_v3_custom_json_obj`. Spell every id exactly as the palette spells it — the capital V in `numberV3_…` and the hyphen in `_cooler_2-way` are real.
- **When the user supplies their own panel JSON**, that file outranks everything on this page and becomes the authoritative geometric template. Rules, the sanitization contract for a layout-matched-but-unlinked demo, and the structural + render QA checklists: [CLAUDE.md](CLAUDE.md) → *Ventilation panel fidelity and template-matching rules*.
- **Best copy sources:** 9916 EXTRA St. Olavsgt (92 obj) · 9868 EXTRA Ugla (90) · 9914 EXTRA Hunstad 360.01 (87) — all the same 57%-linked scaffold pattern.

### Separate MENY ventilation evidence

The focused [MENY ventilation corpus](VENTILATION-CORPUS.md) is separate from the Coop Extra statistics above. Its corrected authenticated GET-only rerun passed offline validation with exactly 20 plants and 101 panels—42 JSON-backed and 59 XML-only—with no plant, unit, or panel errors. It matched 34 panels on 16 plants: 14 JSON and 20 XML-only, 33 visible and 1 hidden, 30 V2-bearing, with discovery split 2 `both`, 30 `unit_name`, and 2 `panel_name`. The raw batch is [plant-panel-survey-meny-20.json](reference_data/plant-panel-survey-meny-20.json); the derived matches are [ventilation-panel-corpus.json](reference_data/ventilation-panel-corpus.json).

Discovery is deliberately narrower than a plant-wide name search: collect real unit IDs from the current panel, exact-join them to that plant's Windows-1252 unit inventory, then test only the joined display names for normalized `ventilasjon`/`ventilation`. JSON requires valid `driver_id` and `unit_id` fields on the same object. Production compiled XML requires a valid `<id>` (= `driver_id`) and valid `<unit_id>` on the same `<data>`. Compact `360.001Ventilasjon` is valid; `V01` and `Forventilasjon` are not. XML-only panels retain enough object/unit evidence for this join but lack the richer layout/link/background metadata available from JSON, so do not rank them as equivalent JSON copy sources; the current userscript cannot export them until they have been recompiled into JSON.

Canonical plant `9099` stays outside the MENY batch: its panel name is `360.001 Ventilasjon`, while the exact live same-plant unit inventory name is `360.001Ventilasjon`. The spaced SQL sample is sample/stale formatting and does not override the live inventory. The generated demo remains outside production totals.

## Energi (energy meters) — most plants

The smallest panel type: energy-meter values on a meter-tree drawing.

- **30 panels**, median **10 objects** (range 4–78), ~**97% linked**.
- Almost mono-object: `number_v3_value_only` (346 of ~400 total objects fleet-wide) + a few `number_v3_label_8px/11px_norm` labels.
- Background: the energy/meter schematic PNG (20–46 KB).
- **Best copy sources:** 9856 EXTRA Løten (42 obj — the big worked example) · 9914 EXTRA Hunstad (24) · 9585 Extra Evje (13).

## VGV / Varmegjenvinning / Akkumulator (heat recovery)

- **14 panels**, median **29 objects**, ~**79% linked**. Names vary: `VGV`, `Varmegjenvinning`, `Akkumulator`, `Akkumulering og VGV`, `VGV AC`.
- Mix: `number_v3_label_10px_bold` titles, `con_down/_top/_right/_left` pipe connectors, `number_v3_60px/40px_no_conn` value boxes, `V3_21px_single_pump_grey_green_left` pumps, `v3_3w_valve_up_right_nrm` valves.
- Background: small tank/pipe schematic (11–35 KB).
- **Best copy sources:** 9697 Glomfjord Varmegjenvinning (13, 100%) · 9099 Dokka Akkumulator (12, 100%) · 9148 Hafjell Akkumulering og VGV (15, 93%).

## Kondenssystem / Hydroloop / Snøsmelt (condenser loop)

- **6 panels**, median **24 objects**. Same object family as VGV (pipes, pumps, valves, value boxes).
- **Best copy sources:** 9921 Irisgården Kondenssystem (23, 83%) · 9862 Holmedalen Kondenssystem (24).

## Varme / 320.NNN (heating plant)

- **5 panels**, median **26 objects**, ~56% linked. Names: `Varme`, `Varmeanlegg`, `320.001`, `320.001 Varmepumpe`, `310.001/320.001`.
- **Best copy sources:** 9673 Vennesla Varmeanlegg (22) · 9914 Hunstad 320.001 + 320.001 Varmepumpe pair.

## Kurver (trend-curve satellites)

- **9 panels**, ~12 objects each, mostly on the older 1280×1024 size. Value boxes (`number_v3_60px_dark_no_conn`, `number_v3_60px_json_obj`) + `previous_page_4` back button.
- Some `Kurver` panels are **XML-store-only navigation stubs** (0 objects in JSON) — same phenomenon as the hotel fleet (CLAUDE.md §17b).

## Aggregat-detalj (Swegon unit pages, 9677 only)

- 9677 EXTRA Ørmelen carries 7 `Swegon PM Gold 1.09 …` setting/curve pages (14–17 objects, 1280×1024) — per-AHU deep-dive panels for a BACnet Swegon unit. A pattern to copy when a plant gets a Swegon aggregate.

## The container exception: 9914 EXTRA Hunstad room system

The only plant in **this survey** using containers at scale: `Romtype1/3/4`, `romtypevav1-3`, and per-room `Rom NNN` panels (1 object + 3–15 containers each), plus `Plan 1`/`Plan 2` floor plans with 14 room-card containers. This is the **room-control card pattern** (same idea as the hotel `rc_box` cards, CLAUDE.md §17b) — study 9914 before building per-room panels for a store with tenant/office zones.

The two table families below are the other container-built panels. The 41-plant survey behind this guide did not cover either, so they carry no fleet statistics here — their evidence is production exports: two for the list panels ([LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md)) and one for the room-control table ([ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md)).

## List panels (spjeldliste and other long tabular lists)

A full-width table: **one `objects_container` per row**, scaffold in `single_objects`, `graphics` empty. Not surveyed in the 41-plant sample above; measured from two production exports (360.001 and 360.004).

**How to tell it apart from a table-shaped normal panel.** If a row must repeat one identical multi-column cell group tens or hundreds of times, it is a list panel. A handful of labels arranged in a grid is not — build that from `single_objects` and the ordinary rules.

- Canvas **1400×750** on the `00-blank-1400x750` blank, like Ventilasjon — but the content **deliberately overflows it**. Banner and group stripes are 1570 px wide at x 15, ending at x 1585. Row count decides vertical overflow: a 26-row list ends at y 628, a 210-row list at y 4668. Rows may run past the canvas; nothing else may.
- Scaffold, all `single_objects`, and the one place `zIndex` is never `"default"`: `previous_page_tekn_box_no` banner (`"5"`), 4 blank `number_v3_label_12px_bold_white` title slots, 14 `number_v3_label_12px_bold` column headers (`"900"`), 13 `number_v3_header_appgrey` dividers (`"5"`, and `"155"` for the wide one at x 790), one `number_v3_header_grey50` stripe per group (`"3"`).
- Rows: `container_c` / `objects_container`, `left` 19, `width` 1544, `height` 23, `zIndex` **integer 4** — while every item inside carries `zIndex` **string `"900"`**. First row `top` 106, pitch 20, group gap 40.
- Two half-tables of the same seven columns. The right half is **not** a constant offset from the left; use the measured table in the contract.

### The variants

| Variant | What changes | Where the geometry comes from |
|---|---|---|
| **Spjeldliste** (damper list) | The documented default: seven columns — `Spjeldnr.`, `Romnr.`, `Prosj. min. m3/h`, `Prosj. maks. m3/h`, `Erverdi`, `SP.pådrag m3/h`, `Spjeldvinkel %` | Fully measured, both exports |
| **Unlinked list** | Static text only; `Erverdi` / `SP.pådrag` / `Spjeldvinkel %` left as headers | Same geometry; sentinel bindings throughout |
| **Linked list** | The three value columns become `number_v3_value_only` cells with real driver ids | Same geometry; every id **copied**, never derived from an address |
| **Other list type** (valve, fan, room…) | The column set, so every column x, header text, and the divider count and positions | **Unmeasured** — derive, mark advisory, say so |

### Rules that catch people out

- **The banner `zIndex` is `"5"`, not `"155"`.** `"155"` belongs to the 11 px half-table divider at x 790.
- **Divider height is derived, not fixed.** `last_row_top + row_height − divider_top − 2`. Add a row and all 13 dividers change, or the column rules stop short of the last row.
- **A driver id is never assembled from a BACnet address.** Six of its eight segments do reproduce from the address; the driver-name segment and `unit_id` are a plant-internal per-device lookup. A part-derived id binds to nothing while looking correct.
- **Production artefacts are preserved on edit and never copied into a new panel** — 14 stacked copies of each group stripe, groups with no stripe, ad-hoc dotted separators, `#c1`/`#c2` markers, `linked:"true"` on unbindable scaffold.
- **The left/right split follows the tag series** (5-series right; 4-, 6-series and unnumbered left), not airflow direction, and it is a convention rather than a rule.

**Generating one from a table: [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md).** It owns the request classes, the column mapping manifest, the 11-step algorithm, all measured geometry, the binding modes, the preservation matrix, the validation contract and two worked examples. [AI-BRIEFING.txt](AI-BRIEFING.txt) §7c is its standalone summary. Committed reference export: [reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json).

## Room-control table (`Tabell romkontroll alle plan`)

The **third** container-built family, and the one most easily mistaken for the
other two. Not surveyed in the 41-plant sample; measured from one production
export (plant 8653, evidence E18).

**How to tell it apart.** A spjeldliste repeats one identical row group tens or
hundreds of times — one `objects_container` per row. A room-control table is a
**rooms × signals matrix**: one row per room, one column per signal, headers
repeating down the page, all of it inside **one** `table_container`. The
`Romkontroll` floor plans of the hotel fleet (CLAUDE.md §17b) and the 9914
Hunstad room cards above are the same *subject* drawn a different way — room
cards over a floor-plan image, one panel per floor. A request naming a *table*,
or *alle plan*, is this panel; a request naming a *plan* or a floor is not.

- **Two layers, and the split is the whole design.** The container's items draw
  the grid — column titles, room numbers and the empty cell rectangles — and
  carry **no** bindings (`driver_id` is `""` on all 1,802). The
  `single_objects` carry the live values and the alarm indicators, one per
  cell, 1,551 of 1,553 bound. A cell is two records; neither layer alone is a
  panel.
- **One container, 22 keys** — the spjeldliste's 16 plus `container_type`
  `"table_container"`, `title` `"Table Container"`, and the six table-state
  fields `num_of_rows`, `num_of_col`, `descr_width`, `val_width`, `cells`,
  `last_y`. Conflict **RC-C1**: both container shapes are real and neither is
  the general case.
- **`unique_id` must contain `custom_`.** Without it the host routes the
  container to `.template()`, an empty stub, and the whole grid **silently
  vanishes on Insert** — no error, a panel that looks like a blank canvas.
- **Item `zIndex` is the string `"5"`**, not the spjeldliste's `"900"`;
  container `zIndex` is the integer `4` in both families.
- **It does not fit the canvas, and is not meant to.** E18 declares
  1400 × 750 and reaches x 3,120 / y 1,690 — 2.2× and 2.25×. 31 signal columns
  at 90 px is 2,790 px of table before anything else. Compressing it to fit,
  or dropping rooms or columns to fit, is the defect; the plant view scrolls.
- **`number_v3_cell_grey25` is absent from the object catalogue.** It is used
  1,700 times here and lives in `reference_data/controls-registry.json`, not in
  the palette dump — conflict **RC-C2**, and the reason the validator resolves
  object ids against both registries.

**Generating one: [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md).**
It owns the classification test, the envelope, the container, object selection,
all measured geometry, the column → signal mapping, the three output modes, the
validation contract, the conflicts and the two rejected generations.
Procedure: [ROMKONTROLL-AUTHORING-GUIDE.md](ROMKONTROLL-AUTHORING-GUIDE.md).
Acceptance gate: [ROMKONTROLL-QA-CHECKLIST.md](ROMKONTROLL-QA-CHECKLIST.md).
Promptable digest: [ROMKONTROLL-COPILOT-PREFLIGHT.md](ROMKONTROLL-COPILOT-PREFLIGHT.md).
Committed reference export:
[reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json)
— one building, measured; not a design target for another.
