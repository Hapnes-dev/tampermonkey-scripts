# IWMAC Designer (V5) — host deep-dive reference

> **What it is:** the legacy IWMAC panel/mimic designer — the tool that builds the graphical plant-view panels (refrigeration overviews, ventilation pages, energy pages) shown in Supermarket. Absolutely-positioned object DIVs over a background PNG; no framework, no virtual model — **the DOM is the document**.
> **Where it runs:** `http(s)://legacy.iwmac.local/iwmac_designer_v4/?plant_id=<id>` — page title "IWMAC Designer V5". `index.php` requires a logged-in session cookie ("There is no user info" without one; "Missing plant id" without the param). Every static asset (all JS/CSS/HTML under `V3scripts/`, `iw_library_v3/`, `graphics/`, `tool_site/`, `designer_site/*.htm`) is fetchable **without** auth; only `index.php` and the PHP data endpoints need the session.
>
> **Line references** cite the host paths (e.g. `V3scripts/container_tool.js:2048`) as served with `?t=9` in August 2026. Probe artifacts captured from a live plant are in [reference_data/](reference_data/).

The sibling userscript [`../IWMAC-Designer-Import-Export.user.js`](../IWMAC-Designer-Import-Export.user.js) (§17) builds directly on the functions documented here.

## 1. Technology stack & page anatomy

jQuery 1.12.4 + jQuery UI 1.12.1 (CDN), jquery.form (CDN), keymaster, w2ui, d3 — everything in page scope, PHP backend. Script load order (see `reference_data/page-anatomy-probe.json`):

`keymaster.js` → `V3scripts/main.js` → `iw_library_v3/{iw_util,iw_xml,iw_move_object,iw_popup_filehandler,iw_popup_paramhandler}.js` → `V3scripts/container_tool.js` → `graphics/library/{d3,w2ui}.js` → `graphics/{graphics_defs,graphics_build,graphics,contextmenu}.js` → `iw_library_v3/iw_site.js` → **`iw_library_v3/iw_graph_designer_js.php`** (PHP-emitted JS glue: the `controls[]` registry, `iw_make_ctrl`, `iw_load_from_db`) → `V3scripts/{V3scripts,autotagging,explorer_tool,templates}.js`.

Page regions:
- `#control_container` — the canvas; object DIVs are its direct children.
- `#main_image` — the background layer; carries attrs `main_image`, `org_image_name`, `converted`, `encoded_image`.
- `#master_wrapper > #manager_div` — the left manager sidebar (§3), loaded from `tool_site/master_page.html`.
- `#toolbox_accordian` — the object palette accordion; other left pages: `tool_site/linking_site.html` (unit/tag linking), `tool_site/templates.html` (templates).
- `#prop_widget_*` — the right property widgets; `#manager_widget8 #status_field` is the status toast area (`V3ok_message`/`V3alert_message`, V3scripts/V3scripts.js:368-405, auto-clear 2 s).

Key globals (live-verified): `cust_id` (plant id, number), `design_modus` (an **HTML attribute string** injected into object markup: `onmousedown=min_mouse_ned(…) onmouseover=iw_mouse_over(…) ondblclick=iw_select(…)`, V3scripts/main.js:1170), `controls` (1769 render defs), `all_design_objects` (820 palette entries), `objectList`, `designContainers`, `duplicator`, `loadedGraphic`, `graphicsCompiler`, `table_container`, `localStorage["num_of_containers"]` (the container-name counter).

## 2. Core mental model: the DOM is the document

There is no model layer. Objects exist as DIVs with ~30 attributes each; every save **reads the DOM** (`getPanelDataFromDOM`, §8), every load **writes the DOM** (`iw_make_ctrl` markup strings, §10). The two bookkeeping singletons —

- `objectList` (container_tool.js:1952) — 11-field records per object; `find()` returns the **last** match (:1993-2001), which is why duplicate entries are benign;
- `designContainers` (container_tool.js:1645) — container records of **non-uniform shape** (fields depend on which code path created the record);

— are convenience caches rebuilt from the DOM by `UpdateObjectWorker()` (container_tool.js:10-32, debounced 2000 ms, **appends without clearing**). Trust the DOM, not the caches.

Element-class predicates (container_tool.js:2969-2988): a **single object** is `id === "driver_id"` with `offsetParent` = `#control_container`; a **container** is `id === "objects_container"` at top level; a **container child** is `id === "driver_id"` inside a container.

## 3. The manager sidebar

`tool_site/master_page.html` is fetched once and injected with `document.getElementById("master_wrapper").innerHTML += content` (`ToolBars.buildLeftPage`, graphics/graphics_build.js:428-451) — see gotcha #1. Widgets as actually rendered (live-verified):

| id | legend | buttons → functions |
|---|---|---|
| `manager_widget1` | New | `makedesigner_panel` → `load('ny')` (prompt for name, clear canvas) |
| `manager_widget2` | Retrieve | `#plant_panels_select` + `load_plant_panel` → `load('')`; checkbox `#plant_panels_xml_check` "Load from legacy XML-format" |
| `manager_widget4` | Save | `save_plant_panel_btn` → `iw_save(null,null,null,null,null)` "Compile Panel for Plant" (§9.2); `sync_designer_panel_btn` → `iw_sync()` |
| `manager_widget5` | Delete | `iw_delete()` (server delete + reload), `iw_deleteAllItems()` (canvas clear only) |
| `manager_widget6` | Manage Images | upload PNG (`iw_select_image_from_pc`), select PNG (`iw_select_image`), remove PNG (`iw_select_file('image')`), panel order (`change_picture_order`) |
| `manager_widget7` | Manage Files | upload PDF (`#upload_file_btn`), remove PDF (`iw_select_file('file')`) |

**`manager_widget3` does not exist.** Code addresses `#manager_widget3 select[id=design_panels_select]` (graphics_build.js:1251, main.js:1243) but the widget was removed from the static HTML — those selectors silently match nothing.

`initMaster()` (graphics_build.js:1206-1334) wires the filter box, fills `#plant_panels_select` from `V3get_plant_designer_panels` (→ global `loaded_compiled_panels`), and attaches the **runtime d3 bindings** the static HTML lacks: `#change_panel_order_btn` → `change_picture_order(cust_id)` (:1315-1318) and **`#upload_file_btn` ("Upload PDF to Server") → `openFileUploader()`** (:1319-1323 — the button has no `onclick` in master_page.html; this d3 `.on("click")` is its only wiring). Also `V4_fileSelector_make(...)` (:1325) and the rubber-band `drawSelectWindow` on `#main_image` (:1327-1332). The current-panel accessor is `get_value()` (main.js:1246 — selected option **text**); `set_value()` (main.js:1237) appends a new Option (used by `load('ny')`).

## 3b. The toolbar layer (w2ui)

Live registry dump: [reference_data/toolbars-live.json](reference_data/toolbars-live.json). All defs live in `ToolBars` (graphics_build.js:8-180); built by `iw_init()` (inline in index.php, body `onload`): `buildTopBar` (:379), `buildObjBar` (:411), `buildExplorerBar` (:395). **No toolbar button carries an app handler in markup** — w2ui renders generic `w2ui['<name>'].click('<id>')` glue and dispatch happens in `toolbars.topBarHandler` / `objectToolHandler` / `explorerToolHandler`. Generated cell ids: `tb_<toolbarName>_item_<itemId>`.

**Top bar `#iw_toolbar`** (w2ui name `iw_toolbar`; handler `topBarHandler`, graphics_build.js:673-798):

| item | effect |
|---|---|
| `cl_left` / `cl_right` | collapse left toolbox (`#main_toolbar_left` 319px⇄0, main.js:249-259 — compares the literal string `"319px"`, breaks after manual resize) / collapse right property field (main.js:238-248) |
| `save` (radio, SAVE) | **pane switch only — does NOT save**: shows `#master_site` (the manager sidebar §3). Real saving = the sidebar buttons |
| `ibt`/`ref`/`rc`/`text`/`led`/`valves`/`buttons`/`danfoss` | `buildLeftItems("IBT"\|"Refrigeration"\|"RoomControl"\|"Text"\|"LED"\|"Valves"\|"Buttons"\|"Danfoss")` — the palette accordion (§4) |
| `templates` (TPL) | gated on global `is_iwmac`; loads `tool_site/templates.html` (§14) |
| `links` (LINK) | shows `#linking_site` (the unit/tag linking pane) |
| `tb_select` (Actions ▾) | see below |
| `grid` (check) | toggles `#grid` className `grid_img_0 ⇄ grid_img_1` (:752-755) — NOT load_grid |
| `fade` (check) | `#main_image` opacity `1 ⇄ 0.3` (:747-751) |
| `gridcolor` (color) | intercepted in `buildTopBar` :384-390 → `load_grid("build", <size>, "#"+color)` |
| `loaded_size` (html) | renders `<div id="panel_size">Panel -> Width: W , Height: H</div>` from `get_layoutSize()` (inline index.php; `setlayoutSize(w,h)` writes it, resizes `#main_image`, rebuilds the grid) |

**Actions ▾ menu** (items :35-49, handlers :737-796; w2ui targets arrive as `"tb_select:<caption>"` — **the switch matches the English caption text**, the `value:` field is unused): `Open Paramselector Popup` → sync `iw_load_units.php` + `openParamsPopup(xml)` (§13b) · `Open Param selector page` → **empty body** (dead) · `CLOSE / OPEN Dark / OPEN White Landing Field` → hide/show `#objects_landing_field` (bg `#9ea5af` / `#ffffff`) · `10/25/50/100px Grid` → `load_grid("build", N, <color>)` · `Set PanelSize 1400x755` → commented out (no-op) · `Open OLD V2-OBJECTS` → `openObjectsSelectorModal()` (the ~880 V2_* defs, §4) · `YR-CREDITS` → `iw_add_image({id:"number_yr_credit"})` (missing `break`, harmless fall-through).

**Object bar `#iw_objects_toolbar`** (w2ui `iw_objtoolbar`; handler `objectToolHandler` :610-671): `align_left/right/top/bottom/middle_vert/middle_horis` → `alignment('left'|'right'|'top'|'bottom'|'center_v'|'center_h')` (container_tool.js:2832) · `distribute_vert/horis` → `distribute_obj_vertically()`/`distribute_obj()` (V3scripts.js:984/:917) · `makegroup`/`ungr` → `makeGroup()`/`unGroup()` (V3scripts.js:1408/:1296) · `z_minus/z_plus` → `setObject_Z('0','decrement'|'increment')` (±50), `z_bottom/z_top` → `setObject_Z('5'|'1100','set')` (main.js:734-760) · `undo` → `iw_undo()` (single-level, position-only) · `grad_minus/plus/minus_90/plus_90` → `elementselector.selected.rotateElement(...)` (±15/±90; d3-selection method — graphics elements only). Readouts `#zval` and `#obj_degrees` are **read-only `<div>`s**, not inputs. **Rotate gating is index-hardcoded**: `enableObjToolbarItems` flips `items[32..36].disabled` (graphics.js:376-388) — reordering the item array silently breaks it; buttons enable only when the clicked graphic has `attr("rotate")==="true"`.

**Explorer bar `#explorerbar`** (`iw_expltoolbar`, :589-608): `explore_obj/cont/tags/states/users` → `explore({id:'explore_object'|'explore_container'|'explore_tag'|'explore_simulator'|'explore_user'})` — the right property-pane tabs.

**Graphics sidebar** (`graphics_site_menu`, w2sidebar): nodes are **hardcoded** in `buildGraphicsSite` (:284-341, "todo implement loading from DB"). `load_dbMenuItems`/`build_dbMenuItems` (POST `designer_site/graphicsHandler.php?function=load_graphic_menu|build_graphic_menu`, :342-377) exist but have **no callers**; the live endpoint replies "No Functions awailable" (sic). Click flow: `graphicsSideMenuHandler` (:570-588) — 4 hardcoded id→graphic mappings, then unconditionally `loadGraphics(event.object.name, …)` (double-fire when a mapped node also has a `name`).

**Palette accordion** (`buildLeftItems`, :458-569): filters the global `all_design_objects` client-side by `menu_type` (`parse_designtools`), one accordion section per `object_type`, and per object three actions: thumb click → `show_details` → `MakeObjectProps('V3', id)` (status simulator), green + → `load_multiple_items` (reads the repeat-count input, calls `iw_add_image` N times), group-add icon → `add_object_to_container(this)`. Both action `<img>`s share `id="<object_id>"` (duplicate DOM ids by design).

**Grid** (`load_grid`, graphics_build.js:1090-1204): pure visual — SVG lines serialized to a Blob URL set as `#grid` background; `grid_size`/`grid_color` stored as attrs. **Nothing snaps to it.** Bug: the vertical-line loop iterates to `width`, so panels taller than wide lose vertical lines.

## 4. The object palette

Two registries, different roles:

- **`all_design_objects`** (820 entries) — what the toolbox lists. Entry: `{object_id, menu_type, object_type, object_name, inverted, base_image_path, info, width, height, default_tag_txt, status_array}`. Filtered per accordion page by `parse_designtools(panel, cb)` (V3scripts.js:1) — `menu_type === panel` for objects, `menu_type === panel+"_Cont"` for containers.
- **`controls[iw_name]`** (1769 entries) — how an object **draws**. `Control(name, width, height, action, zindex, cursor, classname, status_array, tag_text_classname, tag_text_default_text, only_tag_text, obj_type)` (iw_graph_designer_js.php:6). Derived: `.file = status_array[1]`, `.hasTag = !!tag_text_default_text`, `.canLink` = false only for `obj_type ∈ {dummy, dummy_tag, label, container}` (:7-10). Samples in `reference_data/object-palette-samples.json`.

`obj_type` vocabulary (iw_graph_designer_js.php:28-43): `dummy, dummy_tag, label, value_txt, textbox, textbox_tag, dig_object, dig_object_tag, states_object, link_button, head_container, head_container_foot, container_foot, container`.

**Complete catalogues are committed** (live dumps): [reference_data/all-design-objects.json](reference_data/all-design-objects.json) — all 820 palette entries — and [reference_data/controls-registry.json](reference_data/controls-registry.json) — all 1769 render definitions. Note `controls` is declared as an **array** with named properties (iw_graph_designer_js.php:1) — `JSON.stringify(controls)` yields `[]`; dump via `Object.getOwnPropertyNames`.

**Named, human-readable version of both: [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md)** — every one of the 797 distinct palette objects with a plain-language name and description, size, tag/link capability, states, and its real production usage (placement count + which panel types), grouped by menu and `object_type`, plus a "Pick by task" table, and appendices for the inactive/outdated ids, the 19 palette ids with no render def, and the active-but-never-used ones. Machine-readable twin: [reference_data/design-object-catalog.json](reference_data/design-object-catalog.json). Both are regenerated offline (no network, no LLM) by [build-object-catalog.py](build-object-catalog.py), which joins the two dumps against the 266 surveyed production panels — rerun it after a fresh palette dump or a new survey.

**Palette census — `menu_type` (which toolbar category button lists it, §3b):**

| toolbar radio | menu_type(s) | entries |
|---|---|---|
| IBT | `IBT` 145 + `Inactive_IBT` 16 + `__IBT` 5 + `Outdated____IBT` 3 | 169 |
| TEXT | `Text` 181 + `Inactive_Text` 8 | 189 |
| RCO | `RoomControl` 106 + `__RoomControl` 1 | 107 |
| REF | `Refrigeration` 100 + `Refrigeration_Cont` 7 (containers) | 107 |
| VALVE | `Valves` 78 + `Inactive_Valves` 12 | 90 |
| LED | `LED` 69 + `Led` 1 | 70 |
| BTN | `Buttons` 67 | 67 |
| DAN | `Danfoss` 20 | 20 |
| (containers) | `Groups` 1 | 1 |

`object_type` is the accordion sub-category inside a menu (~95 distinct values: Fans, Dampers, Solenoid-valves, Compressors, Statussymbols, Sub-Page-Buttons, Ducts (Exhaust/Inlet/Supply ×14), AK-PC-7xx Danfoss families, Infoscreen-left/centered/right, DASHBOARD, 4K-Resizable, …) — full distribution derivable from the committed dump.

**controls registry census — `obj_type` of the 1769 render defs:** modern types (`textbox_tag` 206, `dig_object` 197, `dummy` 155, `dig_object_tag` 85, `link_button` 42, `value_txt` 38, `label` 36, `dummy_tag` 28, `states_object` 25, `textbox` 9, `nolink_button` 8, `toggle_button_tag` 4, containers 4+`container_link` 2) **plus ~880 legacy `V2_*` defs** (`V2_text` 294, `V2_status` 106, `V2_ventilation` 106, `V2_indicators` 103, `V2_subpage_btn` 65, `V2_refrigeration` 56, `V2_valves` 32, `V2_pumps` 32, `V2_templates` 30, `V2_previous_page_btn` 30, `V2_buttons` 24, 52 with no obj_type). The V2 families are reachable via the Actions menu's "Open OLD V2-OBJECTS". `canLink`'s deny-list only names the modern types, so V2 defs are all linkable.

**`iw_make_ctrl(element_id, name, container, iw_attr, design_modus, left, top, width, height, unit_id, alias_text, tag_text, file_pdf, obj_type, zindex, unit_ref, link_tag, sub_group)`** (iw_graph_designer_js.php:124) — 18 params, returns an **HTML string**. Every object on every panel is born from this. Details that bite:
- `ctrl_id = canLink ? element_id : ''` (:135) — non-linkable objects get an **empty** driver_id.
- unknown `name` → `controls[name]` undefined → `class='undefined …'` markup, no error (:125).
- `iw_type` attr drives dbl-click behavior (:239-253): transparent selectors → `1`, sub_page → `5`, file_pdf → `6`, default `3`; containers → `10`.
- `dummy`/`dummy_tag` force `link_tag="NA"` (:273-275); `!hasTag` suppresses the `tag_text` attribute entirely.
- Container types return early with completely different wrapper markup (`#objects_container[template_id=…]` + `objects_header`/`objects_content`/`objects_footer` inner divs, :392-552).

## 5. Objects on canvas: attributes & bindings

Attribute census from a live 54-object panel (`reference_data/page-anatomy-probe.json`): every object carries `class, onmousedown, onmouseover, ondblclick, onclick, style, iw_no_scale, iw_type, picture, type, driver_info, driver_id, unit_id, unit_ref, alias_text, id, name, pheight, pleft, ptop, pwidth, link_tag, link_name, sub_group, linked, settag, object_type, hastag, only_tag_text, data-title, iw_name`; `tag_text` only on labeled objects.

**Binding fields:**
- `driver_id` — **plant-prefixed**: `10113_AK3_AKC_0_11_1_0_7` = `<plant_id>_<driver>_<address path>`. This is what makes cross-plant panel copying detectable/rebindable by prefix rewrite (same scheme as the VV Designer's sketch driver ids). BACnet exception: `bacnet_ualarm_v1/v2` objects get `.Ualarm` appended on save (`bacCheck`, container_tool.js:2053-2056) and stripped on load (`checkDriver`, V3scripts.js:470-480). It proves only which string the document carries; the host does not resolve it during load.
- `unit_id` — `000:011` bus:address, **not** plant-prefixed. It is the controller locator written by the parameter selector, but the document can carry a stale or foreign value. `unit_ref` is an optional stable reference; empty is common.
- `id` — the literal DOM id `"driver_id"` on linkable objects. It identifies the host object kind. It is **not** a parameter id and proves no binding.
- `link_tag` — the IWMAC system tag (`AREA_SYSTEM_UNIT_SIGNAL_COMPONENT_SUBJECT`, §13). Non-value sentinels: `""`, `"link_tag"`, `"undefined"`, `"NA"`. It is tag metadata, not evidence that `driver_id` resolves.
- `sub_group` — parameter instance ("A", "B", …); sentinel `"sub_group"` normalizes to `"A"` in three separate places (container_tool.js:1961, :2459, save_xml.htm:377).
- `link_name` — `iw_param_name`; created as the literal `"link_name"` (iw_graph_designer_js.php:289). Production parameter objects routinely retain that literal. It is **not** a destination-panel field; navigation objects store their target by their own object contract (the observed sub-page objects use numeric `driver_id`, §17b).
- `linked` — document/host state. `linked="true"` is set whenever `driver_id !== "driver_id"` on load (V3scripts.js:514), **including an empty `driver_id`**. It proves neither source resolution nor semantic correctness.
- `alias_text` — selector text/parameter description. It is human and semantic evidence only when compared with the plant-specific parameter source; the host does not validate it against `driver_id`.
- `tag_text` — free display label, only serialized when `controls[type].hasTag`.

**Host-state boundary:** the Designer does **not** validate `driver_id`, `unit_id`, `alias_text`, `linked`, `link_tag`, `link_name` or `unit_ref` against the plant when loading a document. A foreign, stale or syntactically plausible id renders fine and simply reads no value — or the wrong value if it happens to resolve elsewhere. `linked="true"` plus a non-empty `driver_id` is therefore only **structurally linked**, never proof of binding validity. Source-backed and semantic verification are workflow rules owned by [AI-BRIEFING.txt](AI-BRIEFING.txt) §8b; this section owns only what the host fields do.

## 5b. Input layer: drag / move / resize (`iw_library_v3/iw_move_object.js` + `iw_util.js`)

Mouse plumbing is IE-era: `iw_get_mouse_x/y()` (iw_util.js:34/:45) read the **implicit global `window.event`** (only valid during synchronous dispatch); `iw_util.js:1` declares `iw_mouse_x` twice and `iw_mouse_y` never (implicit global). Event wiring: objects carry inline `onmousedown=min_mouse_ned(event,this)` (from `design_modus`); `<body>` has `onmousemove="iw_move_object()"` + `onmouseup="iw_mouse_up()"` + `onkeydown="microsoftKeyPress()"`.

- `iw_mouse_down(event, obj)` (iw_move_object.js:200-249): stores drag offsets; `id === "drag_handle"` retargets to the popup being dragged; Ctrl held → builds `ofsetArr` from `obj_Arr` for multi-drag; then **resize-mode detection**: `iw_no_scale` attr → mode 4 (move), else a **10 px bottom/right hot-zone** picks mode 1 (both) / 2 (width) / 3 (height) / 4 (move).
- `iw_move_object()` (:106-139): **modes 1-3 are empty switch cases** — mouse resizing via this path is a no-op (resizing actually happens via `resize_by_arrows` / jQuery-UI). Mode 4 single-drag writes `style.left/top` as **bare numbers without "px"** (:130-131, quirks-mode leftovers), and the Ctrl multi-drag branch writes IE-only `style.posLeft/posTop` (`move_dragged_objects` :141-144) — **dead in Chrome**; multi-move only works via `ctrl+arrows`.
- `iw_mouse_up()` (:194-198) just clears state — **no grid snapping exists anywhere** (the grid is purely visual, §3b).
- Arrow nudging: `iw_move_obj_one_step` (:146) ±1px on `obj_selected`; `iw_move_objects_one_step` (:169) loops `obj_Arr`; `resize_by_arrows` (:73-104) writes `style.width/height` **and** mirrors into the persisted `pwidth`/`pheight` attrs.
- **`changeTagObject(object, w, h, x, y, tag_text, selected_file)`** (:21-71) — the write-back used by tag/text/file modals: sets `style` + persisted `pleft/ptop/pwidth/pheight`, then either `tag_text` (label objects: inner DIV + attr) or `driver_id`/`driver_info` (+ `file_pdf` for pdf objects); routes the property-widget refresh by object kind. Guard quirk: compares `tag_text !== "undefined"` (the **string**).
- `resize_object` (:7) is dead (IE-only `style.pos*`, no callers). Undo: single-level, position-only (`iw_undo_data = [obj, left, top, w, h]` captured on every mousedown, main.js:1216-1231; only indices 1-2 are restored).

`iw_library_v3/iw_site.js` is the IE4-era IWS chrome — almost entirely dead (`eval()`-driven menu/toolbar helpers; `iw_body_click` is never bound because the `<body>` `onclick` attribute is **mangled** in index.php: `javascript:iw_body_click();'=""` parses as a bogus attribute name). Still live: `iw_show_toolbox(name)` (:313-333 — lazy pane loader, sets `loaded=true` + `loadPane(name)`), `iw_show_main_page` (:335, used by `initMaster`), and the `iw_idle_*` runtime-value callback API (:387-412, viewer-oriented, unused in the designer).

## 6. Containers

Four layout types with a duplicated content-index switch (container_tool.js:2135, :2546, :2723, V3scripts.js:688):

| type | content idx | header idx | footer idx |
|---|---|---|---|
| `container_c` | 0 | – | – |
| `container_hc` | 1 | 0 | – |
| `container_hcf` | 1 | 0 | 2 |
| `container_cf` | 0 | – | 1 |

`ContainerDataHandler.containerTypes` (container_tool.js:3028-3485) adds 8 specialized container flavors (Objects Container, Line/Bar Graph, Gauge, Progressbar, YR-CREDITS, Notes Field, **Table Container**). Table containers (`table_container` singleton, :3699-3849) keep extra state in `table_container.tablecontainer[<name>]` (`num_of_rows, num_of_col, descr_width, val_width, cells, last_y, header_descr`) and are built from four cell control types (`number_v3_header_appgrey`, `number_v3_header_grey75`, `number_v3_cell_grey25`, `number_v3_val_cell_grey25`).

Container naming: `objects_container_<n>` / `unique_id custom_<n>` where `<n>` comes from `localStorage["num_of_containers"]` on load (V3scripts.js:565-574) or the canvas child index on paste (autotagging.js:540-543).

Real-world usage: the container type that actually ships is the plain `objects_container` (`container_c`) used as a **table row** — the production spjeldliste is 208 of them (one per damper, §17b "list panel"). In those files the container's own `zIndex` is a **number** (`4`) while its items carry string zIndexes (`"900"`), and item `name`s freely collide with canvas-level object names (production has 788 items sharing 8 names, all also used by single_objects) — nothing in the host cares.

### 6a. What the collector and the importer do to a list panel

Four host behaviours decide what a generated list panel may and may not contain. Each is documented in full where it belongs; this is the summary a generator needs.

| Behaviour | Consequence for generated JSON | Source |
|---|---|---|
| `getPanelDataFromDOM` reads the DOM only — it never re-derives geometry, ids or bindings | Whatever you emit is what comes back out. There is no normalization pass to lean on | §8 |
| Item `tag_text` is unconditional in `get_items` and **may be `null`** in stored docs; positions have no `\|\| 0` fallback (NaN possible) | `tag_text: null` on a live value cell is legitimate, not a bug. A non-integer coordinate survives collection and breaks on render | §8 |
| `load_new_ver_containers` routes on `unique_id.indexOf("custom_")`; the non-`custom_` branch, `.template()`, is an **empty stub** | A container whose `unique_id` does not contain `custom_` **silently vanishes on Insert** — no error, no row | §10.1 |
| Insert uses the `objects_template` append path, which **skips the canvas clear**, and renames from `localStorage["num_of_containers"]` / the live child index | The host path only ever appends, so on a populated panel it duplicates every row; the userscript compensates by asking replace-or-add and clearing the canvas itself for replace (§17). Container names and `unique_id`s are renumbered by the host, so their absolute values do not survive — only their order and uniqueness matter | §10.1, §12, §17 |

Two further consequences, both verified in production exports: nothing resolves a container **item** by `name`, so colliding item names are harmless; and the collector round-trips author artefacts untouched — `driver_id "#c1"`/`"#c2"` with `linked:"true"` on static cells, and `linked:"true"` on unbindable scaffold objects (§19 gotcha #25). Preserve them when editing an export; do not emit them when generating.

**Generating a list panel from a source table is not this file's job.** [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) owns it: request classes, column mapping, all measured geometry, binding modes, the artefact preservation matrix, the validation contract and worked examples. This section owns only the host behaviour it must respect.

## 7. The two panel stores

A plant's panels exist in up to two server-side forms:

1. **Compiled/plant panels** — what Supermarket renders. Listed by `V3get_plant_designer_panels` (fields `pic_id_data_type, panel_name, id, visible, image_name` — `reference_data/panel-lists.json`), stored behind **`iw_load_ctrls.php`** in both XML and JSON form (§10.2), written by **`iw_save_ctrls.php`** via the save popup (§9.2).
2. **Design panels / templates** — designer working documents, JSON only, in the `V3_objectHandler` store: listed by `V3get_designer_panels`, loaded by `V3load_design_panel`, saved by `V3_save_design_panel` with a `location` ("global"/"personal") + `panel_type` (`design_panel`, `plant_design_panel`, `panel_template`, `objects_template`). A plant can have **zero** of these (the sampled plant's five panels exist only compiled).

## 8. The design-panel JSON document (normative)

Produced by **`getPanelDataFromDOM(plantId, panelName, imageName, savedBy)`** (container_tool.js:2048-2290) — pure DOM read, no network. Sanitized live sample: `reference_data/design-panel-doc-sample.json`.

```jsonc
{
  "plant_id": "10113",
  "panel_name": "Oversikt",
  "panel_width": "1400px",          // css strings, from #main_image
  "panel_height": "750px",
  "org_image_name": "10113_oversikt_v3.png",
  "image_name": "",                  // see quirk below
  "saved_by": "thomas.kvalvag",
  "single_objects": [ /* 18-field entries, below */ ],
  "containers":     [ /* 17+ field entries, below */ ],
  "graphics":       [ /* d3 graphic records, §11 */ ]
}
```

**`single_objects[]`** — built by `items_handler.get_single_objects` (:2057-2100), top-level objects only (offsetParent name check :2060-2061). Fields: `obj_id` (attr `type`), `name` (`object_N`), `id` (the literal `"driver_id"`), `posWidth/posHeight/posLeft/posTop` (parseInt of style, `|| 0`), `zIndex` (raw string), `tag_text` (only when `controls[type].hasTag`, else `''`), `linked`, `link_name`, `link_tag`, `sub_group`, `driver_id` (via `bacCheck`), `unit_id`, `unit_ref`, `alias_text`, plus conditional `file_pdf` for the two pdf object types (:2084-2088).

**`containers[]`** (:2188-2265): `id, unique_id, name, type, container_type, className, header_footer[] ({type:"header"|"footer", text, function:"none", function_id:"none"}), linked, linked_to (from the registry's linked_unit), width, height, left, top, zIndex, items[]` + merged custom attributes (:2254-2262). `items[]` entries (get_items, :2101-2134) mirror the single-object fields but `tag_text` is unconditional (**can be `null`** in stored docs) and positions have **no `|| 0` fallback** (NaN possible). `tbl_container` className is normalized back to `objects_container` (:2235) and table custom attrs come from `customAttributes("tbl_container")` (:2256).

**Live-verified** on a second plant's containered panel ([reference_data/design-panel-doc-container-sample.json](reference_data/design-panel-doc-container-sample.json)): the stored container carried exactly these 16 keys (+ custom attr `title`), the collector reproduced it 1:1, and inserting the export onto an empty canvas reconstructed it at position with its item inside, registered in `designContainers`, renamed `custom_0`→`custom_1` by the `localStorage["num_of_containers"]` counter — 236 objects + 1 container, zero errors.

**Quirks (verified in source):**
- The returned object is the same `json_data` with `.graphics` attached by `graphicsCompiler.newCompile("json","partly",json_data)` (graphics_build.js:1057-1087 — flattens `loadedGraphic.loaded` to an array; `"full"` is an empty stub).
- `image_name` at :2276 is computed (blank when `org_image_name` exists) and then **discarded** — line :2283 stores the raw `imageName` argument.
- `panel_width/panel_height/org_image_name/image_name` are assigned without `var` → leak to globals.
- **Storage is array-of-one:** `V3_add_designpanel_data` pushes the doc into `DesignPanelArray` and posts that array (container_tool.js:2029-2046) — `V3load_design_panel` therefore replies `[{…doc}]`.
- **Embedded background extension:** `iw_load_from_db` synthesizes `converted:"true"` + `image_data:<dataURI>` + `org_image_name` onto the doc client-side (iw_graph_designer_js.php:614-623) and `renderPanel` consumes them (V3scripts.js:719-723) — the doc format natively supports a base64 background even though the store keeps the image separately. **The userscript rides this both ways**: Export always embeds the canvas background into `panel.image_data`, and since v1.1.0 the Insert dialog has a background-image picker whose file is embedded via `iwdieAttachBackground()` before the objects are applied (live-verified: PNG + AI-generated JSON inserted in one go, `converted="true"`, filename carried into `org_image_name`, re-export carries the 53 KB image inside the JSON). An AI can set the same two fields directly — and since **v1.2.0** it can *author* the artwork: `panel.image_svg` (raw SVG text, validated by `iwdieValidateSvg` — must start `<svg`, carry a viewBox, no `<script>`) is converted to a data-URL by `iwdieSvgToDataUrl` and embedded on insert (live-verified: a generated AHU drawing rendered behind 79 objects; **SVG data-URLs are accepted by the designer's background pipeline** — CSS background, `Image()` load, and `iw_set_base_image` all handle them). Priority on insert: picked file > `image_svg` > `image_data`.

## 9. Save paths

### 9.1 Design panel / template save (JSON)

The orchestrator is **`V3_add_designpanel_data(plantId, panelName, panelType, applTag, metaData, description, imageName, savedBy, placeHolder)`** (container_tool.js:2029) — resets globals `obj_data/container_data/container_items/DesignPanelArray`, collects via `getPanelDataFromDOM`, → **`V3_save_design_panel`** (container_tool.js:2292-2323): POST `function=V3_save_design_panel` body `{location, plant_id, panel_name, panel_type, appl_tag, meta_data, description, image_name, saved_by, json_data:<stringified array>}`.

Live callers: `templateHandler.saveTemplate` (templates.js:96-117, the Templates pane's "Save Complete Panel"/"Save Objects Only") and `iw_save_design()` (main.js:1132, header comment "not in use ???"). **`initSaveDP` (V3scripts.js:828-861) has zero callers anywhere — dead legacy** (it would read a panel-name label element, sentinel `"Loaded panel"`, and `prompt`; note it also reads `document.getElementById("main_image").main_image` — the DOM *property*, usually undefined).

### 9.2 Compile to plant (XML + JSON, the popup)

`iw_save(save_type, name, visible, image_path, view_order, picture_id, obj_gen_Arr)` (container_tool.js:2414-2686):
1. Resolves the panel name (from `#plant_panels_select` when `save_type === null` — the "Compile Panel for Plant" button passes all nulls).
2. Walks `#control_container.childNodes` building a legacy `<iw_sys>` XML doc: per object a `<data>` element (`push_xml_data`, :2592-2634 — `iw_name, zindex, type, id(=driver_id), alias_text, link_tag, sub_group, [tag_text], [file_url], [file_pdf], unit_id, unit_ref, left, top, width, height`). Containers are **flattened**: `container_hc`→`number_v3_100x100_info_box`, `container_cf`→`number_v3_100x100_info_down` (+25px, tag_text "Information"), `container_c`/`container_hcf` wrappers dropped, children stamped with absolute `grx_pos`/`gry_pos` (:2520-2576).
3. Also builds the JSON doc via `getPanelDataFromDOM` (:2660-2663).
4. `save_panel(xml_doc, panel, panelName, visible, save_type)` (main.js:631-649) stashes `last_xml_doc` (serialized string) / `lastPanelObject` / `last_xml_name` and opens the popup `designer_site/save_xml.htm?t=1`, decorating `popup.opener` with `visible, save_type, org_image_name, converted, [encoded_image, image_data]`.
5. The popup reads back via `opener.iw_get_xml()` → `{xml, panelObject}` (main.js:619-621), renders a review table, and `saveXML()` POSTs form fields `picture_name, visible, upload_xml, upload_json, upload_image_data, save_type, picture` to **`designer_site/iw_save_ctrls.php?cust_id=…&picture=…`** (save_xml.htm:466). Default `save_type` = `"save_compiled_data"`, default `visible` = `"1"`.

So one compile writes **both** the XML and the JSON representation of the panel to the compiled store — which is why `iw_load_ctrls.php?format=json` works for panels never saved as "design panels".

**Round-trip verified live** (see [reference_data/roundtrip-verification.json](reference_data/roundtrip-verification.json)): export a 54-object panel → insert onto a fresh scratch panel → Compile via the popup → the stored JSON read back via `format=json` was **field-identical** to the export for all 54 objects (only `object_N` names renumber), the 47 KB background base64 survived, and a full page reload + host load rendered the copy 1:1. Two findings: **`iw_save_ctrls.php` ignores the posted `visible` value on insert — new compiles always land `visible=1`** (hide them afterwards via the panel-order/picture manager if needed); and `#submit1` fails Playwright's stability check (animated preview) — automate the popup with `evaluate(() => saveXML())` after `#visible` is set and `#submit1` is enabled (~500 ms after the review table builds).

`iw_sync()` (main.js:1159) = sync XHR `designer_site/iw_init_sync.php?cust_id=…` → pushes compiled panels to the plant server.

## 10. Load paths

### 10.1 Design panels (JSON store)

`V3_loadDesignPanel(plantId, panelName, type, load_from, saved_by)` (V3scripts.js:823) → `DesignPanelHandler.loadDesignPanel` (:758-817):
- `isFullPanel = type !== 'objects_template'` (:761). Full panels `confirm()` then clear (`objectList.clear(); designContainers.clear(); loadEmptyPanel(...)`); **`objects_template` skips the clear entirely — this is the host's native append/insert path** (used by the templates system, §14).
- Data via `V3loadDesignPanelData` (POST `V3load_design_panel`, body `{cust_id, plant_id, panel_name, load_from, saved_by}`; reply is double-encoded — `callback(JSON.parse(data))` despite `dataType:'json'`, :83). Callers pass `load_from='plant'`.
- Objects: `load_old_ver_objects` (legacy `objects[]` shape) or **`load_new_ver_objects(single_objects)`** (:482-526): `iw_make_ctrl` + `.attr()` everything; `name = "object_" + i` **restarts at 0** (:488); `linked="true"` when driver_id real (:514).
- Containers: **`load_new_ver_containers`** (:528-538) routes each entry on `unique_id.indexOf("custom_")` → `.custom()` (:540-639, full instantiation, renames from `localStorage.num_of_containers`, registers in `designContainers`, handles table containers) — or `.template()` (:684) which is an **empty stub**: non-custom containers silently vanish.
- `panelData[0].groups` is read but **never rendered** (:807-812) — dead field.
- Tail: `UpdateObjectWorker()` runs **outside** the AJAX callback (:815) — fires before objects exist; the debounce mostly hides this.

### 10.2 Compiled panels — `iw_load_from_db` (JSON-first, XML fallback)

`load('')` (main.js:1259-1287; first call skips the confirm via `firstLoad`) → **`iw_load_from_db(navn, container, element_navn, design_modus, cust_id, asXML)`** (iw_graph_designer_js.php:604-709). Preamble: `resetAutotagger(); resetPanelChks(); table_container.clear();`

- **JSON branch** (unless `asXML`): `iw_panel_load_json` — **synchronous** XHR `iw_load_ctrls.php?cust_id=…&format=json&name=…` (:557-585). If the doc has `panel_name`: fetch `format=image_data` (base64 data-URI or `"false"`), synthesize `converted/image_data/org_image_name` onto the doc, and `new DesignPanelHandler().renderPanel(panel)` (:611-625).
- **`renderPanel(panelData)`** (V3scripts.js:709-756): clears both caches; `converted==="true"` → `$('#control_container').html('')` + `iw_set_base_image(width, height, image_data)`, else `loadEmptyPanel`; objects; containers; **graphics** (`loadedGraphic.loader`, the only load path that renders graphics); `UpdateObjectWorker(); make_mouse_selector();`
- **XML branch** (`asXML` checked, or no JSON): `iw_xml_load("iw_load_ctrls.php?cust_id=…&name=…")` → per `<data>` element `iw_make_ctrl(...)` concatenated into **one** `innerHTML =` write (:691), background via `iw_set_image_org` (design) / lazy loader (runtime), then `compiled_view_loaded()` (:713) renames every child `object_<i>`, fixes `object_type "null"→"V2_NA"`, `UpdateObjectWorker()`. No graphics, no containers (XML flattened them at compile time).

### 10.3 Background image setters

- `iw_set_base_image(width, height, image_data)` (iw_graph_designer_js.php:50-65) — sets bg + `main_image` attr; `data:image` payload → `converted="true"`; the width/height params are **accepted and ignored** (sizing code commented out).
- `iw_set_image_org(image_name, element_navn)` (:67-77) — direct URL bg + `main_image`/`org_image_name` attrs; re-appends the hidden `#objects_landing_field`.
- Manual pick flows (main.js:309-431): `iw_select_image` (server list → data-URI convert → `converted="true"`), `iw_select_image_from_pc` (popup `get_image.htm` → `imagesetValue(imgName, w, h, imgBlob)` sets `encoded_image = "<w>px_<h>px"`).

## 11. The graphics layer (d3)

Vector/widget elements living alongside objects: registry `loadedGraphic.loaded` (graphics_build.js:2, :269), record shape `{id, name, attributes, styles, graphic_def, links}` (graphics.js:786-809). Definitions in `graphics_defs.js`: `tbconnector_l/r/t/d`, `label`, `textbox`, `info_box`, `rotating_he`, `stateful_cabinet`, `duct`, `simple-gauge`, `production-gauge`, `efficiency-bar`, `room-control-box`, `multi_tb` (linkable flags vary).

- **`loadedGraphic.loader(json_data)`** (graphics_build.js:982-1018) — the panel-load entry: **resets `this.loaded = []` first** (loader REPLACES, never merges), then `prepareGraphic("db_load", …)` + `buildGraphic("db_load", …)` per item.
- Save side: `graphicsCompiler.newCompile("json","partly",doc)` attaches the flattened registry as `doc.graphics` (§8).
- Right-click menus per graphic type in `graphics/contextmenu.js` (registry at :1241-1249); note the two "Add … func." header-menu entries both call `deleteGraphic` (:147, :155) — real copy-paste bug in the host.

## 12. Copy / paste — the `Duplicator`

`duplicator` (autotagging.js:358-633). Hotkeys: `ctrl+c` copy, `ctrl+v` paste displaced (+50/+50), `ctrl+f` paste in place (main.js:795-810; `skew` is the **string** `"true"`/`"false"`).

- **Snapshot** (`copyItems`, :392-494): per element `{styles: {left, top, width, height}, attributes: <whitelisted>}`. Object whitelist (21 attrs, :399): `id,name,iw_type,iw_name,type,driver_info,driver_id,unit_id,unit_ref,alias_text,pheight,pwidth,pleft,ptop,link_tag,link_name,sub_group,linked,tag_text,hastag,object_type`. Container whitelist (9, :400) + children nested as `items[0][]` (:430-450); table containers merge their `table_container.tablecontainer[name]` state into attributes (:438-445).
- **Paste** (`constructItems`, :495-633): rebuilds via `iw_make_ctrl`; **rename policy: `name = "object_" + (childNodes.length - 1)`** from the live canvas index (:517-518), containers get `objects_container_<idx>` / `unique_id custom_<idx>` (:540-543); `id` attrs stay `driver_id`/`objects_container`. Container children are built unskewed into the content node (:554-556). Bookkeeping via `objectList.add` (:591-594) and a flat `designContainers.add` record (:595-617). `localStorage.num_of_containers` is **not** bumped on paste (unlike the load path).

This rename-from-live-index policy is the host's own answer to name collisions — anything that appends to the canvas (imports included) can renumber the same way afterwards.

## 13. Auto-tagging & the tag system

- **`autotagger.tagList[driver_id]`** = `{driver_id, unit_id, unit_name, link_tag, link_name, sub_group, tagged}` — built from `yourplantUnits[].params[]` 2 s after unit load (autotagging.js:41-70).
- **`setAutoTags()`** (:724-758): for every canvas object, look up its `driver_id` in `tagList` and write `link_tag` + `sub_group` attrs (+ appends to `data-title`). Then `AutoGroup()` (:760-813) wraps each unit's objects in a container via `makeGroup()`.
- **`v4_get_tags_desc`** (GET, `plant_id` + `toLoad=`): `tags` → flat catalogue `{iw_link_name, default_link_name, measure_type}` (1186 on the sampled plant) → `systemtags[<ref>]` records; `tag_groups` → 16 named groups with `tag_list[]`; `parts` → the `area→system→unit→component→signal` taxonomy tree that `buildDescriptions()` (:1325-1378) uses to explode each tag ref into described parts (**index mapping is non-positional**: `tagParts[3]`=signal, `[4]`=component). Samples: `reference_data/tags-samples.json`.
- Manual tagging dialog: `openTagsInspector` (:1815); write-back `setNewTag()` (:1790-1795) sets `link_tag`/`sub_group` attrs on the selected element.

## 13b. The selector popups & the linking write-back

**File/image managers** (`iw_library_v3/iw_popup_filehandler.js`):
- The legacy inline popup `#iw_file_selector` (built once by `V4_fileSelector_make`, :149-168, via `#iw_main_pages.innerHTML +=`) serves **Remove PNG / Remove PDF** (`iw_select_file('image'|'file')` → `iw_file_selector_show`, :21-62): sync `iw_xml_load` of `designer_site/iw_get_image.php` / `iw_get_files.php`, delete via **`iw_delete_file.php?cust_id&filetype&filepath`** (:94-135 — no URL-encoding; dual-server: writes both `#local_status` and `#prod_status`, only refreshes the list when **both** succeed).
- Everything else is **w2popup.load** of a page under `designer_site/` (:325-494): `containerselector.html` (container attrs), `unitlinktoolbox.html`, `objectstoolbox.html` (the OLD V2-OBJECTS picker), `link_panels_selector.html` (sub-page linking), `fileselector.html`, **`filesuploader.html` ("Upload PDF to Server", via the `initMaster` d3 binding — the upload logic `selections.UploadFile()`/`filesuploader_add_tools()` lives inside that page, not in any .js)**, `imageselector.html`. The dispatcher is `iw_select(obj, iw_type)` (main.js:433-485): type 1→unit selector, 3→param selector (or tag-text edit for label objects), 5→sub-page link modal, 6→file modal, 10→dynamic container modal, 100→param selector.
- `PopupDynamicDialog` (:173-324) is the container-attribute form: reads/writes via `ContainerDataHandler` custom attributes; refuses `name`/`id`/`attributes`; `tbl_container` re-runs `table_container.build`.

**The parameter selector** (`iw_library_v3/iw_popup_paramhandler.js`) — the designer's most complex popup:
- Shell `#param_popup` is injected at load time with **`document.write`** (:585-603); w2ui widgets (`layout`, `toolbar`, `sidebar`, `paramgrid`, `unitgrid` — the "detached" entries in toolbars-live.json) are registered up-front (:995-1002).
- ⚠️ The popup's `.ui-dialog` wrapper carries **z-index 2147483646** (one below the int32 max): any overlay/toast appended to `<body>` paints and hit-tests *beneath* the open dialog regardless of its own z-index. UI that must show above it has to be appended **into the wrapper element** (the userscript's `overlayParent()` does this).
- `openParamsPopup(xml_doc)` (:504-583) opens a jQuery-UI dialog (510×800, "PARAMETER SELECTOR"), renders the w2ui layout into it, and fills `unitgrid` from the passed XML (**callers pre-fetch synchronously**: `iw_load_units.php?cust_id&driverId` — Actions menu :737-741, `iw_select` type 3/100 main.js:463-469). Clicking a unit (`unitsClickHandler`, :901-963) sync-loads **`iw_load_plant.php?regulator_name=<unit>&cust_id=…&aliastext=&param_*=false&rw_*=false`** and fills `paramgrid`; rows already auto-tagged (via `autotagger.getTag(driver_id)`) render green/bold. ⚠️ The fill is **not always synchronous with `grid.click()`**: driving the grid programmatically at speed, ~3 of 25 units on plant 4728 still showed the previous unit's rows (or none) immediately after `click()` returned — poll for a `records` change (length + first/last `driver_id`) before reading, as the userscript's export walk does.
- Filters: R/RW cycle + type radios (`all/alarms/boolean/integer/float/string`, classified on `parameter_type` + `application` substrings), `"a ++ b"` multi-term AND alias search (:357-448), alias rebuild tool (strip N chars / append eng_unit — with an off-by-one on the checkbox index, :464-503), param groups via **`iw_param_group_handler.php?cust_id&unit_id&action=get_groups|get_group_params[&group_name]`** (:1102-1134).
- **`onParamPopup_link(selected)` (:1004-1100) is the canonical linking write-back** (Link button / double-click): for a normal object it sets exactly `driver_id, driver_info, alias_text, unit_id, link_tag, sub_group` attrs + `linked` (:1056-1061), then updates `objectList` (single objects) or `designContainers.updateItemDriverinfo` + container badge (container children); graphics elements route to `linkHandler.linkGraphic` (writes `loadedGraphic.loaded[id].links[]`); label-only objects get the chosen field (`alias_text|unit_id|unit_name`) as their text. BACnet mode appends an extra alarm object next to the linked one (`linkHandler.addAlarmObject`, graphics_build.js:846-872). Legacy `iw_set_driver_id` (main.js:487) has **no callers** — it was the dead `paramselector.htm` popup's callback.

**Bulk re-linking (the LINK pane / explorer):** `updateRegLinkTags` binds "Link All" → `linkAllTaggedObjects` → `linkSelRegulator(link_obj, unitHash)` (container_tool.js:126) which matches canvas objects to the chosen unit by autotag+sub_group or by rebuilt driver-id parameter key, stamping the same six attributes. Tag assignments persist via `savePlantUnitsData()` → POST `function=save_plant_unit_tags` body `{plant_id, unit_data: JSON.stringify(plant_unitArray)}` (container_tool.js:1209-1237). **Live host bug:** `explorer_tool.js` defines `linkAllTaggedObjects` twice (:60 good, :172 buggy — `var untit_ref` typo leaves `unit_ref` undeclared); hoisting makes the **buggy second definition win**, so the "Link Reg" button throws `ReferenceError: unit_ref is not defined`.

## 14. Templates (the built-in panel-reuse system)

`templateHandler` (V3scripts/templates.js). Two stores via `getTemplateType` (:306-324): `global` (`serviceType:'templates'`, `insertFrom:'plant'`, `saveTo:'global'`) and `user` (`user_templates` / `insertFrom:'templates'` / `saveTo:'personal'`).

- List: GET `v4listTemplates&type=<serviceType>&plant_id=<cust_id>` (:334-349 — without `plant_id` the server answers `PLANT NOT DEFINED`).
- Save: `saveTemplate(key, type)` (:96-117) → `V3_add_designpanel_data(...)` with `panel_type` = `objects_template` (objects only, `image='none'`) or `panel_template` (complete panel with background).
- Insert: `loadTemplate` (:192-230) → `V3_loadDesignPanel(id, panel_name, type, insertFrom, saved_by)` — **`objects_template` is what makes it append** instead of replace (§10.1).
- Area codes hardcoded (:270-293): `CRC, RMC, TCR, WMO, ENM, DAL, AHU, HPU, RCO, SDS, HSY, AC, LGT, OVW, HRU`.

## 15. Server API catalogue

Base: `designer_site/V3_objectHandler.php?function=…` (same-origin, session cookie; one call site uses the `V3_ObjectHandler.php` casing — Windows/PHP serves both). Verified read functions marked ✓ (probed live).

| function | method | params | returns |
|---|---|---|---|
| `V3get_plant_designer_panels` ✓ | GET | `plant_id` | compiled panel list `[{pic_id_data_type, panel_name, id, visible, image_name}]` |
| `V3get_designer_panels` ✓ | GET | `plant_id` | design-panel doc list (may be `[]`) |
| `V3load_design_panel` ✓ | POST | `cust_id, plant_id, panel_name, load_from, saved_by` | **stringified** array-of-one panel doc |
| `V3_save_design_panel` | POST | `location, plant_id, panel_name, panel_type, appl_tag, meta_data, description, image_name, saved_by, json_data` | status |
| `V3delete_designer_panels` | GET | `plant_id, panel_name` (unencoded!) | status |
| `V3get_obj_by_menu` | POST | query `menu`, body `plant_id` | palette entries for a menu |
| `V3get_obj_by_category` | POST | `plant_id, menu, category` | palette entries |
| `get_plant_units` | GET | `plant_id, driver_type` | plant units |
| `V3_load_group_by_id` | POST | `group_id, plant_id` | group data |
| `V3_load_iw_param_tags` ✓ | GET | `plant_id` | param tags |
| `v4_get_tags_desc` ✓ | GET | `plant_id, toLoad=tags\|tag_groups\|parts` | tag catalogue / groups / taxonomy |
| `V3_loadUnits_Templates` | POST | plant param required | units for templates |
| `v4listTemplates` | GET | `type=templates\|user_templates, plant_id` | template list |
| `delete_user_template` | POST | `plant_id, user, template_id, panel_name` | status |
| `move_template_image` | POST | `plant_id, path` | status |
| `V3_startup_panels` | POST | `plant_id, panel_name, path, visible, view_order, xml_data` | status (IE-era dead path) |
| `save_plant_unit_tags` | POST | (linking tool) | status |
| `load_panel_xml_data` | POST | (container_tool.js:1247) | legacy XML panel data |

Outside the objectHandler:
- **`iw_load_ctrls.php?cust_id=…&name=…`** ✓ — compiled panel XML; `&format=json` ✓ → panel JSON doc; `&format=image_data` ✓ → base64 data-URI of the background (or `"false"`). All three fetched with **synchronous** XHR by the host.
- **`iw_save_ctrls.php?cust_id=…&picture=…`** — the compile write (POSTed by the save popup, §9.2).
- `iw_init_sync.php?cust_id` (sync to plant, sync XHR), `iw_remove_panel.php?cust_id&panel_name` (delete, sync XHR, replies `<status>OK</status>`).
- Selector-popup data: `iw_load_units.php?cust_id&driverId` (unit list XML), `iw_load_plant.php?regulator_name&cust_id&aliastext&param_*&rw_*` (unit's parameters, sync XHR), `iw_param_group_handler.php?cust_id&unit_id&action=get_groups|get_group_params[&group_name]` (async JSON).
- File/image management: `iw_get_image.php?cust_id` (PNG list), `iw_get_files.php?cust_id` (PDF list), `iw_delete_file.php?cust_id&filetype&filepath` (dual local+prod delete), **`iw_upload_file.php?cust_id`** (the actual "Upload PDF to Server" write: multipart FormData POST, field `userfile`, from `filesuploader.html`'s `uploader.upload` — plain-text reply `success` / `ERROR:…` / `ACCESS IS NOT GRANTED`), `picture_manager.php?plant_id` (panel order).
- `graphicsHandler.php?function=load_graphic_menu|build_graphic_menu` — graphics palette persistence, **uncalled by the app** (sidebar tree is hardcoded); live reply "No Functions awailable" (sic).
- w2popup pages (logic lives inside each page, not in the mirrored .js): `containerselector.html`, `unitlinktoolbox.html`, `objectstoolbox.html`, `link_panels_selector.html`, `fileselector.html`, `filesuploader.html`, `imageselector.html`; window popups `get_image.htm`, `save_xml.htm`; dead: `paramselector.htm`, `configtool.html`.

## 16. Hotkeys (keymaster; suppressed while focus is in INPUT/SELECT/TEXTAREA)

`ctrl/cmd+c` copy · `ctrl+v` paste +50/+50 · `ctrl+f` paste in place · `ctrl+g` group · `ctrl+a` select all · arrows = move 1 step · `ctrl+arrows` = move multi-selection · `alt+arrows` = resize · `Delete` (via `microsoftKeyPress`, keyCode 46) = delete selected (main.js:795-937).

## 17. Ecosystem: the Import/Export userscript

[`IWMAC-Designer-Import-Export.user.js`](../IWMAC-Designer-Import-Export.user.js) adds Export JSON / Insert JSON / Background → Illustrator under Manage Files, plus EXPORT XLSX / EXPORT ALL XLSX buttons beside the param popup's UNIT NAME item (§13b) that write `w2ui.paramgrid.records` — for one unit, or for every unit by walking `unitgrid.click()` and restoring the selection — as styled workbooks (own tds, not w2ui items — the host row is a radio group). It deliberately reuses the host verbatim:
- Export = the host's own pre-save resets + `getPanelDataFromDOM(get_plant_id(), get_value(), $('#main_image').attr('main_image')||'', get_user_name())`, background embedded host-natively (`converted`/`image_data`, §8).
- Insert = `DesignPanelHandler.load_new_ver_objects/load_new_ver_containers` (the `objects_template` append path, §10.1) + rename-from-live-index (§12) + `UpdateObjectWorker()`; container `unique_id` forced to contain `custom_` because `.template()` is a stub (§10.1).
- Replace-or-add (v1.8.0): a non-empty canvas gets a chooser before anything is touched. Add is the append path above. Replace first reproduces `renderPanel`'s clear — `objectList.clear()`, `designContainers.clear()`, `table_container.clear()`, `$('#control_container').html('')` (keeping the hidden `#objects_landing_field`, which only `iw_set_image_org` re-appends) and `loadedGraphic.loaded = []` (§10.2, §11). Resetting the registry is also what lets the import's own graphics load, since `loader` replaces rather than merges (§11); on the add path graphics still go only onto a graphics-free canvas. DOM only — no request, so the stored panel is unchanged until the host's own Save.
- Cross-plant: driver-id prefix rewrite `<src>_…` → `<target>_…` (§5), leftovers reported.
- Object-less panel on export (v1.11.0): an unlinked **Oversikt** collects as 0/0/0, which used to be refused. It now exports the CSS background of `#main_image` **verbatim** — data: URL decoded in place, server URL fetched, never re-encoded — as `iwmac-bg_<plant>_<panel>_<stamp>.<png|svg|jpg>`, plus the background-only envelope beside it as the template. No vector trace on this path: the trace exists for the *importer's* benefit (§8), and it costs minutes on a photo background. Only a panel with neither objects nor a background is still refused.
- Envelope format `iwmac-designer-panel` v1 documented in [../README.md](../README.md).

## 17b. Generating a panel JSON from a description (for AI assistants)

The Insert JSON path accepts **AI-authored** panels, which makes "P&ID → panel" generation practical. The kit lives next to this file:

- **[AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md)** — **read this one first.** Which panel type — or which non-panel deliverable — a request is actually asking for, and the source hierarchy that decides which document wins when two disagree. `GLOBAL` scope, owns intent routing for every panel type. It exists because the two 2026-08-10 room-control failures were both routing failures: the first answered "trenger .json fil" with a data file, the second answered a linked-panel request with an unlinked template. Neither was a schema problem.
- **[VISUAL-CORRECTNESS-CONTRACT.md](VISUAL-CORRECTNESS-CONTRACT.md)** — **read this one second.** `GLOBAL` scope, owns the three visual rule areas that apply to every panel type: the mandatory visual analysis before any generation or modification (A1–A12 — a supplied production JSON is an authoritative visual template, not merely a schema), the text-protection rule (a live object never covers descriptive text unless the supplied source proves that exact overlap; not the removed blanket "never overlap" — live-over-artwork classes stay deliberate), and width-from-allowed-values (a value object is sized for the longest allowed display value from `format_extra` / allowed-values maps, never for the current reading). Executable: `python validate-visual-correctness.py PANEL.json [--source SOURCE.json] [--allowed-values VALUES.json]` (rule ids `VC-T*`/`VC-W*`/`VC-A*`), alongside — never instead of — the per-type validator.
- **[AI-BRIEFING.txt](AI-BRIEFING.txt)** — the normative contract: envelope + 17-field object template, the production-proven object allowlist (from [reference_data/production-usage-census.json](reference_data/production-usage-census.json) — 22 real panels), layout rules, and the recipes. Hand it to any AI as knowledge.
- **[MASKIN-KNOWLEDGE-BUNDLE.md](MASKIN-KNOWLEDGE-BUNDLE.md)** — the **generated single-file Maskin knowledge upload**. Use it when an agent can receive one Maskin knowledge file rather than the sibling kit; rebuild it with `python build-maskin-knowledge.py` and never hand-edit the generated Markdown.
- **[AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt)** — the same contract compressed for the M365 Copilot Studio instructions field (7,9xx **characters**, no angle brackets — the field rejects `<`/`>` and caps at 8000). The cap counts characters, not bytes, and a CRLF working tree adds one per line: measure the worst case before editing — `python -c "import io;t=io.open('AI-AGENT-INSTRUCTIONS.txt',encoding='utf-8').read();print(len(t),len(t)+t.count(chr(10)))"`.
- **[DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md)** — the "which object do I use" reference: all 797 palette objects named and described, ranked by real production usage, with a pick-by-task table. Upload it as knowledge next to the briefing; the agent uses it to widen past the briefing's allowlist without inventing ids.
- **[reference_data/generated-panel-example.json](reference_data/generated-panel-example.json)** — a complete correct answer: a CO₂ rack overview generated from an Advansor ValuePack 3x2-1R P&ID, insert-verified live (73/73 objects, 0 errors).
- **[reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json)** — the **normative Maskin reference**: a 66-object production CO₂-booster export (plant 10229, IWDIE v1.7.0) with every live binding removed and everything else preserved byte-for-structure — geometry, `obj_id`s, sizes, `zIndex`, object ordering, `tag_text` (including its three single-space values), all 65 distinct `alias_text` values, and the 124 KB `image_data` background. This is the file to copy for a Maskin. Its measured anatomy — the eight role clusters, the five z-bands, the eleven obj_ids, the compressor pitch and the anomalies — is [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md).
- **[reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json)** — the **normative Oversikt reference**: a 72-object production store overview (plant masked to `NNNNN`) carrying 21 controller clusters over the real 1400×750 store-plan raster in `image_data`. Sanitized the *masked production* way, not the unlinked-demo way: the plant prefix is rewritten, everything else — `unit_id`, `linked:"true"`, geometry, `zIndex`, ordering, `alias_text` — is preserved, because the controller identities are what a coverage comparison is built from. Its measured anatomy — the object vocabulary, the two z-bands, the cluster offsets, the three controller families, the six partial clusters and the four production anomalies — is [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md). **72 objects and 21 clusters are the measurement of this one store, not a design target for any other.**
- **[reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json)** — the **normative room-control-table reference**: a 1,553-object production `Tabell romkontroll alle plan` (plant masked, driver ids masked `NNNN_…`) — one `table_container` with 34 columns × 50 rooms and 1,802 grid items, three repeated header bands, 50 room controllers across every floor of one building, and the blank canvas in `image_data`. It is the only committed example of the **two-layer table** pattern: the container draws the grid and carries no bindings, the canvas objects carry the values. Its measured anatomy — the columns and their widths, the room order, the header bands, the centred cell offsets, the two z-bands and the annotation cluster — is [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md). **34 columns, 50 rooms and 1,553 objects are the measurement of this one building, not a design target for any other** — another building has other rooms and other signals; what carries over is the structure, not the counts.
- **⚠️ [reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json) is a NEGATIVE example** (demoted 2026-08-10; it was previously listed here as a worked example). It is a generated Maskin with a light-skin authored `image_svg` per `maskin-drawing-method.txt` + 63 objects carrying `maskin-akpc-link-map.json` aliases, and it insert-verifies 63/63 — and it is still the wrong shape to copy. Measured against the production export by **role**, not array index: 3 roles missing (the whole third LT compressor — `C3 LT status` / `capacity` / `Runtime total`), 1 role invented (`Liq. inj. status MT`), 2 purpose-built obj_ids substituted with generic value pills (`Hr pump speed` → `number_v3_custom_json_obj` lost, `u17 Ther Air` → `number_v3_60px_no_conn` lost), `zIndex:"default"` on all 63 (so array order silently becomes stacking order), an authored `image_svg` background where production owns a raster `image_data`, and **0 of the 62 shared role instances at the production coordinates** (median displacement 23.2 px, 41 roles more than 20 px out). `validate-maskin-panel.py --profile TEMPLATE-10229` reports 90 errors. The audit is [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) §13. The lesson: passing structural validation and inserting cleanly are not evidence of a correct panel.
- **Ventilasjon is objects-only.** A vent panel is drawn with duct/pipe/connector/equipment objects on the ~6 KB blank background — **never** an authored `panel.image_svg`. The AI-drawn vent example (`generated-vent-example.json`, 79 objects on an AI SVG background) was deleted on 2026-08-09 so an agent cannot copy that shape; the two real exports — [real-vent-panel-example.json](reference_data/real-vent-panel-example.json) and [real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) — are the only vent references, and every obj_id in both (41 and 39 distinct) is a real palette entry in [reference_data/all-design-objects.json](reference_data/all-design-objects.json). **Briefing §7a is the normative vent contract** — classification, the measured skeleton, the functional clusters, the sidebar, the z-bands and the strip-the-source-plant rule — and it overrides the briefing's generic §5 layout grammar, which is for table-style panels only. See "Generating or editing a Ventilasjon panel from an export" below.
- **Real production exports as normative style references** (userscript-exported, plant ids masked): [reference_data/real-vent-panel-example.json](reference_data/real-vent-panel-example.json) (a 360.001 Ventilasjon, 102 objects, OJEXHAUST drivers), [reference_data/real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) (a second plant's 360.001 Ventilasjon, 92 objects / 39 distinct obj_ids, 55 linked, BACNET drivers — adds horizontal dampers, a dummy 2-way motor, a status LED, the sub-page navigation row and a `file_pdf` document link) and [reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json) (a 360.004 Spjeldliste damper list — 383 scaffold objects + **208 `objects_container` rows**, the container-built list-panel pattern, briefing §7c).
- **Hotel / multi-building panel-set anatomy** (briefing §7d): [reference_data/hotel-panelset-anatomy.json](reference_data/hotel-panelset-anatomy.json) — a complete 69-panel production hotel surveyed panel by panel (read-only `iw_load_ctrls` fetches; plant + buildings masked). Documents the panel types the supermarket corpus lacks: the **navigation-hub Oversikt** (icon tiles `sub_page_360_ventilation`/`sub_page_565_room_control`/`sub_page_320_heating_plant` 120×80 + `header_grey75` captions in a 150px-pitch column grid), hotel **Ventilasjon** (Swegon/BACnet: three-section right column, A/B/C alarm LED row, step setpoints, integrated heat pump `number_360_cb`+compressor pair), **kurvestyring** satellites (X1-4/Y1-4 curve setpoint tables + free-text explanation column), **Varme** (energy-meter con_down/con_top pairs + `OEnnn Energy` boxes), **Tappevann** (`rc_box` "Målepunkt" cards + `rc_temp_60` rows over a plant-room photo), **Romkontroll floor plans** (1400×750: supply/extract runs + per-room `rc_box` 150×200 card with temp/CO₂/setpoint/heating rows and VAV position boxes) and mini status panels. Key host facts found: only the hub is `visible=1` — everything else is `visible=4` (nav-only); the panel list is grouped by **0-object separator panels** (`----- Ventilasjon -----`); every system carries empty `Reserve` placeholder panels; `Ur`/`Kurver`/`Reserve`/separators exist **only in the XML store** (JSON fetch returns empty); and **navigation objects store the target panel's numeric id in `driver_id`** (`"6"`, `"39"`) — not a driver parameter.
- **Linking kit** (briefing §8b): [reference_data/real-vent-panel-linked-example.json](reference_data/real-vent-panel-linked-example.json) — a second export of the same **linked** 360.001 Ventilasjon (57/102 objects carry a driver id). **Correction, verified 2026-08-09: this is not a linked/unlinked pair.** Its 102 objects are byte-identical to [real-vent-panel-example.json](reference_data/real-vent-panel-example.json) — the envelopes differ only in `exported_at` and `generator` — so diffing them teaches nothing. Read the contract off either file: `driver_id` = the full parameter string, `unit_id` = the unit, `linked:"true"`, `alias_text` = the selector's `Menu,-Description` text, while `id` stays literally `"driver_id"` and `link_name` stays `"link_name"`. And note the asymmetry that leaks source plants into generated demos: an *unlinked* object in a real export carries an **empty** `driver_id`, never the literal `"driver_id"` placeholder a generated panel must emit (§3) — an export is not a template for what an AI writes. Companion: [reference_data/driver-parameters-sample.sql](reference_data/driver-parameters-sample.sql) — a trimmed `iw_gen_driver_parameters` phpMyAdmin dump (the real one is ~4.5 MB / ~7,200 rows, 37 driver prefixes on the sampled plant) showing where driver ids come from: `driver_id` is stored ready-made per parameter row, and `unit_name` maps system → unit. Its spaced `360.001 Ventilasjon` → `V01` sample is sample/stale formatting and does not override the exact live same-plant inventory name `360.001Ventilasjon`. `application` separates Analog values (`_4_` on the OJ driver) from Digital IO (`_2_`), `att` r/rw flags setpoints, `format_extra` carries enum maps. The group digits differ per driver type (AKC `_0_`, EM270 `_3_`) — driver ids must be **copied verbatim, never constructed**. For whole-panel relinks ("link out all the parameters on this machine picture"): [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) — the canonical Maskin map built from a fully linked production CO₂-booster panel cross-checked against its own dump: **64/64 objects resolved by exact `alias_text` string match** (the template aliases ARE Danfoss parameter names: `Pc`, `Sd-MT`, `Running capacity MT`, `C2 LT capacity`…), 62 on the AK-PC 782A pack unit + 2 on an IO/gateway unit; includes the parameter-group anatomy (763=MT block, 764=LT, 230+i=Cᵢ status, 240+i=Cᵢ capacity, 337=VSD, 288-299 runtimes). Unit numbers are plant-specific — alias names are the portable part, so relinking by name is also THE way to move a Maskin picture between plants (rebind fixes only the plant prefix).
- **Fleet survey — 41 Coop Extra plants, 231+ panels** (2026-08-08, read-only `iw_load_ctrls` fetches): [reference_data/plant-panel-survey.json](reference_data/plant-panel-survey.json) (raw per-panel stats: size, object count, obj_id census, linked ratio, containers, background; author fields stripped before commit) → [PLANT-PANEL-CATALOG.md](PLANT-PANEL-CATALOG.md) (per-plant inventory) + [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) (per-type style guide with named best copy-sources). Key fleet facts: 1400×750 standard (201/231), zero V2 objects, containers only on 9914's room-card system, Ventilasjon panels draw ducts with objects on the 6 KB blank background, `_old`/`Gammel`/`_copy` panels are hidden history snapshots.
- **Focused MENY ventilation corpus — separate from Coop totals**: [VENTILATION-CORPUS.md](VENTILATION-CORPUS.md) summarizes the corrected authenticated GET-only [raw survey](reference_data/plant-panel-survey-meny-20.json) and deterministic [34-panel corpus](reference_data/ventilation-panel-corpus.json). Offline validation passed with 20 plants, 101 panels (42 JSON / 59 XML-only), and no plant, unit, or panel errors. The corpus has 16 matched plants, 4 zero-match plants, no partial/failed plants, 14 JSON + 20 XML-only matches, 33 visible + 1 hidden, and 30 V2-bearing; discovery is 2 `both`, 30 `unit_name`, and 2 `panel_name`. Discovery tests normalized panel names and exact human-readable names joined from unit IDs found on that panel only—never `V01` or an unrelated plant-wide name. JSON requires valid `driver_id` and `unit_id` on the same object; production compiled XML requires valid `<id>` (= `driver_id`) and `<unit_id>` on the same `<data>`. Unit inventory comes from GET `designer_site/iw_load_units.php?cust_id=<pid>&driverId=driver_id` and is decoded as Windows-1252. XML-only rows retain object/V2 counts and linked unit IDs/names but not richer JSON-only layout/link/background metadata. Plant 9099 (panel `360.001 Ventilasjon`, panel-linked `V01` exactly joined to live inventory `360.001Ventilasjon`) stays canonical production evidence outside the batch; `ventilation_demo_360001.json` stays generated demo evidence outside all production totals — and is **not a file you can open here**: it was an uncommitted 2026-08-08 session artifact, recorded in the corpus with `present_in_repository: false` purely as a counter-example (authored SVG background, 45 unlinked objects).
- **XML-only export boundary:** XML-only panels can be surveyed and classified through their exact panel-linked unit IDs, but the current userscript's JSON export cannot export them until the host has recompiled the panel into JSON.
- **Maskin background drawing method**: [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) — the distilled Advansor CO₂-booster drawing doctrine (from the internal "cooling/freezer machine drawing method v2" Word doc, project identifiers omitted): canvas layout (MT upper-left / LT lower-left / oil-sep on the discharge riser / gas cooler top-right / heat-recovery branch top-center / receiver right-of-center / labeled suction-header exits bottom-right / grey info panel far right), the circuit colour code as **function** (orange = HP/discharge, yellow = receiver/liquid, cyan = MT suction, blue = LT suction) with the Illustrator layer-naming template, symbol/pill/text rules (white pills drawn EMPTY — number objects render into them; dark grey pills = setpoints), the PDF→Illustrator→PNG workflow + QA checklist, and the **background-colour** rule — **preserve the background of a supplied production export** unless the user explicitly asks for a background change; for newly authored artwork the background colour follows the user's requirement or the production reference chosen for the job. The kit ships one rendered reference, `reference_data/maskin-light-style-reference.png` (from `maskin-light-template.ai`), which is a light Advansor 781 template — that is what happens to be committed, not a mandated skin. Briefing "MASKIN ARTWORK" block carries the compact version.

### Maskin (CO₂ rack / machine room) — where the rules live, and the host facts

> **Where the Maskin rules now sit (2026-08-10).** This section used to carry the compressor-bank editing procedure. It no longer owns it — one live owner per rule.
>
> | You need | Read |
> |---|---|
> | A coordinate, a role, a z-band, an anomaly — each with its evidence id and scope tag | [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) — **authoritative on any Maskin conflict** |
> | The procedure for authoring, copying or editing one | [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) |
> | **How to add a compressor to an existing bank** — the nine ordered steps, artwork before objects, one measured translation vector, alpha copied verbatim | [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) §4a, rules `M-A01`–`M-A09` |
> | **How to remove static equipment and reroute a circuit** — the fifteen ordered phases, the protection boundary, the background-fill contract, crossings versus junctions, the junction ledger | [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) §4b, contract §17, rules `M-A10`–`M-A19`, `M-C06`, `M-X01`–`M-X07` |
> | Whether the pixels actually connect | [maskin_raster_qa.py](maskin_raster_qa.py) (the checks) and [maskin-visual-qa.py](maskin-visual-qa.py) (the crops and `qa-manifest.json`) |
> | The acceptance tests, stage by stage | [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) — stage **C0** inspects the background ALONE at native size, before any object exists |
> | The same rules as code | [documentation-rules.json](documentation-rules.json) → `python validate-maskin-panel.py panel.json --profile TEMPLATE-10229` |
> | That an edit changed only what was authorized | `validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope compressor-addition\|background-only\|position` (`M-C01`–`M-C05`). Adding a compressor is class 3 **and** class 4 at once: one full document plus one background-only patch with zero counts and three empty arrays |
> | A block to paste into a Copilot prompt, or upload as a knowledge file | [MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md) — points **19** (ordered bank extension) and **20** (an object always carries an alias) |
> | The background drawing doctrine, and the pixel rules `R1`–`R5` | [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) |
> | The file to copy | [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) |
>
> **The artwork rules `M-A01`–`M-A09` are not validator-enforced** — no JSON check can see a faded clone, a two-row copy of a three-row antialiased line or a branch that stops 1 px short of its header. They are enforced by QA stage C0 and by `tests/test_maskin_compressor_bank.py`, which runs them against a raster fixture. **`maskin-akpc-link-map.json` covers C1–C3 only**: a fourth compressor's Danfoss parameters are not in it and may not be inferred from the group anatomy. Ship the object with its grammar alias (`C<n> <MT|LT> <role>`), `linked:"false"`, and report the gap as unresolved — an object with an empty `alias_text` can never be linked by anyone.

What stays here is **host behaviour**, because that is what this file owns. Five facts that decide whether a Maskin edit survives contact with the Designer:

1. **The z-index list elsewhere in this file is ventilation-scoped.** It reads "110 value/setpoint/json boxes … 1100 labels". Maskin inverts that: value and setpoint pills sit at **1100**, the `number_v3_custom_json_obj` / `_60px_no_conn` boxes at **110**, AK-PC status strips at **360**, alarms/LEDs/pumps at **375**, the enable strip at **1000** (measured, contract §3 — recorded as conflict **M-1**, not averaged). Applying the ventilation bands to a Maskin puts every pill underneath the artwork.
2. **`linked="true"` is set on load whenever `driver_id !== "driver_id"`** (V3scripts.js:514) — *including when `driver_id` is empty*. So a production export legitimately carries `linked:"true"` on objects with no binding at all; the 10229 export has two. That is host behaviour, not a defect, and it must not be "tidied".
3. **A production export never emits the literal string `"driver_id"`.** Its unlinked objects carry an **empty** `driver_id`; only a generated demo writes the placeholder. That asymmetry is the mode discriminator the validator keys on — see §17b's linking-kit note, which says the same thing about vent panels.
4. **`panel.image_svg_trace` is input, never output.** Export writes it for the AI to read; `applyImportCore` deletes it before rendering (§17b, §18). A Maskin source export carries a 2.2 MB trace — read it, never re-emit it.
5. **Insert appends and renames from the live canvas child index** (§10.1, §12). A full Maskin export belongs on an empty canvas unless duplication is intended.
6. **`Background picture only` is the import path for an artwork-only change** (§17, userscript v1.10.0). It takes the picture and nothing else: no object, container or graphic is inserted, everything already on the canvas keeps its position, and both mid-import questions are skipped. That is what makes a class-4 patch with zero counts and three empty arrays legal — without the box, the import refuses the file as an empty panel document. **Replace** is for putting a full export onto a canvas whose content you no longer want; **Add** on a populated canvas duplicates every object.

Regression fixtures and tests — run from `iwmac-designer-reference/` (the repo convention is per-module; `discover -s tests` fails because `tests/` has no `__init__.py`):

```bash
python -m unittest tests.test_maskin_compressor_bank tests.test_maskin_equipment_removal tests.test_maskin_10229_contract tests.test_maskin_knowledge_bundle
```

### Oversikt (store overview / case positions / byggeplan) — where the rules live, and the host facts

> **Where the Oversikt rules sit (2026-08-10).** An Oversikt is a **map**: one controller cluster placed on the case, cabinet or cold room it monitors, over the store-layout artwork. It is not a dashboard, and regrouping its objects into cards, rows or a legend destroys the only thing the panel type exists to show. One live owner per rule:
>
> | You need | Read |
> |---|---|
> | A coordinate, a role, a z-band, a cluster shape, an anomaly — each with its evidence id and scope tag | [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) — **authoritative on any Oversikt conflict** |
> | The procedure for authoring, copying, repairing or patching one | [OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md) |
> | The acceptance tests, stage by stage | [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md) |
> | The same rules as code | [documentation-rules.json](documentation-rules.json) → `python validate-oversikt-panel.py panel.json --profile TEMPLATE-10113`, and `--compare SOURCE.json CANDIDATE.json` whenever a source exists |
> | Whether each temperature bubble sits on the centre of its equipment box | measure the boxes into a sidecar — [build-oversikt-footprints.py](build-oversikt-footprints.py) emits the template — then `validate-oversikt-panel.py --footprints FOOTPRINTS.json` and `render-oversikt-panel.py --footprints FOOTPRINTS.json`. A panel JSON alone carries no equipment-box boundaries, so without the sidecar nothing about centring is proved (`O-G08`, `O-G09`) |
> | That a geometry patch changed nothing else | `validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope value-position` (`O-C16`) |
> | A block to paste into a Copilot prompt, or upload as a knowledge file | [OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md) |
> | The file to copy | [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) — 72 objects, 21 controller clusters, real background preserved |
>
> Four rules from the contract are worth carrying without opening it. **A supplied production JSON is the geometric and object-coverage template** — preserve and patch, never rebuild. **The temperature/value object goes in the visual centre of the equipment footprint** — the drawn box, cabinet, combined display case or room, never the text label beside it, never the cluster's own bounding box: placing the cluster *near* the equipment is level 1, and it is not sufficient (contract §7.1b, rule `O-G08`). **A PDF or a byggeplan drawing may identify equipment and room names but may never reduce the panel**: a store-layout drawing routinely omits instrumented positions, so fewer positions in the PDF than in the JSON means the PDF is incomplete, not the JSON. **Coverage is derived from the source, never forced to four objects per controller** — 15 of the 21 reference clusters carry all four roles and 6 carry alarm plus value only, and adding a cooling or defrost symbol to a two-member cluster invents a binding.

What stays here is **host behaviour**, because that is what this file owns. Seven facts that decide whether an Oversikt edit survives contact with the Designer:

1. **The z-index bands are per panel type.** The list elsewhere in this file is ventilation-scoped and Maskin inverts it (fact 1 of the Maskin section). Oversikt uses neither: the value box sits at **110** and all three circular symbols — alarm, cooling, defrost — at **375** (measured, contract §3). There is no `"default"` anywhere in the reference panel, and mixing `"default"` into a panel that uses explicit bands silently makes array order the stacking order.
2. **`linked="true"` is set on load whenever `driver_id !== "driver_id"`** (V3scripts.js:514). All 72 reference objects are linked; a layout correction that blanks a driver id leaves an object that still renders and reads nothing, and the JSON still looks well-formed. That is why the validator's compare mode reports lost bindings as errors rather than trusting the document to look wrong.
3. **A production export never emits the literal string `"driver_id"`.** Its unlinked objects carry an **empty** `driver_id`; only a generated demo writes the placeholder. Oversikt references therefore use the *masked production* convention — plant prefix rewritten to `NNNNN`, `unit_id` preserved, `linked` left `"true"` — not the blank-everything unlinked demo contract that TEMPLATE-10229 uses. Sanitizing an Oversikt the demo way destroys the controller identities the coverage matrix is built from.
4. **`panel.image_svg_trace` is input, never output.** Export writes it for the AI to read; `applyImportCore` deletes it before rendering (§17b, §18). Read the trace to understand the store artwork; never re-emit it, and never replace the raster `image_data` with an authored `image_svg` — the background *is* the store plan.
5. **Insert appends and renames from the live canvas child index** (§10.1, §12). A full Oversikt export belongs on an empty canvas unless duplication is intended, and the renumbering means a candidate must be compared with its source **by controller and role, never by array index**.
6. **`posLeft`/`posTop` are absolute canvas coordinates.** `right = posLeft + posWidth`, `bottom = posTop + posHeight`. Screenshot pixels equal Designer coordinates only after an explicit dimension check; a cropped or scaled screenshot needs `scaleX`/`scaleY`. When the newest JSON already has the intended coordinates, do not transform.
7. **An Oversikt cooling cluster is not a JSON container.** The four live symbols are `single_objects`. Membership is spatial and semantic. Empty `containers` is the production norm. Equal `zIndex` 375 on overlapping alarm/cooling/defrost symbols means array order can affect hit-testing; binding-only work preserves both.

Regression fixtures and tests — run from `iwmac-designer-reference/`:

```bash
python -m unittest tests.test_oversikt_10113_contract
```

### Romkontroll table (tabell romkontroll alle plan) — where the rules live, and the host facts

> **Where the room-control-table rules sit (2026-08-10).** This panel is a **table**: one `table_container` drawing a 34 × 50 grid, and 1,553 canvas objects sitting one per cell showing the live values of every room controller in the building, floor after floor. It is not the Romkontroll *floor plan* (the hotel panel type, §17b hotel anatomy — `rc_box` cards over a drawing) and it is not the spjeldliste (one container per row). One live owner per rule:
>
> | You need | Read |
> |---|---|
> | A column, a row, a cell offset, a rule id, an anomaly — each with its evidence id and scope tag | [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) — **authoritative on any room-control-table conflict** |
> | Which panel type a request is even asking for | [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) — the routing document, `GLOBAL` scope |
> | The procedure for authoring, copying or extending one | [ROMKONTROLL-AUTHORING-GUIDE.md](ROMKONTROLL-AUTHORING-GUIDE.md) |
> | The acceptance tests, stage by stage | [ROMKONTROLL-QA-CHECKLIST.md](ROMKONTROLL-QA-CHECKLIST.md) |
> | The same rules as code | [documentation-rules.json](documentation-rules.json) → `python validate-romkontroll-panel.py panel.json --profile TEMPLATE-8653-ROMKONTROLL`, `--compare SOURCE.json CANDIDATE.json`, and `--source-sql dump.sql` whenever the plant's parameter dump exists |
> | A block to paste into a Copilot prompt, or upload as a knowledge file | [ROMKONTROLL-COPILOT-PREFLIGHT.md](ROMKONTROLL-COPILOT-PREFLIGHT.md) |
> | The file to copy | [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) — 1,553 objects, 1 table container, 1,802 items, background preserved |
>
> Three rules from the contract are worth carrying without opening it. **A room-control table is two layers** — the container draws the grid and carries no bindings, the canvas objects carry the values; a file with only one layer is not this panel type. **The panel is bigger than the canvas on purpose** — 1400×750 is a viewport, content reaches x 3120 and y 1690, and compressing it to fit is a defect, not a fix. **`driver_id`, `unit_id` and `alias_text` are copied verbatim from `iw_gen_driver_parameters`** — the driver id is stored ready-made in the row; constructing, concatenating or adapting one produces an identifier that looks linked and reads nothing.

What stays here is **host behaviour**, because that is what this file owns. Five facts that decide whether a room-control table survives contact with the Designer:

1. **The container is the panel.** Its `unique_id` must contain `custom_`, or `load_new_ver_containers` routes it to `.template()` — an empty stub — and the whole grid **silently vanishes on Insert** with no error and no row (§10.1, gotcha #3). A 1,553-object canvas then arrives with nothing behind it.
2. **`linked="true"` is set on load whenever `driver_id !== "driver_id"`** (V3scripts.js:514) — *including when `driver_id` is empty*. All 1,553 objects in the reference carry `linked:"true"`, and two of them have no binding at all. Host behaviour, not a defect; do not "tidy" it.
3. **The 1,802 container items are scaffold, not data.** Every one carries `driver_id ""`, `link_tag "NA"`, `alias_text "new text"`, `zIndex "5"`. They draw the cell borders. Binding a value to an item instead of to a canvas object puts the number inside the grid layer, where the collector round-trips it and nothing ever reads it.
4. **Nothing clamps to `panel_width`/`panel_height`** (gotcha #25, the same fact the spjeldliste established). The plant view scrolls. `last_y` on the container is `last_row_top + row_height`, so it moves with the row count — it is not a constant.
5. **Insert appends and renames from the live canvas child index** (§10.1, §12). A full room-control table belongs on an empty canvas, and a candidate must be compared with its source **by room and column, never by array index**.

Regression fixtures and tests — run from `iwmac-designer-reference/`. Five tests skip unless the plant's parameter dump (not committed) is pointed at:

```bash
python -m unittest tests.test_romkontroll_8653_contract
```

### Generating or editing a Ventilasjon panel from an export

A vent panel is a **process schematic drawn with objects** plus a right-hand control sidebar — not a table-style dashboard. The full normative contract is [AI-BRIEFING.txt](AI-BRIEFING.txt) §7a; this is the coordinator's summary.

**Classify first**, and say which case you picked: (1) new unlinked demo — take the layout grammar of a named real export whole, then strip its links; (2) copy of a real production layout — reproduce the geometry object for object and relink from the *target* plant's dump; (3) modification of an attached export — preserve every object and field, change only what was authorized, never renumber or re-space the rest; (4) background-only — a vent panel has no artwork, so say so and stop. Case 1 is where generic dashboards come from: an agent that invents a layout instead of tracing one always produces cards and KPI boxes.

**Measured anchors** (literal `posLeft/posTop/posWidth/posHeight` of [real-vent-panel-example.json](reference_data/real-vent-panel-example.json) — 102 objects / 41 distinct obj_ids / 0 containers / 0 graphics, canvas 1400×750 on `00-blank-sidebar-1400x750`): extract run `number_v3_exhaust_pipe_horisontal` **(24,200) 1025×18**; supply run `number_v3_fresh_pipe_horisontal` **(24,442) 260×18** + `number_v3_supply_pipe_horisontal` **(337,442) 710×18** — the runs are **242 px** apart; cross-over column at **x 411** (`exhaust_connector_up` y211 · `exhaust_pipe_vertical` y254 · `supply_pipe_vertical` y329 · `supply_connector_down` y399); rotor `number_360_vg_rot` **(282,149) 60×343**; extract fan **(152,179) 59×59**, supply fan **(795,421) 59×59**; sidebar = three `number_v3_header_grey75` **250×20 at x 1150, y 0 / 165 / 357**, label column x 1160, two setpoint columns of `number_v3_60px_dark_no_conn` 62×22 at **x 1260 (Tilluft) / x 1330 (Avtrekk)**, rows y 205/230/255/279/308 (25 px pitch). `con_down` value boxes sit **above** a run, `con_top` boxes **below** it — that alone is what makes the drawing read as ductwork.

**Functional clusters move whole.** The fan cluster (fan + flow value at dx −2, dy −39 + motor output `con_top` at dx +5, dy +57 + alarm bell at dx +45, dy −19) repeats within 3 px on both fans of the same file — a template, not a coincidence. Same for filter + its own `QD…` tag + alarm, coil + valve/pump + temps + power, rotor + alarm + `LX001 %` + efficiency. Relocate a cluster with **one** translation vector applied to every member; never leave an alarm or an output behind.

**Z-index is load-bearing.** The importer writes `zIndex` through verbatim (it only fills in `"default"` when the field is missing — [iwmac-designer-import-export.user.js:148](../iwmac-designer-import-export.user.js)), so use the production bands: 5 ducts/headers · 15 dummy arrows · 20 nav buttons · 40 equipment bodies · 110 value/setpoint/json boxes · 375 alarms, LEDs, pumps, valves · 1100 labels. Emitting `"default"` is legal, but then array order *is* stacking order (ducts first, labels last).

**Both vent references are already linked** — `linked:"true"` on all 102 objects, 57 masked driver ids like `NNNNN_OJEXHAUST_OJ_1_1_0_4_19`, `unit_id` on 76 (`V01`, or the literal string `undefined`). Copying an object verbatim into a demo therefore leaks another plant's ids. For a demo, reset `id`/`driver_id` to the literal `"driver_id"`, `linked:"false"`, and blank `unit_id`/`unit_ref`/`link_name`/`link_tag`/`sub_group`, while keeping obj_id, geometry, `zIndex`, `tag_text` and the descriptive `alias_text` (the alias is what a human links by later). Never invent a driver id, unit id or navigation target id — an invented id looks linked and is not.

**QA before delivering:** re-parse the JSON; `counts` = array lengths; names `object_0..object_N`, sequential, no duplicates; every obj_id present in [all-design-objects.json](reference_data/all-design-objects.json); no `panel.image_svg`; no surviving source `driver_id`/`unit_id`; any preview drawn from the same coordinates as the JSON and labelled approximate. Report the case, the reference copied, and anything you could not verify.

**Regression prompt** (run this against any agent given the kit): *"Create an unlinked 360.001 Ventilasjon demo in the same production style as real-vent-panel-example.json."* It passes only if the answer is valid v1 JSON whose layout is visibly derived from that reference, drawn with palette objects on the blank sidebar background, with no `panel.image_svg`, no source driver/unit ids, the unlinked placeholder contract on every dynamic object, intact functional clusters, the right-hand control sidebar present, counts and sequential names valid, and a preview (if any) matching the JSON geometry.

### Ventilation panel fidelity and template-matching rules

The subsection above says how to draw a vent panel from the two committed references. This one says what to do when the user supplies **their own** panel and asks for something that should look like it — the case where a generated panel most often degrades into a conceptual diagram. [AI-BRIEFING.txt](AI-BRIEFING.txt) §7a-11 carries the short generation contract and [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) the style summary; both point here rather than restating these rules.

> **Where this subsection now sits in the stack (2026-08-10).** It used to call itself "the authoritative implementation and QA contract". It is no longer either, and it should not be read as one:
>
> | You need | Read |
> |---|---|
> | A coordinate, with its evidence id and scope tag | [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) — **authoritative on any geometric conflict** |
> | The procedure for authoring or editing a vent panel | [VENTILATION-AUTHORING-GUIDE.md](VENTILATION-AUTHORING-GUIDE.md) |
> | The acceptance tests, stage by stage | [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) |
> | The same rules as code | [documentation-rules.json](documentation-rules.json) → `python validate-ventilation-panel.py panel.json --profile PROFILE-9099-ROTOR-DEMO` |
> | A block to paste into a Copilot system prompt | [VENTILATION-COPILOT-PREFLIGHT.md](VENTILATION-COPILOT-PREFLIGHT.md) |
>
> What stays here is the **worked lesson** — the reasoning that produced those documents, and the host facts (exact `obj_id` spelling, "objects-only" is about the drawing not the background, a hover tooltip is not panel content). The measurements below are retained, unedited, as the record of what was seen in the 9099 export on 2026-08-09; where one disagrees with the contract, the contract wins, because it carries the newer evidence and the scope tag that says which panels the number applies to.

Measurements below marked *(9099 export)* come from a user-supplied `iwmac-panel_9099_360-001-ventilasjon` export inspected on 2026-08-09 — 102 objects, 41 distinct obj_ids, IWDIE v1.6.1. **It is not committed**: it carries a live plant id and real driver ids, and the repo policy is that reference JSONs are masked before commit. It is a *revised* layout of the same AHU as [real-vent-panel-example.json](reference_data/real-vent-panel-example.json), not its unmasked twin. **Diff them by role, never by array index.** Compared index by index, 85 objects differ in `posLeft`, 84 in `posTop` and 66 in `obj_id` — but that figure is an artifact of the two files ordering their objects differently. Matched by role, **79 of 102 objects are geometrically identical**; 21 moved, 1 exists only in the 9099 export, 2 only in the committed reference. The moves are real and the two sets of anchors must still not be merged — but the panels are the same drawing, not two unrelated layouts.

**1. Clone the complete visual grammar, not the equipment list.** When a supplied JSON is the template, reproduce `panel_width`, `panel_height`, the background type, `org_image_name`, the embedded `image_data`, the sidebar width and its starting x, and then every object's `obj_id`, `posLeft`, `posTop`, `posWidth`, `posHeight`, `zIndex`, `tag_text` and `alias_text` — plus the `containers` and `graphics` arrays and, where layering depends on array order rather than an explicit z-index, the object ordering itself. Keep the unlinked scaffold: labels, arrows, connector lines, dummy objects, spacers. Do not keep only the objects that look like equipment. The 9099 export is 102 single objects; the earlier generated demo (`ventilation_demo_360001 (7).json` / `(8).json`, 2026-08-09, user Downloads, not committed) was 53 with no background at all, and lost most of the production structure. That is a *different* artifact from the 45-object `ventilation_demo_360001.json` recorded in [the corpus](reference_data/ventilation-panel-corpus.json) — same base filename, different session, and neither one is in this repository. **53 is not a universal bad threshold** — object count and object roles must be justified against the reference panel, and the comparison is object by object, not count against count.

**2. The scaffold is part of the design.** A production vent panel is mostly objects with no live value, and they are what makes it read as ductwork. Named roles, all present in the 9099 export: horizontal fresh / supply / exhaust pipe runs; vertical crossover pipes; pipe connectors (`exhaust_connector_up`, `supply_connector_down`); airflow arrows; recirculation damper symbols; dummy line connectors; the labels that belong to values; section headers; room and sidebar framing objects; heat-recovery artwork; component labels; and the alarm symbols standing beside the equipment they guard. None of these may be dropped on the grounds that they have no driver behind them.

**3. Use the exact production object types.** No generic substitution where the reference uses a purpose-built object. The 41 ids in the 9099 export include, verbatim:

`numberV3_filter_with_diff_press` · `V3_58px_fan_left_nrm` · `V3_58px_fan_right_nrm` · `number_v3_heater_3_way` · `number_v3_el_heater` · `number_v3_cooler_2-way` · `number_360_vg_rot` · `number_360_room` · `number_v3_dummy_resirc_damp_hor` · `number_v3_dummy_resirc_damp_vert` · `number_v3_header_grey75` · `number_v3_60px_dark_no_conn` · `number_v3_60px_dark_no_conn_no_tag` · `number_v3_custom_json_obj` · `number_v3_60px_json_obj`

**Spell `obj_id` exactly as the catalog or the reference JSON spells it.** Do not normalise capitalisation and do not "correct" historical spelling — `numberV3_filter_with_diff_press` and `numberV3_outside_temp` really do carry the capital V, and `number_v3_cooler_2-way` really does carry a hyphen. An id that does not match a palette entry renders as a broken `undefined`-class box (§4). Substituting a generic value box for a purpose-built coil, filter or damper is the second most common way a generated vent panel stops looking like production; inventing an id is the first. The 53-object demo substituted eight ids that appear nowhere in **that** reference: `number_v3_heater_3W_valve` and `number_v3_cooler_3W_valve` for the real coil bodies, `V3_horis_damper_flow-left_nrm`/`-right_nrm` for the resirc dummies, plus `number_v3_label_11px_bold`, `number_v3_label_12px_bold`, `V3_81x21_enebled_disabled_nrm` and `V3_ok_alarm_nrm`. **All eight are legal palette entries** (checked against [all-design-objects.json](reference_data/all-design-objects.json)) — which is the point: passing the id-exists check is not the same as matching the reference's vocabulary, and the id-exists check is the only one an agent usually remembers to run.

> **Correction (2026-08-10) — the two damper ids are not on a global blacklist.** This list is a record of what one demo substituted for **one** template, and two of its eight entries have since been shown to be production-real. `V3_horis_damper_flow-left_nrm` and `V3_horis_damper_flow-right_nrm` appear in [real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) at (30,195) and (30,438), 36 × 26, and the corrected 9099 rotor profile **requires** them at (75,196) and (96,438) with a `number_v3_R_45px_con_down` position value above each. That profile also carries the recirculation column, so the two damper families are not alternatives — a panel can legitimately need both. Which family a panel uses is a property of the selected template, not of whether the unit recirculates. The rule that survives is the one this paragraph is really about: **match the vocabulary of the template you selected**, and say which template that is. Scoped geometry: [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) §5.9a (`REF-9099` dummies) and §5.9b (`PROFILE-9099-ROTOR-DEMO` flow dampers). The other six substitutions stand: they replaced purpose-built coil, filter and status objects with generic ones.

**4. Visual fidelity and parameter linking are separate axes — the layout-matched-but-unlinked mode.** A reusable demo built from a production template keeps the drawing and drops only the bindings.

| Preserve verbatim | Sanitize |
|---|---|
| `obj_id`, `posLeft`, `posTop`, `posWidth`, `posHeight` | `linked` → `"false"` |
| `zIndex`, object ordering | `driver_id` → the literal `"driver_id"` |
| `tag_text`, `alias_text` | `link_name` → `""` |
| panel dimensions, background, `org_image_name`, `image_data` | `link_tag` → `""` |
| every visual and structural object | `unit_id`, `unit_ref` → `""` |

Also set the envelope's `source_plant_id` and `panel.plant_id` to `""` for a generic reusable demo. Keep them only when the user explicitly asks for a plant-specific linked file.

**Do not remove `alias_text` during sanitization.** The alias is the selector text a human links by afterwards (§13b) — stripping it makes the demo unrelinkable. Do not strip static labels or scaffold objects either; "not live-linked" is not a reason to delete anything. `ventilation_demo_360001_layout_matched.json` (2026-08-09, user Downloads, not committed) is what a correct result looks like: 102 objects, obj_id multiset and geometry identical to the 9099 export, `linked:"false"` and `driver_id:"driver_id"` on all 102, `unit_id` empty on all 102, `alias_text` non-empty on all 102.

**5. Preserve the production background contract.** The 9099 export is 1400 × 750 with `org_image_name = "00-blank-sidebar-1400x750"` and a real embedded raster in `image_data` (`converted:"true"`, a ~8 KB PNG data URI byte-identical to the one in the committed reference): a white main drawing area with a light-grey right sidebar starting at about **x = 1150**.

"Ventilasjon is objects-only" means the ducts, equipment, values, symbols and controls are Designer objects rather than painted artwork. **It does not mean "remove the standard embedded blank-sidebar background."** Preserve the reference background exactly unless the user explicitly asks for a different one. And the standing prohibition is unchanged: **never generate decorative SVG artwork behind a ventilation panel** — no authored `panel.image_svg`. Keeping the blank-sidebar raster is preservation, not authorship.

**6. Match the production composition.** The arrangement, not just the parts *(9099 export; literal `posLeft,posTop posWidth×posHeight`)*:

- **Extract-air route on the upper horizontal line** — `number_v3_exhaust_pipe_horisontal` (24,200) 1025×18, extract fan `V3_58px_fan_left_nrm` (187,179) 59×59.
- **Supply-air route on the lower horizontal line** — `number_v3_fresh_pipe_horisontal` (24,442) 260×18 then `number_v3_supply_pipe_horisontal` (337,442) 710×18, supply fan `V3_58px_fan_right_nrm` (795,421) 59×59. The two routes are 242 px apart.
- **Vertical crossover / heat-recovery section between the routes** — the column at x 411 (`exhaust_connector_up` y 211, `exhaust_pipe_vertical` y 254, `supply_pipe_vertical` y 329, `supply_connector_down` y 399) with the rotor `number_360_vg_rot` (282,149) 60×343 and `number_v3_dummy_resirc_damp_vert` (407,310) 40×40.
- **Conditioning equipment placed directly on or across the duct line** — `number_v3_cooler_2-way` (456,409) 38×132, `number_v3_heater_3_way` (583,413) 40×210, `number_v3_el_heater` (697,413) 40×85, all straddling the supply run.
- **Labels and live values close to their sensor or equipment**, and **alarm bells beside the associated component**, never on top of it.
- **A dedicated right sidebar** — see rule 6b.
- Retain this composition when adapting the panel to another AHU, unless the documented equipment sequence for that unit forces a structural change.

**6b. The sidebar, row by row** *(9099 export)*. Three `number_v3_header_grey75` bars 250×20 at **x 1150**, y **0 / 165 / 357**, spanning the section width, captioned **Status og vendere**, **Vifteregulering**, **Temperaturregulering**. Labels start in the left part of each row at **x 1160–1175**; values and controls line up in one or two columns on the right — `number_v3_60px_dark_no_conn` 62×22 at **x 1260** (Tilluft) and **x 1330** (Avtrekk) under *Vifteregulering*, `number_v3_60px_dark_no_conn_no_tag` at **x 1329** under *Temperaturregulering*, `number_v3_60px_json_obj` / `number_v3_custom_json_obj` 100–230×20 at x 1160/1290 under *Status og vendere*, with the two alarm LEDs `V3_led_16px_circ_grey_red` / `_grey_yellow` at x 1317/1362, y 75. Vertical pitch is compact and consistent — 25 px inside the fan block (y 205/230/255/279/308), 25 px inside the temperature block (y 385/410/435). Keep the three sections visually separated by their header bars.

**7. Do not invent equipment to fill space.** Equipment may be added or removed only when the change is supported by the user's system description, an uploaded P&ID, a parameter inventory, an existing target panel, or another explicitly selected production template. If that information is missing, generate an unlinked layout from the closest template and state which equipment assumptions were carried over unchanged. **Never invent driver ids, unit ids or parameter identifiers** — an invented id looks linked and is not (§5, §8b).

**8. Avoid overlap, and do not mistake a hover tooltip for panel content.** Check, before delivering: label / value / equipment / alarm / connector overlap; values kept clear of the duct centreline unless the object actually connects to it; alarm bells close to their component but not covering it; connector-bearing value objects pointing at the correct duct or equipment (`con_down` above a run, `con_top` below it); sidebar labels not colliding with their value boxes; equipment not unintentionally breaking a pipe run; and `zIndex` putting pipes below equipment, values, labels and alarms where that is the intent.

**A Designer hover tooltip is runtime UI, not saved panel content.** Capture QA screenshots with the pointer moved away from every panel object. The 2026-08-09 QA screenshot of this panel showed a tooltip over a cooling-related value object; nothing in it belongs in the JSON.

**9. Run a structural comparison before declaring a generated JSON complete.** Report, generated against reference: panel dimensions · background name and whether it is embedded · single-object count · container count · graphics count · distinct `obj_id` count · per-id frequency differences · reference object roles that are missing · object roles that were added · objects outside the canvas · duplicate object names · non-sequential object names · overlapping rectangles that need a visual check · mismatched pipe endpoints · components that do not intersect or align with their intended duct · sidebar objects outside the sidebar area · live driver ids accidentally retained in a generic demo · missing `alias_text` on objects intended for later linking.

**Counts are necessary but not sufficient.** Two panels can agree on all six counts and still differ where it matters. The 9099 export and the committed reference agree on every count and still move 21 of 102 objects — including both fans, both filters and the electric heater. Compare role by role and report the moved roles, not a count of differing array slots.

**10. Render-based QA is mandatory.** Ten steps, in order: (1) parse the JSON; (2) validate the envelope and the counts; (3) render it, or insert it in a safe test context; (4) capture a clean 1400 × 750 preview with no hover overlay; (5) compare against the reference screenshot; (6) inspect the upper duct line; (7) inspect the lower duct line; (8) inspect the heat-recovery and conditioning section; (9) inspect the right sidebar; (10) correct geometry or object choices before delivery.

Do not deliver a hand-drawn approximation as the final preview when real Designer rendering is available. When it is not, label the preview as an approximation and do not claim pixel-level fidelity. Remember that Insert JSON **appends** (§10.1, §17) — insert a full panel onto an empty canvas unless duplication is intentional.

**11. Visual acceptance criteria.** All seventeen must hold:

1. Canvas and sidebar proportions match the reference.
2. Duct lines are straight and continuous.
3. Vertical crossovers meet the horizontal runs.
4. Fans point in the intended airflow direction.
5. Filters align with their pressure-value connectors.
6. Heating and cooling assemblies use the correct production objects.
7. Alarm bells are visually attached to the correct systems.
8. Sensor and value connectors terminate at the intended line.
9. Tags are readable and not clipped.
10. Sidebar headers share a consistent width and alignment.
11. Sidebar values form clean columns.
12. No component floats without a line, pipe or label.
13. No placeholder tooltip is visible in the preview.
14. A generic demo contains no source-plant driver identifiers.
15. `counts.single_objects` equals `panel.single_objects.length`.
16. Object names are sequential — `object_0 … object_N`, no duplicates.
17. The final JSON reparses without errors.

**12. Worked lesson — the 53-object demo (2026-08-09).**

*Bad approach.* Build a new conceptual panel from a short equipment list; use roughly half the production object set; approximate the filters, the coils and the sidebar elements; then illustrate a preview by hand that does not reflect what the Designer would actually render. Measured result against the 102-object production panel: 53 objects, 30 distinct ids, no background, and **27 production roles absent or thinned** — every one of `number_v3_60px_dark_no_conn_no_tag`, `number_v3_60px_json_obj`, `number_v3_custom_json_obj`, `number_v3_dummy_resirc_damp_hor`, `number_v3_dummy_resirc_damp_vert`, `number_v3_R_45px_con_right`, `number_v3_dummy_6x15_Line_Small_Down`, `number_360_room`, `number_360_vg_rot`, both dummy arrows, both sidebar LEDs, `numberV3_outside_temp`, `v3_3w_valve_right_down_nrm`, `V3_21px_single_pump_grey_green_up`, `number_v3_heater_3_way`, `number_v3_el_heater` and `number_v3_cooler_2-way`, with labels cut from 16 to 7 and setpoint boxes from 8 to 3 — plus 8 substituted ids that appear nowhere in **that** reference (rule 3; two of the eight have since been shown to be production-real elsewhere, and the pump variant `V3_21px_single_pump_grey_green_up` is itself disputed — see contract §12.1).

*Preferred approach.* Open the supplied production JSON. Treat all 102 objects as the baseline. Preserve geometry, `zIndex`, `tag_text`, `alias_text` and the background. Sanitize only the live parameter bindings (rule 4). Render the copied structure and compare it with the supplied screenshot. Then change only what the user's requested system difference actually requires.

**The goal is not blind copying.** It is evidence-based reuse of production composition, object vocabulary, spacing and layering — so that the parts you deliberately change are the only parts that differ.

The contract's load-bearing rules, all live-verified: exact allowlist obj_ids only (unknown ids render as broken `undefined`-class boxes, §4); `driver_id` stays the literal placeholder `"driver_id"` — the human links via the param selector afterwards (alias_text is what guides them, §13b); **UTF-8 text** — write `°C`, never `gr C` (the Insert flow reads files as UTF-8, production panels carry `°`/æøå, the object catalogue itself uses `RT401 °C`, and rendered tests confirm they survive; the mojibake risk is other channels like `addScriptTag` on the ISO-8859-1 page, verified both ways — fix the transport, do not degrade the panel text); `zIndex "default"`; empty `containers`/`graphics` in v1 — **except list panels** (spjeldliste), which are container-built with explicit zIndex layers (next section); raw JSON output only.

**Production drawing conventions** ([reference_data/panel-conventions.json](reference_data/panel-conventions.json) — mined from **194 compiled panels on 59 plants**, incl. the older 3xxx fleet and SE/DK stores): standard panel inventory per plant is Oversikt / Maskin / Energi / Ventilasjon 360.NNN / VGV / Waterloop / Kondenssystem (+ Varmesentral/320.NNN heating, Tørrkjøler, Kurver, multi-part Oversikt on big sites; SE `Översikt Butik`/`Larmöversikt`, DK `Overblik Butik`); **three size standards** — 1400×750 and 1400×755 (the designer's own Actions preset) on newer plants, 1280×1024 on the older fleet — always match the plant; **96% of panels sit on a background image** (`<plant>_<type>-vN_<date>.png`, blanks `00-blank[-sidebar]-1400x750` for object-drawn Ventilasjon panels; images freely reused across sister stores); median 57 objects and 94% driver-linked per finished panel; `link_tag` rare except Energi panels; **containers on 3/194 panels, graphics on 0/194** — empty arrays are the production norm; older plants are drawn in legacy V2 object ids (`alarm_anim.gif`, `number6`, `red_led_small`) that still render but are not modern style. The signature Oversikt pattern is the **case cluster** — one per cooling position, all members linked to the same case controller.

> **Two measurements, two scopes — do not average them** (they describe different evidence, and the rule against averaging conflicting coordinates is why both are recorded). Scope `FLEET-194`, from this survey: **28 occurrences** (+11 of a 3-member variant without the cooling symbol), alarm bell (dx12,dy0) + temp box 42×22 (dx7,dy22) + cooling 28px (dx10,dy35) + defrost 28px (dx28,dy38), ~62×66 px cluster extent. Scope `TEMPLATE-10113`, measured object by object from the committed reference export: alarm (dx4,dy0) + value box 42×22 (dx0,dy35) + cooling (dx7,dy58) + defrost (dx7,dy58, deliberately coincident with the cooling symbol), 42×86 cluster extent on 15 clusters and a 42×57 alarm-plus-value variant on 5 more. When a supplied production export is in play it outranks both — see [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) §7.2 and conflict **OV-C1**. **These occurrence counts are fleet statistics, not design targets**: a store has as many clusters as it has cooling positions, and the cluster shape is derived from the source, never forced to four objects. **And these offsets are member-to-member geometry, not a placement rule** — they say how the members sit relative to each other, never where the cluster lands. Where it lands is decided by the equipment the controller monitors, and the value object is centred on that equipment's drawn box rather than merely placed near it (contract §7.1b, rule `O-G08`). In this documentation *footprint* means the equipment's own rectangle; a cluster's extent is never called one.

AI mode A = blank table-style panel; mode B = a **cluster kit** grid the human drags onto the floor plan after insert — a kit is a hand-off, never a finished Oversikt, and a delivered panel whose clusters sit in a grid instead of on their cases is a defect (contract **OV-C2**); mode C = the container-built **list panel** below (the briefing §7b/§7c documents all three).

**The list panel (spjeldliste) — the one container-built panel type** (normative: [reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json), a real `360.004 spjeldliste` export: 383 single_objects + 208 containers, 21 system groups). Anatomy: a `previous_page_tekn_box_no` top banner (catalogue default 116×76 stretched to 1570×57, zIndex `"155"`) with `number_v3_label_12px_bold_white` titles on it; bold column headers (Spjeldnr. / Romnr. / Prosj. min./maks. m3/h / Erverdi / SP.pådrag m3/h / Spjeldvinkel %) duplicated over **two side-by-side half-tables** (supply 400-series dampers left, extract 500-series right); `number_v3_header_appgrey` stretched to 3×4580 as column dividers (11 px between the halves, zIndex `"5"`); ONE `number_v3_header_grey50` 1570×20 group-highlight stripe behind each group's first row (zIndex `"3"`); dotted `number_v3_label_8px_norm` row separators. Every row is an `objects_container` (`type container_c`, 1544×23 at left 19, top stepping 20 px, +40 px between groups, container `zIndex: 4` as a **number**) whose items are `number_v3_label_12px_bold` cells (posTop 3, zIndex `"900"`, container-relative x: 0 damper tag / 239 room / 342 prosj. min / 445 maks; right half 786/1031/1131/1234); the live-value columns (Erverdi/SP/vinkel) are left unpopulated for later hand-linking. The table overflows the canvas by design — rows to y 4646 and content to x 1585 on a nominal 1400×750 panel; the plant view scrolls. Production-file oddities that must NOT be imitated when generating: 14 identical stripes stacked per group (author copy-paste), and static cells carrying `linked:"true"` + `driver_id:"#c1"/"#c2"` — a hand-typed bookkeeping mark that appears nowhere in the designer sources (the host merely round-trips it; grep of all mirrored JS finds no `#c` consumer).

## 18. How to introspect live

```js
// what's on the canvas
[...document.getElementById('control_container').children].map(e => e.getAttribute('name'))
// the exact save document, without saving:
obj_data = []; container_data = []; container_items = [];
getPanelDataFromDOM(get_plant_id(), get_value(), $('#main_image').attr('main_image')||'', get_user_name())
// a stored compiled panel as JSON (sync, cookie-authed):
fetch('iw_load_ctrls.php?cust_id=' + cust_id + '&format=json&name=Oversikt', {credentials:'same-origin'}).then(r=>r.json())
// palette entry for an object type:
controls['V3_R_34px_circular_alarm_nrm']
// container registry / object cache
designContainers.designcontainerList; objectList.objectList
```
The userscript also exposes `window.__IWDIE` (`doExport`, `openImportPanel`, `applyImport`, `doExportBackgroundAi`, `_collect`). `doExport` (v1.6.1) automatically includes **`panel.image_svg_trace`** for embedded SVG and raster backgrounds. SVG is strictly UTF-8 decoded and validated; raster uses the existing ImageTracer settings, derived color palette, worker transfer, and fresh-pixel main-thread fallback because the transferred buffer is detached. SVG decode/validation failure or raster trace failure shows an error and does not download JSON; panels without embedded backgrounds still export without a trace. The trace is **AI-reading material only**: the briefing tells agents to read it for the drawing's geometry and author their own `image_svg`; `applyImportCore` deletes the field before rendering, so `image_data` always stays the actual background. Separately, `doExportBackgroundAi` (v1.3.0) preserves its chooser and delivery behavior: raster → choose **vector trace to `.svg`** (v1.4.0, vendored imagetracerjs 1.2.6/public domain inside the userscript; ~1–2 s / ≈7–16 k paths on a Maskin background; small text becomes outlines — inherent to tracing; **v1.5.1: the palette comes from the drawing itself** via `iwdieBuildPalette` → `options.pal`) or the lossless single-page PDF named `.ai` (hand-built, raw-RGB `CompressionStream('deflate')`, artboard = panel px; Illustrator opens any PDF); SVG background → the raw `.svg` (already vector; a PDF wrap would rasterize it). On this plain-http host Chrome may flag downloads — "Keep" saves them.

## 19. Gotchas (the real footguns)

1. **`innerHTML +=` everywhere.** The sidebar is injected with `master_wrapper.innerHTML += content` (graphics_build.js:436); `load_old_ver_objects`, `add_object_to_container`, `constructItems` and `makeContainerGR` all append with `innerHTML +=`. That re-parses existing siblings and **destroys their event listeners** — which is why every host button uses inline `onclick` attributes. Any injected UI must do the same.
2. **`UpdateObjectWorker` never clears** `objectList` before pushing (container_tool.js:22) — duplicates accumulate by design; `find()` returning the last match keeps this benign. Do not "fix" by clearing: `designContainers` records are richer than anything a rebuild produces.
3. **`DesignPanelHandler.template()` is an empty stub** (V3scripts.js:684) — containers whose `unique_id` lacks `custom_` silently don't load.
4. **`loadedGraphic.loader` resets the registry** (graphics_build.js:984) — loading graphics **replaces** all existing graphics; there is no merge.
5. **`renderPanel`'s legacy branch is broken**: `if (panelData.objects) objects = panelData[0].objects` (V3scripts.js:730-731) mixes doc-vs-array access; `groups` is read but never rendered (:742-747, :807-812).
6. **`load_new_ver_objects` restarts `name = "object_" + i` at 0** (V3scripts.js:488) — appending to a non-empty canvas creates duplicate names until something renumbers (the Duplicator's index-based rename is the model; `compiled_view_loaded` does a full renumber for the XML path).
7. **`getPanelDataFromDOM` discards the computed `image_name`** and stores the raw argument (container_tool.js:2276 vs :2283); it also assigns four globals without `var`.
8. **The collector's callers must reset `obj_data`/`container_data`/`container_items` first** (the save orchestrator does, :2030-2033) — the collector assigns `obj_data` itself but stale `container_items` can leak through `add_object_to_container` pushes.
9. **Sync XHR on the main thread** for all `iw_load_ctrls.php` fetches and `iw_sync`/`iw_delete` — the UI freezes during loads; don't add more.
10. **`checkTags` link counting uses `driver_id.substring(0,4) === get_plant_id()`** (container_tool.js:1883-1887) — wrong for 5-digit plant ids; the container badge undercounts links on 5-digit plants.
11. **`iw_set_base_image(width, height, …)` ignores width/height** (iw_graph_designer_js.php:50-65, sizing commented out) — panel size survives only because `#main_image` already has it.
12. **`initSaveDP` reads `document.getElementById("main_image").main_image`** — the DOM **property**, not the attribute (V3scripts.js:857) — usually `undefined`.
13. **`last_save_name` initializes to the literal `"test"`** (main.js:1128) and only the XML save path updates it — `get_value()` is the reliable current-panel accessor.
14. **Casing variant `V3_ObjectHandler.php`** (V3scripts.js:1596) — works because the backend is case-tolerant; keep using the host wrappers instead of building URLs.
15. `v4listTemplates`/`V3_loadUnits_Templates` **require a plant param** or reply `{"message":"ERROR : PLANT NOT DEFINED"}`.
16. **`iw_save_ctrls.php` ignores the `visible` form field on new-panel insert** — freshly compiled panels always get `visible=1` regardless of what the save popup posted (verified live). There is no popup-side way to compile a hidden panel.
17. **`controls` is an Array used as a map** (iw_graph_designer_js.php:1) — `JSON.stringify(controls)` returns `[]`; enumerate with `Object.getOwnPropertyNames`.
18. **`objects_toolbar.items` order is load-bearing** — rotate-tool gating hardcodes indices `[32..36]` (graphics.js:376-388); reordering the item array silently breaks rotation.
19. **Actions-menu dispatch matches the visible caption text** (`"tb_select:<caption>"`) — renaming a menu item breaks its handler; the `value:` fields are decorative.
20. **Toolbar SAVE does not save** — it only reveals the manager sidebar. `initSaveDP` is dead code (zero callers); the design-store writers are the Templates pane and `iw_save_design` (itself marked "not in use ???").
21. **`#custom-buttons-container` in the top bar is NOT app code** — it's an injected Tampermonkey overlay (Norwegian check-buttons) present in some sessions; don't document it as host behaviour.
22. **Mouse resize modes 1-3 are empty** in `iw_move_object` and Ctrl multi-drag writes IE-only `style.posLeft/posTop` — dead in Chrome; only arrow-key nudging and `resize_by_arrows` actually work, and **nothing snaps to the grid**.
23. **"Link Reg" is broken by a duplicate definition**: the second `linkAllTaggedObjects` (explorer_tool.js:172, `untit_ref` typo) hoists over the good one (:60) → `ReferenceError: unit_ref is not defined` on click.
24. The **`<body>` onclick attribute is mangled** in index.php (`javascript:iw_body_click();'=""`) — `iw_body_click` never fires; most of `iw_site.js` is unreachable IE4-era code full of `eval()`.
25. **List panels break the canvas-bounds assumptions.** The production spjeldliste places objects to y 4668 / x 1585 on a nominal 1400×750 panel (dividers are 3×4580) — the designer and the plant view both just scroll; nothing clamps to `panel_width`/`panel_height`. Horizontal overflow to x 1585 is structural and present even on a 26-row list; vertical overflow follows the row count. Its static cells also carry `linked:"true"` + `driver_id:"#c1"/"#c2"` — hand-typed markers with **no consumer anywhere in the mirrored sources**; the save/load/compile pipeline round-trips them opaquely. Don't "sanitize" them on export, and don't emit them when generating. The divider height is not a constant: it is `last_row_top + row_height − divider_top − 2`, so adding one row changes all 13 dividers ([LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) §8.8, and §6a here for the host behaviour).
26. **imagetracerjs's sampled palette washes flat schematics to grey.** Its palette comes from evenly-spaced sample points, and IWMAC backgrounds are ~99 % white/grey — all 16 slots land on greys and the thin coloured pipe runs (orange discharge, cyan suction, yellow liquid, red/green pills) snap to grey (proved on the 9982 Maskin: 4 grey fills, zero saturated). v1.5.1 fixes it with `iwdieBuildPalette` (exact-colour buckets, AA-halo dedupe at <24/channel, up to 8 guaranteed slots for saturated colours, `null` → tracer default for photo-like images >3000 buckets) passed as `options.pal`. If traces ever look grey again, check that `traceOptsFor` is still in both call paths.

## 20. Constants quick-ref

- Doc fields: `plant_id, panel_name, panel_width, panel_height, org_image_name, image_name, saved_by, single_objects, containers, graphics` (+ synthesized `converted`, `image_data`).
- Sentinels: driver `"driver_id"`, link_tag `""/"link_tag"/"undefined"/"NA"`, sub_group `"sub_group"`→`"A"`, image `"null"` string, template name sentinel `"Loaded panel"`, `last_save_name` init `"test"`.
- Naming: objects `object_<n>`, containers `objects_container_<n>` + `unique_id custom_<n>` (counter: `localStorage["num_of_containers"]` on load, canvas child index on paste).
- Container content index: c=0, hc=1, hcf=1, cf=0.
- driver_id format: `<plant_id>_<DRIVER>_<address…>`; unit_id `bus:addr`.
- `panel_type` values: `design_panel`, `plant_design_panel`, `panel_template`, `objects_template`; `location`: `global`/`personal`; `save_type` default `save_compiled_data`; `visible` default `"1"`.

## 21. Key functions — where to find things

| What | Where |
|---|---|
| Collector (canvas → JSON doc) | `getPanelDataFromDOM` — container_tool.js:2048 |
| Single-object field builder | `items_handler.get_single_objects` — container_tool.js:2057 |
| Container collection | container_tool.js:2188-2265 |
| Design save orchestration | `V3_add_designpanel_data` :2029 → `V3_save_design_panel` :2292 |
| Compile-to-plant (XML+popup) | `iw_save` — container_tool.js:2414; popup contract `save_panel` — main.js:631; popup POST — save_xml.htm:461-466 |
| Design load | `DesignPanelHandler.loadDesignPanel` — V3scripts.js:758; append mode = `type 'objects_template'` |
| Object instantiation from doc | `load_new_ver_objects` — V3scripts.js:482; containers `custom` — :540 |
| Full JSON render (compiled) | `renderPanel` — V3scripts.js:709; entry `iw_load_from_db` — iw_graph_designer_js.php:604 |
| Markup factory (every object) | `iw_make_ctrl` — iw_graph_designer_js.php:124 |
| Background setters | `iw_set_base_image` :50 / `iw_set_image_org` :67 (iw_graph_designer_js.php) |
| Copy/paste snapshot + rename | `Duplicator.copyItems` :392 / `constructItems` :495 (autotagging.js) |
| Bookkeeping rebuild | `UpdateObjectWorker` — container_tool.js:10 |
| Auto-tagging | `setAutoTags` — autotagging.js:724; tag index `buildLoadedTags` :41 |
| Graphics registry/loader | `LoadedGraphic` — graphics_build.js:269; `loader` :982; compiler `newCompile` :1057 |
| Templates | `templateHandler` — templates.js:1; type table :306 |
| Hotkeys | main.js:795-869 (+ Del via body `onkeydown` → `microsoftKeyPress`, main.js:931) |
| Status toasts | `V3ok_message`/`V3alert_message` — V3scripts.js:368-405 |
| Toolbar defs + handlers | `ToolBars` — graphics_build.js:8-180; `topBarHandler` :673 / `objectToolHandler` :610 / `explorerToolHandler` :589 |
| Palette accordion builder | `buildLeftItems` — graphics_build.js:458; pane loader `buildLeftPage` :428 |
| Grid | `load_grid` — graphics_build.js:1090 |
| Drag/move/resize | `iw_mouse_down`/`iw_move_object`/`iw_mouse_up` — iw_move_object.js:200/:106/:194; modal write-back `changeTagObject` :21 |
| Param selector popup | `openParamsPopup` — iw_popup_paramhandler.js:504; unit click :901; **link write-back `onParamPopup_link` :1004** |
| File/upload popups | `iw_file_selector_show` — iw_popup_filehandler.js:21; w2popup launchers :325-494; `openFileUploader` :447 |
| Bulk re-link | `linkSelRegulator` — container_tool.js:126; tag persistence `savePlantUnitsData` :1209 |
| Alignment/Z tools | `alignment` — container_tool.js:2832; `setObject_Z` — main.js:734 |
