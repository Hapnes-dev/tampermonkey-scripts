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
  modpoll's error lines become one diagnostic line each instead of a wall of
  repeated text.
- **Opens a register as a card.** Clicking any row opens the register under
  it, on a white card with a blue edge that the grid row stays marked for: the
  name and, large, what its value means — 20.3 °C, with *register holds 2031*
  under it; a status word says which bits are set — then a row of badges with
  the facts that decide a point: table, reference and protocol address, access,
  the scale the plant implies, the 32-bit reading when the register and the
  next decode to what the plant shows, whether it moved on the second read,
  and the modbusgen datatype all of that suggests. Below, in columns that each
  read downwards: where it is (table, both address bases, `driver_id`, the
  command); the number read every way that applies — hex, binary, signed
  against unsigned only when they differ, the pair decoded when its region is
  32-bit, the second read; what the plant says, parameter by parameter and bit
  by bit; what the list says; and the point the plant and the device suggest,
  with the reason for every field. Where the sides disagree — the list scales
  by x0.1 and the plant implies x0.01, a value outside the declared range, a
  16-bit datatype on a register that decodes as a float with its neighbour —
  the card says so in a callout of its own. Explanations live in tooltips, not
  beside the values. Three buttons act on it: *Poll this register* reads it on
  its own at its region's width, *Watch* reads it every second, *Copy command*
  puts the modpoll line on the clipboard.
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
  stops after two thousand registers of zeros past the last value; a strict one
  stops after two chunks in a row with no answer at all, 792 registers. The report
  says, per table and per region, what answered, what held a value, and why the
  sweep stopped. Useful before blaming a point list. Every register the scan
  reads is kept, not only where each region starts — see *Save JSON* below.
  Two things happen around the sweep. Before it, the console looks up the unit
  the form points at — the one chosen in the picker, or the one the plant
  database has at that host and slave — and loads its parameters, so what the
  scan finds is named as it lands and the export can say what IWMAC reads
  without a separate click; when no unit matches it says so and scans anyway.
  After it, everything found is read once more, run by run so nothing is
  refused: a register that reads differently the second time is being
  measured, one that reads the same is a setpoint, a configuration word or a
  measurement that held still — half of what deciding a datatype needs, for a
  few seconds of polling. The grid shows the second read beside the first,
  what moved first. Last, it reads IWMAC's own side of the unit, each part on
  its own so one failure costs only that part: the unit's registration and
  status, every setting of its driver (COM port, baud rate, parity, data and
  stop bits, or the TCP server the unit's address names, plus the request
  timeout and retries), whether the driver's module is running, the other
  units on that driver and any other driver set to the same COM port, how the
  table defines each parameter (`driver_id_extra`: read function, raw type,
  byte or word swap, write function; the linear scale; active, update rate
  and whether it is the unit's online indicator), and that driver's lines of
  the Plant Server log — timeouts, invalid responses, exceptions, offline and
  online, failed writes, per parameter where the line names one. The log is
  read from the plant's own log table by driver (`ix_dyn_plant_log_YYYY_MM`),
  not from the Logs view: that view is the last 500 lines of every module
  together, and on plant 2349 PHP-APP alone filled it inside ninety minutes.
  A line naming another unit on the same driver is counted apart, and errors
  count only since the driver last started or the unit last came back online.
  The console log says what could not be read.
- **Judges the width, proves it on the wire, and sets the form.** Reading a
  float map as 16-bit registers prints the halves of every number, so the
  scan ends by judging what each region holds. Every aligned pair of
  registers is decoded both ways from the values already read: a region of
  floats decodes plausibly in one word order at one alignment and badly in the
  other three, a region of 16-bit values badly in all four. Where the unit's
  names are loaded the plant's own displayed values settle it — a value a pair
  decodes to is a 32-bit point, a value the register's own scale explains is
  not — and since any two words make *some* integer, a 32-bit integer verdict
  only ever comes from the plant. A region holding both kinds is called
  *mixed*, and the export's per-row decoding is the finer answer. For the
  best float region the console then reads a few pairs as floats with `-f`
  and without, and whichever read prints the numbers the words decode to says
  what the flag means on this plant — measured, not taken from a manual —
  while proving the region on the wire. Then the form is set: the table
  holding the most values, its densest run of them — small gaps bridged,
  empty stretches left out, since a strict device would refuse those block by
  block — at that width, word order, start and count, with the reasons in the
  log, so *Run* is the next click and prints the numbers rather than the
  halves of them. The grid shows the
  decoded 32-bit value beside each pair, and clicking a row in a 32-bit
  region aims the command at the pair, as a float or an integer.
- **Shows progress the whole time.** Plant Term hands output back as it
  arrives, and the console reads it as it arrives: a chained line of probes
  ticks on every marker the shell reaches — one refusal at a time, about
  630 ms apart on a strict device — and a block read ticks on every value or
  refusal that lands, instead of once per line. The narrowing phase knows its
  number of halvings from the widest gap and says which it is on. Between real
  updates the bar creeps towards where the next one is likely to land, on a
  timer rather than a frame callback, slowing as it gets there and never
  crossing it, and the elapsed time sits beside the text — so a device saying
  no for a second at a time reads as slow rather than dead. The log still gets
  one line per chunk opened, not one per tick.
- **One export, written for an agent.** *Save JSON* writes everything the
  console knows, as files a Copilot agent can be handed cold to check or correct
  a modbusgen list. Per register: the answer now and the answer before, both
  address bases, the raw value read every way, the list's own entry (datatype,
  scale, decimals, range), every IWMAC parameter reading that register with its
  `driver_id`, and the value the plant showed. Whole sections for every parameter
  the plant holds for the unit (polled or not — what IWMAC reads), the list as
  parsed, and the last verification with its offset check. The last scan comes
  two ways: its shape — which tables answered, the regions, the sweep summary —
  in `scan`, and, since a scan is itself hundreds or thousands of live readings,
  every register it actually found in `scanReadings`, enriched the same way a
  poll's readings are. The two reading sections are kept apart because they are
  different evidence: `readings` answers a range someone asked for, a poll;
  `scanReadings` reports whatever a sweep turned up while it was discovering
  the map. Both are the device answering just now, and neither says more than
  that — a value, not a datatype and not a scale. With no poll at all, `device`
  and `summary` fall back to the scan's own host, slave and readings rather
  than describing nothing. Where two sides of a register disagree the reading
  carries a note — a scale the plant implies that the list does not apply, a
  unit that differs, an address the plant maps in another table, a width that
  differs — stated as an observation. A `howToUse` block at the top tells the
  agent how to read it. One file, the header pretty-printed and each section
  one row per line; the plant's parameters are said once, on the reading or
  scan reading where there is one, so covering the unit does not double the
  file. Names are looked up when the file is written, not when the poll or scan
  ran. For a knowledge set with its 36 000-character ceiling per file,
  `__modpoll.exportParts()` splits the same document into files of at most
  34 000 characters, each repeating the header so it stands alone.
  `__modpoll.lastExport()` is the document, `__modpoll.exportText()` the file.
  IWMAC's side of the unit is read by a scan; after a poll, *Save JSON* reads
  it before writing, and `await __modpoll.iwmac()` does the same for an agent.

  Four more things a scan reading carries, each an inference stated as one:

  - `reread`, `changed` and `delta` — the second read, and whether it moved.
  - `wide` — the register and the next one decoded as one 32-bit value, high
    word first (modbusgen `_N`) and low word first (`_W`), as a float and as an
    integer, from the same bits modpoll already printed. *Confirmed* when the
    plant shows the number the pair decodes to — 21,5 °C where the two
    registers hold `0x41AC 0x0000` is a float, whatever the list says —
    *candidate* when only the bit pattern looks like a float. A 16-bit reading
    the plant's own scale explains is never brought here: the simplest reading
    that fits wins, and a float's high word is claimed by one pair only, so the
    row below a real float does not grow a spurious low-word-first twin.
  - `suggest` — the point a modbusgen list would carry for a register the
    plant has a parameter on: `datatype` from the shipped table
    (`A_Hold_I16_N`, `I_Hold_U32_N`, `A_Input_F_N`, `Bit_Hold` with one entry
    per bit, `Coil_X_N`, `Digital_X_N`), the scale key, unit, `rw`, group and
    `addr`, with `basis` stating every choice — why signed, why analog, which
    plant value confirmed the width. A lead to check against the vendor
    document, never a conclusion; the file says so itself.
  - `plant[].reads` — for a parameter that is a bit of the register, what that
    bit reads now.

  And two things the other sections say after a scan: a `plantParameters` row
  — a register IWMAC reads that the scan did not find — says where it fell, a
  hole inside the swept map, below or beyond it, or a table that gave no
  answer; and a `listPoints` row says whether the scan answered for its
  register and what it held. Both are the verification's answer for whatever
  the sweep covered, without a verification. The file is named after the unit
  and the scanned host when there is no poll.

  Since 1.46.0 (`schemaVersion: 2`) the file opens with what the evidence adds
  up to, and sets the device beside IWMAC's own setup:

  - `overview` — the unit, whether the device answered, how many registers
    answered and held values, how many IWMAC parameters were compared with the
    device and how many agree, the unit's status, whether its driver runs, and
    the findings' ids.
  - `findings` — the problems the evidence shows, errors first, each with a
    stable `id`, the evidence that proves it and a suggested action: the
    driver's settings differ from the ones the device answered with, the
    device answers modpoll but IWMAC is not getting answers (status, the
    communication-error parameter, timeouts or offline in the log, parameters
    without a value), another driver on the same COM port, two active units at
    one address, IWMAC polling registers the device does not answer, the online
    indicator on such a register (the driver then takes a unit that answers
    everything else OFFLINE), IWMAC showing a value its own definition does not
    give, floats that do not decode in the defined word order, parameters the
    driver log names, other units on the driver failing too (a bus problem
    rather than this unit's), inactive parameters, values IWMAC does not read,
    and a device slow to refuse. Each is an inference from the sections below
    it and names them.
  - `communication` — the connection modpoll used and the one IWMAC's driver
    is set to, compared field by field (`same`: true, false, or null where one
    side is unknown; `\\.\COM16` and `COM16` are the same port).
  - `iwmac` — IWMAC's side as collected after the scan: registration, status,
    the system parameters (communication error and the like), the driver with
    every setting and its decoded connection, module and process, the bus, the
    table's parameter counts, the log's counts and recent lines, and what could
    not be read.
  - `plant[].iwmac` on every reading row — that parameter's own definition
    (datatype with its swap, scale, format, access, write function, log
    errors) and `expected`, what that definition makes of the register modpoll
    just read. `agrees` compares it with the value IWMAC displayed; `false` on a
    register that did not move is a definition that reads the register
    differently from the device, or an old value.
  - `scanEmpty` — registers that answered 0 with nothing else to say about them,
    as ranges per table. On a lenient device they were most of the file: the
    2349 V01 export was 681 KB before, almost all of it rows like that.
  - `fieldGuide` — every field name that needs one, defined once.
  - `scan.spec`, `scan.phases` and `scan.cost` — the connection the scan used,
    how long each phase took, and what its commands cost: modpoll runs, values,
    refusals, timeouts and the time per run.

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

## What a scan costs, and why it is not parallel

Plant 2349's V01 ventilation controller (Modbus TCP, strict: it refuses every
block that touches an unmapped register) is the slow case, and it was measured
before 1.46.0 changed anything:

| Measurement | Number |
|---|---|
| One good read, on its own command line | ~1.9 s |
| One **refused** read, on its own | ~4.0 s |
| Four good reads, chained on one line | ~3.0 s |
| Four refused reads, chained on one line | ~10.1 s |
| Whole scan, four tables | 223 s |

Refusals are the cost, and they cannot be made cheaper from here: this modpoll
build has no timeout flag (`-o` does not exist), and the device, not modpoll,
decides how long a refusal takes. Nor can the reads run side by side. Plant
Term runs one command line at a time; a serial bus is half-duplex, so a second
master on it corrupts both; and a TCP gateway that serialises its RTU side only
queues the second request behind the first. What is left is asking less:

- **Two empty chunks end a strict table's sweep, not three.** On 2349 V01 the
  third empty chunk of every table, with its three single reads, found nothing
  and cost about 13 seconds — some 50 of the 223.
- **Every command is costed.** `scan.cost` counts modpoll runs, values read,
  refusals, timeouts and port errors, and `scan.phases` times ladder, narrowing,
  sweep, second read and format check, so the next saving is chosen from a
  measurement rather than a guess.

The ladder, the narrowing and the second read were left as they are: each
answers a question the rest of the scan depends on, and a scan that skips one
is faster by being wrong on some device.

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
  A held port answers `Serial port already open`.
- **COM10 and above are written `\\.\COM16`.** Windows opens COM1–COM9 by name
  but higher ports only through the device namespace, and modpoll hands the name
  straight to Windows. A bare `COM16` fails with `Port or socket open error`,
  which reads exactly like a held port and is not one — on plant 3694 the bare
  names failed that way while `\\.\COM16` and `\\.\COM17` answered, and a port a
  driver really held said `Serial port already open`. The
  console writes the device path itself since 1.45.1, in built polls and in typed
  commands alike, and says so in the log when it rewrites one.
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
await __modpoll.scan({ host: '10.0.0.5', slave: 1 });   // every register that answers, read twice; names the unit first

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
  not mapped, a strict one whose map starts at protocol address 1000, and a
  strict one whose whole map is floats. Two of them carry live registers that
  never answer the same twice, which the second read has to catch and nothing
  else may; three carry float maps, high word first and low, whose width and
  order the verdict has to name and the wire check has to prove, and each
  declares the poll the form should end up set to. The scan as committed at
  HEAD runs on the same maps (`--old-ref` picks another), so a change is
  measured against what it replaces: what each finds, what each misses, what
  each tells apart, what each judges, and what each costs in modpoll runs and
  refusals.
- `python test/export-check.py` — *Save JSON* with a scan in hand and no poll,
  against a unit whose parameters cover the shapes a list has to get right: a
  scaled 16-bit register, a float over two registers, a 32-bit counter, a status
  word read by bits, a negative writable setpoint, a register that moved between
  the two reads, parameters on registers the scan did not find, and a scan that
  judged one region mixed and proved another to be floats on the wire. Then the
  same scan again with IWMAC's side of the unit in hand: a driver set to 19200
  where the device answered at 9600, a unit in ERROR with timeouts in its log,
  another driver on the same COM port, two units at one address, a parameter
  defined unsigned where the device holds a negative number, the online
  indicator on a register the device does not answer, and forty empty coils
  that belong in `scanEmpty`. Last, the driver log's reader on lines as plant
  3694's driver wrote them, with another unit's errors mixed in. Sixty
  expectations, each printed PASS or FAIL; exits non-zero on any FAIL.
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
