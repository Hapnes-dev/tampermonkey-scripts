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

- Polls every ~60s. Rocketlane: `/notifications/groups?status=New` → one popup per conversation with new activity. Zendesk: search `assignee:<me> updated><3d`, then the latest **public** comment per ticket — pops only when that comment's author isn't you (a real customer/other reply) **and the ticket isn't solved/closed** (v1.14.0: resolving a case yourself no longer pops a notification for the customer's last reply — a later requester reply reopens the ticket to `open`, so genuine new responses still notify).
- **Cross-tab dedup + a shared ~60s poll throttle** via `GM_setValue`, so multiple open tabs poll ~once/min total and never double-notify. A per-install **prime** records the current backlog silently on first run, so installing never blasts a backlog.
- **Toggle** from the Tampermonkey menu → "✅/❌ Desktop notifications". On by default.
- **Limitation:** can't fire when the browser is fully closed (a static page + userscript can't run with no tab). True always-on push would need a backend server + Web Push.
- The tracker's own in-page notifier **defers** to this bridge at v1.10.0+, so the same item is never popped twice.

## Zendesk ⇄ General Chat (v1.16.0)

Links a project's General Chat in Rocketlane to one Zendesk ticket, so the conversation with the customer can be
followed and answered from the chat.

- **Turn it on.** The button at the bottom right of a chat page (`/projects/<id>/chat/<id>`) says **Zendesk ⇄ off**
  while the sync is off in this browser. Its panel has a button to turn it on, and so does the Tampermonkey menu
  ("Zendesk ⇄ General Chat sync"). Only the browser where it is on does the syncing. The rest of the team sees the
  messages in the chat without installing anything.
- **Link a chat.** The button lists the active tickets in the team's queue. The queue is set by a Zendesk view,
  "IWMAC Leveranse - Kulde" by default, which can be changed in the Tampermonkey menu.
  - The view shows only new and open tickets. So the sync reads the view's groups (Delivery and Aftermarket Cooling)
    and its tag and assignee exclusions, and searches them at every active status. That brings in tickets waiting for
    the customer ("Waiting for Customer") and on hold ("On Hold – Internal"), but never solved, closed or archived
    ones.
  - The ticket whose **Plant ID** is the project's plant number (the number its name starts with, "8222 - Obs
    Harstad") comes first. After it come tickets with that number in the subject, then in the text, then with words
    of the project's name in the subject.
  - When one matches, opening the chat asks whether to link it: **Link**, **Not now** (not asked again in that
    chat for that ticket) or **Choose another ticket**. Meanwhile the button says **Zendesk #207248 found · Link**.
  - **Link** in the list asks once more, with "Yes, link #…".
  - Linking posts a note in the chat, then the ticket's earlier messages once, oldest first: who, what kind, when,
    and the text. They go in one message, or in a few for a long ticket. A chat linked before 1.17.4 can get them
    with **Post earlier messages** in its panel. **Post earlier messages again** posts them once more, after the
    old copies have been deleted from the chat. What was in the chat before the link stays in the chat.
- **From Zendesk to the chat.** Every new message on the ticket is posted in the chat as a private message, so
  customers in the project do not see it. It starts with "Zendesk #<ticket> · <name>" and a label: "(customer)" for the
  customer, "internal note" for an internal note, "reply to the customer" for an agent's public reply. Attachments are links
  to Zendesk.
- **Tidied text.** Email replies are cleaned for the chat. Entities such as `&nbsp;` are decoded, and runs of blank
  lines become one. A quoted earlier email ("Fra: …" / "Sendt: …", "-----Original Message-----", "On … wrote:") is
  cut, and a signature is cut to its sign-off and the name under it. Each line is a paragraph, as Rocketlane writes
  its own messages.
- **From the chat to Zendesk.** Every message written in the chat goes to the ticket as an internal note. One that
  starts with **/kunde** (or **/customer**) goes as a public reply, emailed to the customer. Messages are written with your Zendesk
  session. A colleague's message is marked with their name: "Name (Rocketlane):" before an internal note,
  "— Name" after a public reply.
- **Only active tickets.** A linked ticket syncs while it is new, open, pending or on hold, also after it has left the
  queue's view. Solved or closed, the link pauses. Opened again, the link catches up on everything that came in
  meanwhile.
- **When it runs:** once a minute, in one Rocketlane tab, while a Rocketlane tab is open. **Sync now** in the panel runs
  it at once. With the browser closed it does not run, and it catches up the next time.
- **Needs:** a Rocketlane page loaded (for the api-key) and Zendesk opened once while logged in (for the session and
  the CSRF token). The button shows what is missing.
- **How:** Rocketlane has no public API for chat, so this uses the same tenant API as the tracker's chat. A change on
  Rocketlane's side can break it. Each message is recorded as soon as it has crossed, and the sync remembers the
  messages it posted itself, so nothing goes back where it came from or crosses twice.
- **Tests:** `node --test rocketlane-chat-bridge/test/` runs the engine against an in-memory chat and Zendesk.
  `node rocketlane-chat-bridge/test/chat-sync-e2e.js` runs the button and panel in headless Chrome.

## Permissions

The script requests `@connect` access to:

| Host | What for |
|---|---|
| `kiona.api.rocketlane.com` | Main Rocketlane API |
| `s3.us-east-1.amazonaws.com`, `s3.amazonaws.com`, `amazonaws.com` | Downloading attachments from S3 |
| `assets.rocketlane.com` | Older attachment assets |
| `d1vtr0p8bkmfca.cloudfront.net` | Avatar / company logo CDN |

## Security model

- **Exposure gate:** the privileged `window.*Bridge` objects are exposed **only** on the tracker origin (`file://`, `localhost`/`127.0.0.1`, or `hapnes-dev.github.io`) **and only** when the page carries the `<meta name="rocketlane-tracker" content="hapnes-dev/Project-Progress-Tracker">` marker. On the platform pages (rocketlane/zendesk/oneflow/younium/hubspot) the script is **capture-only** — it grabs the session token/CSRF and returns before exposing any bridge.
- **Origin-pinned credentials (v1.15.0):** every request helper checks the resolved URL's origin before attaching credentials and refuses to send them anywhere else — the Rocketlane api-key only to `kiona.api.rocketlane.com`, the Younium Bearer JWT only to `api.younium.com`, and the Zendesk/Oneflow/HubSpot session CSRF/XSRF tokens only to their own origins. A caller-supplied absolute URL can't redirect credentials to another `@connect` host.
- **No secret logging:** auth diagnostics log presence/length only, never the key or token value.

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
