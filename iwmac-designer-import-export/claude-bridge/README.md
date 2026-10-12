# Claude in VectorCraft: the iwmac-vectorcraft MCP server

`iwmac-vc-mcp.js` lets Claude Code read and change the IWMAC Designer panel that is open
in VectorCraft through **Edit in VectorCraft…**. Claude sees the drawing as a table of
symbols, objects, pipes and text with their boxes, looks at it as a picture, and sends
edits: house symbols, rows of compressors, value pills with their objects, pipes routed
between equipment by circuit, text, moves, alignment. The IWMAC Designer Import/Export
userscript (1.64.0 or later), running in the VectorCraft tab, makes every change there and
opens the result as a new VectorCraft document. Nothing reaches the Designer until you
review it and press **Ctrl+S**, as with any edit.

No dependencies; Node 18 or later.

## Set up

1. Add the server to Claude Code, in the project you work from (`.mcp.json`):

   ```json
   {
     "mcpServers": {
       "iwmac-vectorcraft": {
         "command": "node",
         "args": ["C:\\path\\to\\tampermonkey-scripts\\iwmac-designer-import-export\\claude-bridge\\iwmac-vc-mcp.js"]
       }
     }
   }
   ```

   or once, for every project: `claude mcp add iwmac-vectorcraft -- node <path to iwmac-vc-mcp.js>`.
   A project server must also be allowed (`enabledMcpjsonServers`, or answer the prompt).
2. **Restart Claude Code.** It starts the server with the session; tools appear only in a
   session started after the change.
3. Update the userscript to 1.64.0. In the IWMAC Designer, open a panel and click **Edit in
   VectorCraft…**. The first time, Tampermonkey asks whether the script may reach
   `127.0.0.1`: choose to always allow it.
4. The editor's banner has a **Claude** row: *connected* when the tab has found the server.
   Ask Claude in Claude Code, for example: *"Add three compressors after MT3, connect them to
   the gas cooler on the HP circuit, and put the energy meter's kW and kWh in the
   information column."*

The `iwmac-vectorcraft` Claude skill holds the IWMAC knowledge Claude works by: the Maskin
layout, circuits and colours, which house symbol is which equipment and where its pipes
join, which object shows which parameter, and the binding grammar.

## What happens, from plant to picture

| Step | Who |
|---|---|
| Open the panel, Edit in VectorCraft | You |
| The picture opens as layers, the objects as placeholders, the plant's parameter rows read | Userscript |
| The tab attaches to the server and tells it the plant, panel, kept symbols, object kinds and rows | Userscript |
| Read the drawing (`iwmac_scene`), its conventions (`facts`), a preview; the plant's rows; an Export JSON; documentation you give | Claude |
| Plan and make the change; it opens as `<name> · Claude N.svg`, the version before kept | Claude, through the userscript |
| `iwmac_check`: what would be wrong on the live panel | Claude |
| Review in VectorCraft; Ctrl+S | You |
| Background set, PNG uploaded to the plant's pictures, new objects created, bound ones linked | Userscript, as every sync |

## The tools

| Tool | Does |
|---|---|
| `iwmac_status` | Whether a tab is attached, and its plant, panel, library and units |
| `iwmac_scene` | The drawing as rows (`cid, kind, name, x, y, w, h, note`), filtered by layer, kind, area or words; `facts: true` adds the drawing's own layout: rows of like symbols and their spacing, the information column, circuits, value offsets, text style |
| `iwmac_preview` | A JPEG of the drawing, or of a box of it |
| `iwmac_find` | House symbols (sizes, ports), object kinds, the plant's parameters with the exact binding text |
| `iwmac_edit` | A batch of ops: `symbol`, `bank`, `object`, `value`, `pill`, `box` (an object's empty anchor, or a panel of the information column), `pipe`, `connect`, `text`, `move`, `delete`, `set_text`, `bind`, `align`, `distribute`; `dry_run` plans only |
| `iwmac_check` | Objects off the panel or on each other, symbols missing or standing in for objects, values without pills, overlaps, diagonal pipes, flow arrows not on a pipe running their way, drawn numbers, bindings to nothing |
| `iwmac_undo` | Opens the version before Claude's last edit again |
| `iwmac_export` | Reads an Export JSON file on this computer, part by part, without its picture |

A place is `{x, y}`, `{cx, cy}` or `{near: target, side, gap, align}`, with `free: true`
to slide to the nearest free spot. A bank placed next to one of a row of the same symbol
carries that row on, at its spacing. `connect` routes an orthogonal pipe between two
ports (a compressor's `out` on top, a gas cooler's `in` on its left, a motor valve's at its
knot) and colours it by circuit: HP, Liquid, MT suction, LT suction, Heat recovery.

Claude reads tables, not SVG: a scene of a full Maskin is a few kilobytes, and an edit
sends only its ops.

## Safety

- **Claude cannot sync.** There is no tool for it. Each edit opens as a new document; the
  original stays in its tab. Ctrl+S is yours, and the sync keeps its own guards: it never
  writes over a picture it did not upload.
- **One drawing at a time.** A change is refused unless Claude read that very drawing
  (`iwmac_scene`) first. If another VectorCraft tab took Claude over in between, with
  another panel or plant, the change is refused with what is open now.
- **Two open edits do not trade Claude.** The tab opened last has it. The other says
  *with another VectorCraft tab* and does not take Claude back by itself; its **bring
  Claude here** does.
- **Only the userscript can talk to the port.** The server listens on `127.0.0.1` only. A
  request must name `127.0.0.1` or `localhost` as its host (no DNS rebinding), carry the
  `X-IWDIE-Bridge` header and no web page's `Origin` (a page cannot send that header
  without a preflight, and none is answered), and, after the attach, the session's token.
- **Nothing is read but what the tools name.** `iwmac_export` reads `.json` files only,
  and only reads. The tab sends no cookies, passwords or tokens: the plant, the panel, the
  symbol and object catalogues and the parameter rows of the units in scope.
- What Claude reads becomes part of the Claude conversation, like anything you show it.

## When it does not work

| You see | Do |
|---|---|
| Claude row: *not running* | Claude Code is not running the server: restart Claude Code after adding it. |
| `iwmac_status`: port *in use* | Another Claude Code session has the bridge. Work there, or end it: this one takes the port over by itself. |
| *did not answer in N s* | Bring the VectorCraft tab to the front. The browser pauses a hidden tab's drawing. |
| A red dashed box where a symbol should be | The component library kept in this browser lacks it: import the Maskin template's `.ai` under Components in the banner, then Edit in VectorCraft again. |
| Values placed but not linked after the sync | The banner says why per object: no such parameter in that unit, an alias two units share, a unit whose rows were not read. |

The server's port is 47913 (`IWDIE_BRIDGE_PORT` moves it; the userscript then needs the
same number in its storage key `iwdie.vc.bridge.port`).

## Tests

The kit's `tests/test-claude-bridge.js` (private documents repository) holds the pure
part (ports, routing, free places, facts, the check, the plan, the markup) and the server
itself: the MCP handshake, the guards, attach and take-over, the drawing guard, calls a
fake tab answers, the image, the export, and a second session taking the port over. It was
run end to end against the VectorCraft web build in the stub Designer: scene, preview, a
bank continuing the drawing's own row, pipes into the gas cooler, a bound value, check,
move, undo, and a second tab taking Claude over and giving it back.
