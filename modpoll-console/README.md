# Modpoll Console

Runs `modpoll` against a plant's Modbus devices from the browser, on the IWMAC
`sys_tools` page, and hands the result back as a table — or, for an agent driving
the tab, as parsed JSON from `window.__modpoll`.

[Install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/modpoll-console/Modpoll-Console.user.js)

Matches `*://*.plants.iwmac.local:8080/secure/sys_tools/*`. It appears as
**Modpoll** in the sidebar's Tools group, under Screen Dump, and opens in the
same main panel as every other sys_tools tool. Leaving the tool and coming back
keeps the form, the last result and a running repeat — the panel is moved, not
rebuilt.

## What it does

- **Picks the device from the plant database.** *Load units* queries the Toolbox
  plant-SQL API and lists every active unit with its connection type, resolved IP
  (for Modbus TCP), COM port, baud rate and parity. Selecting one fills the form.
  The slave address is read from the last numeric segment of `driver_addr` — it is
  a starting value, not a fact, so check it against the plant when it matters.
- **Builds the command, then runs it through Plant Term.** The shell creates every
  tool's iframe up front parked at `about:blank`, so the script points that frame
  at `/secure/plant_term/` itself, connects the shell and reads back only what the
  command printed. Opening the console does not switch the main panel away from it.
- **Splits long ranges.** A count above 99 becomes several commands; the results
  are stitched back into one list.
- **Parses the output.** `[N]: value` rows become a table with the printed index,
  the protocol address, the raw value, hex, the int16 reading and ×0.1 / ×0.01
  scalings. modpoll's error lines become one diagnostic line each instead of a
  wall of repeated text.
- **Recovers what a refused block still holds.** Modbus refuses a read whole, so
  one unmapped register inside a 99-register block returns nothing. The block is
  halved until the readable part comes back, and the references the device will
  not serve are listed as `result.unreadable`. Capped at 32 attempts, since every
  refusal is paid for on the wire; `read({recover: false})` turns it off.
- **Scans a device.** *Scan device* asks all four tables where they start
  answering — doubling, then halving back — and reports the first readable
  reference in both bases. Useful before blaming a point list.
- **Exports.** *Save JSON* writes the full result; *Copy for AI* puts a compact
  form on the clipboard (values as a bare array, addresses as two anchors).

## What a deep dive on plant 2313 established

Measured against the VENT controller at 192.168.10.100, with the 2002-2004
FieldTalk build the plants carry.

| Measurement | Number |
|---|---|
| One poll, on its own | ~170 ms |
| One poll, chained with others | ~56 ms |
| A **refused** poll (exception) | ~630 ms — the device is slow to say no |
| 272 registers, three blocks | ~300 ms total |

Those numbers shape the tool: blocks go out four to a chained command line, and a
poll returns as soon as the values asked for have arrived rather than waiting out
a settle window. The same numbers explain why a device scan takes seconds — it is
paying for refusals, not round trips.

The build also turned out to support more than the memo said:

- **32-bit formats exist**: `-t 4:int`, `4:float`, `4:mod`, `4:hex`, and the same
  on table 3. `-c` still counts *values*, and a 32-bit value spends two registers.
- **`-i` and `-f` are the endianness flags** — big-endian integers and floats.
- **There is no `-0` flag in this build.** It answers "Unrecognized option", so
  nothing here can switch to zero-based addressing; `-r` is 1-based, always.
- `-r 0` is rejected outright ("Invalid reference parameter!"), and `-c 100` is
  rejected too, although `-h` claims 1-100.
- Two of its messages are misspelled — "Unknwon error!" (on TCP, usually a slave
  the gateway does not serve) and "Progam stopped with exit code".

And one thing about the device rather than the binary: **it refuses printed
reference 1 — protocol address 0 — in every table**, while answering 0 for
unmapped references higher up. A block containing that one reference was refused
whole, which is why registers 1-20 first read as silence.

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
  start: 430, count: 272, base: 'printed', // or base: 'protocol'
  format: 'float',                         // '' 16-bit | int | float | mod | hex
  bigEndian: true,                         // adds -i (int) or -f (float)
  recover: true                            // halve a refused block, default on
});
await __modpoll.scan({ host: '10.0.0.5', slave: 1 });   // which tables answer
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

## Two things the page does that are worth knowing

Both cost a version to find, and both are invisible from the code alone.

- **jQuery Terminal's `get_output()` is not the transcript.** It returns only what
  the terminal itself echoed — on Plant Term that is the two connect lines and
  nothing else. Everything the shell sends is rendered as one `div` per line in
  `#my_top .terminal-output`, which is what this script reads. Connection state
  comes from `get_prompt()`, since the prompt never appears in the output buffer.
- **The terminal renders every space as a non-breaking one**, so `innerText` hands
  back U+00A0. Output is normalised before parsing; without that, no pattern
  containing a space can match and a device answering "Illegal Data Address
  exception response!" reads as an empty result rather than an answer.

## Requirements

- Plant Term must be reachable. If connecting throws, it is nearly always the HTTP
  login for `*.plants.iwmac.local/secure/*` having expired — open the plant in a
  normal tab, log in once, then retry.
- `c:\iwmac\bin\modpoll.exe` must exist on the plant server. *Probe binary* runs
  `modpoll.exe -h` and reports the version it finds.
- The Toolbox plant-SQL API (`toolbox.iwmac.local:8505`) is needed for the unit
  list only; the rest of the panel works without it if you fill the fields yourself.

## Verified against

Plant 2313, the VENT controller at 192.168.10.100 over Modbus TCP:

- holding registers 430-449 read back live, values matching the plant (432 = 190,
  that is 19,0 °C at ×0,1; 442 = −50, 0xFFCE);
- a 272-register sweep returned all 272, contiguous, in about 300 ms across three
  chained blocks;
- `-t 4:hex`, `4:float` and `4:int` all parsed, with 32-bit values stepping two
  references at a time;
- slave 2, which the gateway does not serve, produced one diagnostic rather than
  a wait;
- reading references 1-20 returned 19 values and named printed reference 1 as the
  only one the device refuses.

## Related

- Serial defaults per driver family are carried over from the standalone
  [ModpollTool](https://github.com/Hapnes-dev/ModpollTool), the Python desktop
  version of this workflow.
- `modbus-list-generator` `docs/16-modbus-commissioning.md` §16.3.1 documents the
  same route and the same limits for people working without the browser.
