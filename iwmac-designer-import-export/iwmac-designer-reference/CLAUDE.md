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

`initMaster()` (graphics_build.js:1206-1260) wires the filter box and fills `#plant_panels_select` from `V3get_plant_designer_panels` (→ global `loaded_compiled_panels`). The current-panel accessor is `get_value()` (main.js:1246 — selected option **text**); `set_value()` (main.js:1237) appends a new Option (used by `load('ny')`).

## 4. The object palette

Two registries, different roles:

- **`all_design_objects`** (820 entries) — what the toolbox lists. Entry: `{object_id, menu_type, object_type, object_name, inverted, base_image_path, info, width, height, default_tag_txt, status_array}`. Filtered per accordion page by `parse_designtools(panel, cb)` (V3scripts.js:1) — `menu_type === panel` for objects, `menu_type === panel+"_Cont"` for containers.
- **`controls[iw_name]`** (1769 entries) — how an object **draws**. `Control(name, width, height, action, zindex, cursor, classname, status_array, tag_text_classname, tag_text_default_text, only_tag_text, obj_type)` (iw_graph_designer_js.php:6). Derived: `.file = status_array[1]`, `.hasTag = !!tag_text_default_text`, `.canLink` = false only for `obj_type ∈ {dummy, dummy_tag, label, container}` (:7-10). Samples in `reference_data/object-palette-samples.json`.

`obj_type` vocabulary (iw_graph_designer_js.php:28-43): `dummy, dummy_tag, label, value_txt, textbox, textbox_tag, dig_object, dig_object_tag, states_object, link_button, head_container, head_container_foot, container_foot, container`.

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

**`containers[]`** (:2188-2265): `id, unique_id, name, type, container_type, className, header_footer[] ({type:"header"|"footer", text, function:"none", function_id:"none"}), linked, linked_to (from the registry's linked_unit), width, height, left, top, zIndex, items[]` + merged custom attributes (:2254-2262). `items[]` entries (get_items, :2101-2134) mirror the single-object fields but `tag_text` is unconditional and positions have **no `|| 0` fallback** (NaN possible). `tbl_container` className is normalized back to `objects_container` (:2235) and table custom attrs come from `customAttributes("tbl_container")` (:2256).

**Quirks (verified in source):**
- The returned object is the same `json_data` with `.graphics` attached by `graphicsCompiler.newCompile("json","partly",json_data)` (graphics_build.js:1057-1087 — flattens `loadedGraphic.loaded` to an array; `"full"` is an empty stub).
- `image_name` at :2276 is computed (blank when `org_image_name` exists) and then **discarded** — line :2283 stores the raw `imageName` argument.
- `panel_width/panel_height/org_image_name/image_name` are assigned without `var` → leak to globals.
- **Storage is array-of-one:** `V3_add_designpanel_data` pushes the doc into `DesignPanelArray` and posts that array (container_tool.js:2029-2046) — `V3load_design_panel` therefore replies `[{…doc}]`.
- **Embedded background extension:** `iw_load_from_db` synthesizes `converted:"true"` + `image_data:<dataURI>` + `org_image_name` onto the doc client-side (iw_graph_designer_js.php:614-623) and `renderPanel` consumes them (V3scripts.js:719-723) — the doc format natively supports a base64 background even though the store keeps the image separately.

## 9. Save paths

### 9.1 Design panel / template save (JSON)

`initSaveDP(element)` (V3scripts.js:828-861; reads the panel name from the given element's innerHTML, sentinel `"Loaded panel"`, then `prompt`s) → **`V3_add_designpanel_data(plantId, panelName, panelType, applTag, metaData, description, imageName, savedBy, placeHolder)`** (container_tool.js:2029) — resets globals `obj_data/container_data/container_items/DesignPanelArray`, collects via `getPanelDataFromDOM`, → **`V3_save_design_panel`** (container_tool.js:2292-2323): POST `function=V3_save_design_panel` body `{location, plant_id, panel_name, panel_type, appl_tag, meta_data, description, image_name, saved_by, json_data:<stringified array>}`.

### 9.2 Compile to plant (XML + JSON, the popup)

`iw_save(save_type, name, visible, image_path, view_order, picture_id, obj_gen_Arr)` (container_tool.js:2414-2686):
1. Resolves the panel name (from `#plant_panels_select` when `save_type === null` — the "Compile Panel for Plant" button passes all nulls).
2. Walks `#control_container.childNodes` building a legacy `<iw_sys>` XML doc: per object a `<data>` element (`push_xml_data`, :2592-2634 — `iw_name, zindex, type, id(=driver_id), alias_text, link_tag, sub_group, [tag_text], [file_url], [file_pdf], unit_id, unit_ref, left, top, width, height`). Containers are **flattened**: `container_hc`→`number_v3_100x100_info_box`, `container_cf`→`number_v3_100x100_info_down` (+25px, tag_text "Information"), `container_c`/`container_hcf` wrappers dropped, children stamped with absolute `grx_pos`/`gry_pos` (:2520-2576).
3. Also builds the JSON doc via `getPanelDataFromDOM` (:2660-2663).
4. `save_panel(xml_doc, panel, panelName, visible, save_type)` (main.js:631-649) stashes `last_xml_doc` (serialized string) / `lastPanelObject` / `last_xml_name` and opens the popup `designer_site/save_xml.htm?t=1`, decorating `popup.opener` with `visible, save_type, org_image_name, converted, [encoded_image, image_data]`.
5. The popup reads back via `opener.iw_get_xml()` → `{xml, panelObject}` (main.js:619-621), renders a review table, and `saveXML()` POSTs form fields `picture_name, visible, upload_xml, upload_json, upload_image_data, save_type, picture` to **`designer_site/iw_save_ctrls.php?cust_id=…&picture=…`** (save_xml.htm:466). Default `save_type` = `"save_compiled_data"`, default `visible` = `"1"`.

So one compile writes **both** the XML and the JSON representation of the panel to the compiled store — which is why `iw_load_ctrls.php?format=json` works for panels never saved as "design panels".

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
- `iw_init_sync.php?cust_id` (sync to plant), `iw_remove_panel.php?cust_id&panel_name` (delete), `iw_get_image.php`, `iw_load_units.php?cust_id&driverId`, `iw_get_files.php`, `iw_upload_file.php`, `picture_manager.php`, `get_image.htm`, `paramselector.htm`, `configtool.html`.

## 16. Hotkeys (keymaster; suppressed while focus is in INPUT/SELECT/TEXTAREA)

`ctrl/cmd+c` copy · `ctrl+v` paste +50/+50 · `ctrl+f` paste in place · `ctrl+g` group · `ctrl+a` select all · arrows = move 1 step · `ctrl+arrows` = move multi-selection · `alt+arrows` = resize · `Delete` (via `microsoftKeyPress`, keyCode 46) = delete selected (main.js:795-937).

## 17. Ecosystem: the Import/Export userscript

[`IWMAC-Designer-Import-Export.user.js`](../IWMAC-Designer-Import-Export.user.js) adds Export JSON / Copy JSON / Insert JSON under Manage Files. It deliberately reuses the host verbatim:
- Export = the host's own pre-save resets + `getPanelDataFromDOM(get_plant_id(), get_value(), $('#main_image').attr('main_image')||'', get_user_name())`, background embedded host-natively (`converted`/`image_data`, §8).
- Insert = `DesignPanelHandler.load_new_ver_objects/load_new_ver_containers` (the `objects_template` append path, §10.1) + rename-from-live-index (§12) + `UpdateObjectWorker()`; graphics only onto a graphics-free canvas because `loader` replaces (§11); container `unique_id` forced to contain `custom_` because `.template()` is a stub (§10.1).
- Cross-plant: driver-id prefix rewrite `<src>_…` → `<target>_…` (§5), leftovers reported.
- Envelope format `iwmac-designer-panel` v1 documented in [../README.md](../README.md).

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
| Hotkeys | main.js:795-869 |
| Status toasts | `V3ok_message`/`V3alert_message` — V3scripts.js:368-405 |
