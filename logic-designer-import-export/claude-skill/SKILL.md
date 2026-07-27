---
name: vv-designer-sketch
description: Generate, validate, debug and explain logic sketches for IWMAC/Kiona's VV Designer (the vv_fbx.qxs "Virtual Values" function-block editor on refrigeration/energy plants) as importable vv-fbx-sketch JSON. Use this whenever the user mentions VV Designer, vv_fbx, IWMAC/Kiona plant logic, a "sketch" of blocks and wires, virtual values, or block types like PARAMV, WRITETOUNIT, VIRTUALOUT, CONST, BIGGERTHAN, DELAY_VARIABLE, COMP_AND, FORMULA or PROCESSIN — and also when they describe plant automation in words ("alarm if the cold-room goes above 8 °C for 15 minutes", "write the outdoor temp to the ventilation unit", "make a reusable process for the curve control") without naming the tool, or paste a Live Simulate log, an import validation report, or a compile error like "Unable to get element ID for". Also use it to READ or review an existing sketch export. The format is a niche in-house contract that generic node-graph assumptions get wrong, so consult this skill rather than inferring the schema.
---

# VV Designer sketch JSON

The VV Designer is IWMAC/Kiona's visual function-block editor for refrigeration and
energy plants. A **sketch** is a dataflow graph that gets compiled and deployed to a
plant's controllers, where it runs continuously — reading live parameters, computing,
raising alarms, and writing setpoints back to hardware.

Your job is to produce **one pure-JSON file** the user imports via
**File → Transfer → Import sketch (JSON)** (the Logic Designer Import/Export
userscript), or to read/debug such a file.

## The one fact that matters

**There is no expression language.** No steps, no script, no conditions-as-text.
Every comparison, every AND, every delay, every alarm, every write is a **separate
block**, and every data flow is a **wire between numeric pins**.

This is worth stating up front because the failure mode here is not carelessness —
it's confidence. Five documented AI attempts produced plausible, well-structured
files built on invented schemas (`logic.steps`, `expression: "enable && temp > limit"`,
`parameterBindings`, camelCase field names) and every one was rejected. Generic
instincts about node-graph JSON are *actively wrong* for this host. If you catch
yourself writing an `expression` string or a `steps` array, stop and convert it to
blocks and wires.

Corollary that has bitten repeatedly: **regenerate from the templates each time**
rather than patching an earlier draft. Corrected mistakes creep back across attempts.

## Workflow

1. **Classify the request.**
   - *Generate* new logic from a description → continue below.
   - *Validate* a file the user has → jump to step 5.
   - *Debug* a pasted Live Simulate log or import report → see [Reading feedback](#reading-what-the-user-pastes-back).
   - *Explain / review* an existing export → read it as a graph; see [Reading sketches](#reading-an-existing-sketch).

2. **Match the request to a recipe** (see [Recipes](#recipes)). Most real requests are
   one of six shapes with different inputs, limits and gates. Pattern-matching to the
   closest shape beats designing from scratch, and it makes the output look like the
   rest of the plant's logic.

3. **Ask once for what you cannot know**: the plant id and the exact parameter driver
   ids. If the user can't supply them, emit TODO-bind blocks rather than guessing —
   see [Bindings](#bindings-what-you-must-never-invent). Never block on this; a file
   full of TODO-bind blocks is useful and is exactly how the fleet's own 449 starter
   templates ship.

4. **Build the file** per the [Contract](#the-contract) and [Block reference](#block-reference).
   Label every block, document every block, lay it out left-to-right.

5. **Validate mechanically — do not skip this.** The skill bundles the same validator
   the userscript's import panel runs:

   ```bash
   node scripts/validate-vv-sketch.js path/to/sketch.json
   ```

   (resolve `scripts/` relative to this skill's directory). Exit 0 = importable.
   Exit 1 = numbered errors, each with its exact fix — apply them and re-run until
   clean. Warnings don't block the import but read them; they usually flag a real
   omission such as an undocumented block or a `data: null` you didn't intend.

   Validate your own output even when you're confident. All five documented failures
   were delivered confidently, and the validator catches every one of them in seconds.

6. **Deliver**: the complete JSON in one code block (or written to a `.json` file),
   then 2–4 short bullets — which blocks import red and need binding, then the
   pipeline: validate → import → configure red blocks → **F10** → save.
   **Deployment and hardware writes are the human's decision.** Never assume them.

## The contract

Pure JSON — no comments, no trailing commas.

```json
{
  "format": "vv-fbx-sketch", "version": 1, "exported_at": "<ISO8601>",
  "source_plant_id": null, "source_sketch_id": null,
  "name": "<short name>", "block_count": N, "connection_count": M,
  "sketch": {
    "mode": "function", "require_plant_revision": 0,
    "blocks": [ ... ], "connections": [ ... ], "groups": []
  }
}
```

`sketch.mode` is required — without it the importer rejects the file outright.
`block_count`/`connection_count` must equal the array lengths.

**Block** — every block carries all of these keys:

```json
{ "id": 0, "type": "BIGGERTHAN", "func": "biggerthan", "compile_type": "function",
  "data": null,
  "override": { "alias_text": "Over grense" },
  "runtime": {},
  "properties": { "documentation": { "alias_text": "", "value": "1–2 sentences" } },
  "output_type": "boolean", "x": 260, "y": 110 }
```

- `id` is an **integer**, unique. Never a string.
- `type` is an UPPERCASE palette key; `func` is copied verbatim per type.
- The on-canvas label lives in `override.alias_text`. There is no `name` or `label` field.
- `override` / `runtime` / `properties` are **block-level siblings of `data`** — never inside it.
- `x`/`y` are required numbers. Sources ≈ 40, logic ≈ 260–500, outputs ≈ 700; rows 120–150 apart.

**Wire** — output pin → input pin:

```json
{ "source": { "id": 0, "put": 0 }, "target": { "id": 2, "put": 0 } }
```

`put` is a 0-based pin index. There are no named pins and no `from`/`to`/`block`/`pin`
keys. Outputs fan out freely; **each input pin takes exactly one wire**, and every
non-optional input needs one.

**Keys that do not exist anywhere** (each has appeared in a failed attempt):
`schema`, `logic`, `steps`, `expression`, `parameterBindings`, top-level
`inputs`/`outputs`, `severity`, `message`, `priority`, `label`, `name`, `blockType`,
`config`, `address`, `value`, `valueType`, `driverId`, `reset_interval`, `from`, `to`,
`block`, `pin`, `writePulse`, `durationMs`.

## Block reference

The types below cover the overwhelming majority of real sketches. For anything else —
exact pin names, pin types, the host's own help text, or the toolbox name a user said
out loud ("Season selector", "Counter Limit", "Variable Delay") — read
**`references/blocks.md`**, which has all 71 blocks.

| type | func | compile_type | data |
|---|---|---|---|
| `PARAMV` | `paramv` | input | `{"driver_ids":["<FULL_ID>"]}` — or `null` to bind later |
| `CONST` | `const` | input | `{"alias_text":"Limit","type":"float","initial_value":8,"mode":"single","eng_unit":"°C","readonly":false,"precision":"%.1f"}` (drop `precision` unless float) |
| `CALENDAR` | `calendar_value` | input | `{"calendar":"<id>","offset":0,"post_offset":0}` or `null` |
| `BIGGERTHAN` / `BIGGERTHANOREQUAL` | `biggerthan` / `biggerthanorequal` | function | `null` — 2 numeric inputs, boolean out |
| `SMALLERTHAN` / `SMALLERTHANOREQUAL` | `smallerthan` / `smallerthanorequal` | function | `null` |
| `LIKE` / `UNLIKE` | `like` / `unlike` | function | `null` — equality / inequality |
| `COMP_AND` / `COMP_OR` | `comp_and` / `comp_or` | function | `null` — 2+ boolean inputs |
| `INVERT` | `invert` | function | `null` — boolean NOT, 1 input |
| `ADD`/`SUBTRACT`/`MULTIPLY`/`DIVIDE`/`MOD`/`AVERAGE` | same lowercase | function | `null` |
| `MIN` / `MAX` | `comp_min` / `comp_max` | function | `null` |
| `IF` | `if` | condition | `null` — put0 Condition, put1 Value; passes Value only while true |
| `SELECTOR` | `selector` | function | `{"output_type":"integer"}` — put0 bool, put1 if-true, put2 if-false |
| `DELAY_VARIABLE` | `alarm_multi_delay` | function | `null` — put0 value, **put1 = CONST seconds (required)**, put2 optional |
| `LATCH` | `latch.run` | function | `null` — put0 set, put1 reset |
| `FORMULA` | `formula` | function | `{"formula":"inp0*1.8+32","output_type":"float","title":"…","precision":"%.1f"}` |
| `PULSE_COUNT` | `pulse_count` | function | `{"block_func_args":{"periode":"day","type":"flank_rising_edge","periode_amount":1}}` — put0 signal, **put1 = CONST level (required)** |
| `TOGGLE_INTERVAL` | `toggle_interval.run` | function | `{"block_func_args":{"interval":"min","offset":0}}` |
| `HOURMETER` | `hourmeter.run` | function | `null` — accumulated seconds |
| `ALARM` | `alarm` | output | `{"alias_text":"<text>","pri":"a","alarm_type":"general","alarm_destination":"general"}` |
| `VIRTUALOUT` | `virtualout` | output | `{"alias_text":"Kalk …","type":"float","engineering":{"unit":"°C"}}` |
| `WRITETOUNIT` | `set_unit_value` | function | `{"force_write":false,"delay":0,"limit_count":false,"count":1,"driver_ids":["<FULL_ID>"]}` |

**Types that do not exist** — translate on sight:
`EQUAL`→`LIKE` · `GREATERTHAN`→`BIGGERTHAN` · `LESSTHAN`→`SMALLERTHAN` ·
`AND`/`OR`/`NOT`→`COMP_AND`/`COMP_OR`/`INVERT` · `CONSTANT`→`CONST` ·
`WRITE`/`WRITEOUTUNIT`/`DIGITAL_OUTPUT`→`WRITETOUNIT` ·
`DIGITAL_INPUT`/`ANALOG_INPUT`/`READ`/`SENSOR`→`PARAMV` · `TIMER`→`DELAY_VARIABLE` ·
`COUNTER`→`PULSE_COUNT` · `SR_LATCH`→`LATCH`.

`RISING_EDGE` and `TOGGLE` have no block at all — they are compositions (see R2).

**`block_func_args` inner keys differ per type and the spellings are the contract, not
typos**: `PULSE_COUNT` uses `periode`/`type`/`periode_amount`; `PERIODE_VALUE` uses
`mode`/`periode`/`period_amount`; `AVG_IN_PERIOD` uses `period`/`period_amount`;
`TOGGLE_INTERVAL` uses exactly `interval`/`offset`. Copy them per type.

**FORMULA** is the only place an expression exists, and it runs server-side in PHP over
`inp0…inpN-1` (0-indexed by wired pin). Arithmetic, `%`, comparisons (`==` for equality),
ternary `?:`, `and`/`or`, `min max abs round floor ceil sqrt pow`, `time()`, `date('W')`,
plus PHP stdlib (`intval`, `floatval`, `substr`, `strpos`/`stripos`, `strtotime`,
`rand(min,max)`). The magic variable `state` is the formula's **own previous output** —
`(inp0 >= inp1 ? 1 : (inp0 < inp2 ? 0 : state))` is a complete hysteresis in one block.
No `if(){}` blocks, no bare `pi`/`e`. A formula with more than one input must declare
`properties.input_count = {"alias_text":"Input count","value":N}` where N equals the
wired-input count — otherwise the extra pins don't exist and wires to them are silently
dropped.

## Recipes

Most requests are one of these with different inputs, limits and gates.

- **R1 — Threshold alarm with persistence** (the workhorse):
  `PARAMV → BIGGERTHAN ← CONST(limit)` → optional `COMP_AND ← CALENDAR` →
  `DELAY_VARIABLE ← CONST(seconds on put 1)` → `ALARM`. Use `SMALLERTHAN` for "below".
- **R2 — Toggle on rising edge**: `PARAMV → PULSE_COUNT(flank_rising_edge) ← CONST(1)`
  → `MOD ← CONST(2)` → `VIRTUALOUT`. The count resets each configured period, so parity
  can flip at the boundary — widen the period if that matters.
- **R3 — Hysteresis / hold until reset**: `comparator(high) → LATCH.put0 (set)`,
  `comparator(low) → LATCH.put1 (reset)`. One-block alternative: the `state` formula above.
- **R3b — Enable switch** (the fleet's most common `IF` usage, 69 % of gates):
  a labelled boolean `CONST` → `IF.put0`, the value → `IF.put1` → write. This gives the
  customer a hand-flippable on/off for the whole behaviour — prefer it over hardcoding
  an always-on write.
- **R4 — Pick setpoint by condition**: condition → `SELECTOR.put0`, two `CONST`s on
  put1/put2 → output.
- **R5 — Computed KPI**: readings → arithmetic or `FORMULA` → `VIRTUALOUT`.
- **R6 — Parameter bridge**: `PARAMV → WRITETOUNIT`. The smallest real sketch (2 blocks,
  1 wire) and one of the most common; several `driver_ids` in one `WRITETOUNIT` fan the
  same value to many parameters.

## Bindings — what you must never invent

Driver ids exist only on the actual plant. They look like
`5440_AK3_AKC_0_1_0_0_2576` — the leading digits are the plant id, and **only that
prefix is a reliable contract** (device names contain underscores; 7- to 106-segment ids
are all real). Never parse, construct or "correct" one; copy it verbatim from the user.

When you don't have the id:

```json
"data": null, "override": { "alias_text": "TODO bind: room temperature" }
```

The block imports with a red title and the user binds it through the normal dialog.
An empty `"driver_ids": []` is *worse* than `null` — it means "configured with nothing".

A unit/device address like `000:001` or `IWT01` is a **unit**, not a parameter — it can
never be a binding. If the user gives only a unit, leave the binding TODO and say which
unit to pick from.

`WRITETOUNIT` writes to real hardware when deployed. Include it only when the user
explicitly asked to write **and** supplied a confirmed target; otherwise use
`VIRTUALOUT`, which stores the value safely as a new plant parameter.

## Make it look like production

These come from a census of ~668 plants / 3,618 sketches. Matching them is what makes
generated logic read as native rather than machine-produced.

- **Label every block** (`override.alias_text`) — 73 % of production blocks are labelled.
  `VIRTUALOUT` names conventionally start with **"Kalk"** (kalkulert); `CONST` names are
  role words: "Delay when true", "Limit", "Settpunkt komfort", "X1".."Y4", "Bryter 0-Av 1-På".
- **Document every block**: `properties.documentation = {"alias_text":"","value":"…"}` —
  1–2 sentences on the block's role in *this* sketch, why this limit or delay, and what
  the user must bind. It surfaces under right-click → *Edit documentation*, so the import
  explains itself. (Exception: when regenerating an existing sketch, keep any `#ew.*`
  values verbatim — EcoWatcher parses those machine tags.)
- **ALARM priority** is only `a`/`b`/`c`. `a` + `general` is the fleet norm (79 % / 91 %).
  Alarm text reads like a drawing-referenced fault, in the plant's language:
  `"360.003 Ingen Kommunikasjon I/O Modul Nr.3"` — short statements, not sentences.
- **`WRITETOUNIT` defaults** `force_write:false`, `delay:0`, `limit_count:false`,
  `count:1` are near-universal — emit exactly those.
- **`eng_unit`**: `&deg;C` (the HTML entity is the *most* common form), `°C`, `%`, `min`,
  `K`, `sek`, `kWh`, `ppm`. Both degree forms are real.
- **Sketch names** read like drawing labels in the plant's language: "Kurvestyring",
  "Snøsmelt styring", "360.001 Sandstadkurve".
- **`require_plant_revision`**: 620 if `IF`/`WEATHER`/`AGE_OF_VALUE` is used, else 0.
  Higher floors: `CALENDAR_2_0` 1460, `OPTIMAL_START_STOP` 1543, `SPOT_PRICE*` 1670,
  `LATCH`/`RESET_INPUT`/`PID_CONTROLLER` 1683.
- Production logic is **shallow and wide** — 71 % of sketches have a longest path of ≤ 4
  blocks. Big sketches grow by stamping parallel rows, not deeper chains. If your graph
  is getting deep, consider splitting it across sketches chained through `VIRTUALOUT`
  (21 % of production sketches read another sketch's virtual output).

## Process mode

If the user asks for a **reusable process** (a library block parametrised by pins)
rather than plant logic, three things change:

- `sketch.mode` is `"process"`, and the user imports it in Process Mode.
- **`PARAMV` and `TAGVALUE` are illegal.** A process reads plant data through a
  `PROCESSIN` pin (`func:"processin"`, `compile_type:"reference"`,
  `output_type:["mixed"]`). Its `data` varies by method — `parameter`, `constant`
  (a tweakable setting; `initial_value` is a **string** even for numbers), `tag`,
  `enable`, `calendar`.
- Outputs are `PROCESSOUT` pins. **Zero `PROCESSOUT`s is valid and common** — 61 % of the
  fleet library are "effect" processes whose `ALARM`/`VIRTUALOUT`/`WRITETOUNIT` lives
  inside them.

The interior is ordinary function blocks. Read `references/briefing.txt` §7b and
EXAMPLE 9 in `references/examples.txt` for the full contract before generating one.
After import the user does **Save process → Publish process** to make it a library block.

## Reading what the user pastes back

**A Live Simulate log** is self-contained. `SUMMARY` states outcomes in plain language
(which alarms would fire, what each write would write, which inputs silently defaulted
to 0). `WHAT THE ERRORS MEAN` translates each error to a fix — apply exactly those and
don't guess further. `FLOW` traces every input pin (`in0 <- PARAMV (0) = 12`), so for a
run that completed but behaved wrong, find the wrong sink in SUMMARY and walk FLOW
backwards until the first unexpected value; the defect is at that block or wire.
`BLOCKS`/`WIRES` is the current canvas — regenerate your corrected file **from that**,
as one complete file, never a diff.

Inputs listed as "defaulted to 0" usually mean the *user* forgot a panel value — point
that out before changing any logic.

**An import validation report** numbers each problem with its fix. Apply them and return
one complete corrected file.

**A compile error** shaped `"Unable to get element ID for <unit> (<TAG>) for block id N"`
is a **binding** problem — a stale unit or deleted tag on that block — never a
sketch-JSON problem. F10 passes while compile fails in exactly this case.

## Reading an existing sketch

When analysing rather than generating, expect things generators shouldn't emit:

- `data.driver_id` (singular string) is the **majority** in the fleet — accept both it
  and the plural array; only ever generate the plural.
- Block ids are **not compact** — 70 % of sketches have gaps from edit history. Never
  renumber when editing; new blocks take `max(id)+1`.
- Unwired helper blocks are normal clutter (27 % of sketches), not an error.
- A process instance with no outgoing wires is usually an effect process, not dead logic.
- Non-empty `groups` (visual boxes) are rare but real — preserve them when round-tripping.
- Very old documents omit `compile_type` on process instances; treat "type not in the
  palette + `func` == lowercase(type)" as a process instance.

## Reference files

Read these when the inline material doesn't cover the case:

| file | when to read it |
|---|---|
| `references/examples.txt` | **Before generating anything non-trivial.** Nine complete files — seven verbatim production exports, an authored template, and a verified process definition. Pattern-match to the closest one and keep its structure. |
| `references/blocks.md` | Exact pins, pin types, host help text, or the toolbox-name → type-key mapping for all 71 blocks. |
| `references/briefing.txt` | The full allowlist with every `data` payload, the complete prohibition list, and the five documented failure cases. Read when working with a block not in the table above. |
| `references/vv-sketch.schema.json` | JSON Schema (draft-07) for editor/CI validation. The bundled validator is stricter — prefer it. |
