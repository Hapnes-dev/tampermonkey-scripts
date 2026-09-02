# MD-To Bulk Convert

Drag a whole folder of Markdown files onto [md-to.com](https://md-to.com/) and get every one back as `.docx`, packed into a single ZIP.

[**Install**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/md-to-bulk-convert/MD-To-Bulk-Convert.user.js) · requires [Tampermonkey](https://www.tampermonkey.net/)

md-to.com converts one file at a time. This adds the missing bulk path.

## Where it runs

| Page | What you get |
|---|---|
| `https://md-to.com/` | Drop a folder on the hero box (or anywhere) — converts with the default Word template |
| `https://md-to.com/markdown-to-word/` | Same, and the template you picked on the page is applied to every file |

## How to use

1. Open either page above.
2. Drag a folder (or a pile of `.md` files) anywhere onto the page. A drop overlay appears and the panel opens with everything it found.
   *Or* click the **📁 Bulk convert** button bottom-right and use **Choose folder** / **Choose files**.
3. Untick anything you don't want.
4. Hit **Convert** — you get one ZIP.

Picked up: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx`, `.txt`.
Skipped: dotfiles, dot-folders, `node_modules`, `.git`, `.svn`, `.obsidian`, `__pycache__`. Cap of 500 files per run.

## Options

Remembered in `localStorage` between visits.

| Option | Default | Effect |
|---|---|---|
| Download as one ZIP | on | Off = each `.docx` downloads separately (Chrome will ask to allow multiple downloads) |
| Keep folder structure | on | ZIP mirrors the folder tree. Off = flat, with `name (2).docx` for collisions. Only meaningful with ZIP on |
| Catch drops anywhere on the page | on | Off = the site's own single-file drop behaviour is left alone; use the panel's own drop zone instead |

The ZIP is named after the dropped folder (`mydocs.zip`), or `markdown-docx-YYYYMMDD.zip` when the source isn't a single folder.

## How it works

md-to.com does its conversion **entirely in the browser** — the page module runs
`generateDocx(markdown)` → `Packer.toBlob(doc)` → `saveAs(blob, name)` with no server
round-trip. This script imports that same module and drives it in a loop, so bulk output is
byte-for-byte the conversion the site would have produced: same renderer, same template, no
API and no rate limit. Nothing is uploaded anywhere.

Two details make that robust:

- **The module URL is content-hashed** (`_astro/docx-generator.<hash>.js`) and changes on every
  deploy. The script reads the page's own `<script>` tags to find whichever hash is current. On
  the home page — which doesn't load the converter — it fetches `/markdown-to-word/` and reads
  the script list out of that HTML instead.
- **The exports are minified to single letters.** They're identified by shape, not name:
  FileSaver carries `.saveAs`, Packer carries `.toBlob`, and the remaining function is the
  generator — confirmed by generating a throwaway document with it before use.

If md-to.com is ever rebuilt in a way that breaks this, the panel says so plainly rather than
producing wrong files.

Everything else is self-contained: the ZIP is written by ~60 lines of stored-mode ZIP writer in
the script. A `.docx` is already a compressed ZIP, so deflating it again would buy nothing and
cost a dependency. `@grant none`, no `@require`, no CDN.

Folders arrive through `DataTransferItem.webkitGetAsEntry()` and are walked recursively —
`readEntries()` hands back at most 100 children per call, so it's drained in a loop.

Between documents the script yields with `scheduler.yield()` (falling back to a `MessageChannel`
message) rather than `setTimeout`, because Chrome throttles timers to one tick per second in a
background tab, which would otherwise stall a long run the moment you switch away.

## Notes

- Conversion is CPU-bound on the main thread; roughly 50 ms per document. 40 files ≈ 2 seconds.
- A file that fails is marked ✗ with the reason on hover; the rest of the batch still completes
  and ships.
- Output filenames follow the **input filenames** (`setup.md` → `setup.docx`), not the first
  heading — which is what the site's own single-file download uses.
