# Media Capture

**Version: 1.0**

Lists the images and media files (video, audio, stream segments) the page you are on has loaded, each with a **Download** button. It replaces the two Chrome extensions *Image Downloader* and *Media Capture*, whose toolbar popup Chrome caps at 800×600.

## Install

[Click here to install (latest, currently v1.0)](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/media-capture/Media-Capture.user.js)

After installing, Tampermonkey auto-updates whenever a new version is pushed.

## Match

`*://*/*` — every page. The script only watches; nothing is shown until you open it.

## Use

Open it with **Alt+Shift+M**, or from the Tampermonkey menu → **Open Media Capture**.

- **All / Images / Media** — filter the list; each tab shows its count.
- **Download** — saves the file through Tampermonkey. If Tampermonkey refuses the file type, the file opens in a new tab instead.
- Hovering an image row shows it in the preview pane on the right (hidden when the panel is narrower than 520 px).
- **Rescan** — looks through the page again. **Clear** — empties the list.

## Any size

- **The panel** — drag it by its header, resize it from the bottom-right corner. There is no maximum size. Size and position are remembered.
- **Pop out** — moves the list into its own browser window, which resizes and maximises like any window. Its size is remembered too.

The pop-out window is drawn by the page's script, so it closes when that page navigates or reloads.

## What is captured

- Everything the browser reports in the page's resource timing: files requested by `<img>`, `<video>` and `<audio>`, plus anything else whose extension is an image or media type (CSS backgrounds, HLS/DASH segments fetched by a player).
- `<img>`, `<video>`, `<audio>`, `<source>` and poster images found in the page.
- Frames report what they loaded to the top page, so an embedded player's files are listed too.

## Differences from the extensions

- The list is **per page**, not shared across all tabs, and it starts over when the page reloads.
- A userscript cannot see network requests directly, so a file fetched under a URL with no recognisable extension by script (not by an `<img>`/`<video>` element) is not listed.
- `blob:` and `data:` URLs are skipped.
