# etaHEN DPI Upload Queue

The [etaHEN](https://github.com/etaHEN) DPIv2 web interface installs **one** PKG
per page load: pick a file, press *Upload and Install*, wait, come back, repeat.
This userscript adds a batch queue underneath that form — pick every package in
one go, put them in the order you want, press start once.

[Install](https://gitlab.com/thomas.kvalvag/tampermonkey-scripts/-/raw/main/etahen-dpi-queue/etaHEN-DPI-Queue.user.js)
· requires [Tampermonkey](https://www.tampermonkey.net/)

> This one is hosted on GitLab only — it is deliberately not part of the GitHub
> copy of this repository, so install and auto-update both run off the GitLab
> raw URL.

## What it does

- **Multi-select** — choose many `.pkg` files at once, or drag them from Explorer
  onto the drop zone. Non-`.pkg` files and packages already in the queue are
  skipped, and the script says how many of each.
- **Paste URLs in bulk** — one per line. The console downloads those itself,
  which is by far the fastest route, and the queue handles files and URLs mixed.
- **Choose the order** — drag a row by its handle, nudge it with ▲ ▼, or use the
  one-click sorts: A→Z, smallest first, largest first, reverse. Reordering only
  touches packages that have not been sent yet.
- **One at a time, in the order shown** — per-item progress bar with percentage,
  live transfer speed and time remaining, plus a running total across the queue.
- **Pause, abort and retry** — *Pause* lets the running upload finish and then
  stops; *Abort* cancels the upload in flight. Anything that failed can be put
  back in the queue with one click.
- **Clear temp files** — optionally fire the interface's own `/cleartmp` once the
  queue finishes, so the uploaded packages stop occupying console storage.

## Settings

| Setting | Default | Why |
|---|---|---|
| Wait between installs | 20 s | The console answers `SUCCESS` when the install *starts*, not when it ends (see below). This pause gives it room before the next upload lands. |
| Stop the queue on the first failure | on | A failure usually means the console is out of space or the package is bad — both affect everything that follows. |
| Clear temp files when the queue finishes | off | Runs `/cleartmp` after a clean run. |
| Ask before starting | off | Confirms the package count and total size first. |

Settings persist. So do queued **URLs** — they survive a page reload. Queued
**files** cannot: a browser only keeps a file handle for as long as the page
lives, so after a reload those rows have to be picked again.

## The one thing worth knowing

DPIv2 exposes exactly two endpoints — `POST /upload` (multipart, one `file` *or*
one `url` per request) and `POST /cleartmp`. There is no status or progress
endpoint; every other path returns 404. So the queue can observe the *upload*
and nothing after it. When the console replies `SUCCESS`, it means the
installation was accepted and started, not that it finished.

That is the entire reason for the *Wait between installs* setting. Uploading a
second large package while the console is still unpacking the first is how you
run its temporary storage out of space. If you queue big packages, raise the
wait; if you queue small ones, lower it. Watch the console's own install
notifications the first time and tune from there.

A failure is reported verbatim — the console's own message ends up in the row,
e.g. `FAILED: Install failed with error SCE_NP_DRM_CONTENT_ERROR_UNSUPPORTED`.

## Where it runs

Matched on `http://10.0.0.17:12800/*` plus any host on port 12800, and the
script checks for DPIv2's own upload form before doing anything. If your console
answers on a different address, either edit the `@match` line or let the port
rule cover it.

The original single-file form and the Maintenance section are left untouched —
use them whenever one package is all you need.
