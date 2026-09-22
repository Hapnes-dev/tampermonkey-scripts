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
- **Parses the output into columns that suit the table polled.** Registers get the
  printed index, the protocol address, the name, the value, the scaled value, the
  unit, hex, int16, what changed since the last pass, and where the name came
  from; a 32-bit value says which two registers it spans. Coils and discrete
  inputs get a shorter set — a bit is 0 or 1, and hexadecimal is noise on it.
  Clicking any row opens every other reading of that register: binary, unsigned
  and signed, the two characters it would be as text, and everything the point
  list or the plant knows about it. modpoll's error lines become one diagnostic
  line each instead of a wall of repeated text.
- **Recovers what a refused block still holds.** Modbus refuses a read whole, so
  one unmapped register inside a 99-register block returns nothing. The block is
  halved until the readable part comes back, and the references the device will
  not serve are listed as `result.unreadable`. Capped at 40 attempts, since every
  refusal is paid for on the wire; `read({recover: false})` turns it off.
- **Scans a device.** *Scan device* asks all four tables a ladder of references
  placed where maps actually begin — 1, the round hundreds and thousands, and one
  past each, since "address 1000" in a document is reference 1001 — then treats
  every run of answering rungs as a region, halves down to each region's exact
  first readable reference, and sweeps each region until its answers run out, up
  to reference 65536. A strict device refuses a block whole, so a chunk that
  comes back short is read again with recovery on and the holes are isolated
  instead of costing their blocks; a chunk that comes back empty is told apart
  from a hole in every block by two single reads before recovery is paid for. A
  lenient device answers 0 for everything and never goes empty, so its sweep
  stops after two thousand registers of zeros past the last value. The report
  says, per table and per region, what answered, what held a value, and why the
  sweep stopped. Useful before blaming a point list.
- **One export, written for an agent.** *Save JSON* writes everything the
  console knows, as files a Copilot agent can be handed cold to check or correct
  a modbusgen list. Per register: the answer now and the answer before, both
  address bases, the raw value read every way, the list's own entry (datatype,
  scale, decimals, range), every IWMAC parameter reading that register with its
  `driver_id`, and the value the plant showed. Whole sections for every parameter
  the plant holds for the unit (polled or not — what IWMAC reads), the list as
  parsed, the last verification with its offset check, and the last scan. Where
  two sides of a register disagree the reading carries a note — a scale the plant
  implies that the list does not apply, a unit that differs, an address the plant
  maps in another table, a width that differs — stated as an observation. A
  `howToUse` block at the top tells the agent how to read it. One file, the
  header pretty-printed and each section one row per line; the plant's
  parameters are said once, on the reading where there is one, so a poll
  covering the unit does not double the file. Names are looked up when the file
  is written, not when the poll ran. For a knowledge set with its
  36 000-character ceiling per file, `__modpoll.exportParts()` splits the same
  document into files of at most 34 000 characters, each repeating the header so
  it stands alone. `__modpoll.lastExport()` is the document,
  `__modpoll.exportText()` the file.

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

## Stopping and starting the Plant Server

Reaching a serial device means taking its COM port, and the Plant Server holds
every one of them. The console can stop and start it — using the plant's own
controls, not its own invention: `stop_plant_server`, `start_plant_server_norm` and
`start_plant_server_nogen` posted to `plant_cmd.php` on the plant, which is exactly what the sys_tools page does when someone clicks those
buttons, and what IWMAC Escape offers locally.

It is the most consequential thing this panel can do — temperature logging stops,
and so do alarms, on a live store — so three rules apply:

- **Stopping takes two clicks.** The first arms the button, which then reads
  *Confirm: stop 2349 — logging and alarms off*. Only the second sends anything,
  and walking away for eight seconds disarms it.
- **Nothing restarts by itself.** No timer, no watchdog. The console stops and
  starts only when told.
- **A stop stays visible.** While the modules are down the panel carries a red
  banner naming the plant, and since a stop outlives the tab it was made in, the
  banner returns on the next load saying how long ago it happened. It clears only
  when the modules are running again.

*Check* reads which modules are running and needs no permission to do so.

## Serial devices, and what polling one costs

A unit's bus comes from the sys_tools topology, which is already on the page. A
label like `COM1 - 192.168.10.30` is both a COM port on the plant server and the
gateway behind it, and the console says which before the poll rather than after
it fails:

- **The Plant Server holds the COM port.** It polls the bus continuously, so
  modpoll cannot have that port until the service is stopped — which stops
  temperature logging and alarms. That is the plant owner's decision, and the
  console never touches it; it only tells you that is what the port error means.
- **Try ENC first.** Mode `enc` is Modbus RTU framed inside TCP, which is what a
  serial gateway in TCP-server mode expects, so the same bus can often be reached
  at the gateway address with nothing stopped. Port 4001 upwards is the usual
  mapping, one per serial port. It is worth a try before anything is stopped — on
  plant 2349 both gateways refused 502, 4001 and 4003, so there it really did come
  down to the Plant Server.

## The three traps it handles for you

| Trap | What the script does |
|---|---|
| `-r` is 1-based — the protocol address is the printed index minus one | Every row carries both numbers. The *Start is* selector says which base your input uses; choosing *protocol address* adds the one. |
| `-c` caps at 99, although `-h` claims 1-100 | Ranges are split into blocks of 99 automatically. |
| `-t` follows the Modicon prefix, not the function code | The table selector is labelled by prefix: 4 holding, 3 input, 1 discrete input, 0 coil. |

Registers outside the device's map answer with 0 rather than an exception, so a
block may span gaps safely — a row of zeros is not by itself evidence of a
missing device.

## Names from the plant's own database

*Names from plant* asks the plant what it calls the registers it is polling — no
file involved. The plant serves its configuration over JSON-RPC at
`/services/iwmac_plant/settings.php`, on the same origin as the sys_tools page:
`get_regulators` lists the units, `get_groups` and `get_parameters` give every
parameter for one of them, with its alias text, engineering unit, current value
and `driver_id`.

The `driver_id` ties a parameter to a register. modbusgen writes it as
`0_<read function>_<protocol address>`, with `.<bit>` for a bit inside a
register, behind a prefix naming plant, driver and table — so
`2313_VENT_vent_1_1_0_3_431` is read function 3, protocol address 431, which is
modpoll's reference 432 on table 4.

What that buys, on any plant, with nothing loaded:

- the grid names what it polled, with the unit and the value the plant itself
  shows — and since the plant shows the register already scaled, the detail row
  states the scale those two numbers imply (`×0.1 — the plant shows 19 where the
  register holds 190`), which is the field a vendor document most often omits;
- a register carrying several bit parameters lists all of them, each with what
  its bit currently reads, so a status word does not have to be counted out in
  binary;
- the unit list works without the Toolbox query, which is the only part that
  needs a cross-origin helper. The Toolbox is still asked first, because it alone
  knows the resolved IP, baud rate and parity.

## Verifying a modbusgen list

*Load point list* takes a modbusgen project file. From it the console reads the
addressing convention (`options.subtract_one`), the connection (`system.comm`)
and the points themselves. Each `datatype` is decoded by the grammar of the
shipped keys: `read_func` gives the Modicon prefix `-t` actually wants, `raw_type`
gives a 16- or 32-bit format, word order gives the endian flag. A key that does
not decode is reported as undecodable rather than guessed at — a wrong table
polls the wrong half of a device in silence.

*Verify list* polls every point, grouping them into ranges that merge across
small gaps and split at the count cap, then judges each answer with a fixed
vocabulary: `read`, `zero`, `refused`, `no answer`, `not polled`. A value outside
the range the list itself declares is flagged.

**The offset check** scores the whole list at shifts of −3 to +3, on two signals:
how many points land inside their declared range, and how many read non-zero.
Ranges on a plant are wide — a neighbouring register usually fits one too — so
the non-zero count is what separates a correct list from a shifted one. On the
VENT controller this identifies a list written one register low as `+1`, one
written two high as `−2`, and passes a correct list with no verdict. Treat a
verdict as a lead: confirm against a setpoint whose value is already known
before moving every address.

*Save report* writes markdown for the Copilot kit — every part states the three
address bases and the status vocabulary up front, stands alone, and stays under
the 36 000-character ceiling a SharePoint-backed agent reads whole. *Save
verification* writes the same thing as JSON.

## Read-only by construction

modpoll has no write flag: it writes when a value follows the host argument. Every
command — including one typed by hand into the preview box, and every segment of a
chained one — is tokenised first, and a second positional argument is refused with
the reason stated, whatever it starts with: `-7` behind the host is a value, not a
flag. Nothing in the panel can set a register.

The same pass keeps the command a poll and nothing more, because it runs in a
shell on the plant server. The executable must be `modpoll`, `modpoll.exe` or
`c:\iwmac\bin\modpoll.exe` — a path that merely contains the word is not run —
and every token must be made of the characters a modpoll argument can contain.
A quote, a space inside an argument, a pipe, a redirect, a `%variable%` or a line
break is refused with the token named. The API's `read()` checks its serial
settings the same way, in the words of the field: a baud rate is a number, parity
is `none`, `even` or `odd` in any of the spellings a list writes (`N`, `E`, `O`,
`0`, `1`, `2`), data bits are 7 or 8, stop bits 1 or 2.

There is a second hazard that is not about writing. Without `-1`, modpoll polls
every second forever, and a command that loses its tail on the way through Plant
Term can leave exactly that: a process flooding the shell until someone
reconnects, for everyone using it. So `-1` is the *first* argument rather than the
last — truncation then costs the host argument and modpoll refuses to start — and
chained lines are capped at 420 characters. If a session ever does go quiet with
its prompt still showing, *Reconnect* takes a fresh one; the console does it
automatically when a run prints nothing at all.

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

await __modpoll.units();                  // the plant's own unit list
await __modpoll.names('ID01');            // name registers from the plant database
__modpoll.nameFor('4', 432);              // what the plant calls that register

__modpoll.loadList(projectJson);          // a modbusgen project: points and system.comm
await __modpoll.verify();                 // poll every point in it and judge the answers
__modpoll.report();                       // [{name, text}] markdown parts, ready to upload
await __modpoll.readCompact(spec);         // same, values as a bare array
await __modpoll.raw('modpoll -1 -m tcp -a 1 -t 4 -r 430 -c 99 10.0.0.5');
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

## Tests

Two scripts in `test/`, both of which lift the code they test **out of
`Modpoll-Console.user.js` on every run**, so a change to the script cannot
quietly stop being the thing under test.

- `python test/security-matrix.py` — the command guard, in Node. Builds every
  command the form can produce (2 880 lines across mode, format, endianness,
  port, table, count and serial preset) and confirms each passes, then confirms
  twenty attack shapes are refused and nine parity spellings normalise. Exits
  non-zero on any miss.
- `python test/scan-simulation.py` — *Scan device* against simulated devices, in
  Node, with Plant Term replaced by a device model: a strict one that refuses a
  block touching anything unmapped, a lenient one that answers 0 for whatever is
  not mapped, and a strict one whose map starts at protocol address 1000. The
  scan as committed at HEAD runs on the same maps (`--old-ref` picks another),
  so a change is measured against what it replaces: what each finds, what each
  misses, and what each costs in modpoll runs and refusals.
- `python test/make-harness.py` — writes `test/harness.html`, a page that mounts
  the panel chrome with everything the IWMAC page would supply stubbed: the
  grid, the detail view, the resize grips, the corner expand control and the
  log. Serve the directory (`python -m http.server 8791` from `test/`) and drive
  it from a browser; `window.__poll`, `__detail`, `__dragGrip`, `__toggleZeroFilter`
  and `__probe` are the hooks.

Neither touches a plant. What only a plant can prove — Plant Term, the unit
list, the names — is still proven on a plant.

## Requirements

- Plant Term must be reachable. If connecting throws, it is nearly always the HTTP
  login for `*.plants.iwmac.local/secure/*` having expired — open the plant in a
  normal tab, log in once, then retry.
- modpoll must be on the plant server. Commands are written as plain `modpoll`,
  which Plant Term resolves; a plant that does not falls back to
  `c:\iwmac\bin\modpoll.exe` by itself, saying so once. `__modpoll.probe()` runs
  `modpoll -h` and reports what that plant's build supports.
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
  only one the device refuses;
- a nine-point modbusgen list verified against the device in 265 ms, with the
  values it reports matching the plant (19,0 °C supply, 14,0 °C extract, −5,0 °C
  outdoor, 800 and 400 Pa);
- the same list written one register low was identified as `+1`, and written two
  high as `−2`, while the correct list produced no verdict.

## Related

- Serial defaults per driver family are carried over from the standalone
  [ModpollTool](https://github.com/Hapnes-dev/ModpollTool), the Python desktop
  version of this workflow.
- `modbus-list-generator` `docs/16-modbus-commissioning.md` §16.3.1 documents the
  same route and the same limits for people working without the browser.
