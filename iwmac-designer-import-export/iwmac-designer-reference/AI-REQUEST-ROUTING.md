# AI request routing — what kind of file does this request want?

> **Read this first.** It is the only document in this repository that decides
> *what to produce*. Everything else decides *how to produce it*. Scope:
> `GLOBAL` — every panel type, every assistant, every model.
>
> If you read nothing else here, read §1 and §2. They are sufficient to route
> correctly; §3 onwards refines the choice.

## Search terms — this page answers to all of these

`romkontroll` · `room control` · `romkontroll alle plan` · `all floors` ·
`tabell` · `tabell romkontroll` · `table panel` · `list panel` · `spjeldliste` ·
`damper list` · `ventilasjon` · `ventilation panel` · `oversikt` · `maskin` ·
`IWMAC` · `IWMAC Designer` · `IWMAC Designer JSON` · `Designer import` ·
`Designer Import/Export` · `userscript import` · `IWDIE` · `Insert JSON` ·
`Export JSON` · `panel JSON` · `panel document` · `single_objects` · `obj_id` ·
`driver_id` · `unit_id` · `unit_ref` · `alias_text` · `linked panel` ·
`linked signals` · `unlinked template` · `table_container` ·
`parameter SQL` · `iw_gen_driver_parameters` · `parameterdump` ·
`generer en tabell` · `lag et panel` · `trenger .json fil` ·
`create a panel from this SQL export` · `make an IWMAC Designer JSON panel` ·
`use this good panel as the example`

Norwegian and English are interchangeable throughout. A request in Norwegian
routes exactly like its English equivalent.

---

## 1. The routing trigger

> `GLOBAL` **A request for "a JSON file" in an IWMAC context is not a request
> for a generic JSON export.** It is a request for an **IWMAC Designer panel
> document** — `format: "iwmac-designer-panel"`, with `panel.single_objects`.

Route to panel generation if **any one** of these appears in the request, in
the conversation that precedes it, or in an attached file:

| Signal | Examples |
|---|---|
| the product | IWMAC, IWMAC Designer, Designer Import/Export, IWDIE, userscript, Insert JSON, Export JSON |
| the artefact | panel, panel JSON, panel document, `single_objects`, `containers`, `graphics` |
| a schema field | `obj_id`, `driver_id`, `unit_id`, `unit_ref`, `alias_text`, `link_name`, `posLeft`, `tag_text` |
| a binding concept | linked signals, linked panel, unlinked template, link the objects, parameter binding |
| a panel type | room-control table, romkontroll, romkontroll alle plan, ventilation panel, ventilasjonspanel, list panel, spjeldliste, oversikt, maskin |
| a source artefact | `iw_gen_driver_parameters`, parameter dump, plant export, an attached panel `.json` |

One signal is enough. They do not need to co-occur.

### 1.1 The two verbatim route statements

Quote these when a shorter answer is needed, and paste them into any assistant
that will not read a whole document:

> **If a user asks for a .json file after discussing an IWMAC panel, preserve
> the panel context and generate an iwmac-designer-panel document. Do not
> serialize the source data into a custom JSON schema.**

> **If a known-good export is attached, inspect it before generating or
> modifying the panel. Use it as the panel-type example and preserve its
> structural conventions unless a normative contract requires otherwise.**

### 1.2 Context inheritance

`GLOBAL` A short follow-up inherits the previous turn's task. "trenger .json
fil", "send den som fil", "kan du lage filen", "now as JSON", "give me the
file" after a panel discussion all mean **the panel, as a file** — never "the
data I just described, serialized".

This is the exact failure recorded in
[ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) §13.1:
a correct room analysis emitted as a custom dataset with keys `schema_version,
kilde, utvalg, plan_tolkning, antall_romkontrollere, planoversikt,
romkontrollere`. It was not a panel and the importer rejected it. The analysis
was right; the routing was wrong.

### 1.3 When it really is a data request

Produce a plain data file **only** when the user explicitly asks for one:
"extract the data", "give me the parameters as JSON", "an API payload", "a data
table", "a CSV/JSON of these rows", "not a panel — just the data". Absent such
wording, a JSON request in this context is a panel request.

If genuinely ambiguous: **say which one you are producing in the first
sentence**, and offer the other. Do not silently pick the cheaper one.

---

## 2. Which panel type

Run in order; the first match wins. Each row names the one file that owns the
rest of the decision.

| # | Test | Panel type | Owner |
|---|---|---|---|
| 1 | A panel JSON is attached to the task | whatever that file is | inspect it first — it outranks every document (precedence rank 1) |
| 2 | "romkontroll" **and** ("tabell" / "table" / "alle plan" / "all floors" / "alle rom") | room-control table | [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) |
| 3 | "romkontroll" with a floor plan, room cards, or one floor at a time | Romkontroll floor plan | [AI-BRIEFING.txt](AI-BRIEFING.txt) §7d |
| 4 | "spjeldliste", damper list, or a repeating row of identical cells built one container per row | spjeldliste list panel | [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) |
| 5 | ventilation, aggregat, ventilasjon, AHU | ventilation panel | [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) |
| 6 | oversikt, overview, plant landing page, navigation | oversikt panel | [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) |
| 7 | maskin, kjølemaskin, chiller, heat pump | maskin panel | [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) |
| 8 | none of the above | ask, or state the assumption | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |

`GLOBAL` **Never generate a panel type by analogy with another one.** The
families differ in ways no amount of care recovers: the spjeldliste uses one
container per row, the room-control table uses one container for the whole
grid, the Romkontroll floor plan uses no container at all. Picking the nearest
document and adapting it produces a file that inserts and is wrong.

---

## 3. Which output mode

`GLOBAL` Three modes. Choose **before** writing any object, and say which one
you chose.

| Mode | Output | Choose when |
|---|---|---|
| **A — data-only JSON** | a custom structure describing the source data | the user explicitly asked for extracted data, an API payload, or a data table (§1.3) |
| **B — unlinked Designer template** | a valid panel document with `driver_id: "driver_id"`, `linked: "false"`, `unit_id: ""` | the user explicitly asked for a reusable template or unlinked skeleton, **or** no binding data exists for this plant |
| **C — linked Designer panel** | the same document with every identifier copied from the source | binding data exists — this is the default |

> `GLOBAL` **Default rule.** A request built on an attached plant parameter
> export, with enough binding data to resolve the signals, produces the
> **linked panel (mode C)**.

Mode B is a **complete panel with the bindings withheld** — same columns, same
rows, same object types, same geometry. It is not a reduced panel. A skeleton
that also drops the container, the value objects and 96 % of the rows is not
mode B; it is failure §13.2 of the Romkontroll contract.

Placeholder binding values (`"driver_id"`, `linked: "false"`, empty `unit_id`)
are legal **only** in mode B, and only because the import contract requires
them ([AI-BRIEFING.txt](AI-BRIEFING.txt) §3). In mode C they are an error.

If binding data covers only part of the panel: emit mode C for what is bound,
leave the rest **empty** rather than placeholdered, and name exactly what could
not be bound. Do not downgrade the whole file.

---

## 4. Do not invent — normative, all panel types

`GLOBAL` These are rejection criteria, not advice.

1. **Never invent an `obj_id`.** It must appear in
   [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md), or — for host-generated
   table-cell types — in `reference_data/controls-registry.json`. A plausible
   name is not an object.
2. **Never invent a `driver_id`.** Copy the exact string from the parameter
   source. Never construct, concatenate, pattern-match from another row, or
   adapt one from another plant.
3. **Never invent a `unit_id`, `unit_ref`, `plant_id` or `source_plant_id`.**
4. **Never invent a navigation target** — a panel id, a link target, a URL.
   Without evidence that the target exists, do not create the link.
5. **Never derive an identifier** unless an authoritative contract states the
   algorithm *and* the result is verifiable against the source data.
6. **Never mark an object linked without a verified binding.** `linked` is host
   behaviour, not a claim (`V3scripts.js:514`).
7. **Never replace a real identifier with a placeholder** to make a file
   "safe", "generic" or "shorter".
8. **Never invent geometry to fill a gap.** A missing signal leaves an empty
   cell; a missing measurement stops the work.
9. **A successful JSON parse is not proof of usability.** Both rejected
   generations parsed.
10. **Never call a file corrected, fixed, production-ready or validated unless
    validation actually ran** and you can name the validator and its output.

When the information needed for a binding does not exist: generate an
explicitly unlinked template **if one was asked for**, otherwise report that
the linked panel cannot be completed and say precisely what is missing.
[AI-BRIEFING.txt](AI-BRIEFING.txt) §0: *when the evidence does not exist, say
so.*

---

## 5. Before generating

`GLOBAL` The short form. The panel-type authoring guide carries the full
checklist — for the room-control table,
[ROMKONTROLL-AUTHORING-GUIDE.md](ROMKONTROLL-AUTHORING-GUIDE.md) §2.

1. Is this a panel document or a data file? (§1)
2. Which panel type? (§2)
3. Is a known-good export of that type attached or in `reference_data/`?
   **Inspect it before generating.**
4. Which file owns the document shape? — [AI-BRIEFING.txt](AI-BRIEFING.txt) §2–§3.
5. Which file owns the geometry? — the panel type's contract.
6. Which file owns `obj_id` selection? — the catalogue, plus the type's role table.
7. Mode A, B or C? (§3)
8. Where do `driver_id` and `unit_id` come from, row by row?
9. Is every identifier source-backed? (§4)
10. Does the panel need a background, and containers?
11. Does the content exceed the viewport, and is that expected? (It usually is.)
12. Which validator will run, and with which flags?
13. Do `counts` match the array lengths?
14. Does every entity in the source appear exactly once?
15. Is anything in the file a guess? If yes, remove it or mark it.

## 6. After generating

`GLOBAL`

1. Run the panel type's validator with `--check`. Zero errors.
2. Run `--compare` against the known-good export when one exists. Explain every
   structural difference.
3. Run `--profile` only when the panel is for the same plant as the profile.
4. Confirm `counts` equals the three array lengths.
5. Confirm no identifier was invented, and say so explicitly.
6. **Return the actual downloadable JSON file** — not a summary, not a schema,
   not a snippet, not a description of what the file would contain. A panel
   that is described but not delivered is not a deliverable.

---

## 7. Owners

| Question | File |
|---|---|
| What to produce | **this file** |
| Host and userscript behaviour | [CLAUDE.md](CLAUDE.md) |
| Document shape, the 17 object fields, source precedence | [AI-BRIEFING.txt](AI-BRIEFING.txt) |
| A one-screen brief for a model with no repository access | [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) |
| Which panel type is which | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| Valid `obj_id` values | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| Room-control table geometry and bindings | [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) |
| Spjeldliste list panels | [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) |
| Ventilation, oversikt, maskin | the matching `*-GENERATION-CONTRACT.md` / `*-GEOMETRY-CONTRACT.md` |
| Why a rule exists | [documentation-change-log.md](documentation-change-log.md) |
