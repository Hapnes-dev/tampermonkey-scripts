# VV Designer (`vv_fbx`) — How It Works

> **What it is:** IWMAC's **Virtual Values (VV) Designer** — a browser-based, visual
> **function-block editor** for building automation/energy logic ("sketches") on a plant
> and deploying the compiled result to that plant's controllers. Think of it as a
> low-code dataflow/PLC editor: you drag typed blocks onto a canvas, wire outputs to
> inputs, configure each block, verify the graph, then compile & deploy.
>
> **URL:** `http://internal.iwmac.local/vv_fbx.qxs?plant_id=<PLANT_ID>`
> (analysed against `plant_id=3111` — "IWMAC Demo 1").

This document is the result of a deep runtime + source dive (Playwright + PowerShell,
2026-07-07). It describes the data model, the block library, the connection/type rules,
the save format, the server API, and the compile/deploy lifecycle. See
[[iwmac-changes-testing]] for the sibling pang/changes pipeline.

---

## 1. Technology stack & page anatomy

| Layer | Detail |
|---|---|
| Framework | **qooxdoo-style "qxs" component runtime** (IWMAC in-house), built on **Prototype.js 1.7** + **Class.create** multiple-inheritance. NOT the public qooxdoo. |
| Canvas / graphics | **Raphaël (SVG)** + **g.Raphael** charts. The whole block canvas is one `<svg>` "paper". |
| Transport (request/response) | JSON-RPC 2.0 over `POST` to `/services/vv_fbx/*.php` (form-urlencoded body, `[{jsonrpc,method,params,id}]`). |
| Transport (realtime) | **Stream Server** via `core.communication.stream` — pluggable protocol (`…_xhr`, `…_websocket`, `…_bridge`); handshake POSTs to `/qxs_runtime/qxs_commlayer.xphp`. Used for deploy/compile progress. |
| Auth | **Session-cookie** based. The `.php` services 401 (`code -2000 "Authentication required"`) if called without the browser's session cookie. Call them via same-origin `fetch()` inside the page, not raw PowerShell. |
| Component loading | JS bundles served from `/qxs_runtime/qxs_load.xphp?...&salt=<hash>`; the app's own logic is **inline** in the `.qxs` HTML (~325 KB in a `qxs_class_4781` + `qxs_application` block). |

**Console note:** one benign error at load — *"Permissions policy violation: unload is not
allowed"* from Prototype.js. Harmless.

### Screen layout
- **Top:** IWMAC logo bar + toolbar (align/spread/group buttons, `Mode: FUNCTION|PROCESS`).
- **Left:** the **Toolbox** — system blocks grouped in collapsible categories, plus (in
  function mode) a searchable **process library tree**.
- **Center:** the **Paper** (SVG canvas) where blocks are dropped and wired.
- **Right:** the **Property box** — read-only info about the selected block (name,
  inputs/outputs, types, connected state, properties, documentation).
- **Bottom:** console output + simulation progress bar.

---

## 2. Core mental model: Blocks, Puts, Connections

A **sketch** is a directed graph:

- **Blocks** (a.k.a. elements) — nodes. Each has a numeric **pointer** (`id`, 0,1,2…),
  a **type** (e.g. `CONST`, `BIGGERTHAN`, `ALARM`), a compile-time role
  (`compile_type`), config **data**, visual position, and typed **puts**.
- **Puts** — the connection points: **inputs** (left, `i0…`) and **outputs** (right, `o1…`).
  Rendered as circles; **black = unconnected, blue = optional, green = connected, red =
  currently-selected output**.
- **Connections** — edges from one block's **output put** to another block's **input put**.
  Wiring is: click an output (turns red) → click a compatible input → edge drawn
  (orange line `#FFAC01`).
- **Groups** — visual bounding boxes that collapse/expand a set of blocks (organisational
  only; no compile effect).

Interaction model (from `qxs_fbx_paper`):
- **Left-drag on canvas** = rubber-band multi-select.
- **Left-drag on block** = move (only if `moveable`).
- **Right-click block** = context menu (Configure element, Edit documentation, input/output
  count, interval/transformation/enumeration properties, preview, replace process…).
- **Click output then input** = connect. **Shift-click input** = disconnect.
- **Del** = delete selected. Toolbar = align/spread/group selected blocks.

---

## 3. The type system (data types & connection rules)

Five value types flow along connections: **`boolean`, `integer`, `float`, `string`, `mixed`.**

### 3.1 Type widening (bit-flags)
`data_type_flags = { BOOLEAN:1, INTEGER:2, FLOAT:4, STRING:8 }`. An input's accepted set is
computed by widening (`__get_valid_types_flag`), i.e. **a wider type accepts all narrower
numeric types**:

| Input declares | Actually accepts (widened) |
|---|---|
| `boolean` | boolean |
| `integer` | boolean, integer |
| `float`   | boolean, integer, float |
| `string` or `mixed` | boolean, integer, float, string (everything) |

`get_allowed_output_types()` intersects the flags of **all** inputs a source is wired to, so a
`CONST` feeding several inputs is constrained to their common accepted types.

### 3.2 Connection validation (`__connect`)
A connection is **rejected** (unless `force`) if any of:
1. **Type mismatch** — source output type ∉ target input accepted types (and neither is
   `mixed`). Error: *"Invalid types, expected: X. Output was Y"*.
2. **Target `require_type`** — some inputs demand a specific **block type** (not just value
   type). E.g. many process inputs require the source to be a `TAGVALUE`/`PARAMV`/`CONST`/
   `CALENDAR` block. Error: *"The input requires a block with type: …"*.
3. **Source `require_type`** — an output can demand its consumer be a specific type (or a
   `process`). Error: *"The output requires a block with type: …"*.

`load()` re-creates saved connections with `force=true` (trusts persisted data).

> **Key rule to remember:** two kinds of "type" exist per put — the **value type**
> (`type: ['float']`) and the **block-identity requirement** (`require_type: ['TAGVALUE','PARAMV']`).
> Both must pass. `require_data` pins the input to a *specific tag/parameter id*.

---

## 4. The block library (the palette)

The palette (`FBX_system_blocks.system_blocks`) has **5 categories / 71 built-in blocks**.
Each block definition carries: `mode` (`function`|`process`|`both` — controls which editor
mode shows it), `type` (`internal`), `compile_type` (see §5), `alias_text`, `block_func`
(server-side function name), `require_configuration`, `inputs[]`, `outputs[]`, `color`,
`glyph` (icon), optional `config` (expandable puts), optional **`require_plant_revision`**
(min plant firmware revision), a `sim` function (client simulation), and `documentation`.

### 4.1 Basic Inputs (9) — sources, `compile_type: input`/`reference`
| Type | Alias | Notes |
|---|---|---|
| `PROCESSIN` | Process Input | Exposed input of a **process** (reference). `moveable:false`. |
| `CALENDAR` | Calendar | Boolean from a saved plant calendar schema. |
| `CALENDAR_2_0` | Calendar 2.0 | `require_plant_revision ≥1460/1477`. |
| `TAGVALUE` | Tag value | Points to a unit **tag**; `require_type:'process'` on output. Supports **repeat** (multi-unit) mode. |
| `PARAMV` | Parameter value | Points to a parameter. |
| `CONST` | Constant value | User-entered constant; type + scaling + precision. |
| `VARIABLE_INPUT` | Variable input | References a `VARIABLE_OUTPUT` elsewhere in the sketch. |
| `TOGGLE_INTERVAL` | Toggled value (Interval) | Boolean toggled on a schedule. |
| `CRITERIA` | Criteria | Boolean from date/time criteria (`require_plant_revision ≥604`). |

### 4.2 Basic Functions (28) — `compile_type: function`/`condition`
Logic & math. Booleans: `COMP_AND`, `COMP_OR`, `INVERT`. Comparisons: `BIGGERTHAN`,
`BIGGERTHANOREQUAL`, `SMALLERTHAN`, `SMALLERTHANOREQUAL`, `LIKE` (==), `UNLIKE` (!=).
Aggregation (many are **expandable-input**, 2–100): `MIN`, `MAX`, `SUM`, `AVERAGE`,
`MULTIPLY`, `DIVIDE`, `ADD`, `SUBTRACT`, `MOD`. Period variants (require config):
`MIN_IN_PERIOD`, `MAX_IN_PERIOD`, `SUM_IN_PERIOD`, `AVG_IN_PERIOD`. Misc: `FORMULA`
(server-verified math expression, configurable output type), `DIFF`, `DELTA_T`, `ABSOLUTE`.
Control flow: **`IF`** (`compile_type:condition`) and **`IF_ELSE`** — these
**invalidate downstream blocks** on the untaken branch (`__invalidate_blocks`);
`require_plant_revision ≥620`.

### 4.3 Special Functions (25) — advanced, mostly `color:#999`/`#FF5500`
`PERIODE_VALUE` (Counter Limit — alarm vs value mode), `CORRELATION`, `PULSE_COUNT`,
`AVERAGE_PERIODE`, `IS_WITHIN_DATES` (Season selector: summer/winter/other),
`SELECTOR` (bool→pick A/B), `INPUT_SELECTOR` (biggest/smallest/by-index; expandable 2–200),
`DELAY` / `DELAY_VARIABLE` (age-of-value threshold), `AGE_OF_VALUE`,
`TIME_SINCE_VALUE_LIMIT`, `WEATHER` / `WEATHER_SUN` (YR.no lookups by county/commune/place
or GPS; rev ≥620/1365), spot-price family `SPOT_PRICE`, `SPOT_PRICE_NUM_HOURS`,
`SPOT_PRICE_ANALYSER`, `SPOT_PRICE_LOW`, `SPOT_PRICE_HIGH` (rev ≥1670/1683; region set in
`iw_sys_plant_settings`), `RESET_INPUT`, `PID_CONTROLLER` (rev ≥1683), `LATCH` (set/reset),
`DATE_TIME`, `HOURMETER` (last/current/total run-time), `OPTIMAL_START_STOP` (uses
Calendar 2.0; rev ≥1543; expandable setpoints), `SHIFT_REGISTER`.

### 4.4 Basic Outputs (8) — sinks, `compile_type: output`/`reference`
`ALARM`, `ALARM_OBJECT` (+cost), `ALARM_OBJECT_EXTENDED` (+cost/value/limit),
`WRITETOUNIT` (write to a real unit parameter — `driver_ids`, optional force/delay/count),
`VIRTUALOUT` (Virtual Output → autogenerated parameter), `TEMP_VALUE` (persist + pass-through),
`PROCESSOUT` (exposed output of a **process**), `VARIABLE_OUTPUT` (named ref target for
`VARIABLE_INPUT`).

### 4.5 Transformers (1)
`TRANSFORM_MAPPED` — run a value through a lookup/conversion table (see §6 refrigerant maps).

### 4.6 Expandable puts
Blocks whose `config` has `expandable_inputs`/`expandable_outputs` (with
`minimum_inputs`/`maximum_inputs`, optional `base_expandable_on_input`) let the user
add/remove puts via the right-click menu ("Configure element input/output count").

---

## 5. `compile_type` — a block's role in compilation
This drives syntax rules, the right-click menu, and codegen:
- **`input`** — a value source (CONST/TAGVALUE/PARAMV/CALENDAR/VARIABLE_INPUT…).
- **`reference`** — process boundary (PROCESSIN/PROCESSOUT).
- **`function`** — a transform/computation.
- **`condition`** — branching (IF/IF_ELSE) that can invalidate downstream branches.
- **`output`** — a sink (ALARM/VIRTUALOUT/WRITETOUNIT/…).

Menu gating example: "Edit interval" only for `function`/`output`; "Edit enumeration" not
for `reference`/`input`/`output`; "Edit transformations" not for `input`.

---

## 6. Block configuration (`data`) — per-type payloads

Right-clicking → **Configure element** opens a type-specific dialog (`designer_windows.show_*`).
On OK, the dialog writes `set_block_data(id, data)` (and often `set_block_override(id,'alias_text',…)`).
Highlights of the `data` shapes:

- **CONST**: `{alias_text, type, initial_value, mode:'single'|'repeat', values, eng_unit,
  readonly, precision?, scaling?}`. `mode:'repeat'` stores a per-key `values` map.
- **PROCESSIN**: `{alias_text, method:'parameter'|'tag'|'constant'|'calendar'|'enable',
  type, by_refference, …}` (+ tag/constant/scaling fields depending on method).
- **TAGVALUE** (via tag_chooser): `{value:[units], tag:require_data}`; multi-select flips the
  connected block into **repeat** runtime mode (`repeat_count`, `repeat_block`).
- **ALARM**: `{alias_text, pri:'a'|'b'|'c', alarm_type:'general'|'system',
  alarm_destination:'general'|'ew'|'cw'}` (destination labels: General / Energy Watcher /
  Climate Watcher).
- **SHIFT_REGISTER**: `{mode:'0'|'1', default_return}` — 0 = Linear, 1 = Circular.
- **PROCESSIN type** ∈ mixed/integer/float/boolean/string; **PERIODE_VALUE mode** ∈
  `alarm`|`value` (alarm = boolean over-limit; value = counter value for the period).
- **PERIODE_VALUE / PULSE_COUNT / CORRELATION / WEATHER…**: `{block_func_args:{mode, periode,
  period_amount, …}}` (period ∈ `hour|day|week|month|year`).
- **FORMULA**: `{formula, title, output_type, eng_unit, precision?, scaling?}` — the formula is
  **server-verified** (`verify_math(formula, input_count)`) before save; changing output type
  prunes now-incompatible connections (with a confirm). **Grammar** (a server-side **PHP
  expression evaluator**, probed live): inputs are referenced as **`inp0`, `inp1`, … `inpN‑1`**
  (0-indexed, bounded by the block's input count — `inp2` on a 2-input block errors). Supports
  `+ - * / % ^`, comparisons `> < >= <=`, ternary `?:`, boolean `and`/`&&`/`or`/`||`, and the
  functions `min max abs round floor ceil sqrt pow sin cos log log10 exp fmod pi() random()`.
  **Not** supported: block-statement `if(){}`, or bare named constants (`pi`, `e`, `M_PI`).
  `precision` is printf-style: `%.1f` / `%.2f` / `%.3f`. `output_type` ∈ integer/float/boolean/string.
- **WRITETOUNIT**: `{force_write, delay, limit_count, count, driver_ids:[…]}`.
- **RESET_INPUT**: `{trigger_value, reset_value, delay_unit, delay_amount}`.
- **CALENDAR**: `{calendar, offset, post_offset}`.

**Value scaling** (`add_datatype_values`): numeric blocks may carry
`scaling:{type:'scaling'|'clip_scale', from_min,from_max,to_min,to_max}` and `precision`
(float). `parse_value` enforces: float (accepts `,`→`.`), integer, boolean (0/1 only), string.

**Refrigerant/thermo transform maps** (for `TRANSFORM_MAPPED` and property transformations,
`available_transformations`): `suva_404a/407c/410a/507/hfc_134a`, `co2_enthalpy`, `co2_svg`,
`r717_ammonia`, `tega_co2`, `cop_350_he/mt/parallel/kw` (COP maps need `require_plant_revision ≥1030`).

**Criteria** (`available_criterias`): `year (1970–2099)`, `month_of_year (1–12)`,
`week_of_year (1–52)`, `day_of_year (1–365)`, `day_of_month (1–31)`, `day_of_week (1–7)`,
`hour_of_day (0–23)`, `minute_of_hour (0–59)`, `second_of_minute (0–59)`.

**Block-level properties** (separate from `data`, set via right-click → Properties):
`interval` / `interval_offset` (how often the block runs), `transformations[]`,
`format_extra` (enumeration lookup), `documentation`.

---

## 7. Syntax check (validation) — `syntax_check(check_configuration)`

Run via **F10** (or automatically before deploy/save). Algorithm (`__recursive_discovery`):

1. Find **root sources** (blocks with no inputs; in **process** mode only `PROCESSIN` counts).
2. Walk the graph forward from each root, and backward through required inputs.
3. Collect errors:
   - **Unconnected required put** — *"BLOCK(id) INPUT/OUTPUT n is not connected"* (optional
     puts are exempt).
   - **Unconfigured block** — if `require_configuration` and `data==null`:
     *"BLOCK(id) is not configured"*.
   - **Type error** — output type incompatible with the consuming input.
4. Offending puts **blink red** (`__highlight_errors`). Returns
   `{ok:bool, errors:[…], text:'<trace>'}`; `text` is a human-readable connection trace,
   e.g. `CONST(0) OUTPUT 0 is connected to BIGGERTHAN(2) INPUT 0`.
   If nothing is wired, error is *"No connections"*.

---

## 8. Save / load format (the sketch document)

`paper.save()` → `__save_sketch()` produces this JSON (verified live). This is exactly what
gets persisted by `save_sketch`/`save_process` and re-hydrated by `load()`:

```jsonc
{
  "mode": "function",                 // or "process"
  "require_plant_revision": 1543,     // MAX require_plant_revision across all blocks used
  "blocks": [
    {
      "id": 0,                        // numeric pointer (stable within sketch)
      "func": "const",                // server-side block_func
      "type": "CONST",                // palette type key
      "compile_type": "input",
      "data": { … } | null,           // per-type configuration (§6)
      "override": { "alias_text": … },// display overrides
      "runtime": { … },               // e.g. repeat/repeat_count for multi-tag
      "properties": { … },            // interval, transformations, format_extra, documentation
      "output_type": ["boolean","integer","float","string"] | "boolean" | null,
      "x": 40, "y": 40,               // canvas position
      "current_revision": "…",        // (process blocks) published revision used
      "required_plant_revision": 1543 // (if the block declares one)
    }
  ],
  "connections": [
    { "source": {"id":0,"put":0}, "target": {"id":2,"put":0},
      "alias_text": "Input 1", "label": … , "by_refference": true? }
  ],
  "groups": [
    { "id":0, "blocks":[…ids], "alias_text":"…", "open":true, "box":{x1,y1,x2,y2} }
  ]
}
```

Notes:
- **`require_plant_revision`** is computed at save time as the **max** of every used block's
  requirement — this is how the system knows the minimum plant firmware needed to run the sketch.
- **`by_refference`** on a connection means the consumer wants the *reference* (address) of the
  value, not just its computed value (used by period/aggregation/delay blocks).
- `save(exclude_configuration, include_static_linking)` can omit config for
  dynamically-linked blocks (used when publishing processes).
- `save_svg()` exports the canvas as SVG (used when publishing a process preview image).

---

## 9. Modes: FUNCTION vs PROCESS

The editor has two modes (`logic_designer.paper.mode`, toggled from the menu):

- **Function mode** — you build a **sketch** that lives under a **Project** on a plant, and
  ultimately **deploy** it (compile → push to the plant). Sketches can consume **processes**
  from the library as reusable blocks.
- **Process mode** — you build a reusable **process**: a parametrised sub-sketch with
  `PROCESSIN`/`PROCESSOUT` boundary blocks. Saving/publishing a process makes it available as a
  single block in the library tree (see §10). Only `PROCESSIN` blocks are valid roots for a
  process's syntax check.

Switching modes clears the canvas (with a save prompt if dirty).

---

## 10. Processes (published reusable blocks) & the library

The most important domain concept beyond raw blocks:

- A **process** is a **published sketch** exposed as one library block. Runtime data confirms
  **726 processes** loaded for plant 3111 from the active **configuration library** "Drift"
  (`USER_LIB_5538d94a5aa8d`), vs 71 built-in blocks (797 total in `paper.blocks`).
- A process block definition (from `get_configuration`) looks like:
  ```jsonc
  "EW_REGULATOR_SP_LOWER_LIMIT": {
    "data": {
      "mode":"function", "type":"process", "compile_type":"process",
      "alias_text":"Temp SP [3]", "block_func":"ew_regulator_sp_lower_limit",
      "require_configuration":false, "color":"#CCCC33",
      "inputs":[
        { "id":"i0","alias_text":"SP","type":"float",
          "require_type":["TAGVALUE","PARAMV"],
          "require_data":"CRC_GK-GF-FF-FK_LF_SP_THERM_CUT-OUT" },  // pinned to a specific tag
        { "id":"i1","alias_text":"Limit","type":"mixed",
          "require_type":"CONST","eng_unit":"&deg;C" }
      ],
      "outputs":[]
    },
    "state":"DONE", "id":"3", "current_revision":"3833"
  }
  ```
- **`require_data`** binds a process input to a *specific* plant tag/parameter — this is how a
  generic process ("Temp setpoint lower limit") is wired to concrete points when dropped.
- **Process lifecycle `state`** (drives the tree icon in the toolbox):
  `DONE` (green puzzle), `TEST` (yellow warning), `PROGRESS` (grey puzzle),
  `PHASED_OUT` (red warning). Each process is versioned (`current_revision`).
- **Configuration payload** (`get_configuration(id)`): `{ processes:{…}, tree:[…] }` — the
  `tree` is the library hierarchy; leaf nodes have `type:"7"` and an `eid` = the process key.
- The **user library hierarchy** organises processes into folders and can be re-organised
  (see library.php methods §11). There are ~14 named libraries (ØTS, Drift, General, per-person…).

---

## 11. Server API (two transports: JSON-RPC services + the qxs PHP bridge)

There are **two distinct server transports** (both cookie-authed, both optionally sending
`Authorization: Bearer <localStorage['iwmac-jwt-token']>` if a JWT is present):

1. **JSON-RPC services** — `POST /services/vv_fbx/<svc>.php` with body
   `[{"jsonrpc":"2.0","method":M,"params":P,"id":0}]`. Used by `configuration.php` and
   `library.php`. (`configuration.php` returns a bare `{jsonrpc,result,id}` object;
   `library.php` returns an array-wrapped one.)
2. **The qxs "commlayer" PHP bridge** — the four facade objects are thin JS proxies over
   server-side **PHP classes**, invoked via `core.communication.poll` →
   `POST /qxs_runtime/qxs_commlayer.xphp?unique=…` with form body
   `args=<JSON-encoded arg array>&arg_type=multi`, plus `directory=vv_fbx`,
   `file=runtime/php_client`, `func=<Class>-><method>`. Failure replies carry
   `{poll_type:'error', str, line}`. The mapping:

   | JS facade | PHP class (`func`) | Role |
   |---|---|---|
   | `logic_designer_manager` | `logic_designer_manager` | project/sketch/process/template/history CRUD |
   | `logic_compiler` | `logic_compiler` | compile & preview |
   | `logic_upload_manager` | `logic_upload_manager` | fleet/plants + batch deploy |
   | `report` | `report` | usage/version/revision reports |

   From a script you don't build these calls by hand — you call the facade method with a
   trailing callback: `logic_designer_manager.load_sketch(id, true, reply => …)`.

### `/services/vv_fbx/configuration.php`
- `get_configurations()` → list of libraries `[{id,title}]`.
- `get_configuration(id)` → `{processes, tree}` for one library (§10).

### `/services/vv_fbx/library.php` (organise the process library)
`get_process_library_hierarchy()`, `move_process_library_level(from,to)`,
`update_process_library_level_alias_text(node,text)`, `create_process_library_level(node,text)`,
`create_user_library(text)`, `get_user_libraries()`, `get_user_library_hierarchy(id)`,
`create_user_library_level(node,text)`, `update_user_library_level_alias_text(node,text)`,
`delete_user_library_level(node)`, `link_process_library_to_user_library(pnode,unode)`,
`unlink_process_library_to_user_library(unode)`.

### `logic_designer_manager` (project / sketch / process CRUD)
`create_new_project(plant_id,name,desc)`, `load_project_list(plant_id)`,
`load_sketch_list(project_id)`, `load_sketch(sketch_id,with_data)`,
`save_sketch(project_id,name,sketch_data,sketch_id,syntax_state,comment)`,
`delete_sketch(id)`, `rename_sketch(id,new_name)`,
`new_process(group,config,alias,desc)`, `save_process(name,config,alias,desc,group,comment)`,
`rename_process(name,new)`, **`publish_process(name,config,svg)`**,
`get/set_process_state(id[,state])`, `get/set_process_invoiceable(id[,flag])`,
`get_process_preview(name)`, `load_process(id,with_data)`, `load_process_list()`,
`load_template_list()`, `load_history_list(ref)`, `revert_to_history_entry(id)`,
`save_as_template(id,alias,sketch)`, `load_template(id)`,
`load_avaliable_tags()`, `load_avaliable_calendars(plant_id)`,
`load_avaliable_calendar_systems(plant_id)`, **`verify_math(formula,inputs)`**,
`check_for_vv_error_alarms_on_plant(plant_id,sketch_id)`,
`acknowledge_vv_error_alarms(plant_id)`, `check_for_db_table_changes(plant_id,sketch_id)`,
`acknowledge_changed_tables(plant_id)`.

### `logic_compiler`
`compile_sketch_from_data(plant_id,project_id,project_name,sketch_id,sketch_data,debug)`,
`compile_sketch_from_id(plant_id,sketch_id,debug)`,
**`compile_sketch_for_preview(sketch_id,parameter_values)`** (returns compiled/previewable data),
`get_problem_sketches()`, `fix_sketches()`, `compile_all(only_uncompiled,debug)`,
`compile_ew(only_uncompiled,debug,only_compiled)`.

### `logic_upload_manager` (fleet + batch deploy)
`load_plants()` → **whole fleet** `[{plant_id, plant_name, revision}]` (revision = the plant's
current firmware revision; `null` if offline/unknown — 1808 plants at time of capture).
`load_sketches_for_plants([ids])` → grouped `[{name:"<plant>, <project>",
sketches:[{id, plant_id, name, ok, required_revision}]}]`. Drives the Deploy Manager's
cross-plant compile+deploy.

### `report`
`get_function_usage(type)`, `generate_process_report()`, `generate_process_list()`,
`generate_project_report(project)`, `get_process_usage(name)`,
`get_process_used_versions(filter_outdated)`, `get_revision_report()`.

---

## 12. Compile & deploy lifecycle

1. **Edit** sketch in function mode under a Project (`plant_id` in the URL scopes everything).
2. **Verify** (F10) — must pass `syntax_check(true)` (configured).
3. **Save** (Ctrl+S) — prompts for a **revision comment**; stores via `save_sketch` with the
   syntax state and computed `require_plant_revision`.
4. **Deploy** (F9, only shown when `?debug=1`, or via **Tools → Deploy Manager**):
   - `compile_sketch_from_data|from_id` → server returns a **`compile_id`**.
   - `start_plant_deploy` **subscribes to the Stream Server** service **`vv_fbx_uploader`**
     (params: `plant_id`, `unique`, `id`, `alarm_clean_up`); progress arrives as realtime
     `on_stream` notifications (`start → check_plant_online → progress → complete|error`).
   - Deploy requires an **online plant** and a live Stream connection (indicator dot: green =
     connected, red = disconnected).
5. **Post-processing** (**Tools → Verify values**) → Stream service **`vv_fbx_post_process`**
   (checks the deployed sketch against the live plant DB).
6. **Publish process** (process mode) → `publish_process(name, sketch, svg)` makes the new
   revision available as a library block.

**Batch/maintenance tools:** Deploy Manager (compile+deploy many sketches across plants),
Batch compiler, **Cleaner** (remove orphaned items), **Problems** window
(`check_for_vv_alarms`, `check_for_db_table_changes`), Simulation Manager (server-side sim),
Reports (process/project/usage/versions/revision), and `vv_changes.qxs` (VV change report).

---

## 13. Client-side simulation (`FBX_Simulator`)

**Tools → Simulate** runs a **client-only** dry run on the canvas (no server):
- `simulator_start` → syntax-checks, resets, then steps block-by-block (`simulator_step`,
  advance with the **Next** button).
- For each block it computes a value using the block's **`sim(block, …inputs)`** function.
  Input-less/leaf blocks and many I/O blocks **prompt the user** (`get_user_input` → JS
  `prompt`) for a simulated value; pure functions (AND, BIGGERTHAN, arithmetic…) compute
  directly.
- Results render on the canvas: each evaluated block gets a white box with its value
  (green TRUE / red FALSE), connections animate green as they're traversed, and
  IF/IF_ELSE **grey out** invalidated branches.
- This validates **logic/wiring**, not real plant data. It's a design aid, distinct from the
  server-side Simulation Manager.

---

## 14. Practical: how to introspect the live tool

The services need the browser session cookie, so drive them from **inside the page**
(Playwright `browser_evaluate` or Claude-in-Chrome `javascript_tool`), same-origin `fetch`:

```js
const call = (svc, method, params={}) =>
  fetch(`/services/vv_fbx/${svc}.php`, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
    body: JSON.stringify([{jsonrpc:'2.0', method, params, id:0}])
  }).then(r=>r.json());

// Returns a bare object {jsonrpc,result,id} for configuration.php; an ARRAY for library.php.
await call('configuration','get_configurations');
await call('configuration','get_configuration',{id:'USER_LIB_5538d94a5aa8d'});
await call('library','get_process_library_hierarchy');
```

Live object handles in the page:
- `logic_designer.paper` — the canvas engine (`__render_block`, `__connect`, `save()`,
  `load()`, `syntax_check()`, `blocks`, `elements`, `get_user_blocks()`).
- `application` — top-level app (current_project/sketch/process, save/deploy/publish).
- `designer_windows` — all configuration dialogs + `available_transformations`/`available_criterias`.
- `logic_designer_manager`, `logic_compiler`, `report` — server RPC facades.
- `core.settings.get('current_configuration_library')` — active library id.
- `window.query_string` — `{application, plant_id}`.

Build a sketch programmatically (confirmed working) and read back the exact save JSON:
```js
const p = logic_designer.paper; p.reset();
const a = p.__render_block('CONST',40,40), b = p.__render_block('CONST',40,140);
const gt = p.__render_block('BIGGERTHAN',200,80), al = p.__render_block('ALARM',360,80);
p.set_block_data(a,{alias_text:'A',type:'float',initial_value:10,mode:'single'});
p.set_block_data(b,{alias_text:'B',type:'float',initial_value:5,mode:'single'});
p.__connect({id:a,put:0},{id:gt,put:0},true);
p.__connect({id:b,put:0},{id:gt,put:1},true);
p.__connect({id:gt,put:0},{id:al,put:0},true);
JSON.stringify(p.save());        // → the §8 document
p.syntax_check(true);            // → {ok, errors, text}
p.reset();                       // clean up (nothing is persisted until save_sketch)
```

> ⚠️ Rendering/connecting through `__render_block`/`__connect` mutates the live canvas.
> `p.reset()` afterwards; nothing hits the server until an explicit `save_sketch`/deploy.
> qooxdoo/qxs gotcha (from [[iwmac-changes-testing]]): `Array.from({length:N}, fn)` misbehaves
> in this page context — use a plain `for` loop when building fixtures.

---

## 15. Host internals — the live object model (verified)

Everything above describes behaviour; this section pins down the **exact in-memory shapes**
on `logic_designer.paper` that automation must read/write. All of it is **cross-verified**
two ways: against the minified host source, and against the independently-probed
`HostAdapter` in the community Copy/Paste userscript (§16), and re-confirmed live
(2026-07-07). This is the contract a script relies on.

### 15.1 `paper.elements` — placed blocks
A map **keyed by numeric string** (`"0"`, `"1"`, …) of every block instance on the canvas.
(Do not confuse with `paper.blocks`, which is keyed by **type string** — the palette/process
*templates*. Real canvas instances are the numeric keys.) Each element object:

```
{
  pointer, block_type, type, func, compile_type, alias_text, color,
  data, override, properties, runtime, config,      // the configurable state (→ §6, §8)
  require_configuration, can_configure, moveable, output_type,
  main:{set_id:0}, main_height, image, text,        // Raphael shape indices into `set`
  set,                                              // Raphael set: set[shape.set_id] = SVG shape
  inputs:[ …pin ], outputs:[ …pin ],
}
```

- **`set`** is a Raphael set; `set[0]` (= `main.set_id`) is the block's body rect. Each pin
  and the label are shapes at their own `set_id`. A shape's on-canvas position lives in its
  **SVG transform matrix** (`shape.matrix.e`/`.f` = translate x/y; the `shape._.dx`/`.dy`
  helper exposes the same and is the most stable accessor). `save()` instead reads it via
  `getBBox()` — both are valid.

### 15.2 Pin (put) objects
Input and output pins have **different shapes** — this asymmetry is the single most
important internal detail:

```
input  = { id, alias_text, connected, connected_to,          valid_types, require_type,
           optional, set_id, by_refference, fill_color }
output = { id, alias_text, connected, connected_to, connection_index, connections,
           allow_multi, valid_types, require_type, optional, set_id, fill_color }
```

**`connected_to` is shaped differently on each side** (verified live):
- **Input side** (single upstream): `connected_to = { ref, put_id, put_connection_id, connection_id }`
  where **`ref` = SOURCE block id** and **`put_id` = the SOURCE's *output* pin index**.
  `put_connection_id` is the key into the source output's `connected_to` map.
- **Output side** (fan-out map, keyed by `connection_index`):
  `connected_to = { "0": { ref, put_id, connection_id }, … }`
  where **`ref` = TARGET block id** and **`put_id` = the TARGET's *input* pin index**.

So `put_id` means "the pin at the *other* end," and its role flips by side. To find a wire's
true source-output-pin you match the pin object by identity or read the input side; you
cannot read it off the output entry's `put_id` (that's the target's input index).

### 15.3 `paper.connections[]` — wires
Each connection object: `{ id, line, bg, from, to, user:{ source, target } }`, where
`user.source`/`user.target` are block ids and `line`/`bg` are the Raphael SVG path shapes
(hit-test `line.node`/`bg.node` for click-on-wire). Note: from a script the pin indices are
**not** directly on the connection — derive them from the endpoint blocks' pin
`connected_to.connection_id`.

### 15.4 Id allocation & selection
- **`paper.element_pointer`** — monotonic next-id counter. `__render_block(...)` consumes it
  and `++`s; `clear()`/`reset()` sets it to `0`. To inject a node at a known id, pass
  `force_id` to `__render_block` and then bump the counter past it.
- **`paper.selected_blocks`** — array of selected refs. **Gotcha:** marquee selection stores
  **string** keys (`"12"`), Ctrl-click stores **numbers** (`12`). Normalise before use.
- **`paper.initialized`** — `true` once the palette is built (readiness gate).

### 15.5 Mutation API (the write-side contract)
- **Create block:** `__render_block(type, x, y, ref, override, properties)` → then
  `set_block_func(ref, func)`, `set_block_data(ref, data)`. `override` is `{alias_text}` (pass
  `{}` if none); `properties` defaults to `[]`.
- **Create wire:** `__connect({id:src,put:outPin}, {id:dst,put:inPin}, force)`. `force=true`
  bypasses type validation (§3.2) — used when re-hydrating known-good data.
- **Delete block:** set `paper.selected_blocks=[ref]` then `__delete_selected()`, restore
  selection. (`__delete_block_connection` expects a *connection object*, not a block ref.)
- **Delete wire (pair, must call both):** `__disconnect_output(srcRef, srcOutputObj, putConnIdx)`
  removes the visual line + source-side state; `__disconnect_input(dstRef, inputObj)` clears
  the target input. The input's `put_connection_id` can desync from the source map — verify
  by matching `connection_id` before disconnecting.
- **Grow/shrink pins:** `set_block_input_count(ref, n)` / `set_block_output_count(ref, n)` —
  for expandable blocks (§4.6); the host rebuilds affected wires via `__connect`.
- **Read getters:** `get_block_type/func/compile_type/data/override/config/properties/runtime/
  inputs/outputs(ref)`. Caveat: `get_block_override` often returns `null` even when
  `element.override.alias_text` is set — prefer the raw `element.override`.

> These `__`-prefixed methods are host-private and event-driven by design (e.g. real selection
> needs a mouse event). Scripts drive them directly and manage `selected_blocks` by hand, which
> works but is unsupported — expect bookkeeping to occasionally desync across
> create/undo/create sequences (the userscript carries explicit orphan-cleanup for exactly this).

---

## 16. Ecosystem: the "Logic Designer Section Copy/Paste" userscript

A community **Tampermonkey userscript** (v1.5.2, author *Henrik Monge*,
`@match …/vv_fbx.qxs*`) adds editor features the host lacks, by driving the §15 internals.
Worth knowing because (a) it's in real use against this tool, and (b) its `HostAdapter` is a
battle-tested reference for scripting the designer. It never calls the server — it only
manipulates the in-memory canvas; the user still saves/deploys through the host.

**Features & controls:**
| Feature | Trigger | What it does |
|---|---|---|
| Copy section | `Ctrl+C` | Snapshot selected blocks + their **internal** wires (both endpoints selected) to a clipboard. |
| Paste section | `Ctrl+V` | Recreate the snapshot offset by `(40,40)`, re-wire, select the new nodes. |
| Undo | `Ctrl+Z` | Session-scoped LIFO over paste/delete/wire/tag ops (not the host's own undo). |
| Multi-wire | `Shift+W` | Pick N pins/blocks on one side, click a target; fans out / distributes / expands inputs to wire many at once. Toggles auto-expand → fill-only → off. |
| Remove connectors | `Shift+D` | Click/drag/marquee wires or blocks to bulk-delete connections. |
| Paste tags | menu | Bulk-set `driver_ids` on selected `PARAMV`/`WRITETOUNIT` blocks from pasted lines (one per block, or fill a single `WRITETOUNIT` with all). |

- **Clipboard format** (persisted via `GM_setValue`, key `ldscp:clipboard:v1`):
  ```jsonc
  { "version":1, "copiedAt":"…ISO…",
    "nodes":[ { "localId":"n0", "type":"CONST", "position":{x,y}, "data":{…full host payload…} } ],
    "wires":[ { "from":{nodeLocalId:"n0",pin:0}, "to":{nodeLocalId:"n1",pin:1} } ] }
  ```
  Nodes get portable `localId`s so a paste is position-independent; wires whose endpoints
  aren't both in the selection are dropped at copy time.
- **How it hooks the host:** monkey-patches `paper.__connect` and `paper.__disconnect_output`
  to log host-native wire edits into its own undo stack, and **polls `paper.selected_blocks`
  every 150 ms** to observe marquee selections (the host fires no selection event a script can
  catch). It guards against false undo entries during host-driven rebuilds by fingerprinting
  element + pin counts (a block resize or sketch swap clears the stack).
- **Reused host facts it confirms:** the §15 element/pin/connection shapes, the `connected_to`
  `put_id` asymmetry, `element_pointer` as the id source, the disconnect *pair*, `force=true`
  on `__connect`, and `set_block_data`/`set_block_override` for retagging.
- **Testable core:** the pure graph helpers (`buildSnapshot`, `createUndoHistory`,
  `pairSourcesToTargets`, `classifyBlockPinDirection`, `distributeSourcesAcrossTargets`) are
  split out and `module.exports`-ed for Node unit tests; the browser IIFE is skipped under Node.

> If you extend or debug this script, the §15 contract is the source of truth. The most
> fragile assumptions are the selection **string-vs-number** keys and the `connected_to`
> **side asymmetry** — both are load-bearing and both have bitten past revisions.

---

## 17. Persistence, fleet & reports — the data model (verified live)

Second-pass live probing (2026-07-07, plant 3111) of the four PHP facades pinned down the
entities behind the editor and how the system tracks versions across the whole plant fleet.

### 17.1 Entity hierarchy
```
Plant (plant_id, firmware revision)
 └─ Project           load_project_list(plant_id) → [{id, name, date}]
     └─ Sketch        load_sketch_list(project_id) → [{id, name, …}]
         └─ Revision  load_history_list(sketch_id) → [{id, saved_by, date, comment}]
```
- **`load_sketch(sketch_id, with_data)`** →
  `{sketch_id, state, compile_state, sketch_name, plant_id, project_id, project_name, sketch}`.
  **Gotcha:** pass **`with_data=true`** or `sketch` comes back as the bare flag `1`, not the
  document. With data, `sketch` is the §8 save document.
- **Sketch `state`** (e.g. `PROGRESS`) is the sketch's own lifecycle, separate from a process's
  `state`. **`compile_state`** `'1'` = has a current compile.
- **History/revisions**: every save appends `{saved_by, date, comment}` (the comment is the
  prompt shown on Ctrl+S). Real sketches carry years of history; `revert_to_history_entry(id)`
  rolls back.
- On plant 3111: one project **"test"** (id `3201`); the fleet has **1808 plants**.

### 17.2 Templates (global, cross-plant)
`load_template_list()` → `[{id, name, date}]` — a **shared, plant-independent** library
(462 entries, newest minutes old). `load_template(id)` → `{sketch, alias_text}`. These seed
"New sketch from template". Distinct from **processes** (§10): templates are whole starter
sketches; processes are reusable sub-blocks.

### 17.3 Authored sketch vs compiled artifact
- **`load_sketch`** returns the **authored** graph (what you edit).
- **`compile_sketch_for_preview(sketch_id, parameter_values)`** → `{ok, data:{mode, blocks,
  connections}}` — the **compiled/expanded** form the plant actually runs. In it, block ids are
  **strings**, `properties`/`runtime` may be empty arrays, and connections can carry a
  **`label`** (e.g. the constant value shown on the wire). This is also what the read-only
  `?preview_sketch=<id>` view renders.

### 17.4 Process library hierarchy (the toolbox tree)
`get_process_library_hierarchy()` → one tree rooted **"VV Designer Processes"**
(`eid: VV_PROCESSES`). Node **`type:"6"` = folder**, **`type:"7"` = process leaf**:
```jsonc
{ "id":"19867", "type":"7", "title":"AV/PÅ/Kalender [526]",
  "eid":"29_59EDD982127871.95514300",   // "<libNum>_<uniqid>", or symbolic e.g. "EW_COMPRESSOR_…"
  "description":"…", "state":"PROGRESS", "children":[] }
```
The `state` drives the leaf icon in the toolbox tree (§10). Folders nest (e.g. Drift → 37
children incl. sub-folders like "IOC Drift - Temperatur"). The `eid` of a `"7"` leaf is the
process key used elsewhere (`configuration.processes`, `get_process_used_versions`).

### 17.5 Reports — version drift across the fleet
- **`get_revision_report()`** → per-plant **firmware** gap:
  `{plants:{<pid>:{plant_id, current_revision, projects:{<proj>:{name, sketches:{<sid>:{name,
  required, current}}}}}}}`. When a sketch's **`required`** (= its computed
  `require_plant_revision`, §8) exceeds the plant's **`current`** firmware, that sketch can't run
  until the plant is upgraded. This is the end-to-end payoff of the per-block
  `require_plant_revision` metadata.
- **`get_process_used_versions(filter_outdated)`** → per-deployed-sketch **process** drift:
  `{…sketches:{<sid>:{name, processes:{<eid>:{name, used_revision, current_revision}}}}}`.
  `used_revision` = the process version the sketch was **compiled with**; `current_revision` =
  the **latest published**. Divergence ⇒ the sketch runs an outdated process (candidate for
  recompile). Pass `true` to filter to only-outdated.
- `generate_project_report(project)` / `generate_process_report()` / `get_process_usage(name)`
  return downloadable report blobs (via `filedownload`).

### 17.6 Tags & calendars (what blocks bind to)
`load_avaliable_tags()` → `{ok, data:[{tag:"<TAG_ID>", alias_text:"<friendly name>"}]}` — the
plant's data points (**1186** for plant 3111), e.g. `TCR_LT_JKU_PRESSURE_RP0_SUCTION` =
"Suction Pressure". `TAGVALUE`/`PARAMV` blocks bind to these (multi-select ⇒ repeat mode, §6).
`load_avaliable_calendars(plant_id)` / `load_avaliable_calendar_systems(plant_id)` →
`{ok, data:[…]}` feeding `CALENDAR`/`CALENDAR_2_0` (both empty on 3111 — no calendars defined).

### 17.7 Problems system (health checks)
- **`check_for_vv_error_alarms_on_plant(plant_id, sketch_id)`** → `{ok, data:[…]}` — active VV
  runtime error alarms on the plant (empty on 3111 = healthy). `acknowledge_vv_error_alarms(plant_id)` clears.
- **`check_for_db_table_changes(plant_id, sketch_id)`** → `{ok, data:[…]}` — DB tables that
  changed underneath deployed sketches; `acknowledge_changed_tables(plant_id)` clears.
- Both run automatically on sketch load and populate the **Problems** window (§12).

---

## 18. Glossary / cheat-sheet

| Term | Meaning |
|---|---|
| **Sketch** | A saved logic graph under a Project on a plant (function mode). The deployable unit. Has its own `state` + revision history. |
| **Process** | A published, versioned, parametrised sub-sketch reused as one block. Has `state` + `require_data` inputs. Tracked for version drift (`used` vs `current` revision). |
| **Template** | A whole starter sketch in a global, cross-plant library ("New sketch from template"). Distinct from a Process. |
| **Project** | A named container for sketches on a plant. |
| **Revision (plant)** | A plant's firmware level. A sketch's computed `require_plant_revision` must be ≤ the plant's current revision to run (see revision report, §17.5). |
| **`inp0…inpN‑1`** | The FORMULA block's input variables (PHP expression evaluator, §6). |
| **Configuration / Library** | A named set of processes + folder tree (e.g. "Drift"). Selected via `current_configuration_library`. |
| **Block / element** | A node on the canvas. `type` = palette key, `func`/`block_func` = server function. |
| **Put** | An input/output connection point. |
| **`compile_type`** | Role: input / reference / function / condition / output. |
| **`require_type`** | An input/output that demands a specific *block type* (not just value type). |
| **`require_data`** | Pins a process input to a specific plant tag/parameter id. |
| **`require_plant_revision`** | Minimum plant firmware revision a block needs; sketch's value = max over blocks. |
| **VV** | "Virtual Values" — IWMAC's computed/derived values produced by these sketches. |
| **Tag / Parameter / Unit** | Real plant data points a sketch reads (`TAGVALUE`/`PARAMV`) or writes (`WRITETOUNIT`/`VIRTUALOUT`). |
