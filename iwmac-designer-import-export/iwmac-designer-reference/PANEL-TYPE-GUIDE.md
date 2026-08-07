# IWMAC panel types — how Coop Extra panels are built today

A per-panel-type style guide, mined 2026-08-08 from the live compiled panels of 41 Coop Extra plants (231+ panels). Raw data: [reference_data/plant-panel-survey.json](reference_data/plant-panel-survey.json). Per-plant inventory: [PLANT-PANEL-CATALOG.md](PLANT-PANEL-CATALOG.md). Written as a knowledge file for AI assistants (Copilot) helping colleagues build or copy panels.

**Common rules across all types (fleet-verified):**

- Canvas: **1400×750 px** is the standard. 1280×1024 only appears on older-era panels — do not build new ones at that size.
- Style era: **modern V3 objects only** — zero legacy `V2_*` objects anywhere in this fleet.
- Containers and graphics: **empty on almost every panel** — panels are flat `single_objects` over a background PNG. (Exception: 9914's room-card panels.)
- Backgrounds: nearly every panel has an embedded PNG background. Two families: a drawn schematic (Maskin, Energi, VGV, Kondens — 30–130 KB) or the ~6 KB blank canvas on which Ventilasjon panels draw their duct layout using objects.
- Backup convention: keep the old version as a hidden panel suffixed `_old` / `Gammel` / `_copy` — never overwrite history.
- Visibility: main panels `visible=1`; detail/backup panels `visible=4` (hidden from the list, reachable via navigation buttons).
- To copy a panel between plants: Export JSON on the source plant → Insert JSON on the target, accept the driver-id prefix rewrite, then re-link via the parameter selector (aliases carry over — see the linking notes per type).

---

## Oversikt (store overview) — every plant has one

The floor-plan panel: case clusters placed over the store layout PNG.

- **44 panels**, median **132 objects**, ~**95% driver-linked** — the most object-dense and most fully linked panel type.
- Built almost entirely from the four-object **case cluster** (one per cooling position):
  - `V3_R_34px_circular_alarm_nrm` — alarm bell (1,795 uses fleet-wide)
  - `number_v3_40px_no_conn_no_tag` — temperature box (1,769)
  - `V3_R_28px_circular_defrost_nrm` — defrost symbol (1,171)
  - `V3_R_28px_circular_cooling_nrm` — cooling symbol (970)
  - All four link to the same case controller.
- Trim: `number_v3_label_12px_bold` / `_11px_norm` labels, `V3_led_21px_circ_grey_red` LEDs, `number_v3_1440x95_footer_dark` footer bar, `number_v3_header_grey75` headers, occasional `number_v3_rc_temp_sp_60` room-temp boxes.
- Background: the store floor plan PNG (30–70 KB).
- **Best copy sources:** 9982 EXTRA Fauske (240 obj, 100% linked) · 9856 EXTRA Løten (215, 100%) · 9857 EXTRA Otta (207, 100%) · 9673 Extra Vennesla (206, 100%).

## Maskin (CO₂ rack / machine room) — every plant has one

The refrigeration-plant schematic: pack controller values drawn onto the machine drawing.

- **39 panels**, median **59 objects**, ~**98% linked** — always fully linked when finished.
- Object mix is value-dominated:
  - `number_v3_value_only` (1,422) — the white value pill, drawn EMPTY on the background artwork
  - `number_v3_white_value_only` (261)
  - `V3_akpc_772_781_781A_783_contr` / `V3_akpc_782A_suct` / `V3_akpc_783_781A_782A_cond` — the Danfoss AK-PC pack-controller blocks
  - `V3_led_13px_circ_grey_green`, `V3_81x21_enebled_disabled_nrm`, `V3_ok_alarm_nrm`, `V3_21px_single_pump_grey_green_down`, `V3_co2_compressor_31x35_nrm`
- Background: the Advansor-style CO₂ booster drawing (80–130 KB) — see `reference_data/maskin-drawing-method.txt` for the drawing doctrine and `maskin-light-template.ai` for the production template.
- Linking: aliases are Danfoss parameter names (`Pc`, `Sd-MT`, `Running capacity MT` …) — `reference_data/maskin-akpc-link-map.json` is the canonical alias→parameter map; relinking by alias is how a Maskin moves between plants.
- **Best copy sources:** 9643 EXTRA Kjerulfsgate (67, 100%) · 9683 Extra Havnesenteret (67, 100%) · 9982 EXTRA Fauske (64, 100%) · 9664 EXTRA Rakkestad (63, 100%).

## Ventilasjon (360.NNN) — most plants

The air-handling-unit page: ducts, dampers, filters and sensors drawn **with objects** on a blank background.

- **34 panels**, median **92 objects**, ~**54% linked** — the many label/duct scaffold objects have no driver, which is normal; the *values* are what gets linked.
- Named `Ventilasjon`, `360.001 Ventilasjon`, `360.01 Ventilasjon`, or per-zone (`360.001 Utleiedel`, `360.002 Butikk`); multi-AHU plants get one panel per system.
- Object mix (scaffold + values):
  - `number_v3_label_11px_norm` (515) / `_8px_norm` (155) — labels everywhere
  - `number_v3_R_45px_con_down/_top/_left` (398) — the duct connector pieces the layout is drawn with
  - `number_v3_60px_dark_no_conn` (220) — dark value boxes
  - `V3_R_34px_circular_alarm_nrm` (196), `number_v3_60px_json_obj` / `number_v3_custom_json_obj` (165) — JSON plugin objects
  - `numberV3_filter_with_diff_press` (56), `number_v3_fresh_pipe_horisontal` (37), `number_v3_header_grey75` section headers
- Background: the ~6 KB blank (`00-blank…`) — the drawing *is* the objects.
- Reference exports already in the kit: `reference_data/real-vent-panel-example.json` (unlinked) and `real-vent-panel-linked-example.json` (linked twin, the linking contract).
- **Best copy sources:** 9916 EXTRA St. Olavsgt (92 obj) · 9868 EXTRA Ugla (90) · 9914 EXTRA Hunstad 360.01 (87) — all the same 57%-linked scaffold pattern.

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

The only plant using containers at scale: `Romtype1/3/4`, `romtypevav1-3`, and per-room `Rom NNN` panels (1 object + 3–15 containers each), plus `Plan 1`/`Plan 2` floor plans with 14 room-card containers. This is the **room-control card pattern** (same idea as the hotel `rc_box` cards, CLAUDE.md §17b) — study 9914 before building per-room panels for a store with tenant/office zones.
