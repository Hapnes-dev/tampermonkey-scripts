# VV Designer (`vv_fbx`) — How It Works

> **What it is:** IWMAC's **Virtual Values (VV) Designer** — a browser-based, visual
> **function-block editor** for building automation/energy logic ("sketches") on a plant
> and deploying the compiled result to that plant's controllers. Think of it as a
> low-code dataflow/PLC editor: you drag typed blocks onto a canvas, wire outputs to
> inputs, configure each block, verify the graph, then compile & deploy.
>
> **URL:** `http://internal.iwmac.local/vv_fbx.qxs?plant_id=<PLANT_ID>`
> (analysed against `plant_id=3111` — "IWMAC Demo 1").

This document is the result of a deep runtime + source dive.
It describes the data model, the block library, the connection/rules type
system, the save format, the server API, and the compile/deploy lifecycle. See
[[iwmac-changes-testing]] for the sibling pang/changes pipeline.

> **Here to BUILD logic (not just understand the tool)?**
> - **§19 — logic-building playbook**: requirement→block mapping, proven recipes, and a
>   build procedure for constructing logic **live** on the canvas (UI or programmatic).
> - **§20 — generate a sketch `.json` from a description**: the offline path — user describes
>   logic, you **write a `.json` file** they Import (via the Logic Designer Import/Export
>   userscript). Block/connection schema, a per-block generation table, and a complete
>   ready-to-import example. **This is the one to use when asked to "generate the JSON".**
>   ⚠️ The file **must** be `{"format":"vv-fbx-sketch","sketch":{mode,blocks,connections}}` (or a
>   bare `{mode,blocks,connections}`) — a graph of typed blocks + wires. **Do not invent a
>   `schema`/`steps`/`expression`-style format** (§20's STOP box + §20.8/§20.9 show two real
>   rejections). **§20.0 is the normative machine contract** — when delegating generation to
>   another AI, paste §20.0 + §20.4 + §20.6, and always run
>   `node validate-vv-sketch.js <file>` on the result before importing.
>
> Sections 1–18 are the reference both link back into.

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
| `PROCESSIN` | Process Input | Exposed input of a **process** (reference). `moveable:false`. **Process-mode only** — hidden from the toolbox in FUNCTION mode. |
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
`AVERAGE_PERIODE` (**process-mode only**), `IS_WITHIN_DATES` (Season selector: summer/winter/other),
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
`PROCESSOUT` (exposed output of a **process**; **process-mode only**), `VARIABLE_OUTPUT`
(named ref target for `VARIABLE_INPUT`).

### 4.5 Transformers (1)
`TRANSFORM_MAPPED` — run a value through a lookup/conversion table (see §6 refrigerant maps).

### 4.6 Expandable puts
Blocks whose `config` has `expandable_inputs`/`expandable_outputs` (with
`minimum_inputs`/`maximum_inputs`, optional `base_expandable_on_input`) let the user
add/remove puts via the right-click menu ("Configure element input/output count").

### 4.7 Toolbox presentation (visual reference — screenshots 2026-07-07, FUNCTION mode)

How the palette actually renders (left panel, top half):

- **Row anatomy:** `[18px glyph] [alias text] …………… [❓]`. The **?** (fa-question-circle)
  button appears on every block that defines `documentation` (all built-ins do) and opens
  the **Block Documentation** window (`show_documentation` → inputs/outputs/logics text from
  §4's `documentation` field). The row's hover **tooltip** is the block `description`;
  hovering highlights the row grey; **clicking the row spawns the block** on the canvas
  (`prepare_render_block`, incl. auto-created required/autoconnect input blocks, §2).
- **Category headers** ("Basic Inputs", "Basic Functions", …) are dark collapsible bars;
  categories render in source order and scroll independently of the process-library tree
  below.
- **Mode filtering, visually confirmed (all 5 categories screenshotted end-to-end):** in
  FUNCTION mode exactly the three `mode:'process'` blocks are absent — `PROCESSIN`
  (Basic Inputs starts at Calendar), `AVERAGE_PERIODE` (Special Functions jumps from Pulse
  count to Season selector), and `PROCESSOUT` (Basic Outputs shows 7 of 8: Alarm, Alarm
  Object, Alarm Object Extended, Write to unitparameter, Virtual Output, Temp. value,
  Variable output). Transformers shows its single Mapped transform. Display order matches
  the §4.1–4.5 listings 1:1 throughout.
- **Icons** are served from `/qxs_components/views/ext/qxs_fbx/images/<glyph>` (per-block
  `glyph` filename; `common.png` fallback). Distinctive designs: logic-gate shapes (And/Or),
  literal comparison symbols (`>` `≥` `<` `≤`, `=` Like, `|=` Unlike), ⤓/⤒ arrows (Min/Max),
  `Σ` (Sum), `f(x)` (Formula), operator glyphs `a·b`-style (Multiply/Divide/Add/Subtract),
  `%` (Mod), `x̄` (Average), `Δ` (Delta T), `|×|` (Absolute), literal "if"/"if else" text
  (IF/IF_ELSE), square-wave (Toggled value), ⚡-variants (the five Spot Price blocks),
  clock faces (Delay family, Current time), a "PID" badge, a digit-counter box (Hour meter),
  a **bell family** for the three Alarm blocks (plain bell → bell+badge → bell+more badges,
  `alarm*.png`), arrow-into-box (Write to unitparameter, `write_unit.png`) vs
  arrow-out-of-box (Virtual Output, `write_virtual.png`), and colour accents on
  Season selector / Weather / Sunrise-and-sunset / Mapped transform (red-green arrows,
  `transform.png`).
- **Shared glyphs — icon alone can't disambiguate these** (same file per group):
  Criteria = Toggled value (`toggled_value.png`); Delay = Variable Delay = Age of value
  (`delay.png`); Weather = Sunrise and sunset (`weather.png`); Calendar = Calendar 2.0
  (`calendar.png`). Read the label, not the icon.
- "…in period" variants reuse their base icon with a small period mark added
  (`min_in_period.png`, `max_in_period.png`, `sum_in_period.png`, `average_in_period.png`).

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
- **PARAMV**: modern shape **`{driver_ids: ["<DRIVER_ID>", …]}` (plural array)** — this is
  what the host dialog (`show_paramv`) writes; selecting multiple parameters also sets
  `output_count` = one output per parameter. Old sketches carry legacy singular
  `{driver_id: "…"}` (seen in 2021 production data); the dialog **migrates** singular→plural
  when opened. Friendly name goes in `override.alias_text` as
  `"<unit_id>, <unit_name>, <param alias>"`. Driver ids look like
  `3111_IWT_IWT_1_1_0_BAT_0`; discover them programmatically via the param_chooser service
  (§19.4).
- **AVG_IN_PERIOD** (verified from production): `{block_func_args:{period:'min',
  period_amount:5}}` — ⚠ the key is **`period`** here, while PERIODE_VALUE / PULSE_COUNT /
  CORRELATION use **`periode`**. Copy the exact key per block type.
- **DELAY_VARIABLE**: `data: null` even in production — it needs no configuration; the
  delays arrive via its CONST inputs (i1 true-delay, i2 optional false-delay).
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

A community **Tampermonkey userscript** (**v1.7.0**, author *Henrik Monge*,
`@match …/vv_fbx.qxs*`) adds editor features the host lacks, by driving the §15 internals.
Worth knowing because (a) it's in real use against this tool, and (b) its `HostAdapter` is a
battle-tested reference for scripting the designer. It never calls the server — it only
manipulates the in-memory canvas; the user still saves/deploys through the host.

**Features & controls:**
| Feature | Trigger | What it does |
|---|---|---|
| Copy section | `Ctrl+C` | Snapshot selected blocks + their **internal** wires (both endpoints selected) to a clipboard. |
| Paste section | `Ctrl+V` | Recreate the snapshot offset by `(40,40)`, re-wire, select the new nodes. |
| Paste at cursor (ghost) | `Ctrl+B` | Paste with a cursor-following **ghost preview**; click to drop it where you want. Shares the `Ctrl+V` clipboard + a common commit path (`applySnapshotAt`). *(v1.6+)* |
| Undo | `Ctrl+Z` | Session-scoped LIFO over paste/delete/wire/**move**/tag ops (not the host's own undo). |
| Multi-wire | `Shift+F` | Pick N pins/blocks on one side, click a target; fans out / distributes / expands inputs to wire many at once. Toggles auto-expand → fill-only → off. *(was `Shift+W` ≤ v1.5.x)* |
| Remove connectors | `Shift+D` | Click/drag/marquee wires or blocks to bulk-delete connections. |
| Paste tags | menu | Bulk-set `driver_ids` on selected `PARAMV`/`WRITETOUNIT` blocks from pasted lines (one per block, or fill a single `WRITETOUNIT` with all). Writes the plural `driver_ids` array — which matches the **modern host schema** for both types (the PARAMV dialog itself writes plural and migrates legacy singular `driver_id` on open, §6). |
| Drag-move undo | automatic | Wraps `paper.__move_block` so a host block-drag (incl. alt-drag-with-connected / multi-select drag, which fire one `__move_block` per block) coalesces into **one** `move-batch` undo step; undo replays the recorded FROM coords and wires follow. Host snaps moves to a 10 px grid. *(v1.7)* |
| Sketch quick-open | automatic | Augments the host **"Get started!"** dialog with a per-project arrow listing that project's sketches → opens one directly (via `logic_designer_manager` project/sketch RPC). *(v1.7)* |
| Alarm → block highlight | automatic | In the VV "problems" alarm window (`div#comp_application_window_problems_tbl_wnd_vv_alarms`), clicking an alarm token `VV_<proj>_<sketch>:<pointer>:<line>` flashes the block whose canvas `(NN)` pointer matches. DOM-scrape, read-only (no host alarm RPC exists). *(v1.7)* |

- **Clipboard format** (persisted via `GM_setValue`, key `ldscp:clipboard:v1`):
  ```jsonc
  { "version":1, "copiedAt":"…ISO…",
    "nodes":[ { "localId":"n0", "type":"CONST", "position":{x,y}, "data":{…full host payload…} } ],
    "wires":[ { "from":{nodeLocalId:"n0",pin:0}, "to":{nodeLocalId:"n1",pin:1} } ] }
  ```
  Nodes get portable `localId`s so a paste is position-independent; wires whose endpoints
  aren't both in the selection are dropped at copy time.
- **How it hooks the host:** monkey-patches `paper.__connect` + `paper.__disconnect_output`
  (wire edits) and `paper.__move_block` (drag-moves) to log host-native gestures into its own
  undo stack, and **polls `paper.selected_blocks` every 150 ms** to observe marquee selections
  (the host fires no selection event a script can catch). It guards against false undo entries
  during host-driven rebuilds by fingerprinting element + pin counts (a block resize or sketch
  swap clears the stack), and coalesces the many `__move_block` calls of a single drag via a
  short flush window.
- **Reused host facts it confirms:** the §15 element/pin/connection shapes, the `connected_to`
  `put_id` asymmetry, `element_pointer` as the id source, the disconnect *pair*, `force=true`
  on `__connect`, `set_block_data`/`set_block_override` for retagging, and — new in v1.7 —
  `__move_block(block,x,y)` snapping to a 10 px grid (`Math.round(c/10)*10`) and setting
  `block.set.transform` absolutely (undo replays FROM coords, wires redraw for free).
- **Testable core:** the pure helpers (`buildSnapshot`, `createUndoHistory`,
  `pairSourcesToTargets`, `classifyBlockPinDirection`, `distributeSourcesAcrossTargets`, and
  v1.7's `matchProjectId`, `formatSketchEntry`, `isRowProcessed`, `parseAlarmToken`,
  `distinctPointers`) are split out and `module.exports`-ed for Node unit tests; the browser
  IIFE is skipped under Node.

> If you extend or debug this script, the §15 contract is the source of truth. The most
> fragile assumptions are the selection **string-vs-number** keys and the `connected_to`
> **side asymmetry** — both are load-bearing and both have bitten past revisions.

**Second ecosystem script — "Logic Designer Import/Export" v1.0.0** (same repo,
`logic-designer-import-export/`): adds a **Transfer** section (Export/Import sketch as JSON)
to the File menu so logic can be moved **between plants**. Cross-plant import offers a
one-click **driver-id rebind** (`<src>_…` → `<target>_…` on `driver_ids`/legacy `driver_id`),
warns about CALENDAR/TAGVALUE bindings and unknown process blocks, and clears
`application.current_sketch` after import so Ctrl+S saves as a *new* sketch. Integration
pattern worth reusing: it wraps `menu_main.creator.render` to append items to the `file`
level before every rebuild (menus are re-rendered on each mode switch), and wraps
`application.on_menu` to catch its `file_ldio_*` item ids. Live-verified end-to-end
(export envelope → simulated foreign plant → rebind → 6 blocks/5 wires restored, syntax ok).

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
  **Gotcha (verified live, all three variants):** call it **without** `with_data` —
  `load_sketch(id)` → `sketch` is the full §8 document. Passing `true`/`1` returns the bare
  flag `sketch: 1`; passing `false` returns an empty object. (The app itself always omits it.)
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

---

## 19. Logic-building playbook (for AI assistants)

You've been asked to **create logic** — an alarm, a virtual value, a control rule. This
section turns the reference above into a build procedure. Follow it top to bottom.

### 19.0 Clarify before building
Ask (or infer from context) — these change the graph:
1. **Which plant** (`plant_id` in the URL) and **which project/sketch** (new, or edit existing?).
2. **Inputs**: which tags/parameters? Get exact ids via `load_avaliable_tags()` (§17.6) or ask.
3. **Output effect**: alarm (which priority A/B/C, type, destination §6)? a stored virtual
   value (`VIRTUALOUT`)? a write to a real setpoint (`WRITETOUNIT` — **writes to hardware**,
   confirm intent)?
4. **Conditions**: thresholds, delays/persistence, calendar/time gating, seasons.
5. **Deploy now or just draft?** Saving is safe; **deploy pushes to a live plant** — always
   confirm with the user before deploying, and never deploy on plants you weren't asked about.

### 19.1 Requirement → block mapping
| Requirement fragment | Block(s) to reach for |
|---|---|
| "read temp/pressure/status from unit X" | **`PARAMV`** — the general reader for plain function logic. (`TAGVALUE`'s output has `require_type:'process'` — it can **only** feed a process block's pinned tag input, §4.1/§10.) |
| "a settable limit/setpoint the user can tweak" | `CONST` (becomes an exposed, editable parameter; `readonly:false`) |
| "when open / within schedule" | `CALENDAR` / `CALENDAR_2_0` (needs a calendar on the plant, §17.6) |
| "only at night / by sun" | `WEATHER_SUN`; "by outdoor temp/forecast" → `WEATHER` |
| "in summer vs winter" | `IS_WITHIN_DATES` (Season selector) |
| "on weekdays 7–17" etc. | `CRITERIA` (year/month/week/day/hour/min ranges §6) |
| "X greater/less than Y" | `BIGGERTHAN(OREQUAL)` / `SMALLERTHAN(OREQUAL)`; equality `LIKE`/`UNLIKE` |
| "both/any of…" | `COMP_AND` / `COMP_OR` (expandable inputs); "not" → `INVERT` |
| "must hold for N minutes" (debounce) | `DELAY_VARIABLE` (delay via CONST inputs — best for programmatic builds) or `DELAY` (delay in config dialog) |
| "on rising/falling edge", "count starts/pulses" | `PULSE_COUNT` with `block_func_args.type` = `flank_rising_edge`/`flank_falling_edge`/`flank_changing_edge` (native edge counting; signal→i0, **CONST level→i1 required**) |
| "toggle/flip a value on each pulse" | `PULSE_COUNT`(flank mode) → `MOD` ← `CONST(2)` — 0/1 flips per edge (count resets per configured period). Time-based toggle = `TOGGLE_INTERVAL`; set/reset hold = `LATCH` |
| "average/min/max/sum over a period" | `AVG/MIN/MAX/SUM_IN_PERIOD` (input **by_refference**) |
| "how long has it been running" | `HOURMETER`; "how old is the value" → `AGE_OF_VALUE`, `DELTA_T` |
| "stays on until reset" (hysteresis/holding circuit) | `LATCH` (set/reset) |
| "pick A when true else B" | `SELECTOR`; "largest/smallest of many" → `INPUT_SELECTOR` |
| "custom math" | `FORMULA` (`inp0…inpN‑1`, §6 grammar) — prefer ADD/MULTIPLY/… for trivial cases |
| "cheap/expensive electricity hours" | `SPOT_PRICE_LOW` / `SPOT_PRICE_HIGH` / `SPOT_PRICE_ANALYSER` |
| "convert pressure→temperature (refrigerant)" | `TRANSFORM_MAPPED` or a **transformations property** on the reading (§6 maps) |
| "raise an alarm" | `ALARM` (or `ALARM_OBJECT(_EXTENDED)` to attach cost/value/limit) |
| "store a computed value (trend/dashboard)" | `VIRTUALOUT` (creates a new plant parameter) |
| "write to the controller" | `WRITETOUNIT` (⚠ real write; force/delay/count options) |
| "bind a process's tag input" | `TAGVALUE` (auto-created when you drop a process; multi-select units ⇒ **repeat mode** §6 = same logic stamped per unit) |
| "same logic for 40 fridges" | a **process** + `TAGVALUE` repeat mode, or publish the process and stamp it per sketch |
| "reusable piece for many sketches" | Build in **process mode** with `PROCESSIN`/`PROCESSOUT`, publish (§9/§10) |

Prefer an existing **library process** over rebuilding common logic: search the toolbox tree
(726 in "Drift"); dropping one auto-creates its pinned inputs (`require_data`, §10).

### 19.2 Proven recipe shapes
- **Threshold alarm with persistence** (the workhorse — **executed live 2026-07-07**: all 7
  wires connect without `force`, `syntax_check(true).ok === true`, min plant revision 0):
  `PARAMV(temp)` → `BIGGERTHAN` ← `CONST(limit)`; → `COMP_AND` ← `CALENDAR` (optional gate);
  → `DELAY_VARIABLE` ← `CONST(delay-when-true s)`; → `ALARM{pri, type, destination}`.
  Toolbox tip: spawning `DELAY_VARIABLE` via toolbox click auto-creates + wires both delay
  `CONST`s (its `autoconnect` inputs) and leaves the block's output selected, ready to click
  a target input — verified live.
- **Hysteresis / holding circuit**: comparator(high) → `LATCH.set`; comparator(low or
  `INVERT`) → `LATCH.reset`; `LATCH.value` → output. (Library also has "Holdekrets" processes.)
- **Virtual KPI**: readings → `FORMULA`/arithmetic → `VIRTUALOUT{alias, type:'float',
  engineering:{unit}}` (+ set an **interval** property §6 if it shouldn't run every scan).
- **Spot-price load shift**: `SPOT_PRICE_LOW` → `SELECTOR` (comfort vs eco setpoint via two
  `CONST`) → `WRITETOUNIT(setpoint)`.
- **Season/night setback**: `IS_WITHIN_DATES`/`WEATHER_SUN` → `SELECTOR` → setpoint write.
- **Toggle on rising edge** (**verified live on plant 5440, 2026-07-07** — loaded, 6 blocks/
  5 wires, syntax ok; import-ready file `Downloads/toggle_rising_edge_5440.json`):
  `PARAMV(digital input)` → `PULSE_COUNT{block_func_args:{periode:'day',
  type:'flank_rising_edge', periode_amount:1}}` ← `CONST(1)` (Logic True Level, put 1);
  → `MOD` ← `CONST(2)`; → `VIRTUALOUT` (or `WRITETOUNIT` with an explicit target parameter).
  Caveat: the count resets each configured period, so parity can flip at the period boundary —
  widen the period if that matters.
- **Fan-out one condition to many alarms**: one comparator output connects to many inputs
  (outputs multi-connect; inputs take exactly one wire).

### 19.3 Build procedure — in the UI
1. Open `vv_fbx.qxs?plant_id=<id>`, pick/create the **Project** (Get started dialog).
2. Click blocks in the toolbox to spawn (§4.7); click output-pin then input-pin to wire (§2).
3. Right-click each red-titled block → **Configure element** (red title = unconfigured).
4. **F10** syntax check → fix blinking puts/blocks until `Syntax OK`.
5. **Ctrl+S** → name + **revision comment**. Then (only if asked) deploy via Tools →
   Deploy Manager (§12).

### 19.4 Build procedure — programmatic (Playwright/console)
Drive `logic_designer.paper` (§14/§15). Skeleton that composes with §19.2 recipes:
```js
const p = logic_designer.paper;                     // assumes startup() done (library loaded)
const src  = p.__render_block('PARAMV', 40, 40);    // returns numeric ref (reader — see note)
const lim  = p.__render_block('CONST',   40, 160);
const gt   = p.__render_block('BIGGERTHAN', 220, 90);
const al   = p.__render_block('ALARM',  400, 90);
p.set_block_data(src, {driver_ids: ['<DRIVER_ID>']}); // §6 — modern plural shape
p.set_block_override(src, 'alias_text', '<UNIT_ID>, <UNIT_NAME>, <PARAM ALIAS>');
p.set_block_data(lim, {alias_text:'Limit', type:'float', initial_value:8, mode:'single',
                       eng_unit:'°C', readonly:false, precision:'%.1f'});
p.set_block_data(al,  {alias_text:'High temp', pri:'b', alarm_type:'general',
                       alarm_destination:'general'});
p.__connect({id:src,put:0},{id:gt,put:0});          // NO force ⇒ type rules enforced (§3.2)
p.__connect({id:lim,put:0},{id:gt,put:1});
p.__connect({id:gt, put:0},{id:al,put:0});
const check = p.syntax_check(true);                  // {ok, errors[]} — iterate until ok
```
Rules of thumb:
- Omit `force` on `__connect` while building so the host validates types for you.
- Prefer blocks whose config arrives **via CONST inputs** (`DELAY_VARIABLE`, `SELECTOR`,
  `LATCH`, comparators) — no dialog-only `data` shapes to guess. For dialog-configured
  blocks use the §6 payloads verbatim; if a shape isn't documented there, **open the real
  dialog once and diff `get_block_data(ref)`** rather than inventing fields.
- After every `set_block_data`, the title turns black (configured). `p.changed` tracks dirt.
- Persist only on request: `logic_designer_manager.save_sketch(project_id, name, p.save(),
  sketch_id_or_null, syntax_ok, comment, cb)` — a **comment is required practice** (§17.1).
  To edit an existing sketch: `load_sketch(id)` (**omit** `with_data`, §17.1) →
  `p.load(reply.sketch)` → mutate → save with the same `sketch_id`.
- **Never call** `deploy`/`compile_sketch_from_*`/`publish_process`/`WRITETOUNIT`-bearing
  saves without explicit user confirmation (§19.0.5).
- **Discover real driver_ids programmatically** (same source the PARAMV dialog uses — the
  param_chooser component service over the commlayer):
  ```js
  const poll = (func, data) => new Promise(res => core.communication.poll({
    file: '../lib/xml/qxs/views/ext/qxs_param_chooser/runtime/class.param_chooser.php',
    func, data, callback: res }));
  // units on the plant:            → {data:{data:[{plant_id, alias_name, units:[{unit_id, unit_name, driver_type}]}]}}
  await poll('param_chooser->get_left',  {plant_id: query_string.plant_id, mode:'unit', values_to_load:[]});
  // parameters of one unit:        → {data:{data:[{id:'<group>', parameters:[{alias_text, driver_id, driver_id_no, element_id}]}]}}
  await poll('param_chooser->get_right', {plant_id: query_string.plant_id, mode:'unit',
              value:{plant_id, unit_id:'IWT01', unit_name:'Tempnod 1'}});
  ```
- **Saving a NEW sketch** (mirrors the app's own call): `logic_designer_manager.save_sketch(
  project_id, name, p.save(), false /*sketch_id=false ⇒ create*/, syntax_ok, cb)` →
  `{sketch_id, sketch_name}`. Re-saving an existing sketch passes its `sketch_id` plus a
  revision `comment`.

### 19.5 Pre-flight checklist (before save/deploy)
- [ ] `syntax_check(true).ok === true` (all non-optional puts wired, all
      `require_configuration` blocks have `data`, types compatible §3).
- [ ] Numeric flow: remember arithmetic blocks emit **strings via `.toFixed(2)`** in
      simulation; server compile handles numbers — but avoid feeding string-typed CONSTs
      into numeric-only inputs.
- [ ] Period/age blocks (`*_IN_PERIOD`, `DELAY*`, `AGE_OF_VALUE`) take their value input
      **by_refference**. Feeding them a computed value is fine and common (the production
      "Monitor reception" sketch runs `PARAMV → AVG_IN_PERIOD → SMALLERTHAN →
      DELAY_VARIABLE → ALARM`), but `*_IN_PERIOD` aggregates history — feed it the raw
      reading (`PARAMV`), not post-processed math, unless you mean to aggregate the math.
- [ ] `require_plant_revision` of every used block ≤ plant firmware (§17.5 revision report;
      spot-price needs ≥1670, PID/LATCH ≥1683, OSS ≥1543).
- [ ] Alarm blocks: priority/type/destination chosen deliberately (§6) — destination `ew`
      routes to Energy Watcher, `cw` to Climate Watcher.
- [ ] Consider an **interval** property (§6) on heavy period/weather/spot blocks.
- [ ] Save with a descriptive **revision comment**; verify with the client-side simulator
      (Tools → Simulate, §13) before proposing deploy.

### 19.6 Worked example — "Alarm if room > 8 °C for 15 min during opening hours" (executed live ✓)
Blocks: `PARAMV`(room temp) · `CONST`(8 °C float) · `BIGGERTHAN` · `CALENDAR`(opening) ·
`COMP_AND` · `DELAY_VARIABLE` · `CONST`(900 s integer) · `ALARM`(pri b).
Wiring: temp→GT.i0, limit→GT.i1, GT→AND.i0, CAL→AND.i1, AND→DLY.i0, 900→DLY.i1,
DLY→ALARM.i0. Configure PARAMV to the parameter, CALENDAR to the schedule, ALARM's texts.
F10 → Ctrl+S ("high-temp alarm w/ 15 min persistence, calendar-gated") → simulate → propose
deploy. This is recipe 19.2#1 verbatim — most real requests are that recipe with different
inputs, limits, and gates. (Mirror of the real production pattern in §17.3's
"Monitor reception" sketch.)

### 19.7 End-to-end proof (built + saved for real, 2026-07-07)
The full pipeline was executed on plant 3111 producing **sketch 8660
"claude_demo_tempnod1_battery_alarm"** in project "test" (3201): a wireless sensor-node
**low-battery maintenance alarm** —
`PARAMV{driver_ids:['3111_IWT_IWT_1_1_0_BAT_0']}` ("IWT01 Tempnod 1, Battery level")
→ `SMALLERTHAN` ← `CONST(20 %)`; → `DELAY_VARIABLE` ← `CONST(3600 s)`; → `ALARM{pri:'c'}`.
Discovered the real parameter via param_chooser (§19.4), wired without `force`,
`syntax_check(true).ok`, saved via `save_sketch(…, false, true)` → round-trip
`load_sketch(8660)` returned all 6 blocks / 5 connections (state PROGRESS,
compile_state 0 = never deployed). Open it:
`vv_fbx.qxs?plant_id=3111&sketch=8660`. Not deployed — deploying is a human decision.

---

## 20. Generating a sketch `.json` from a description (offline authoring)

**Goal:** the user describes logic in words → you (the AI) **write a `.json` file** → the user
loads it with the **Logic Designer Import/Export** userscript (File → Transfer → Import). No
live browser needed to author it — you emit the file directly. This is the fastest path from
"I want an alarm that…" to something runnable, and it's what to reach for when asked to
"generate the JSON".

> ⛔ **STOP — read this before authoring. The single biggest failure (seen repeatedly).**
> The importer accepts **exactly one data model**: a graph of concrete function **blocks**
> wired by **connections**. It does **not** run any abstract description of logic. Do **not**
> invent your own schema. Concretely, an import is **rejected** ("*Unrecognized file — expected
> a VV sketch export or a raw sketch document*") or is useless unless the file is **either**
> `{"format":"vv-fbx-sketch", "sketch":{ "mode", "blocks":[…], "connections":[…] }}` **or** a
> bare `{"mode", "blocks":[…], "connections":[…]}`. The importer literally checks
> `parsed.format === 'vv-fbx-sketch' && parsed.sketch` **or** `Array.isArray(parsed.blocks) &&
> Array.isArray(parsed.connections)` — nothing else is recognized.
>
> **Therefore, NEVER emit** any of these (they all fail — see §20.8 for a real example):
> - a top-level **`"schema"`** key, or any envelope key other than `"format":"vv-fbx-sketch"`;
> - an **abstract logic representation** — no `logic.steps`, no step `type`s like
>   `read`/`condition`/`writePulse`, no free-form **`expression`** strings
>   (`"enable && display_air > highTempLimit"` ← **there is no expression language**);
> - `inputs`/`outputs`/`parameterBindings` as the top-level structure.
>
> Every threshold, AND/OR, alarm, and write is a **separate block** wired to others (§20.4).
> If you catch yourself writing an `expression` string or a `steps` array, you are building the
> wrong thing — convert it to blocks + connections first.

### 20.0 The machine contract (hand this to ANY AI generating a file)

This subsection is **self-contained and normative**. When asking another model (ChatGPT,
Copilot, Gemini, …) to generate VV logic, paste **§20.0 + the §20.4 block table + the §20.6
example** as its instructions — nothing else is needed, and nothing less is safe. Then run the
output through the **mechanical validator** before importing (see below) — do not trust any
AI-generated file unvalidated, including your own.

```text
CONTRACT — VV Designer sketch JSON (vv-fbx-sketch). Follow EXACTLY.

OUTPUT = one pure-JSON file (no comments, no trailing commas):

{ "format": "vv-fbx-sketch", "version": 1, "exported_at": "<ISO8601>",
  "source_plant_id": null, "source_sketch_id": null, "name": "<short name>",
  "block_count": <int>, "connection_count": <int>,
  "sketch": {
    "mode": "function",                      // REQUIRED. "function" unless building a process
    "require_plant_revision": 0,
    "blocks": [ <block>, … ],
    "connections": [ <connection>, … ],
    "groups": []
  } }

<block> = { "id": <int 0,1,2,… unique>,      // INTEGER. Never a string.
            "type": "<PALETTE_KEY>",         // ONLY from the block table. UPPERCASE.
            "func": "<block_func>",          // copy VERBATIM from the block table
            "compile_type": "<from table>",
            "data": <object per table> | null,   // null ⇒ imports unconfigured (red)
            "override": {} | {"alias_text":"<canvas label>"},
            "runtime": {}, "properties": {},
            "output_type": <from table>, "x": <number>, "y": <number> }

<connection> = { "source": {"id": <block id>, "put": <output pin index, 0-based>},
                 "target": {"id": <block id>, "put": <input  pin index, 0-based>} }

HARD RULES (violating ANY one breaks the import):
 1. ALLOWLIST SEMANTICS: emit ONLY the keys shown above and the data fields shown in
    the block table. If a key is not in this contract, it does not exist. Do not
    invent, rename, or camelCase anything.
 2. Block ids are integers. Pin refs are numeric indices. There are NO named pins
    (no "out"/"a"/"b"/"trigger") and NO "from"/"to"/"block"/"pin" keys.
 3. There is NO expression language, NO "steps", NO "logic", NO "parameterBindings",
    NO "schema" key, NO "inputs"/"outputs" arrays, NO "severity"/"message"/"label"/
    "blockType"/"writePulse"/"durationMs". Every operation is a block; every data
    flow is a wire.
 4. Only block types in the table exist. In particular: equality is LIKE (not EQUAL);
    inequality is UNLIKE; write-to-hardware is WRITETOUNIT (not WRITEOUTUNIT/WRITE/
    DIGITAL_OUTPUT); ANY read of a plant value is PARAMV (there is no DIGITAL_INPUT/
    ANALOG_INPUT/INPUT/SENSOR); AND/OR are COMP_AND/COMP_OR; NOT is INVERT.
    There are NO edge-detect (RISING_EDGE) and NO toggle/flip-flop (TOGGLE) blocks —
    but PULSE_COUNT has NATIVE edge count modes (block_func_args.type
    "flank_rising_edge"/"flank_falling_edge"/"flank_changing_edge"). Toggle-per-edge =
    PULSE_COUNT(flank_rising_edge) → MOD ← CONST(2) (count resets each configured
    period). Set/reset memory = LATCH; time-based toggle = TOGGLE_INTERVAL.
 5. Data payloads are snake_case host fields, copied from the table:
    PARAMV  {"driver_ids":["<PLANT>_<…>"]}          (ARRAY; or null to bind later)
    CONST   {"alias_text":…,"type":"integer|float|boolean|string",
             "initial_value":…,"mode":"single","eng_unit":…,"readonly":false}
    ALARM   {"alias_text":…,"pri":"a"|"b"|"c",
             "alarm_type":"general"|"system",
             "alarm_destination":"general"|"ew"|"cw"}      (no other priorities exist)
 6. Each INPUT pin takes exactly ONE wire. Outputs may fan out.
 7. NEVER invent a driver id. Use ids the user supplied/verified, else data: null
    with override.alias_text "TODO bind: <what>". A unit id like "000:001" is a UNIT,
    not a parameter — there is no "address" field; bindings are FULL parameter driver
    ids (e.g. "5440_AK3_AKC_0_1_0_0_2576") in data.driver_ids.
 8. Do not include WRITETOUNIT unless the user explicitly asked to write to hardware.
 9. Wire every non-optional input of every block you place (comparators need both
    pins; DELAY_VARIABLE needs value + a CONST seconds on put 1; PULSE_COUNT needs
    the signal on put 0 + a CONST "Logic True Level" on put 1 — put 1 REQUIRES a
    CONST source).
10. Before answering, self-check: parse your own JSON; verify rules 1–9; verify every
    connection's ids exist and block_count/connection_count match the arrays.
```

**Mechanical enforcement (don't skip):**
- `node validate-vv-sketch.js <file.json>` — validator shipped in the repo at
  [`logic-designer-import-export/validate-vv-sketch.js`](https://github.com/hapnes-dev/tampermonkey-scripts/blob/main/logic-designer-import-export/validate-vv-sketch.js).
  Exit 0 = importable; exit 1 = numbered errors with the exact fix for each. It encodes every
  rule above **plus** the full 71-type allowlist, a wrong-name correction map (EQUAL→LIKE,
  WRITEOUTUNIT→WRITETOUNIT, …), per-type data checks, and the single-wire-per-input rule.
  Both real AI failures (§20.8, §20.9) fail it with precise messages; the verified-good files
  pass.
- [`vv-sketch.schema.json`](https://github.com/hapnes-dev/tampermonkey-scripts/blob/main/logic-designer-import-export/vv-sketch.schema.json)
  — JSON Schema (draft-07) for editor/CI validation; catches the structural mistakes
  (string ids, `from`/`to`, forbidden keys). The validator is stricter — prefer it.

### 20.1 The file to emit — the export envelope
Emit **pure JSON** (no comments) in the `vv-fbx-sketch` envelope the import script accepts:
```jsonc
{
  "format": "vv-fbx-sketch",
  "version": 1,
  "exported_at": "<ISO 8601 timestamp>",
  "source_plant_id": null,            // null for fresh logic; set to target plant if known
  "source_sketch_id": null,
  "name": "<short descriptive name>",
  "block_count": <N>, "connection_count": <M>,
  "sketch": { …the sketch document, below… }
}
```
(The import script also accepts a **bare** sketch document — the `sketch` object alone — but
the envelope is preferred: it carries the name and enables cross-plant rebind.)

### 20.2 The sketch document (what `sketch` holds)
Exactly the §8 `paper.save()` shape:
```jsonc
{
  "mode": "function",                 // "function" for plant logic; "process" only for reusable sub-sketches
  "require_plant_revision": <max over blocks, see 20.5>,
  "blocks": [ …block objects… ],
  "connections": [ …connection objects… ],
  "groups": []
}
```

**Block object** — per block:
```jsonc
{
  "id": 0,                            // 0-indexed sequential integer, unique in the sketch
  "type": "BIGGERTHAN",               // palette key (20.4 table)
  "func": "biggerthan",               // block_func (20.4 table) — applied on load, keep correct
  "compile_type": "function",         // input|reference|function|condition|output (20.4)
  "data": null,                       // per-type config payload (20.4 / §6), or null if none/unknown
  "override": {},                     // e.g. {"alias_text":"…"} to rename the block on canvas
  "runtime": {},
  "properties": {},                   // usually {} (or []); interval/format_extra/etc. rarely
  "output_type": "boolean",           // 20.4 table (informational; re-derived from type on load)
  "x": 220, "y": 80                   // canvas position (px)
}
```
**Connection object** — one per wire (source **output** → target **input**):
```jsonc
{ "source": { "id": 0, "put": 0 }, "target": { "id": 2, "put": 0 } }
```
`put` is the 0-based pin index. Outputs may fan out to many inputs; **each input takes exactly
one wire**. On import the host connects with `force=true`, so author only valid type pairings
(§3) — a `boolean`/numeric comparator output into a `boolean`/mixed input, etc.

> **Why this loads even hand-authored:** `paper.load()` calls `__render_block(type, x, y, id,
> override, properties)` which rebuilds each block's structure (inputs/outputs/compile_type/
> colour) **from its `type`**, then applies your `func` and `data`, then wires connections with
> force. So `type`, `id`, `func`, `data`, `x`, `y` and the connections are the load-critical
> fields; `compile_type`/`output_type` are re-derived (include them anyway for a clean
> re-export).

### 20.3 Authoring procedure
1. **Map the description to a recipe** (§19.1/§19.2). Most requests are the threshold-alarm
   shape: `reader → comparator ← limit → [gate] → [delay] → output`.
2. **Assign block ids** 0,1,2,… in any order; keep them unique.
3. **Lay out `x`/`y`** left→right by dataflow so the imported graph is readable: sources
   `x≈40`, comparators/logic `x≈240`, delay/mid `x≈480`, outputs `x≈700`; stack parallel
   inputs ~120 px apart in `y`.
4. **Fill `data`** from the 20.4 table. For values the user gave (limits, delays, priorities),
   author them fully. For **plant-specific bindings you can't know** (real `PARAMV` driver ids,
   `CALENDAR` ids), **leave `data: null`** — the block imports **unconfigured (red title)** and
   the user binds it via the normal dialog after import. Never invent a real driver id.
5. **Add connections** per the recipe.
6. **Compute `require_plant_revision`** (20.5) and the counts; stamp `name`/`exported_at`.
7. **Write the file** (e.g. `vv-sketch_<desc>.json`) and tell the user to Import it, then
   configure any red (unbound) input blocks, F10, save, and deploy when ready.

### 20.4 Block generation reference (the common set) — ALLOWLIST
**These are the only field names and values that exist** — copy `type`/`func`/`compile_type`/
`data` cells **verbatim** (exact casing; never rename to camelCase or a synonym; see §20.9 for
what happens if you do). `data: null` = needs no config (or leave null to configure
post-import). Pin order = input index. For expandable blocks add inputs `i2,i3,…` and matching
connections. The full 71-type palette is in §4; anything not listed in §4/§20.4 does not exist
(the validator's correction map catches common inventions: EQUAL→LIKE, WRITEOUTUNIT→WRITETOUNIT,
GREATERTHAN→BIGGERTHAN, AND→COMP_AND, NOT→INVERT, …).

| Type | func | compile_type | output_type | inputs (pins) | `data` template |
|---|---|---|---|---|---|
| `PARAMV` | `paramv` | input | `["mixed"]` | — | `{"driver_ids":["<REAL_ID>"]}` — **or `null`** to bind post-import |
| `CONST` | `const` | input | `["boolean","integer","float","string"]` | — | `{"alias_text":"Limit","type":"float","initial_value":8,"mode":"single","eng_unit":"°C","readonly":false,"precision":"%.1f"}` (type ∈ integer/float/boolean/string; drop `precision` unless float) |
| `CALENDAR` | `calendar_value` | input | `["mixed"]` | — | `{"calendar":"<id>","offset":0,"post_offset":0}` — or `null` to bind post-import |
| `BIGGERTHAN` | `biggerthan` | function | `boolean` | i0,i1 numeric | `null` |
| `BIGGERTHANOREQUAL` | `biggerthanorequal` | function | `boolean` | i0,i1 | `null` |
| `SMALLERTHAN` | `smallerthan` | function | `boolean` | i0,i1 | `null` |
| `SMALLERTHANOREQUAL` | `smallerthanorequal` | function | `boolean` | i0,i1 | `null` |
| `LIKE` / `UNLIKE` | `like` / `unlike` | function | `boolean` | i0,i1 | `null` |
| `COMP_AND` / `COMP_OR` | `comp_and` / `comp_or` | function | `boolean` | i0,i1,… (expandable, boolean) | `null` |
| `INVERT` | `invert` | function | `boolean` | i0 boolean | `null` |
| `ADD`/`SUBTRACT`/`MULTIPLY` | `add`/`subtract`/`multiply` | function | `float` | i0,i1,… numeric (expandable) | `null` |
| `DIVIDE` | `divide` | function | `["integer","float"]` | i0,i1 | `null` |
| `MIN`/`MAX`/`AVERAGE` | `comp_min`/`comp_max`/`average` | function | `float` | i0,i1,… (expandable) | `null` |
| `FORMULA` | `formula` | function | `float` | inp0,inp1,… (expandable) | `{"formula":"inp0+inp1","output_type":"float","title":"…","precision":"%.1f"}` (grammar §6) |
| `SELECTOR` | `selector` | function | `["integer","float"]` | i0 bool, i1 if-true, i2 if-false | requires config — build the two alternatives as `CONST`s |
| `DELAY_VARIABLE` | `alarm_multi_delay` | function | `boolean` | i0 value, i1 delay-true (CONST s), i2 delay-false (optional CONST) | `null` (delays come from the CONST inputs) |
| `AVG_IN_PERIOD` | `avg_in_period` | function | `float` | i0 value (by-ref) | `{"block_func_args":{"period":"min","period_amount":5}}` (note key **`period`**) |
| `MIN_IN_PERIOD`/`MAX_IN_PERIOD`/`SUM_IN_PERIOD` | `min_in_period`/`max_in_period`/`sum_in_period` | function | `float` | i0 value (by-ref) | requires config `{"block_func_args":{…}}` |
| `LATCH` | `latch.run` | function | `integer` | i0 set, i1 reset | `null` (needs plant rev ≥1683) |
| `PERIODE_VALUE` | `counter_limit.run` | function | `["float","boolean"]` | i0 param, i1 limit | `{"block_func_args":{"mode":"alarm","periode":"day","period_amount":1}}` (note key **`periode`**) |
| `PULSE_COUNT` | `pulse_count` | function | `["integer"]` | i0 signal (by-ref), i1 level (**requires CONST**) | `{"block_func_args":{"periode":"day","type":"flank_rising_edge","periode_amount":1}}` — periode ∈ sec/min/hour/day/week/month/year; type ∈ `over_or_equal_value`/`absolute_value`/**`flank_rising_edge`**/`flank_falling_edge`/`flank_changing_edge` (⇒ native edge counting!); count resets each period |
| `ALARM` | `alarm` | output | `null` | i0 boolean | `{"alias_text":"…","pri":"c","alarm_type":"general","alarm_destination":"general"}` (pri a/b/c; dest general/ew/cw) |
| `ALARM_OBJECT` | `alarm_object` | output | `null` | i0 condition, i1 cost | `{"alias_text":"…","pri":"c","alarm_type":"general","alarm_destination":"general"}` |
| `VIRTUALOUT` | `virtualout` | output | `null` | i0 mixed | `{"alias_text":"…","type":"float","engineering":{"unit":""},"precision":"%.1f"}` |
| `WRITETOUNIT` | `set_unit_value` | function | `null` | i0 value | `{"force_write":false,"delay":0,"limit_count":false,"count":"","driver_ids":["<REAL_ID>"]}` — **real hardware write; confirm with user** |
| `TEMP_VALUE` | `tmp_value` | output | `["mixed"]` | i0 mixed | `{"alias_text":"…"}` |

For any block not listed, pull `block_func`/`compile_type`/`inputs`/`outputs` from §4, or open
it once in the live designer and read `get_block_data(ref)` (§19.4).

### 20.5 `require_plant_revision`
Set it to the **max** minimum-revision of the blocks used (0 if none apply). Common floors:
`IF`/`IF_ELSE`/`CRITERIA`/`AVG_IN_PERIOD`/`WEATHER`/`HOURMETER` **620** (`CRITERIA`/`AVG` 604),
`CALENDAR_2_0` **1460**, `OPTIMAL_START_STOP` **1543**, `SPOT_PRICE*` **1670–1683**,
`RESET_INPUT`/`PID_CONTROLLER`/`LATCH` **1683**. If unsure, 0 is safe (the plant just needs to
meet whatever the blocks actually require at compile).

### 20.6 Worked example — the file for "Alarm if room temp > 8 °C for 15 min during opening hours"
A complete, ready-to-import file (leave `PARAMV`/`CALENDAR` unbound for the user to pick):
```json
{
  "format": "vv-fbx-sketch",
  "version": 1,
  "exported_at": "2026-07-07T00:00:00.000Z",
  "source_plant_id": null,
  "source_sketch_id": null,
  "name": "High temp alarm 8C 15min calendar-gated",
  "block_count": 8,
  "connection_count": 7,
  "sketch": {
    "mode": "function",
    "require_plant_revision": 0,
    "blocks": [
      { "id": 0, "type": "PARAMV", "func": "paramv", "compile_type": "input", "data": null, "override": { "alias_text": "TODO bind: room temperature" }, "runtime": {}, "properties": {}, "output_type": ["mixed"], "x": 40, "y": 60 },
      { "id": 1, "type": "CONST", "func": "const", "compile_type": "input", "data": { "alias_text": "High temp limit", "type": "float", "initial_value": 8, "mode": "single", "eng_unit": "°C", "readonly": false, "precision": "%.1f" }, "override": { "alias_text": "High temp limit (8 °C)" }, "runtime": {}, "properties": {}, "output_type": ["boolean","integer","float","string"], "x": 40, "y": 200 },
      { "id": 2, "type": "BIGGERTHAN", "func": "biggerthan", "compile_type": "function", "data": null, "override": {}, "runtime": {}, "properties": {}, "output_type": "boolean", "x": 260, "y": 110 },
      { "id": 3, "type": "CALENDAR", "func": "calendar_value", "compile_type": "input", "data": null, "override": { "alias_text": "TODO bind: opening-hours calendar" }, "runtime": {}, "properties": {}, "output_type": ["mixed"], "x": 40, "y": 330 },
      { "id": 4, "type": "COMP_AND", "func": "comp_and", "compile_type": "function", "data": null, "override": {}, "runtime": {}, "properties": {}, "output_type": "boolean", "x": 440, "y": 150 },
      { "id": 5, "type": "CONST", "func": "const", "compile_type": "input", "data": { "alias_text": "Persistence", "type": "integer", "initial_value": 900, "mode": "single", "eng_unit": "s", "readonly": false }, "override": { "alias_text": "Persist 900 s (15 min)" }, "runtime": {}, "properties": {}, "output_type": ["boolean","integer","float","string"], "x": 440, "y": 320 },
      { "id": 6, "type": "DELAY_VARIABLE", "func": "alarm_multi_delay", "compile_type": "function", "data": null, "override": {}, "runtime": {}, "properties": {}, "output_type": "boolean", "x": 640, "y": 180 },
      { "id": 7, "type": "ALARM", "func": "alarm", "compile_type": "output", "data": { "alias_text": "Room too warm during opening hours", "pri": "b", "alarm_type": "general", "alarm_destination": "general" }, "override": {}, "runtime": {}, "properties": {}, "output_type": null, "x": 840, "y": 190 }
    ],
    "connections": [
      { "source": { "id": 0, "put": 0 }, "target": { "id": 2, "put": 0 } },
      { "source": { "id": 1, "put": 0 }, "target": { "id": 2, "put": 1 } },
      { "source": { "id": 2, "put": 0 }, "target": { "id": 4, "put": 0 } },
      { "source": { "id": 3, "put": 0 }, "target": { "id": 4, "put": 1 } },
      { "source": { "id": 4, "put": 0 }, "target": { "id": 6, "put": 0 } },
      { "source": { "id": 5, "put": 0 }, "target": { "id": 6, "put": 1 } },
      { "source": { "id": 6, "put": 0 }, "target": { "id": 7, "put": 0 } }
    ],
    "groups": []
  }
}
```
After import the two `TODO bind:` blocks show **red** (unconfigured) — the user opens each,
picks the real parameter/calendar, then F10 → Save. **Verified live 2026-07-07:** this exact
hand-authored file was `paper.load()`-ed on plant 3111 — all **8 blocks / 7 wires** rendered,
every `func` correct, the two bound `CONST`s configured, and `syntax_check(true)` returned
exactly `["PARAMV(0) is not configured", "CALENDAR(3) is not configured"]` — i.e. only the two
intentionally-unbound inputs, exactly the "configure these two, then save" state the template
is meant to produce. (The host re-derives block structure from each `type` on load — 20.2 note —
so a hand-authored file behaves identically to a `paper.save()` one.)

### 20.7 Validation checklist for a generated file
- [ ] **Run the mechanical validator first**: `node validate-vv-sketch.js <file>` (§20.0) —
      it enforces this whole checklist and more, with per-error fixes. The items below are the
      manual fallback when Node isn't available.
- [ ] **Top-level shape is right:** either `"format":"vv-fbx-sketch"` + a `"sketch"` object,
      **or** a bare doc with top-level `"blocks"`/`"connections"`. **No `"schema"` key. No
      `logic`/`steps`/`expression`/`inputs`/`outputs`/`parameterBindings`.** (This is the #1
      rejection — §20.8.)
- [ ] `sketch.mode` is a string; `sketch.blocks` and `sketch.connections` are arrays.
- [ ] Every operation the user described is a **block**, and every data flow is a **wire** —
      nothing is left as prose/expression inside a field.
- [ ] Pure JSON, parses cleanly (no trailing commas, no comments).
- [ ] Every `connections[].source.id`/`target.id` exists in `blocks[]`; `put` indices are in range.
- [ ] Each **input** pin has ≤1 incoming wire; every non-optional input is wired (or the user is
      told it's intentionally left for post-import binding).
- [ ] Type pairings valid (§3): comparator/logic outputs are `boolean`; don't feed a `string`
      CONST into a numeric-only input.
- [ ] `block_count`/`connection_count` match the arrays; `require_plant_revision` = max floor.
- [ ] Real hardware bindings (`WRITETOUNIT`) and real driver ids are present **only** if the
      user supplied them; otherwise left `null`/placeholder and flagged.
- [ ] You told the user: Import → configure red blocks → F10 → Save → deploy is their call.

### 20.8 Anti-pattern: a real rejected file and its fix
A file that produced *"Unrecognized file — expected a VV sketch export or a raw sketch
document"* on plant 5440 (generated by another AI). It is instructive because it's **plausible
but built on an invented model**:
```jsonc
{
  "schema": "vv-designer-demo-function.v1",          // ✗ not "format":"vv-fbx-sketch"
  "name": "Demo_Regulator_000_001_K5_Maskinrum",
  "source": { "unitId": "000:001", "driverType": "AK3", … },
  "inputs": [ { "id":"highTempLimit", "type":"float", "default":8.0 }, … ],   // ✗ not blocks
  "parameterBindings": [ { "driverId":"5440_AK3_AKC_0_1_0_0_2576", … }, … ],  // ✗ a catalog, not wired
  "logic": {
    "steps": [
      { "id":"read_display_air", "type":"read", "parameter":"5440_AK3_AKC_0_1_0_0_2576" },   // ✗
      { "id":"alarm_high_temp", "type":"condition",
        "expression":"enable && read_display_air > highTempLimit",           // ✗ no expression language
        "severity":"A", "message":"…" },
      { "id":"cmd_reset_alarm", "type":"writePulse", "parameter":"…_2046", "durationMs":1000 } // ✗
    ],
    "outputs": [ { "id":"isHealthy", "expression":"…" } ]                     // ✗
  }
}
```
**Every top-level idea here is wrong for VV** — `schema`, `inputs`, `parameterBindings`,
`logic.steps`, `read`/`condition`/`writePulse`, `expression`, `severity`, `outputs`. The importer
sees no `format:"vv-fbx-sketch"` and no top-level `blocks`/`connections`, so it rejects at the
first gate. Even fixing the wrapper wouldn't help — there are **no blocks to render**.

What *was* good: it discovered **real driver ids** for the regulator (e.g. Display Air
`5440_AK3_AKC_0_1_0_0_2576`, Comm error `…_COM_ERR`, Reset alarm `…_0_2046`). Those are exactly
the `PARAMV.data.driver_ids` values a correct file needs — the mistake was cataloguing them
instead of **wiring them into blocks**.

**The correct translation** (each abstract idea → concrete blocks/wires, §20.4):
| Its abstract idea | Correct VV blocks |
|---|---|
| `read` parameter `…_2576` | `PARAMV{ "driver_ids":["5440_AK3_AKC_0_1_0_0_2576"] }` |
| input `highTempLimit=8.0` | `CONST{ type:"float", initial_value:8, … }` |
| `condition "display_air > highTempLimit"` | `BIGGERTHAN` with PARAMV→i0, CONST→i1 |
| `condition "comm_error == 1"` | `PARAMV(COM_ERR)` → (compare to `CONST(1)` via `LIKE`, or invert as needed) |
| `enable && …` | `COMP_AND` with the enable source + the condition wired in |
| `severity:"A", message:"…"` (an alarm) | `ALARM{ pri:"a", alarm_type:"general", alarm_destination:"general" }` fed by the condition |
| `writePulse` to `…_2046` | `WRITETOUNIT{ driver_ids:["…_0_2046"] }` — **real hardware write, confirm first** (or `RESET_INPUT`) |
| `output isHealthy = expression` | build the boolean with comparators + `COMP_AND`/`INVERT`, end in `VIRTUALOUT` |

So "high-temp alarm on Display Air > 8 °C" becomes the §20.6 shape:
`PARAMV(…_2576) → BIGGERTHAN ← CONST(8) → [COMP_AND ← enable] → ALARM{pri:'a'}` — real driver id
in the PARAMV, everything else a wired block. Do that per described condition and collect them
into one `sketch.blocks`/`connections`. **If your draft contains the word `expression` or a
`steps`/`parameterBindings` array, delete it and re-express as blocks before emitting.**

### 20.9 Second failure class: right shape, wrong host contract
The *next* attempt (M365 Copilot, same regulator) got the big idea right — a `vv-fbx-sketch`
envelope with `blocks` + `connections`, and it even harvested **real** driver ids from the plant
— yet still failed. This is the subtler, more common trap once the model knows it needs blocks:
it invents field names and shapes instead of using the host's exact contract. Every one of these
was live-verified against plant 5440:

| # | What it emitted | Why it fails | Correct (host contract) |
|---|---|---|---|
| 1 | `sketch` has `name`/`description`/`metadata` but **no `mode`** | Importer rejects: *"Sketch document is malformed (mode/blocks/connections missing)"* (`typeof doc.mode !== 'string'`) | `sketch.mode: "function"` is **required** |
| 2 | block `"id": "p_comm_error"` (strings) | Host ids are numeric (`element_pointer`); string keys break save + every `/^\d+$/` path | `"id": 0,1,2,…` **integers**, unique |
| 3 | connections `{ "from":{block,pin:"out"}, "to":{block,pin:"a"} }` | `__connect` reads `source.id`/`source.put`; `from`/`to` are undefined to it, and pins are **numeric indices** not names | `{ "source":{"id":0,"put":0}, "target":{"id":2,"put":0} }` |
| 4 | PARAMV `data.driverId` (camelCase, singular) | Host reads **`data.driver_ids`** (snake, **array**) — the camel/singular field is ignored → unbound | `"data":{"driver_ids":["5440_AK3_AKC_0_1_0_0_2576"]}` |
| 5 | CONST `data.value` + `valueType` | Host reads `initial_value`+`type`+`mode` — so the const has **no value** | `{"type":"float","initial_value":8,"mode":"single","alias_text":"…"}` |
| 6 | ALARM `data.priority`/`message` | Host reads `alarm_type`/`alarm_destination`/`alias_text`; and `pri` is **only `a`/`b`/`c`** (it used `"n"`) | `{"pri":"a","alarm_type":"general","alarm_destination":"general","alias_text":"…"}` |
| 7 | types `"EQUAL"` and `"WRITEOUTUNIT"` | **Not real block types** — `__render_block` silently drops them (`type in paper.blocks` is false) | equality = **`LIKE`**; write = **`WRITETOUNIT`** (§20.4) |
| 8 | per block: `blockType`, `label`; no `func`/`compile_type` | `label`/`blockType` are ignored (canvas label = `override.alias_text`); missing `func` leaves the block's server function unset | include `func` + `compile_type` (§20.4); put the label in `override.alias_text` |

**Rules that kill this whole class:** copy `type`/`func`/`compile_type`/`data` **verbatim from
the §20.4 table** (never rename a field to camelCase or a synonym); ids are integers; connections
are `source`/`target` + numeric `id`/`put`; only block types that appear in §4/§20.4 exist.
Its real driver ids were correct and reusable — the fix was pouring them into the right shapes.

> **Verified fix (live on plant 5440, 2026-07-07):** the corrected sketch —
> `PARAMV(…_COM_ERR) → ALARM`; `PARAMV(…_2576) →{BIGGERTHAN←CONST(8)→ALARM,
> SMALLERTHAN←CONST(−2)→ALARM}` (Display Air fans out to both) — `paper.load()`-ed with **9
> blocks / 7 wires, all types rendered, `syntax_check(true).ok` with zero errors**, and all four
> driver ids confirmed real via param_chooser. That's the shape to emit.

**A third failure (Copilot, same day) repeated the classes** — string ids, `from:"x.output"`
string connections, `name`/`config.address` fields — and added a new one: **PLC-vocabulary
block types that don't exist** (`DIGITAL_INPUT`→PARAMV, `WRITE`→WRITETOUNIT, and
`RISING_EDGE`/`TOGGLE` which have **no VV equivalent at all** — see §20.0 rule 4 for the
compositions). Also note its `config.address: "001:001"` confusion: that's a **unit** id;
bindings need the full **parameter** driver id (§20.0 rule 7). The validator catches all of it
with per-error guidance (22 errors on that file).

**A fourth failure (Copilot again, after coaching) got the closest yet** — bare document,
integer ids, correct `source`/`target`+`put` connections — and *still* failed on five details,
each now validator-enforced (16 errors on that file):
1. **`//` comments inside the JSON** → `JSON.parse` fails before the importer even looks at it.
   Emit *pure* JSON, always.
2. Every block **missing `func`** (and `x`/`y`) — `paper.load` applies `func` verbatim, so its
   absence breaks the compiled sketch.
3. CONST `{"value": 2}` instead of `{"initial_value":2,"type":"integer","mode":"single"}`.
4. PULSE_COUNT with invented `{"reset_interval":0}` — the real shape is
   `{"block_func_args":{"periode":…,"type":…,"periode_amount":…}}`, and there is **no
   "never reset"**: the count resets each configured period.
5. PULSE_COUNT's required **"Logic True Level" input (put 1) left unwired** — it must be fed by
   a `CONST` (host `require_type`). Every non-optional input of every placed block needs a wire.
The working translation of that intent (toggle on rising edge) is recipe §19.2 /
`toggle_rising_edge_5440.json` — PULSE_COUNT's **native `flank_rising_edge` mode** → MOD ←
CONST(2), verified live.
