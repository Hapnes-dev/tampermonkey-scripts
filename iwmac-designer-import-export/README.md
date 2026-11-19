# IWMAC Designer Import/Export

A Tampermonkey userscript for the IWMAC Designer. It adds a **Panel JSON** section to the Designer's sidebar, under
*Manage Files*, with four buttons:

| Button | What it does |
|---|---|
| **Export JSON** | Downloads the loaded panel as one `.json` file: its objects, containers, graphics and background picture, byte for byte. The file also holds the plant's units and parameter rows, for an AI agent. |
| **Insert JSON…** | Puts such a file on the open panel, on the same plant or another. **Replace** gives an exact copy, **Add** merges. A file from another plant can have its driver ids rewritten to this plant. |
| **Edit in VectorCraft…** | Opens the panel's picture and objects in a vector editor in the browser. **Vectorize image** turns a picture of pixels into an editable drawing. **Ctrl+S** there brings the result back to the Designer. |
| **Background → Illustrator** | Exports the background as a file Adobe Illustrator edits directly, an `.ai` with the panel's objects on a hidden layer. |

It also adds **EXPORT XLSX** to the Parameter Selector: the whole parameter list of one unit, or of several ticked
units, as an Excel file.

## Install

👉 [**Install IWMAC Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js)

- **Requirements:** Tampermonkey in Chrome. The script updates itself on every `@version` bump.
- **Where it runs:**
  - in the Designer, at `http(s)://legacy.iwmac.local/iwmac_designer_v4/?plant_id=<id>`, on the IWMAC network or VPN;
  - in the hosted editor, `https://hapnes-dev.github.io/iwmac-vector/app/`. Tampermonkey asks once to allow it.

## Copy a panel to another panel or plant

1. On the source plant, load the panel (*Retrieve → Load*), then click **Export JSON**.
2. On the target plant, create or load a panel, then click **Insert JSON…** and pick the file.
3. Answer its questions:
   - for a file from another plant, whether to rewrite the driver-id prefixes;
   - for a panel that already has objects, **Replace** or **Add**.
4. Save with the Designer's own buttons: *Compile Panel for Plant*, then *Sync Panels with Plant*.

## Edit the background as vectors

1. Load the panel and click **Edit in VectorCraft…**. A new tab opens the panel as layers: the picture, any drawing,
   and the panel's objects as placeholders.
2. A picture with no drawing can be read into one with **Vectorize image**: its words become labels, and the objects it
   shows become objects.
3. Edit it, then press **Ctrl+S** in VectorCraft. The new picture is uploaded to the plant's pictures, and the panel's
   objects follow the edit.
4. Save the panel with the Designer's own buttons.

## What it never does by itself

- **Export** only reads.
- **Insert** and **Replace** change only the screen. Reloading without saving brings the old panel back.
- The one upload is the picture that **Ctrl+S** in VectorCraft sends. The panel itself is kept only when you save it in
  the Designer.
- **Every insert is counted afterwards.** The toast is green when every object arrived and red when any did not.
- **A file that is not a panel, or a broken one, is refused** with an explanation, and the canvas is left as it was.

## Claude and Copilot

- **Claude in VectorCraft:** a small MCP server, [`claude-bridge/`](claude-bridge/README.md), lets Claude Code read and
  edit the panel open in VectorCraft. Saving stays yours.
- **AI-generated panels:** Insert JSON also takes files an AI made from a P&ID or a description. Their format is in
  [`panel-file.schema.json`](panel-file.schema.json).

## More

Everything else is in [`docs/REFERENCE.md`](docs/REFERENCE.md):
- the file format;
- each feature in detail;
- how the script works with the Designer;
- the notes of every release.
