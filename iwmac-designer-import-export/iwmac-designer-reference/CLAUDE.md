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
- `driver_id` — **plant-prefixed**: `10113_AK3_AKC_0_11_1_0_7` = `<plant_id>_<driver>_<address path>`. This is what makes cross-plant panel copying detectable/rebindable by prefix rewrite (same scheme as the VV Designer's sketch driver ids). BACnet exception: `bacnet_ualarm_v1/v2` objects get `.Ualarm` appended on save (`bacCheck`, container_tool.js:2053-2056) and stripped on load (`checkDriver`, V3scripts.js:470-480).
- `unit_id` — `000:011` bus:address, **not** plant-prefixed. `unit_ref` — optional stable ref.
- `link_tag` — the IWMAC system tag (`AREA_SYSTEM_UNIT_SIGNAL_COMPONENT_SUBJECT`, §13). Non-value sentinels: `""`, `"link_tag"`, `"undefined"`, `"NA"`.
- `sub_group` — parameter instance ("A", "B", …); sentinel `"sub_group"` normalizes to `"A"` in three separate places (container_tool.js:1961, :2459, save_xml.htm:377).
- `link_name` — `iw_param_name`; created as the literal `"link_name"` (iw_graph_designer_js.php:289).
- `tag_text` — free display label, only serialized when `controls[type].hasTag`.

`linked="true"` is set whenever `driver_id !== "driver_id"` on load (V3scripts.js:514) — the designer does **not** validate driver ids against the plant at load time; a foreign id renders fine and simply never gets live values.

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
- **Embedded background extension:** `iw_load_from_db` synthesizes `converted:"true"` + `image_data:<dataURI>` + `org_image_name` onto the doc client-side (iw_graph_designer_js.php:614-623) and `renderPanel` consumes them (V3scripts.js:719-723) — the doc format natively supports a base64 background even though the store keeps the image separately.

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
- `openParamsPopup(xml_doc)` (:504-583) opens a jQuery-UI dialog (510×800, "PARAMETER SELECTOR"), renders the w2ui layout into it, and fills `unitgrid` from the passed XML (**callers pre-fetch synchronously**: `iw_load_units.php?cust_id&driverId` — Actions menu :737-741, `iw_select` type 3/100 main.js:463-469). Clicking a unit (`unitsClickHandler`, :901-963) sync-loads **`iw_load_plant.php?regulator_name=<unit>&cust_id=…&aliastext=&param_*=false&rw_*=false`** and fills `paramgrid`; rows already auto-tagged (via `autotagger.getTag(driver_id)`) render green/bold.
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

[`IWMAC-Designer-Import-Export.user.js`](../IWMAC-Designer-Import-Export.user.js) adds Export JSON / Copy JSON / Insert JSON under Manage Files. It deliberately reuses the host verbatim:
- Export = the host's own pre-save resets + `getPanelDataFromDOM(get_plant_id(), get_value(), $('#main_image').attr('main_image')||'', get_user_name())`, background embedded host-natively (`converted`/`image_data`, §8).
- Insert = `DesignPanelHandler.load_new_ver_objects/load_new_ver_containers` (the `objects_template` append path, §10.1) + rename-from-live-index (§12) + `UpdateObjectWorker()`; graphics only onto a graphics-free canvas because `loader` replaces (§11); container `unique_id` forced to contain `custom_` because `.template()` is a stub (§10.1).
- Cross-plant: driver-id prefix rewrite `<src>_…` → `<target>_…` (§5), leftovers reported.
- Envelope format `iwmac-designer-panel` v1 documented in [../README.md](../README.md).

## 17b. Generating a panel JSON from a description (for AI assistants)

The Insert JSON path accepts **AI-authored** panels, which makes "P&ID → panel" generation practical. The kit lives next to this file:

- **[AI-BRIEFING.txt](AI-BRIEFING.txt)** — the normative contract: envelope + 17-field object template, the production-proven object allowlist (from [reference_data/production-usage-census.json](reference_data/production-usage-census.json) — 22 real panels), layout rules, and the recipes. Hand it to any AI as knowledge.
- **[AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt)** — the same contract compressed for the M365 Copilot Studio instructions field (5.4k chars, no angle brackets — the field rejects `<`/`>` and caps at 8000).
- **[reference_data/generated-panel-example.json](reference_data/generated-panel-example.json)** — a complete correct answer: a CO₂ rack overview generated from an Advansor ValuePack 3x2-1R P&ID, insert-verified live (73/73 objects, 0 errors).

The contract's load-bearing rules, all live-verified: exact allowlist obj_ids only (unknown ids render as broken `undefined`-class boxes, §4); `driver_id` stays the literal placeholder `"driver_id"` — the human links via the param selector afterwards (alias_text is what guides them, §13b); **ASCII-only text** (the page is ISO-8859-1 — `°`/æøå mojibake, verified); `zIndex "default"`; empty `containers`/`graphics` in v1; raw JSON output only.

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
The userscript also exposes `window.__IWDIE` (`doExport`, `doCopyJson`, `openImportPanel`, `applyImport`, `_collect`).

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
