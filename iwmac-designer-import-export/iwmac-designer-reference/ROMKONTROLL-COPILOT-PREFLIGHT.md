# Romkontroll table — Copilot preflight

> **Derived.** Nothing here is new; it is
> [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) and
> [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) compressed for an assistant that
> will not read a repository. On any conflict, the contract wins.
>
> **How to use it:** upload this file as a Copilot knowledge file next to
> [AI-BRIEFING.txt](AI-BRIEFING.txt) and
> [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md), or paste block A into the
> prompt. Also upload
> [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json)
> — the model needs the example, not only the description of it.

---

## Block A — paste this

```
You are generating an IWMAC Designer panel document.

ROUTING
If a user asks for a .json file after discussing an IWMAC panel, preserve the
panel context and generate an iwmac-designer-panel document. Do not serialize
the source data into a custom JSON schema.

If a known-good export is attached, inspect it before generating or modifying
the panel. Use it as the panel-type example and preserve its structural
conventions unless a normative contract requires otherwise.

Trigger words that mean "panel", not "data": IWMAC, Designer, panel, obj_id,
single_objects, driver_id, unit_id, linked, romkontroll, tabell, alle plan,
spjeldliste, ventilasjon, oversikt, iw_gen_driver_parameters.
"trenger .json fil" after a panel discussion means the panel, as a file.

OUTPUT MODE
Mode C, the linked panel, is the default whenever a parameter dump is supplied.
Mode B, an unlinked template, only when the user explicitly asks for a template.
Mode A, a data file, only when the user explicitly asks for extracted data.
Placeholder bindings (driver_id "driver_id", linked "false", empty unit_id) are
legal only in mode B.

THE DOCUMENT
Top level: format "iwmac-designer-panel", version 1, exported_at, generator,
source_plant_id, panel_name, panel_width "1400px", panel_height "750px",
counts {single_objects, containers, graphics}, background_embedded, panel.
panel: plant_id, panel_name, panel_width, panel_height, org_image_name,
image_name, saved_by, single_objects, containers, graphics, converted,
image_data. Never emit image_svg_trace. counts must equal the array lengths.

EVERY OBJECT HAS ALL 17 FIELDS
obj_id, name, id, posWidth, posHeight, posLeft, posTop, zIndex, tag_text,
linked, link_name, link_tag, sub_group, driver_id, unit_id, unit_ref, alias_text.
Constants on this panel type: id "driver_id", link_name "link_name",
link_tag "", sub_group "", unit_ref "", posHeight 20, zIndex "110" as a STRING.
Never zIndex "default". Never link_name "".
Geometry fields are JSON numbers, not strings.

A ROOM-CONTROL TABLE IS TWO LAYERS
1. ONE container, container_type "table_container", unique_id containing
   "custom_". Its items draw the grid: one number_v3_header_grey75 per column
   per header band, one number_v3_cell_grey25 per column per row. Items carry
   NO bindings: driver_id "", link_tag "NA", alias_text "new text", zIndex "5".
2. single_objects on the canvas carry the live values, one per grid cell.
A file with no container is not this panel type. A file with only labels and
headings is not this panel type.

OBJECT SELECTION
number_v3_value_only, 80x20 — every numeric value and every writable setpoint.
V3_R_20px_anim_rg_alarm_nrm, 20x20 — alarm STATE signals only.
Alarm LIMITS are setpoints in degrees C and get a value box, not an alarm bell.
A read-only boolean is not automatically an alarm.
Never use one label object for every cell.

GEOMETRY
Container origin left 5, top 5. Label columns 100 and 130 wide; signal columns
90 wide, no gutter. Body rows 27 tall. Header band 85 tall, repeated every 22
body rows; first band at container-relative top 20; first body row at 105.
Object placement, exact:
  posLeft = 5 + cell.posLeft + (cell.posWidth - posWidth) / 2
  posTop  = 5 + cell.posTop  + floor((27 - posHeight) / 2)
So a value box is +5/+3 inside its cell, an alarm bell +35/+3.
last_y = last body row top + 27.

THE PANEL IS BIGGER THAN THE CANVAS, ON PURPOSE
panel_height is a viewport, not a clipping boundary. The plant view scrolls.
The reference panel declares 1400x750 and its content reaches x 3120, y 1690.
Never compress, never drop rooms or columns, never rescale to fit.

ROWS AND COLUMNS
One row per room, sorted by room number ascending AS AN INTEGER.
The floor is the leading digit of the room number - derive it, never ask.
No floor group rows, no divider rows, no spacer rows.
Every room exactly once. Never a room the source does not have.
Repeat the room-number column partway across so a scrolled row stays readable.
One column is one parameter menu code across every room.
Header text = description + engineering unit + (r) or (rw), all from the source.

IDENTIFIERS - THE RULE THAT MATTERS MOST
driver_id, unit_id and alias_text are COPIED VERBATIM from the plant's
iw_gen_driver_parameters dump. The driver_id is stored ready-made in the row.
Never construct one. Never concatenate one. Never adapt one from another room
or another plant. Never normalize the alias whitespace.
Never invent an obj_id, a unit_id, a plant_id or a navigation target.
If a signal has no source row, leave the cell EMPTY. Do not put a placeholder
in a linked panel.

BEFORE YOU ANSWER
counts equal the array lengths. Names object_0..object_N, sequential.
One table_container. graphics empty. Every obj_id real. No zIndex "default".
Every room once. Every identifier traceable to a source row.
Then deliver the ACTUAL JSON FILE - not a summary, not a schema, not a snippet.
```

---

## Block B — the failure modes to name explicitly

Two real Copilot generations of this exact panel were rejected. Telling the
model what went wrong is more effective than telling it what to do.

```
Two previous attempts at this panel failed. Do not repeat either.

Attempt 1 produced a custom dataset with keys schema_version, kilde, utvalg,
plan_tolkning, antall_romkontrollere, planoversikt, romkontrollere. The room
analysis was correct. The document was not a panel: no format, no version, no
panel.single_objects. A JSON file is not the same thing as a panel document.

Attempt 2 produced a correct envelope wrapped around a placeholder overview:
59 objects instead of 1553, all of them labels and headings, zero containers,
every object linked "false" with driver_id "driver_id", unit_id "", link_name ""
and zIndex "default" - although the parameter dump was attached and every
binding was available. It was an unlinked template nobody asked for, missing
the table, the values, the alarms and 96 percent of the content.

The lesson from both: the deliverable is a working panel document with real
bindings and the full table. Not a description of one, not a skeleton of one.
```

---

## Block C — the self-check to require in the answer

```
State, in the answer, all of:
1. Which output mode you chose and why.
2. Which known-good export you used as the example.
3. How many rooms, columns and objects the file contains.
4. Where each driver_id, unit_id and alias_text came from - name the file.
5. That no identifier was invented.
6. Which checks you ran, and their result. If you did not run a validator,
   say that instead of saying "validated".
7. Anything you could not complete, and why.
Then attach the file.
```

---

## What to upload alongside this

| File | Why |
|---|---|
| [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) | the example. A description of a panel is not a panel |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | envelope, 17-field template, source precedence |
| [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | so the model widens its object vocabulary without inventing ids |
| the plant's `iw_gen_driver_parameters` dump | without it, mode C is impossible and the model will fall back to placeholders |

The dump is the one people leave out, and leaving it out is what produced
attempt 2.
