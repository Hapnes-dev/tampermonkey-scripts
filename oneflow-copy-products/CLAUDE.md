# Oneflow + HubSpot Copy Products — technical reference

Deep technical notes for `oneflow-copy-products/oneflow-copy-products.user.js`, a single IIFE containing Oneflow and HubSpot copy tools plus a separate Rocketlane grid-editor enhancement. Current `@version`: **2.4.1**. Grant: `GM_setClipboard`. There are no `@connect` grants and no GM storage keys. Repo-wide rules (version bumping, commit/push, line endings) live in the root `CLAUDE.md` and are not repeated here.

The folder `README.md` covers the two copy buttons but omits the Rocketlane module. This document follows the executing source.

---

## 1. What it is / where it runs

Exact `@match` patterns:

- `https://app.oneflow.com/*`
- `https://*.oneflow.com/*`
- `https://app.hubspot.com/*`
- `https://app-eu1.hubspot.com/*`
- `https://*.hubspot.com/*`
- `https://*.rocketlane.com/*`

It runs at **`document-idle`**.

The bottom router classifies `location.hostname` with suffix regexes:

- `/oneflow\.com$/i` → maintain the Oneflow sidebar copy button.
- `/hubspot\.com$/i` → maintain the HubSpot Line items copy button.
- `/rocketlane\.com$/i` → install grid-editor CSS, hover listeners, popup scanning, and focus-box reanchoring.

These tests are not limited to the explicit `app.*` hosts, but execution is still bounded by the metadata matches. The script is SPA-oriented: one document-level `MutationObserver` watches every descendant `childList` change and schedules a single `requestAnimationFrame` tick per mutation burst.

## 2. Overall architecture

The IIFE has four pieces:

1. Shared output helpers: `escapeHtml`, SVG constants, `svgAt`, and the three-tier `copyRich` clipboard path.
2. `ONEFLOW` module: inject button, force lazy PDF pages to render, extract products via PDF/API/native DOM, normalize/nest items, copy rich + plain output.
3. `HUBSPOT` module: locate the Line items card, clone the Edit-link styling, extract visible item rows, and copy.
4. `ROCKETLANE` module: unrelated to product copying; enlarges specific ag-grid popup editors and replaces rich-cell hover behavior with a selectable custom tooltip.

`tick()` calls only the active host module. `scheduleTick()` debounces with `tickScheduled`; errors inside animation-frame ticks are swallowed. The initial `tick()` runs immediately after observer installation.

## 3. Shared clipboard pipeline

`copyRich(html, plain)` tries, in order:

1. `navigator.clipboard.write()` with one `ClipboardItem` containing both `text/html` and `text/plain` blobs.
2. An off-screen `contentEditable` holder, selected with `Range`, then `document.execCommand('copy')`.
3. `GM_setClipboard(plain, 'text')` if rich copying failed.

It returns a Boolean. Oneflow and HubSpot render a green check or red X for **1,500 ms**, then restore the original copy UI. The GM fallback is plain text only, which is why `GM_setClipboard` is the sole grant.

`escapeHtml()` escapes `&`, `<`, and `>` before source text enters generated HTML. It does not escape quotes because source values are emitted as element text, never attributes.

## 4. Oneflow extraction pipeline

### Click-time source precedence

The Oneflow button is injected as `#of-copy-products-btn` at the end of the first vertical tablist (`[role="tablist"][aria-orientation="vertical"]`). It borrows the first tab button's classes after removing any `_ActiveTabTrigger...` class token.

On click the button disables itself and uses this exact precedence:

1. `ensureAllPagesRendered()` then `extractItems()` from the rendered PDF text layer.
2. `fetchProductsViaApi()` if PDF extraction returned no items.
3. `extractFromNativeContent()` if API also returned no items.

The PDF is intentionally first because it contains the signed document's section headers and visual quantities. The comment above `fetchProductsViaApi()` calling it the “Preferred path” is stale; the click handler at lines 585–592 and actual call order prefer PDF.

### Forcing react-pdf pages to render

`ensureAllPagesRendered()` finds `._PdfPage_iv0eo_10, [class*="_PdfPage_"]`, chooses `._Scrollable_vt0q8_62`, the nearest `[class*="_Scrollable_"]`, or `document.scrollingElement`, and saves `scrollTop`.

Pages are processed sequentially. A page counts as rendered when it contains `.react-pdf__Page__textContent span[role="presentation"]`. Otherwise it is centered with `scrollIntoView`, then polled every **80 ms** for at most **2,500 ms** before the code advances anyway. At the end the original `scrollTop` is restored.

### Reconstructing PDF rows

`buildRows()` processes each `.react-pdf__Page__textContent` separately because each page reuses 0–100% coordinates. For every presentation span it parses `top` and `left` percentages from the inline style, rounds top to the nearest **0.25 percentage point** (`Math.round(top * 4) / 4`), groups spans by that value, sorts cells left-to-right, then concatenates pages in DOM order.

`detectColumns(rows)` uses the first row containing both `Beskrivelse` and `Antall`. It finds split headers by joining one to four consecutive spans, then derives:

- description maximum: closest detected non-description column to the right of `Beskrivelse`, minus `2` percentage points;
- quantity minimum: `Antall` left minus `2`;
- quantity maximum: `Sum` left minus `2`, or `Antall + 8` effectively when `Sum` is absent.

If column detection fails, `extractItems()` falls back to description left `< 45`, quantity left `74..84`.

### Row state machine and item normalization

Parsing ignores everything until a row contains both `Beskrivelse` and `Antall`. It then:

- skips continuation-page headers and `isNonTableRow()` patterns such as Oneflow ID, page number, signature/customer headers;
- stops the entire extraction at a row beginning with `Installasjonkostnader`, `Listepris`, `Sum eks mva`, `Totalsum`, or `Sluttsum`;
- keeps description spans left of `descMaxLeft` while excluding `isPriceLikeToken()` values (Norwegian comma-decimal prices, percentages, and `N pcs`);
- finds the first `N pcs` span in the detected/fallback quantity range;
- creates `header` items for `IWMAC Product:` / `IWMAC Modul:` and `bullet` items for everything else.

Main descriptions are recognized only by `/^(IWMAC|Integration|Per|Freight)\b/i`. This drives two quantity-repair heuristics:

- Quantity-only row: walk back through consecutive no-quantity bullets and attach the quantity to the first bullet in that block.
- Non-main description sharing a row with quantity: walk backward to a preceding no-quantity main bullet, assign the quantity there, and retain the current description as a quantity-less sub-line. If no eligible main item exists, keep the quantity on the current row.

Finally, a quantity-less bullet beginning with lowercase `[a-zæøå]` is merged into the preceding bullet description. Iteration runs backward so multiple continuations collapse safely.

### API fallback

`fetchProductsViaApi()` only works when the path matches `/documents/(\d+)`. It same-origin fetches `/api/agreements/{id}` with `credentials: 'include'` and `Accept: application/json`; no userscript network grant is involved.

It reads `j.boxes`, keeps `box.type === 13`, then `content.data` entries with `key === 'product'`. Each selected entry becomes `{type:'bullet', desc:value.name, antall: count + ' pcs'}`. Empty names and `Number(count) <= 0` are skipped. API fallback does not reconstruct section headers or sub-lines.

### Native-content fallback

`extractFromNativeContent()` scans `[class*="_ProductTableWrapper_"]` and non-header `[class*="_TableRow_"]` rows. It reads `[class*="_ProductNameCell_"]`; quantity precedence is number input, checked radio, checked checkbox, then `N pcs` text. Rows with descriptions are retained even if no quantity is detected.

### Nesting and output

`nestItems()` makes quantity-bearing or main-prefix bullets parents with `subs: []`. A quantity-less, non-main bullet is attached to the immediately preceding bullet if possible; otherwise it remains top-level. `stripSubPrefix()` removes one leading dash/en dash/em dash/bullet from nested text.

Rich output starts with `<strong>Oneflow document info:</strong>`, emits headers as bold paragraphs, top-level bullets in `<ul>`, quantities as bold text after an em dash, and sub-lines as nested `<ul>`. Plain output mirrors that hierarchy with `•` and four-space-indented `-` lines.

## 5. HubSpot Line items path

`findLineItemsCard()` searches `span[data-selenium-test="crm-card-title"]` for text matching `line items` case-insensitively. It climbs ancestors until one contains `[data-test-id="line-items-card-line-item"]`; if no populated ancestor is found, it falls back to the nearest class containing `ExpandableWrapper` or the title's parent.

`injectButton()` requires `span[data-selenium-test="crm-card-actions"]`. It uses the first `a[data-test-id^="line-items-card-action"]` as the style/reference link, creates `#hs-copy-line-items-btn`, and inserts it immediately before Edit when possible, otherwise as the first action.

Each visible row is parsed by `HUBSPOT.extractItems()`:

- Name: first tries the `TruncateString... span` selector, then `p span > span` under `line-items-card-line-item-name-quantity`.
- Quantity: `[data-test-id="line-items-card-line-item-quantity"]`, whitespace removed (for example `x 31` → `x31`).
- A row is skipped only when both name and quantity are empty.

Output is a flat list headed `HubSpot line items:`; there is no grouping/nesting logic.

`removeStaleButton()` removes an existing button if its closest `ExpandableWrapper` is missing or no longer contains a CRM-card title, allowing SPA route/card replacement to reinject against the new card.

## 6. Rocketlane grid-editor and hover module

This module is independent of the script name and README. It runs on every matched `*.rocketlane.com` page.

### Popup resizing

`injectStyle()` adds `#rl-popup-editor-resize-style`. Only popup wrappers whose `data-field-type` matches `MultiLineText|RichText` are resized. CSS allows `resize: both`, constrains to `95vw`/`90vh`, and stretches descendants/editables to fill the wrapper.

`scanPopups()` calls `applyInlineSize()` for every `.ag-popup-editor [data-field-type]`. A wrapper is processed once via `dataset.rlResized = '1'`, assigned **640 × 420 px**, and the closest `.ag-popup-editor` is moved left/up when that size would exceed the viewport (8/16 px margins in the calculations).

### Native-tooltip suppression

The injected CSS always hides `.ag-tooltip` and `.ag-tooltip-custom`. While `body.rl-tooltip-active` is set, it also hides other `[role="tooltip"]`, tippy roots/boxes/content, except `#rl-custom-cell-tooltip`.

### Eligible rich cells and stable identity

`cellHasRichContent()` requires a descendant matching `[class*="rich-text-editor"], .ck-content, [class*="multi-line-text"]`, at least two normalized text characters, and more than punctuation/dash placeholders.

`cellKey()` uses `(row-id || row-index) + '|' + col-id`. This survives ag-grid recycling. `reanchorFocusBox()` searches current `.ag-cell` nodes for the same key and repositions the fixed `#rl-hover-focus-box` when DOM rows are replaced.

### Custom tooltip interaction

`showTipFor()` copies the rich cell's existing `innerHTML` into `#rl-custom-cell-tooltip`, positions it below the cell or above when space is tight, and adds `body.rl-tooltip-active`. The tooltip is selectable and scrollable, maximum **640 × 420 px**, with z-indexes `2147483647` (tooltip) and `2147483646` (focus box).

Movement between the cell and tooltip cancels hiding; other exits use a default **120 ms** delay. Wheel input over the source cell is redirected to `tipEl.scrollTop` and prevented from scrolling the grid. Wheel/touch inside the tooltip stops propagation.

A tooltip mousedown/up movement of at most **3 px** counts as a click: `openCellEditor()` hides the tooltip, temporarily disables tooltip pointer events, finds the underlying element at the cell center, calls `.click()`, then dispatches a composed/bubbling `dblclick`. Larger movement is left alone for text selection. Any open `.ag-popup-editor` suppresses/hides the hover tooltip.

## 7. SPA lifecycle and performance

The observer watches `{childList:true, subtree:true}` on `document.documentElement`; it does not watch attributes or text-node character data. Mutation bursts collapse into one animation-frame scan.

Per tick:

- HubSpot: stale-button cleanup + card/action lookup.
- Oneflow: ID existence check + vertical-tablist lookup.
- Rocketlane: scan all popup field wrappers, reanchor the focus box, and hide the tooltip if an editor is open.

Rocketlane hover listeners are installed once using the function property `installHover._done`. `mouseover`, `mouseout`, wheel, scroll, mousedown, and window blur handlers are delegated globally, so they survive SPA DOM replacement without reinjection.

## 8. Gotchas

1. > ⚠️ **The script has a third Rocketlane feature.** The README, `@description`, and script name mention only Oneflow/HubSpot copying, but metadata includes `https://*.rocketlane.com/*` and roughly the last third of the source changes Rocketlane ag-grid editors/tooltips.

2. > ⚠️ **PDF is the actual preferred Oneflow source.** The “Preferred path” comment above `fetchProductsViaApi()` contradicts the click handler. Execution is PDF → API → native DOM.

3. > ⚠️ **Do not merge rows across PDF pages by top percentage.** Every page restarts coordinates at 0–100%; `buildRows()` must group per page first. This is the reason for `pageIndex` and per-page maps.

4. > ⚠️ **Lazy-render timeout is best-effort, not success.** After 2,500 ms a missing page is skipped and extraction continues silently. A slow page can therefore produce incomplete copied output.

5. Quantity repair depends on the exact main-prefix regex `IWMAC|Integration|Per|Freight`. Expanding or narrowing it changes parent/sub-item attribution, not merely formatting.

6. `isPriceLikeToken()` intentionally does **not** reject bare digits, because descriptions such as `3 x OJ Master` must survive. Treating all numeric-looking text as price would delete real descriptions.

7. Native-content fallback and API fallback have different selection semantics. API drops `count <= 0`; native DOM retains any named row even when no checked/value quantity is found.

8. Oneflow injection is based on the first vertical tablist, not on `/documents/...`. On another Oneflow screen with such a tablist the button can appear, but API fallback returns `null` unless the path contains a numeric document ID.

9. `detectColumns()` uses the first qualifying header. Its returned `headerTop` is unused. Repeated headers are skipped later by text, not by coordinate.

10. The lowercase continuation merge is deliberately narrow. Uppercase continuation lines remain separate and are later nested/left top-level by `nestItems()`.

11. HubSpot selectors are internal `data-*` hooks plus generated class fragments. The two name-selector fallbacks, card ancestor walk, and stale-button cleanup all exist to tolerate partial DOM variants.

12. `removeStaleButton()` assumes the installed button has an `ExpandableWrapper` ancestor. If HubSpot uses the fallback card shape without that class, the next tick removes and may reinsert the button.

13. Rocketlane's `.ag-tooltip` suppression is unconditional once the style is injected. If the custom rich-cell tooltip stops working, native ag-grid tooltips remain hidden.

14. Rocketlane tooltip content is copied as existing host-page `innerHTML`, not escaped. This preserves lists/formatting and does not introduce an external data source, but refactors must not start feeding arbitrary outside HTML into `showTipFor()`.

15. `dataset.rlResized` prevents reapplying the 640 × 420 inline size to a wrapper. If the host reuses the same wrapper for a different field type, the module will not reconsider it.

16. The global observer remains active on all matched hosts for the lifetime of the page. Keep injectors idempotent and keep new tick work bounded.

## 9. Constants & storage keys quick-ref

- Oneflow button: `BTN_ID = 'of-copy-products-btn'`.
- HubSpot button: `BTN_ID = 'hs-copy-line-items-btn'`.
- Rocketlane style: `STYLE_ID = 'rl-popup-editor-resize-style'`.
- Rocketlane tooltip: `TOOLTIP_ID = 'rl-custom-cell-tooltip'`; focus box ID `rl-hover-focus-box`.
- Rocketlane popup defaults: `DEFAULT_W = 640`, `DEFAULT_H = 420`.
- Tooltip limits: `TIP_MAX_W = 640`, `TIP_MAX_H = 420`.
- Oneflow row-top grouping: nearest `0.25%`.
- Oneflow column fallbacks: description `<45%`; quantity `74..84%`.
- Lazy page polling: every `80 ms`, maximum `2500 ms` per unrendered page.
- Button feedback: `1500 ms`; tooltip hide delay: `120 ms`; click-vs-drag threshold: `3 px`.
- Storage keys: **none**. The script does not call `GM_getValue`/`GM_setValue` or web storage.
- Network: no `@connect`; only Oneflow's same-origin `fetch('/api/agreements/{id}', {credentials:'include'})`.

## 10. Key functions — where to find things

- `escapeHtml` (line 27), `svgAt` (38), `copyRich` (45) — output safety, icon sizing, clipboard fallback ladder.
- `parsePct` (98), `buildRows` (103), `detectColumns` (141), `isPriceLikeToken` (198), `isNonTableRow` (212), `extractItems` (225) — PDF geometry and parsing.
- `fetchProductsViaApi` (360), `extractFromNativeContent` (398) — Oneflow fallbacks.
- `nestItems` (439), `stripSubPrefix` (462), Oneflow `itemsToHtml` (466) / `itemsToPlain` (501) — hierarchy and serialization.
- `ensureAllPagesRendered` (533), Oneflow `buildButton` (571) / `injectButton` (608) — lazy rendering and sidebar UI.
- `findLineItemsCard` (626), HubSpot `extractItems` (642), `itemsToHtml` (664) / `itemsToPlain` (676), `buildButton` (702), `removeStaleButton` (738), `injectButton` (747) — HubSpot flow.
- `injectStyle` (783), `applyInlineSize` (924), `scanPopups` (951) — Rocketlane CSS and popup sizing.
- `cellKey` (978), `ensureTip` (1000), `openCellEditor` (1056), `ensureFocusBox` (1082), `showFocusBox` (1090) — stable hover/editor mechanics.
- `cellHasRichContent` (1123), `getCellHtml` (1138), `positionTip` (1147), `showTipFor` (1163), `hideTip` (1179) — tooltip eligibility/content/lifecycle.
- `onMouseOver` (1191), `onMouseOut` (1220), `onMouseDown` (1228), `onWheel` (1238), `installHover` (1261) — delegated interaction handlers.
- `tick` (1294), `scheduleTick` (1307), observer setup (1316) — host router and SPA maintenance loop.
