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
an evaluate timeout. That is the point: on a shared RS-485 bus a single refusal means the
bus was busy, not that the register is absent, and only repetition separates the two.

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
attach, the session's token. Answers pass through the console's own `sanitizeDeep` on the
way out, so no credential-shaped string leaves by this road either.

`toolbox_*` is SELECT-only, enforced in the server. The Toolbox API itself would accept
`INSERT`, `UPDATE` and `DELETE`; a plant's rows are the user's to change, by a script he
runs and reads first, never by a tool call. Every Toolbox call carries `X-Caller` and one
`X-Run-Id` per plant, reused for that plant's whole run, because the Toolbox log groups
traffic by them.

## Protocol

Same shape as the IWDIE VectorCraft bridge: `GET /bridge/hello`, `POST /bridge/attach`,
long-poll `GET /bridge/next`, `POST /bridge/result`, `POST /bridge/detach`. Port 47921, or
`MODPOLL_BRIDGE_PORT`.

The client is in `Modpoll-Console.user.js` under *Claude bridge*. It is built from five
console methods and no more — `api.devices`, `api.useUnit`, `api.setForm`, `api.run`,
`api.state` — because each one it leans on is another thing that breaks the bridge when the
console changes. Add a sixth only when a command cannot be written without it.
