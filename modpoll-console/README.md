# Modpoll Console

Runs `modpoll` against a plant's Modbus devices from the browser, on the IWMAC
`sys_tools` page, and hands the result back as a table — or, for an agent driving
the tab, as parsed JSON from `window.__modpoll`.

[Install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/modpoll-console/Modpoll-Console.user.js)

Matches `*://*.plants.iwmac.local:8080/secure/sys_tools/*`. A ⚡ **Modpoll**
button appears bottom-right; the panel is draggable and remembers the last form.

## What it does

- **Picks the device from the plant database.** *Load units* queries the Toolbox
  plant-SQL API and lists every active unit with its connection type, resolved IP
  (for Modbus TCP), COM port, baud rate and parity. Selecting one fills the form.
  The slave address is read from the last numeric segment of `driver_addr` — it is
  a starting value, not a fact, so check it against the plant when it matters.
- **Builds the command, then runs it through Plant Term.** The script loads
  `plant_term` in the sys_tools sidebar, connects the shell, executes the command
  and reads back only what that command printed.
- **Splits long ranges.** A count above 99 becomes several commands; the results
  are stitched back into one list.
- **Parses the output.** `[N]: value` rows become a table with the printed index,
  the protocol address, the raw value, hex, the int16 reading and ×0.1 / ×0.01
  scalings. modpoll's error lines become one diagnostic line each instead of a
  wall of repeated text.
- **Exports.** *Download JSON* writes the full result; *Copy for AI* puts a
  compact form on the clipboard (values as a bare array, addresses as two anchors).

## The three traps it handles for you

| Trap | What the script does |
|---|---|
| `-r` is 1-based — the protocol address is the printed index minus one | Every row carries both numbers. The *Start is* selector says which base your input uses; choosing *protocol address* adds the one. |
| `-c` caps at 99, although `-h` claims 1-100 | Ranges are split into blocks of 99 automatically. |
| `-t` follows the Modicon prefix, not the function code | The table selector is labelled by prefix: 4 holding, 3 input, 1 discrete input, 0 coil. |

Registers outside the device's map answer with 0 rather than an exception, so a
block may span gaps safely — a row of zeros is not by itself evidence of a
missing device.

## Read-only by construction

modpoll has no write flag: it writes when a value follows the host argument. Every
command — including one typed by hand into the preview box — is tokenised first,
and a second positional argument is refused with the reason stated. Nothing in the
panel can set a register.

## The API for an agent

`window.__modpoll` is exposed on the page. `__modpoll.help()` prints the list.

```js
await __modpoll.devices();                 // units from the plant database
await __modpoll.read({                     // full result
  host: '10.0.0.5', slave: 1, table: '4',
  start: 430, count: 272, base: 'printed'  // or base: 'protocol'
});
await __modpoll.readCompact(spec);         // same, values as a bare array
await __modpoll.raw('c:\\iwmac\\bin\\modpoll.exe -m tcp -a 1 -t 4 -r 430 -c 99 -1 10.0.0.5');
await __modpoll.probe();                   // what this plant's modpoll -h reports
__modpoll.last();                          // last full result
__modpoll.stop();                          // abort a running sweep
```

A full result is `{ ok, plant, at, spec, values, summary, diagnostics, commands }`,
where each value is `{ i, addr, v }` — `i` as modpoll printed it, `addr` the
protocol address. `readCompact` returns the values as a plain array with the first
index and address as anchors and a `contiguous` flag, which is far cheaper to carry
in a conversation than a few hundred objects.

Callers that run in an isolated world (a browser extension content script, some
automation harnesses) can use the `postMessage` bridge instead:

```js
window.postMessage({ __modpoll: 'request', id: 1, method: 'readCompact', args: [spec] }, '*');
// → { __modpoll: 'response', id: 1, ok: true, result: { … } }
```

## Requirements

- Plant Term must be reachable. If connecting throws, it is nearly always the HTTP
  login for `*.plants.iwmac.local/secure/*` having expired — open the plant in a
  normal tab, log in once, then retry.
- `c:\iwmac\bin\modpoll.exe` must exist on the plant server. *Probe binary* runs
  `modpoll.exe -h` and reports the version it finds.
- The Toolbox plant-SQL API (`toolbox.iwmac.local:8505`) is needed for the unit
  list only; the rest of the panel works without it if you fill the fields yourself.

## Related

- Serial defaults per driver family are carried over from the standalone
  [ModpollTool](https://github.com/Hapnes-dev/ModpollTool), the Python desktop
  version of this workflow.
- `modbus-list-generator` `docs/16-modbus-commissioning.md` §16.3.1 documents the
  same route and the same limits for people working without the browser.
