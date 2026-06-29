# Rocketlane Chat Bridge

Bridges Rocketlane's API to the local [Project Progress Tracker](https://github.com/Hapnes-dev/Project-Progress-Tracker) HTML page, bypassing the browser CORS policy that would otherwise block `fetch()` calls from a `file://` URL.

## Install

[**Install (auto-updates)**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-chat-bridge/rocketlane-chat-bridge.user.js)

1. Install [Tampermonkey](https://www.tampermonkey.net/) if you don't have it.
2. Click the **Install** link above — Tampermonkey will prompt you to install/update.
3. Go to `chrome://extensions` → **Tampermonkey** → **Details** → toggle **Allow access to file URLs** to **ON**.
4. Visit [https://kiona.rocketlane.com](https://kiona.rocketlane.com) once while logged in. The userscript captures your session key automatically.
5. Open the Project Progress Tracker HTML — chat, attachments, and notifications should now work.

The script auto-updates whenever a new version is pushed to this repo (Tampermonkey checks for updates on a default schedule).

## What it does

- Side A — on `kiona.rocketlane.com`: reads your api-key from `localStorage.__api_key` and stores it via `GM_setValue`.
- Side B — on `file://` pages: injects `window.RocketlaneBridge` exposing methods the tracker uses:
  - `listProjectConversations(projectId)`
  - `fetchChatComments(projectId, conversationId)`
  - `postChatComment(projectId, conversationId, text, opts)`
  - `uploadAttachment(projectId, file, opts)` — multipart form upload
  - `downloadAttachmentBlob(attachmentId)` — for files that can't open inline (zip, ai, etc.)
  - `fetchAttachment(attachmentId)` — regenerates the presigned S3 URL (URLs expire after 5 minutes)
  - `fetchProjectAttachments(projectId)` — Files popover backing
  - `fetchNotificationGroups()`, `getNotificationLastSeen()`, `markNotificationsSeen()` — notifications drawer

All calls go through `GM_xmlhttpRequest`, which is exempt from the browser CORS policy.

## Background desktop notifications (v1.10.0+)

Pops a desktop notification (`GM_notification`) for **new Rocketlane** chat/mention/status notifications and **new Zendesk public replies** — from whichever matched tab is open, so you get alerts **without the Project Progress Tracker open**. As long as you have Rocketlane (or Zendesk, etc.) open in some tab, you're covered.

- Polls every ~60s. Rocketlane: `/notifications/groups?status=New` → one popup per conversation with new activity. Zendesk: search `assignee:<me> updated><3d`, then the latest **public** comment per ticket — pops only when that comment's author isn't you (a real customer/other reply).
- **Cross-tab dedup + a shared ~60s poll throttle** via `GM_setValue`, so multiple open tabs poll ~once/min total and never double-notify. A per-install **prime** records the current backlog silently on first run, so installing never blasts a backlog.
- **Toggle** from the Tampermonkey menu → "✅/❌ Desktop notifications". On by default.
- **Limitation:** can't fire when the browser is fully closed (a static page + userscript can't run with no tab). True always-on push would need a backend server + Web Push.
- The tracker's own in-page notifier **defers** to this bridge at v1.10.0+, so the same item is never popped twice.

## Permissions

The script requests `@connect` access to:

| Host | What for |
|---|---|
| `kiona.api.rocketlane.com` | Main Rocketlane API |
| `s3.us-east-1.amazonaws.com`, `s3.amazonaws.com`, `amazonaws.com` | Downloading attachments from S3 |
| `assets.rocketlane.com` | Older attachment assets |
| `d1vtr0p8bkmfca.cloudfront.net` | Avatar / company logo CDN |

## Tenant customization

If your Rocketlane tenant is not `kiona.rocketlane.com`:

1. Replace `kiona` in the `@match` directives at the top of the script.
2. Update the `TENANT_API` constant inside the script body to point at your tenant's API host.

## Manual session capture (fallback)

The script auto-captures your api key + userId on every visit to
`kiona.rocketlane.com` by reading `localStorage.__api_key`. If that ever
fails (rare — usually a privacy extension blocking storage access), you
can grab the values manually:

1. Open `https://kiona.rocketlane.com` while logged in.
2. Open DevTools → Console.
3. Run:
   ```js
   JSON.parse(localStorage.__api_key)
   // → ["api_key", "<uuid>", <userId>, <accountId>]
   ```
4. Copy the `<uuid>` (second element) and `<userId>` (the integer).
5. Open Tampermonkey dashboard → click the **Rocketlane Chat Bridge**
   row → **Storage** tab, then set these values:
   - `rlApiKey` → the uuid string
   - `rlUserId` → the userId number
   - `rlApiKeyCapturedAt` → `Date.now()` (any integer works)
6. Refresh the tracker — chat, attachments, and notifications will work
   without you having to keep the Rocketlane tab open.

The api-key rotates occasionally. If chat suddenly errors with 401, just
revisit `kiona.rocketlane.com` once — auto-capture will refresh both
values transparently.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `RocketlaneBridge is undefined` on the tracker | Enable "Allow access to file URLs" in Tampermonkey's extension settings. |
| Chat empty after install | Visit `kiona.rocketlane.com` once while logged in so the script can capture your session key. |
| HTTP 401 from Rocketlane | Session expired — log back into Rocketlane to refresh. |
| Download fails with "Network error" | The destination host isn't in `@connect`. Re-install the script if you've manually edited an older copy. |
