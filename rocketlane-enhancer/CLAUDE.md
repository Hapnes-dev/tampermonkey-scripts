# Rocketlane Enhancer — technical reference

Technical notes for `rocketlane-enhancer/rocketlane-enhancer.user.js`, a single IIFE. Current
`@version`: **2.0**. Declared grant: `GM_addStyle` (the implementation does not call it; it creates
`<style>` elements directly). Repo-wide rules for version bumps, commits, and pushes live in the
**root `CLAUDE.md`** and are not repeated here.

> ⚠️ **VERIFIED RELEASE EXCEPTION:** this userscript has **no `@updateURL` and no `@downloadURL`**.
> Its `@namespace` is `http://tampermonkey.net/`. A repository-wide header check found it is the only
> one of the 13 `.user.js` files without `@updateURL`. Therefore, pushing a version bump to `main`
> ships nothing to installed users; they must reinstall the raw userscript by hand. The README's
> statement that the script auto-updates is false.

---

## 1. What it is / where it runs

Two independent Rocketlane UI additions: hide the Gantt/timeline half of project-plan pages and show a
floating, two-conversation chat panel on a project's timeline route.

- Exact `@match`: `https://kiona.rocketlane.com/projects/*`.
- `@run-at document-start`.
- Calendar logic runs when `location.pathname` matches `PROJECT_URL_PATTERN = /^\/projects\/\d+(\/|$)/`:
  any numeric project route, but not the project list.
- Chat logic runs only for `TIMELINE_URL_PATTERN = /^\/projects\/(\d+)\/plan\/timeline(\/|$)/`.
  `getProjectIdFromTimelineUrl()` returns that captured ID; no project ID is hardcoded.

## 2. Calendar hiding and toggle

The absent `rl-calendar-hidden` key means **hidden by default**: `isCalendarHidden()` returns false only
when the stored value is exactly `'0'`. `applyStyle()` adds `#hide-rocketlane-calendar-style`; removal of
that node reveals the calendar again.

`HIDE_CSS` hides four parts of the Bryntum/Rocketlane layout:

- timeline body/header/footer: `.b-grid-subgrid-normal`, `.b-grid-header-scroller-normal`,
  `#b-gantt-5-normalSubgrid-footer`, `.b-grid-footer-scroller-normal`;
- splitters under header, vertical scroller, footer, and virtual-scroller containers;
- toolbar `.toolbar__FilterBarWrapper-kUPJEs`;
- and expands `.b-grid-subgrid-locked` plus the locked header/footer selectors to 100% width.

`injectToggleButton()` locates `[data-cy="present_phase.exit"]`, uses its nearest
`.fullscreen__Action-fhhebC` (or parent) as the container, copies the present button's `className`, and
appends a calendar-icon button. If the anchor is absent it retries after **500 ms**. Clicking toggles
`rl-calendar-hidden` between `'0'` and `'1'`, adds/removes the style, and updates the title/background.

## 3. Floating chat panel

`CONVERSATIONS` is a fixed list used on every timeline project:

| key | label | conversation ID |
|---|---|---:|
| `private` | Private | `12287338` |
| `general` | General | `12287339` |

`buildPanel(projectId)` creates one same-origin iframe per conversation at
`/projects/${projectId}/chat/${conversationId}`. Both load immediately; changing tabs only switches
`opacity` and `pointer-events` over **120 ms**, preserving the inactive iframe's state. The saved active
key is accepted only if it still exists in `CONVERSATIONS`; otherwise the first entry wins.

Each iframe's `load` event calls `injectIframeStyles()`. It inserts `#rl-chat-embed-style` into the
iframe document and hides broad app chrome, the conversation/sidebar `resizable-wrapper`, chat header,
draggable handle, and `ChannelDetailsWrapper`; main/chat containers are expanded to 100%, while message
list/body/action-bar selectors are forced to flex. Access works because iframe URLs remain on the
current Rocketlane origin. Exceptions are logged as `[rl-floating-chat] could not style iframe:`.

## 4. Panel geometry and interactions

The fixed panel starts **16 px** from the right/bottom, at stored size or **420px × 560px**, with
`min-width: 280px`, `min-height: 40px`, `max-width/max-height: 90vw/90vh`, and
`z-index: 2147483000`. A collapsed panel is **40px** high and hides the iframe container.

- Collapse stores/restores `rl-floating-chat-height` and persists `'1'`/`'0'` in
  `rl-floating-chat-collapsed`.
- Close only removes the panel DOM node; it stores no closed preference.
- Dragging starts on the 40px header except over buttons. Right/bottom are clamped to zero while moving.
- Eight custom edge/corner handles resize with effective minima **280 × 200**. Right/bottom-edge math
  also adjusts the corresponding position to keep the opposite edge fixed.
- During drag/resize, a viewport overlay at `z-index: 2147483001` prevents any page iframe from swallowing
  mouseup. `mouseup` on window/document or window blur calls `stopAll()` and stores width/height.
- Position is never persisted. The panel CSS also declares native `resize: both`, but the persistence
  path only runs when the custom `dragging` or `resizing` flags are set.

## 5. SPA navigation lifecycle

`syncAll()` calls both feature routers. The script wraps `history.pushState` and
`history.replaceState`, invokes the original method first, then calls `syncAll()`; it also listens for
`popstate` and calls `syncAll()` once at startup.

`syncHideStyleForCurrentUrl()` defers style/button injection to one-shot `DOMContentLoaded` handlers
when head/body do not yet exist, and removes both style and toggle outside numeric project routes.
`syncChatPanelForCurrentUrl()` mounts `#rl-floating-chat-panel` only on the timeline route and removes it
elsewhere. `mountPanel()` is ID-guarded.

## 6. Gotchas

> ⚠️ **Publishing is manual for installed users.** Neither bumping `@version` nor pushing to `main`
> updates existing installs because both update metadata URLs are absent. See the verified warning at
> the top.

> ⚠️ Conversation IDs are global constants, while the project ID is taken from the current URL. Every
> project therefore tries `12287338` and `12287339`; if those IDs are not valid for that project, update
> `CONVERSATIONS`. There is no discovery API or per-project mapping.

- The README is stale in three material places: auto-update is absent; its `PROJECT_ID = 1177803` does
  not exist in the code; and it claims a `MutationObserver` re-injects iframe CSS, but the script has no
  `MutationObserver`. Iframe CSS is injected only on each iframe `load` event.
- The calendar is hidden by default, not only after opting in. Any value other than the exact string
  `'0'` means hidden.
- All preferences use origin-wide `localStorage` keys with no project suffix, so calendar state, panel
  size/collapse, and active conversation are shared across every Kiona Rocketlane project.
- DOM/CSS hooks include generated-looking selectors (`.toolbar__FilterBarWrapper-kUPJEs`,
  `.fullscreen__Action-fhhebC`) and instance-specific IDs beginning `#b-gantt-5-`; Rocketlane changes
  can break hiding or toggle placement without a JavaScript error.
- The 500 ms toggle retry does not re-check `PROJECT_URL_PATTERN`. A retry scheduled before navigating
  away can continue polling off the project route until it eventually finds the anchor/button ID.
- Close is not durable and there is no separate reopen control. The panel remains absent on the current
  DOM until a later `syncAll()` event; a client-side navigation that still lands on a timeline route
  mounts it again.
- There is no general DOM observer. If Rocketlane replaces an already-injected toggle or panel without a
  history/popstate event, this script does not necessarily restore it. The initial toggle's 500 ms retry
  only covers locating its anchor.
- Iframe styling assumes same-origin relative chat URLs. Changing `chatUrlFor()` to an external origin
  makes `contentDocument` inaccessible; the catch only logs and leaves the full page UI in the frame.
- `GM_addStyle` is declared but unused. Removing the grant should not be confused with removing the
  manual `<style>` injection in `applyStyle()` or `injectIframeStyles()`.
- Custom right/bottom resize paths do not clamp the resulting `right`/`bottom` values; unlike dragging,
  resizing can place an edge beyond the viewport.

## 7. Constants & storage keys quick-ref

| Identifier / key | Value / purpose |
|---|---|
| `PROJECT_URL_PATTERN` | `/^\/projects\/\d+(\/|$)/` |
| `TIMELINE_URL_PATTERN` | `/^\/projects\/(\d+)\/plan\/timeline(\/|$)/` |
| `STYLE_ID` | `hide-rocketlane-calendar-style` |
| `TOGGLE_BTN_ID` | `rl-calendar-toggle-btn` |
| `PANEL_ID` | `rl-floating-chat-panel` |
| `LS_CALENDAR_HIDDEN` | `rl-calendar-hidden`: `'0'` shown; anything else hidden |
| `LS_COLLAPSED` | `rl-floating-chat-collapsed`: `'1'` collapsed |
| `LS_WIDTH` / `LS_HEIGHT` | `rl-floating-chat-width` / `rl-floating-chat-height` |
| `LS_ACTIVE_CONVO` | `rl-floating-chat-active-convo`: `private` or `general` |
| iframe style ID | `rl-chat-embed-style` |
| `CONVERSATIONS` | `private: 12287338`, `general: 12287339` |

Defaults: panel **420px × 560px**, collapsed height **40px**, position **16px** right/bottom, custom
resize minimum **280 × 200**, iframe fade **120 ms**, toggle retry **500 ms**.

## 8. Key functions — where to find things

`applyStyle` / `removeStyle` / `isCalendarHidden` (calendar CSS state) ·
`syncHideStyleForCurrentUrl` (calendar route router) · `updateToggleButton` / `injectToggleButton`
(present-toolbar control and retry) · `getProjectIdFromTimelineUrl` (dynamic project ID) ·
`getActiveConversation` / `chatUrlFor` (chat selection/routes) · `injectIframeStyles` (embedded-chat CSS) ·
`buildPanel` (DOM, iframes, tabs, collapse, close, drag, resize, persistence) · `mountPanel` /
`unmountPanel` / `syncChatPanelForCurrentUrl` (panel lifecycle) · `syncAll` (SPA entry point).
