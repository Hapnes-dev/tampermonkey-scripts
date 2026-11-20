# modpoll bridge — Claude reads Modbus registers through the console

`modpoll-mcp.js` is an MCP server for Claude Code. It gives Claude two things that answer
different questions:

- **the bus** — `modpoll_*`, which read the device itself through the Modpoll Console;
- **the database** — `toolbox_*`, which read what IWMAC has already polled and stored.

Both are read-only. Nothing here can change a plant.

## Why it is shaped this way

modpoll runs on the plant PC behind Plant Term, an interactive terminal in an iframe on a
page under `/secure/`. There is no request-response API to call, so whatever drives it has
to be either a browser holding the session or a client holding the credentials.

This takes the first. The server listens on `127.0.0.1`, and the **userscript attaches to
it** from the sys_tools tab the user is already logged into. No password is stored
anywhere and the server never sees one. It also avoids Playwright, whose file-chooser
interception breaks the user's own file pickers.

The loops run on the server side of that link. A sweep of forty registers, or five repeats
of one, is a single tool call and a single answer rather than a round trip per read against
an evaluate timeout. That is the point: where the bus is shared — a gateway the Plant Server
also polls — a single time-out can mean the bus was busy rather than that the register does
not answer, and only repetition separates the two. A refusal is different: it is the device
answering with an exception, and it says the register is outside its map.

**Reads need no spacing (Modpoll Console 1.70.0).** Up to 1.69 a read that followed another
closely could come back empty. The console took 300 ms of quiet as the end of a command, and
a serial poll can be quiet for longer than that before the device's answer. The console
stopped listening before modpoll had said anything, and the reply that came afterwards was
lost. The empty read was then reported as a refusal. On plant 10275 (2026-11-20) a healthy EM270 read three times in a row answered
only the first time, and a 6 s pause between reads hid the fault. Since 1.70.0 every
command line ends with an end tag of its own, and the next line is not sent before that tag
has printed. A row that did not answer says why in `missed`: `refused`, `no answer` (modpoll
timed out) or `unknown`.

Consecutive registers go in one modpoll run, which takes `-c` up to 99. Scanning V01 on
plant 2349 is `modpoll … -r 1 -c 40`, one run returning forty registers, where reading them
one at a time was forty runs at roughly 630 ms each. A block is all or nothing — the device
refuses the whole range if any single register in it is illegal, which is why one at a time
was right for discovery in the first place — so a refused block falls back to one at a time
across that chunk alone. One bad register costs its own run, not the ninety-eight around it.
`test/bridge-sweep.js` holds that case against a simulated device.

## Setup

Already registered in `Documents/Claude/.mcp.json` as `modpoll-bridge`. It needs a Claude
Code restart to appear, and Modpoll Console **1.65.0 or newer** in Tampermonkey.

Then open the plant's sys_tools page in Chrome:

```
http://<plant>.plants.iwmac.local:8080/secure/sys_tools/
```

The console attaches by itself. `modpoll_status` says whether it has. If the page shows a
login prompt, log in once in a normal tab first — the bridge cannot do that for you, by
design.

The server not running is the normal case, not a fault: it only runs while Claude is
working, and the console backs off and keeps offering the tab.

## Tools

| Tool | What it answers |
|---|---|
| `modpoll_status` | Is a tab attached, which plant, which units |
| `modpoll_read` | What does this register hold — with `repeats` and a `control` register |
| `modpoll_verify_list` | Which points of a modbusgen project does the device not answer |
| `modpoll_scan` | What does this address range actually contain |
| `toolbox_plant_sql` | What is configured and bound on the plant (SELECT only) |
| `toolbox_sql` | The Toolbox's own database (SELECT only) |

`control` is the lesson from plant 5689 built in. Give it a register known to answer, and
each pass reads it alongside the rest; a pass where the control also refused proves nothing
about anything else read in it, and the answer says so instead of reporting a map full of
holes.

`modpoll_verify_list` reads the project's `options.subtract_one` to turn each point's
`addr` into a printed reference. Getting that wrong moves every point by one register,
which is the failure it exists to catch.

## The two halves, and which to reach for

They are not interchangeable, and plant 5689 needed both:

- **`toolbox_plant_sql`** reads `iw_plant_server3`. `iw_par_<table>_param` is the template
  a list defines; `iw_gen_driver_parameters` is what is actually bound per unit, and is
  what the parameter page shows. A list can import cleanly and bind nothing, and only this
  side shows it.
- **`modpoll_*`** reads the controller, including registers IWMAC does not poll at all.
  Only this side answers whether a register exists.

## Security

The port is bound to the loopback. A request must arrive at `127.0.0.1` or `localhost` by
that very name (no DNS rebinding), carry `X-MODPOLL-BRIDGE` — which a web page cannot send
without a CORS preflight, and that is refused — and no web page's `Origin`; after the
attach, the session's token. An extension's own `Origin` (`chrome-extension://…`) is
accepted since console 1.69.0, as the IWDIE VectorCraft bridge always has: it is no web page,
and the header and the token still apply. `test/bridge-origin.js` asks the real server.
Answers pass through the console's own `sanitizeDeep` on the way out, so no
credential-shaped string leaves by this road either.

`toolbox_*` is SELECT-only, enforced in the server. The Toolbox API itself would accept
`INSERT`, `UPDATE` and `DELETE`; a plant's rows are the user's to change, by a script he
runs and reads first, never by a tool call. Every Toolbox call carries `X-Caller` and one
`X-Run-Id` per plant, reused for that plant's whole run, because the Toolbox log groups
traffic by them.

## Protocol

Same shape as the IWDIE VectorCraft bridge: `GET /bridge/hello`, `POST /bridge/attach`,
long-poll `GET /bridge/next`, `POST /bridge/result`, `POST /bridge/detach`. Port 47921, or
`MODPOLL_BRIDGE_PORT`.

### Why every request is anonymous (console 1.69.0)

Tampermonkey 5.5.1 sends a userscript's request one of two ways. An anonymous request
(and a blob or stream one) goes out with `fetch()` from its service worker. Every other
request goes out as an `XMLHttpRequest` from its offscreen document, and those go one at a
time. The long poll waits up to 25 s at the server for a command. On the offscreen road it
held that one place almost without a break, so every request of every userscript in the
browser waited up to 25 s behind it.

Measured on 2026-11-18, with a sys_tools tab attached on plant 3006:

- Rocketlane, Younium and Oneflow requests from other scripts took 24–27 s each.
- Four sent together came back one after another.
- Answering the poll early (a `modpoll_status` call) let two stalled requests through at
  that very second.
- The anonymous probes of IWMAC Designer Import/Export and KUDL Mapping Assistant kept
  arriving every second or two all the while.

The bridge takes no cookies, so anonymous costs nothing. From the service worker, though,
the request carries Tampermonkey's `Origin`, which a server older than 1.69.0 refuses
(`403 not for you`). The console then asks the old way for as long as that server runs,
and says so once in the browser console. The slowdown then lasts until the Claude Code
session that started that server is restarted. `test/bridge-transport.js` runs the real
request function against a new, an old and a missing server.

The client is in `Modpoll-Console.user.js` under *Claude bridge*. It is built from five
console methods and no more — `api.devices`, `api.useUnit`, `api.setForm`, `api.run`,
`api.state` — because each one it leans on is another thing that breaks the bridge when the
console changes. Add a sixth only when a command cannot be written without it.
