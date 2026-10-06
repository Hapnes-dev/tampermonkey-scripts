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

  Since 1.48.0 the card also shows how IWMAC itself defines every parameter on
  the register, read when it opens from the Plant Server's parameter view
  (`iw_gen_driver_parameters`: the unit, `iw_par_<table>_param` and
  `iw_set_<table>` joined, one row per unit and parameter). Each field is in
  words, with its database column small under the label so the row can still
  be found in phpMyAdmin. A field with no value is not shown at all — on the
  whole card, not only here — and a section left with nothing is not shown
  either (1.49.3):
  - **How IWMAC reads it** — `driver_id_extra` as sentences (*function 4 (read
    input registers), address 208, unsigned 16-bit, no swap*; *not written*),
    `driver_id_no` (the number the Plant Server log writes: *Param write:
    19655 = 3*), `element_id` as stored — `3x0209`, `alm_0_2_0`,
    `0_123_r15_ther__s4__`, whatever the table uses — `driver_id`,
    `driver_group`, `update_freq`, `onl_ind` (whether the driver judges the unit
    online by it), `driver_type`, `hardware_datatype`, `relation`. The element
    id is also put under `driver_id` in *Where it is* once it has arrived: the
    plant's own parameter list, which the card starts from, does not carry it.
  - **How IWMAC shows it** — `alias_text`, `menu` where it differs from the element id, `eng_unit`
    decoded (`&#037` is %), the scale spelled out (*linear: raw 0 … 1000 → 0 …
    10 (×0.01)*), `format`, `range_min`/`range_max`, `parameter_type`,
    `application`, `att`, `grp`, `category_id`, `user_attribs`, and the state
    texts in `format_extra` one per line, the one the register holds marked
    *◀ now*.
  - **Logging and alarms** — `save_data` with `save_freq` (*every 1 min*, *on
    change*), `alarm_type`, `alarm_block`, `plant_pri`, `sys_pri`.
  - **The unit in IWMAC** — `unit_id`, `unit_name`, `regulator_type`,
    `grp_name` and `order_no`, `driver_adr_extra` (*node 111 · nodetype 16*),
    and when the view was built (`row_date`).

  Parameters sharing the register — the bits of a status word — get one line
  each, with their bit's state now. A register IWMAC has no parameter on shows
  none of this; a parameter missing from the view says so. The rows are read
  once per page and kept, and come from the scan's own read of the unit when
  there is one.
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
  Which lines are the unit's is decided by its real `driver_id` prefix — the
  middle part of a `driver_id` is the unit's regulator type, not its table
  (`2349_OJEXHAUST_OJ_1_1_0_4_208` in table `exhausto_OJ_v610`) — and a write,
  which the log names by number (*Write failed 19423 = 1.00*), is matched to its
  parameter through the Plant Server's parameter view, which also gives each
  parameter's state texts and logging to the export (`plant[].iwmac.states`,
  `stateNow`, `logging`, `parameterNo`). The console log says what could not be
  read.
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
  one line per chunk opened, not one per tick. The text keeps a fixed share of
  the row (1.49.4): sized to its words, it grew and shrank with every update and
  the bar beside it with it, so the fill slid back and forth while the fraction
  only rose. It says what is happening in words — *Reading discrete inputs
  (1xxxx) at 516 — 519 found · 83 commands · 1:11*, *Looking for where each
  table starts — probe 23 of 56, 9 answering*.
- **The log is a terminal transcript (1.62.0, restyled light in 1.62.1).** Every
  command sent appears as Plant Term shows it, the shell's prompt and then the
  command (`C:\iwmac\sys_tools\plant_term>modpoll -1 -m rtu …`), whatever sent
  it: a poll, a block of a long one, a scan's probes or the API. modpoll's
  answer follows exactly as printed — *Protocol configuration …*, *Protocol
  opened successfully.*, *Polling slave (Ctrl-C to stop) ...*, *Reply
  time-out!*. The one exception is the FieldTalk banner, the same three lines on
  every run (modpoll's name, its copyright and the Getopt library's), which is
  left out (1.62.2). Nothing is indented, and the blank lines between its
  blocks are kept, a run of them as one.

  The frame is light and quiet, a code block's grey in the terminal's
  monospace (the black of 1.62.0 was too heavy). Each command is a block: a
  band with the prompt dimmed, the command in full and the time it was sent at
  the right. In modpoll's answer:
  - a register's value is set apart from its reference (`[95]:` **207**);
  - a time-out or an error is red, an opened port green.

  The console's own notes are blue. Its warnings and errors sit on a tinted
  band with a bar at the left, so nothing it says can be taken for something
  the device said.

  Over the log, *Copy* takes the transcript as text, each command as the
  terminal shows it without its time. *Clear* empties the log on screen. A
  repeat still drops the banner after the first pass. The log keeps its last
  4 000 lines, as a terminal keeps its scrollback.
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
- **What could be improved, and on what evidence (1.52.0).** After *Verify list*
  the export also hands the agent what it needs to suggest edits to the list,
  all of it from the words the verification already read:
  - `verificationRows[].words` / `wordsHex` — the 16-bit registers each point is
    made of, as modpoll printed them;
  - `verificationRows[].otherDatatypes` — the same words under every other
    datatype of that width (`U32_N`, `U32_W`, `I32_*`, `F_*`; for 16-bit, the
    other signedness where it differs), scaled the way the list scales the point,
    so a wrong word order or signedness shows as one of them reading what it
    should;
  - `asViewed` — on any row the person had viewed as another datatype or scale,
    that choice and what the register reads under it;
  - `listImprovements` — one proposed edit per point: `kind` (word order,
    signedness, scale), `now`, `try` (the datatype or scales and what they
    read), `evidence`, and `strength`: **twin** (a 16-bit point of the same name
    and unit reads exactly what the other word order gives — how plant 11087's
    word order was proved), **pattern** (one word is 0 and the listed order makes
    a millions-size value, or an implausible float), **unit range** (the value is
    outside what its unit usually is, and these scales bring it inside —
    weakest). Findings `list-word-order`, `list-signedness` and
    `list-scale-leads` count them in the overview; a register named as a
    password gets neither words nor a lead;
  - `views` — the word order iw_mb.exe applies, the datatype views and IWMAC
    scalings on offer with their formula, and what was on screen when saving.

  The header repeats in every part of a split file, so these stay compact there
  and the per-point detail rides in the split sections — `listImprovements` is a
  section of its own, like `verificationRows`.
- **Every datatype at once, for the agent (1.55.0).** *Save JSON* has a seventh
  section, `everyDatatype`. It covers every register a 16-bit poll read, and
  every other register the list or IWMAC names. Each row reads the register as
  every datatype the console knows, so a Copilot agent can hold the vendor
  document's value against all of them and find the datatype without asking for
  a poll per guess:
  - `hex` holds the registers from `ref` on, as read.
  - `listed` is the list's datatype.
  - `as` maps the tail of each datatype name to its reading. Prefix `A_`/`I_` and
    `Hold` (table 4) or `Input` (table 3), and `U32_N` becomes `A_Hold_U32_N`;
    `Bit` is `Bit_Hold`.

  Values are unscaled. Some readings are left out, because they would only be
  noise:
  - a view that needs registers that were not read;
  - a float that is no plausible engineering value;
  - text with an unreadable character;
  - a register whose window of four is all zero.

  A register named as a password gives no row, and no neighbour's 32- or 64-bit
  view reads through it. Every scanned register would have been most of a
  megabyte on a large unit, nearly all of it unnamed configuration.

  Two fixes came with it:
  - A split file's `part.contents` gives each section the range of parts holding
    it (`"4-12"`), not every part number. That list had grown to 6 000 characters
    and pushed parts past the ceiling.
  - A decoded text holding `$&` can no longer break the file: sections are put in
    place by a function, not a replacement string.
- **Save JSON keeps to what the table shows, and adds every scaling (1.60.0).**
  It used to write everything known: every parameter of the unit, the last scan
  and the last verification, even for one register looked up to show an agent.
  Now:
  - With a poll in the table, the file holds only the registers polled.
  - With a search in the table, it holds only the registers found.
  - With a scan or a verification in the table, it is the whole device or list,
    as before.
  - *Find register* with nothing typed lists every named register, and saves
    everything (1.60.1).

  A focused file says so at the top, in `focus`: which registers (`table|ref`),
  how they were chosen, and what was left out. Every register section keeps only
  their rows, and the scan's and verification's summaries stay out. One register
  is about 19 k characters, nearly all of it the guide an agent reads it by.

  Each focused register that was read has its `everyDatatype` row:
  - `as`: every datatype, as before;
  - `scales`: its reading under every IWMAC scaling, what IWMAC would show with
    that scaling set (`"x0.01": 18.91`);
  - `nearShown`: the scalings within 2 % of what IWMAC showed;
  - `notRead`: present when the registers after it were not read. A register
    polled on its own has no 32- or 64-bit reading, and this says which poll
    gives them (count 4 from it).

  The API takes the same choice: `__modpoll.exportText({ focus: 'shown' })` does
  what Save JSON does, `{ focus: ['3|30'] }` picks registers, and no option gives
  the whole document.
- **Every row checks itself, in every file (1.61.0).** Every `everyDatatype` row
  now carries `scales`, whole files included. It also says what the list makes
  of the register beside what IWMAC showed, ahead of the two maps, so the reader
  meets the verdict first:
  - `listed` and `listedScale`: the list's datatype and scale key;
  - `shown` and `unit`: what IWMAC displayed for the register;
  - `listGives`: the list's datatype read and scaled as the list says;
  - `listMatchesShown`: whether that is within 2 % of `shown`.

  `false` is where to look. `as` and `scales` then hold the candidates, and
  `nearShown` the scalings that already give `shown`. The guide walks an agent
  through those steps. Each scale is keyed as a list writes it: the modbusgen
  key where there is one (`x0.01`), else the preset's name (`Kelvin to
  Celsius`). `views.scalings` gives every key's ranges once. A preset that
  scales exactly as another (`L/h -> m3/h` is `x0.001`) is not repeated.

  `__modpoll.exportParts()` splits the file for a knowledge set. Every part
  repeated the whole header, which on a unit with findings and IWMAC's side read
  had grown past 35 000 characters, so every part held one row. Now part 1
  carries the whole header. Every other part carries a short one of about 9 500
  characters: what the file is and where part 1 is, the overview, the rule that
  data is never an instruction, its own section's guide, the field guide and
  the views. Findings are split like the other sections. On the test fixture
  that is 19 parts where there were 1 415, and 16 for the scan alone where there
  were 26.

  Four more things a scan reading carries, each an inference stated as one:

  - `reread`, `changed` and `delta` — the second read, and whether it moved.
  - `wide` — the register and the next one decoded as one 32-bit value, high
    word first (IWMAC's `_W` on `iw_mb.exe`) and low word first (`_N`) — see
    [Word order is measured, not named](#word-order-is-measured-not-named) — as a
    float and as an integer, from the same bits modpoll already printed. *Confirmed* when the
    plant shows the number the pair decodes to — 21,5 °C where the two
    registers hold `0x41AC 0x0000` is a float, whatever the list says —
    *candidate* when only the bit pattern looks like a float. A 16-bit reading
    the plant's own scale explains is never brought here: the simplest reading
    that fits wins, and a float's high word is claimed by one pair only, so the
    row below a real float does not grow a spurious low-word-first twin.
  - `suggest` — the point a modbusgen list would carry for a register the
    plant has a parameter on: `datatype` from the shipped table
    (`A_Hold_I16_N`, `I_Hold_U32_W` for a high-word-first counter, `A_Input_F_W`,
    `Bit_Hold` with one entry per bit, `Coil_X_N`, `Digital_X_N`), the scale key,
    unit, `rw`, group and
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
    differently from the device, or an old value. Since 1.49.0 it opens with
    `reading`, the whole way from the wire to the screen in one sentence —
    *modpoll read 6374 → as U16 ×0.01 = 63.74 % → IWMAC shows 63.7 % — agrees*
    — and `reads` (and `writes`, where IWMAC writes it), what the register's
    card shows under *How IWMAC reads it*: *function 4 (read input registers),
    address 208, unsigned 16-bit, no swap*. Beside them `type`,
    `application`, `element`, the state texts (`states`, `stateNow`), how it is
    logged and its log number, from the Plant Server's parameter view.
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
| One good read, on its own command line (`raw()`) | ~1.9 s |
| One **refused** read, on its own (`raw()`) | ~4.0 s |
| Whole scan, four tables | 223 s |

A one-off command waits out a settle window a scan's reads do not, so those
first two numbers overstate what a scan pays. `test/scan-simulation.py` carries
V01's map and prices every run on a model calibrated on the real scan — a shell
line ~0.5 s, an answered run ~0.1 s more, a refusal ~0.63 s (what a refusal
cost on plant 2313 too) — which reproduces the 223 s within seconds. It says
where the time went: the ladder ~32 s, the sweep ~180 s, 193 of the scan's 232
refusals, most of them spent proving where each small map ends.

Refusals are the cost, and they cannot be made cheaper from here: this modpoll
build has no timeout flag (`-o` does not exist), and the device, not modpoll,
decides how long a refusal takes. Nor can the reads run side by side. Plant
Term runs one command line at a time; a serial bus is half-duplex, so a second
master on it corrupts both; and a TCP gateway that serialises its RTU side only
queues the second request behind the first. What is left is asking less:

| V01, in the calibrated model | Time | Refusals |
|---|---|---|
| 1.45.1 | 219 s | 232 |
| 1.46–1.48: two empty chunks end a strict sweep, not three | 198 s | 204 |
| 1.49: an edge is searched inside the block already read short | 175 s | 180 |
| 1.49: past IWMAC's last register, the end is proved with less | **141 s** | 136 |
| 1.49: the same device scanned again, from its known map | **13 s** | 0 |

- **The edge inside the block that came back short.** Finding where a map ends
  used to ask again about everything to the end of the chunk — 297 registers,
  then 148, then 74, each a refusal — before narrowing down inside the one
  block the chunk's own read had already shown was refused. Now the search
  starts there, wherever everything before it in the block has answered.
- **IWMAC's list as a hint for effort.** Past the highest register IWMAC (or
  the loaded list) reads in a table, a stretch with no answer is the map's end
  far more often than a gap, so it is proved with a look-ahead of 8 registers
  instead of 128 and one empty chunk instead of two. Everything up to that
  register is swept as before, and the ladder still looks for regions beyond it
  — the simulation's device whose list knows two of three areas still finds the
  third. What this gives up: an island within 128 registers past IWMAC's last
  register, after a gap of more than 8, not at a ladder rung.
- **The known map.** A full scan that runs to its end keeps the map it found —
  each table's answering ranges — in the userscript manager's storage, keyed by
  plant, mode, address, port and slave, the forty most recent devices. The next
  *Scan device* on the same device reads exactly those ranges as block reads
  nothing refuses, then reads them again and judges widths as a full scan does:
  seconds instead of minutes. It checks the map as it reads: a range that comes
  back short means the device changed, and the scan looks for its map again
  (the simulation changes V01's map under it to prove that); a device that
  answers none of it is reported as answering nothing rather than searched for
  at length. *find map again* next to the button forces a full scan, and the
  export says which it was: `scan.mode` is `known map` or `full discovery`,
  `scan.mapFrom` when the map was found.
- **Every command is costed.** `scan.cost` counts modpoll runs, values read,
  refusals, timeouts and port errors, and `scan.phases` times ladder, narrowing,
  sweep, second read and format check.

The ladder, the narrowing and the second read of a full scan are left as they
are: each answers a question the rest of the scan depends on, and a scan that
skips one is faster by being wrong on some device.

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

- **Modbus RTU needs the Plant Server stopped; Modbus TCP does not.** The
  Plant Server polls a serial bus continuously and keeps its COM port open, so
  modpoll cannot have that port until the service is stopped — with IWMAC
  Escape (*Stop PlantServer*) or *Stop Plant Server* here, which also stops
  temperature logging and alarms. That is the plant owner's decision. A TCP
  device (and ENC to a serial gateway) is reached over the network and runs
  beside the Plant Server, stopped or not. A held port answers `Serial port
  already open`; since 1.49.1 a scan or a verification stops at that first
  answer and says so — before, a scan counted every such answer as a refusal,
  probed on through its whole ladder and ended by reporting a device that
  answers nothing. A scan of a device scanned before reads its known map, so
  the time the Plant Server has to stay down for an RTU scan is seconds.
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
register, behind a prefix naming plant, driver, the unit's regulator type and
its address — so `2313_VENT_vent_1_1_0_3_431` is read function 3, protocol
address 431, which is modpoll's reference 432 on table 4. The regulator type is
not always the table: plant 2349's V01 is `2349_OJEXHAUST_OJ_1_1_…` in table
`exhausto_OJ_v610`.

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
  knows the resolved IP, baud rate and parity;
- *Find register* searches the names — alias text, group, or a reference —
  while you type, up to 200 matches; with the box empty, the button (or Enter)
  lists every register the plant and the loaded list name, all of them, by table
  and reference. Click one to poll it. Emptying the box while typing goes back
  to what was on screen before.

## Verifying a modbusgen list

*Load point list* takes a modbusgen project file. From it the console reads the
addressing convention (`options.subtract_one`), the connection (`system.comm`)
and the points themselves. Each `datatype` is decoded by the grammar of the
shipped keys: `read_func` gives the Modicon prefix `-t` actually wants, `raw_type`
gives one register or two, and the swap letter gives the word order the way
IWMAC's driver applies it. A key that does not decode is reported as undecodable
rather than guessed at — a wrong table polls the wrong half of a device in
silence.

Since 1.50.0 every point is read as the 16-bit words it is made of, and a 32-bit
value is put together by the console the way `iw_mb.exe` puts it together — not
with modpoll's own `int`/`float` formats, which follow modpoll's conventions (and
whose `-i` some plants' builds do not have). A verification therefore shows a
32-bit point as IWMAC will: a `_W` point on a low-word-first device reads as the
millions IWMAC would show, where 1.49 passed it.

### Word order is measured, not named

`N` and `W` say what the driver does with a 32-bit value's two registers, and
neither driver document says which register `N` takes as the high word. Measured
on plant 11087 (`iw_mb.exe`, *Driver ModBus 2.6*, 2026-09-29): a 2000 l/s setpoint
the device holds low word first, `[3392, 3]` = 200000 × 0.01, showed in IWMAC as
2222981.15 under `U32_W` and correctly under `U32_N`. So **`_N` takes the first
register as the low word and `_W` as the high word** — the reverse of how 1.49 and
earlier read the letters. Signed 32-bit and floats are assumed to follow (plant
8848's CVM-C10 list, `_W` on a meter whose manual proves high word first, agrees).
One constant in the script, `IWMAC_WORD_ORDER`, carries this, and every decoder,
suggestion, IWMAC comparison and verification goes through it; the evidence is
owned by modbus-list-generator `docs/15` §2.1.

### Viewing a register as another datatype

The **type** column is a picker. Choose another datatype for a row and the console
shows that register as IWMAC would under it — the value, the list's scale applied,
the words in hex, and in the row's tooltip the word order used and whether it is
measured or assumed. **Display only: the loaded point list is never changed**, and
nothing is written anywhere. A viewed row is tinted; the summary line counts the
views and offers *clear views*.

Since 1.53.0 the picker offers every datatype modbusgen's table has a register
reading for (docs/15 §6), grouped by how many registers each spans:

- **16-bit, one register:**
  - `U16`, `I16`, and `U16_R` / `I16_R` with the bytes swapped.
  - `U16_W` / `I16_W`, which on one register read as `_N`.
  - `rU16` / `rI16`, bit order reversed.
  - `BCD4` and `BCD35`.
  - `CLK_N` / `CLK_R`, a count shown as hh:mm.
  - `Bits`, the register drawn as its sixteen bits — what a `Bit_Hold` or
    `Bit_Input` point picks one of.
- **32-bit, two registers:**
  - `U32_N`, `U32_W`, `I32_N`, `I32_W`, `F_N`, `F_W` — the register and the next
    one, put together by `IWMAC_WORD_ORDER`.
  - `U32_R`, `I32_R`, `F_R`, with the bytes of each word swapped.
  - `STR4_N` / `STR4_R`, four characters of text.
- **64-bit, four registers:**
  - `U64U32` and `I64I32` in `_N`, `_W` and `_R`. These show what IWMAC keeps, the
    low 32 bits, with the whole 64-bit number in the tooltip.
  - `D` in `_N`, `_W` and `_R`, an IEEE 64-bit float.
  - `STR8_N` / `STR8_R`, eight characters of text.

The ten 1.50 keys decode exactly as they did. Every other one follows docs/15 and
the measured word order: `_N` takes the first register as the least significant
word, `_W` as the most, and `_R` swaps the bytes of each word in `_N` order. None of
those has been measured on `iw_mb.exe`, and each row's tooltip says so.

**Full datatype names (1.54.0).** The picker and the card name every view the way a
point list writes it, for the table being read:
- `-t 4` gives `A_Hold_I16_W` / `I_Hold_I16_W`, and `-t 3` gives `A_Input_…` /
  `I_Input_…`.
- `BCD`, `CLK`, `STR` and the reversed-bit types have only the `I_` name, as in
  modbusgen's table.
- A bit view is `Bit_Hold` / `Bit_Input`.

`A_` and `I_` read the same words the same way; the letter is how IWMAC presents
the value. `test/decode-check.py` checks that every name shown is a row in
modbusgen's `data/tables/datatypes.csv` when that repository sits beside this one.

**Click a register to choose from all of them at once (1.53.0).** The detail card a
row opens has a *View as* section. Since 1.53.1 it is three lists side by side, one
per register width. Each row holds the full names and what this register reads as
under them, with the values lined up on the right. What a datatype means is in its
tooltip. With the table expanded to fill the tab, the card fills it too (1.54.1):
the facts flow into as many columns as fit and the three lists widen. In the panel
it keeps its 1120-pixel cap.

A click on a row shows the grid row that way, and the card opens again on the same
register, so the next datatype is one click away too. Since 1.56.0 the card's big
number follows the choice: the value under that datatype, scaled the way the row
would scale it, with the unit. The scale is a chosen scaling, else the list's
scale, else the factor the plant's own display implies, at the plant's decimals.
Underneath it says what the datatype reads and what the register holds — for
example *61.6 °C — as I_Input_rU16_N it reads 6160 · register holds 2072*. The one showing is marked
with an amber stripe. A datatype that cannot be read here is greyed out — `BCD4` on
a word with a digit above 9, or a 64-bit view on the last register polled. *as
read*, beside the heading, goes back to the list's own.

In the register grid a view needs a 16-bit poll, which has the raw words; a poll
in modpoll's own 32-bit formats has already put them together modpoll's way, so
the picker is disabled there and says so. In a verification a view decodes the
words the verification already read — no second poll. Clicking a 32-bit point in
a verification now aims the form at its two 16-bit words, which works on every
modpoll build and leaves the view to decide how they go together.

The same from the API: `__modpoll.viewAs('3', 191, 'U32_N')`, `__modpoll.views()`,
`__modpoll.clearViews()`, and `__modpoll.decode([3392, 3], 'U32_W')` for words in
hand.

### Scalings

IWMAC scales a value linearly. A parameter holds four numbers, `raw_min`, `raw_max`,
`eng_min` and `eng_max`, and shows

```
eng = eng_min + (raw − raw_min) × (eng_max − eng_min) / (raw_max − raw_min)
```

Since 1.58.0 the console scales the same way, with the catalogue Supermarket-superuser
offers when a parameter is scaled. It has three groups:
- **Multipliers:** `x1000` down to `x000.1`, `/5` and `Raw value * 400 / 1000`.
- **Conversions:** `Kelvin to Celsius`, `L/s -> m3/h` and the other flow units, and the
  energy flow rate.
- **Digital and current transformers:** `Invert`, `MV-alarm` and the six CT ratios.

Every key a modbusgen list can carry is in it too. A preset that modbusgen has a key
for carries that key, so `x00.1` is `x0.01` and `L/s -> m3/h` is `x3.6`; a choice
made here can then be written into a list. A preset without a key is set in IWMAC
itself, by its four numbers.

A reading is shown with the decimals its scaling implies: as many as its factor and
offset state, which is the list rule that pairs `x0.1` with 1. Where those run past
four, as `x65`'s ×0.000152587890625 does, it shows up to six decimals.

**The scaled column is a picker (1.51.0).** Closed, it shows what it always did — the
value under the list's scale, what the plant shows, or the bare reading — followed by
where that comes from (`x0.01, list`, `IWMAC shows`, `unscaled`). Open, it lists the
same reading under every scaling, in the three groups, so opening it *is* the
comparison. Choosing one shows that scaling on the row; the first entry goes back.
**Display only: the point list keeps its own scale.** It combines with a datatype
view — the scaling then applies to the viewed value — and *clear views* clears both.

**Click a register to choose its scaling as well (1.57.0, IWMAC's scalings since
1.58.0).** Under *View as*, the detail card has a *Scale* section in the same look,
with a column per group. Each row holds:
- the preset;
- what it does (`÷10`, `×3.6`, `raw − 273.15`);
- the value the reading gives under it.

Its tooltip has the four numbers, the formula with this reading in it, and the
modbusgen key, or a note that there is none. The reading is the one the scaled cell
scales: what the chosen datatype reads, when one is chosen. Three marks help pick:
- a grey tag gives the modbusgen key where the preset's label is another;
- `list` sits on the list's own scale;
- `IWMAC` sits on any scaling that gives the number the plant showed for this
  register when its names were read, to the decimals the plant shows.

A click shows the row under that scaling, and the card opens again on the same
register. The big number follows: *745.2 °C — under L/s -> m3/h (x3.6), display only
· register holds 207*. *own scale*, beside the heading, goes back.

Under the lists, as in Supermarket-superuser:
- **Custom:** `raw_min`, `raw_max`, `eng_min` and `eng_max`, filled with the scaling
  showing or the list's. Its result and formula follow the boxes as they are typed.
  *Use* (or Enter) shows the row under it.
- **Calculator:** *raw X should read Y*, with this reading as X and, where the plant
  shows a number, that number as Y. It makes the scaling 0…X onto 0…Y and says
  which preset that is, if any.

A custom scaling that scales the same as a preset is shown as that preset. Otherwise
it is listed as `raw 0..4095 -> 0..100`, the same text the export and the API use.
The section is in the cards of the register grid and of a verification, where the row
has a scaled cell to show the choice in. A text view (`STR`, `CLK`, bits) has nothing
to scale, and the section says so.

**A list's scale key is read through modbusgen's table (1.58.0).** `data/tables/scaling.csv`
gives the four numbers modbusgen writes into IWMAC for each key, and four keys do not do
what their text says. Before 1.58.0 the console read them from their text:

| key | IWMAC scales it | the console read it as |
|---|---|---|
| `x65` | ×10/65536 (0…65536 → 0…10) | ×65 |
| `x0036` | ÷277 | ×36 |
| `x0.000001` | ÷100 000 (0…1000000 → 0…10) | ×0.000001 |
| `pa` | raw − 30000 | not understood |

The point list's *scale* row in the card now says what a key does, for example
`x65 (×0.00015259)`.

IWMAC's own definitions are read the same way. Scale mode 3, *scale, format and
clipping*, scales as mode 1 does, as Supermarket-superuser's `isScalingActive` has
it. Before 1.58.0 the console compared a mode-3 parameter unscaled.

From the API:
- `__modpoll.scaleAs('3', 95, 'x3.6')` takes a preset's label or a modbusgen key.
- It also takes the four numbers, as `'raw 0..4095 -> 0..100'` or `[0, 4095, 0, 100]`.
- `__modpoll.scalePresets(2000)` gives every scaling's four numbers and value for a
  number in hand.

*Save JSON* lists each scaling chosen with its four numbers (`views.active[].scaling`)
and states the formula once (`views.scaleFormula`).

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

The host argument is held to what a poll needs, because Windows opens it as it
stands: a COM port (`COM3`, `\\.\COM16`) on a serial mode, an IPv4 or IPv6
address or a host name on a network one, either when the command names no mode.
A UNC path would have the plant server open an SMB connection to whatever server
it names and offer that server its credentials; `\\.\PhysicalDrive0` is a disk;
a name on a serial mode is a file in the working directory — all refused, typed
or passed to the API. So are control characters anywhere in a line, the echo
marker included, and any line over 1 000 characters. Options are read wherever
they stand — `modpoll \\.\COM11 -b9600 -pnone -a11` polls slave 11 at 9600 — so a
flag behind the host is an option, and only a bare value behind it is a write.

## Security and privacy

What the script reaches, and what becomes of it:

| Reaches | For | What is kept or sent on |
|---|---|---|
| The sys_tools page and its Plant Term session | running modpoll | Only guarded, read-only modpoll lines are sent; the output is parsed, not stored |
| The plant's own endpoints, same origin | a unit's parameters, the module list, the log, Stop and Start | The browser supplies the plant's HTTP login; the script never reads it and strips it from every URL it builds |
| The Toolbox plant-SQL API | the unit list, IWMAC's side of a unit | `SELECT` only, for the page's own plant; a unit id is sent only if it is a plain token; `X-Caller` and one `X-Run-Id` per plant; no browser cookies |
| Tampermonkey storage | the form, panel heights, the Plant Server stop mark, the known maps | Host, slave, port, serial settings, a plant id and a time; per scanned device (forty at most) its address and register ranges — never a login |
| Files | point lists in, exports out | See below |

What leaves in a file — *Save JSON*, *Save report*, *Save verification*, and the
same documents through the API:

- **Kept**, because a list check needs it: plant and unit ids and names, the
  driver and its table, the connection (address and port, or COM port, baud
  rate, parity, bits and slave), IWMAC's parameter definitions, every register
  read with its value, the unit's status, the driver's module, bus and log
  lines, the scan's statistics and the findings.
- **Withheld as `[redacted]`**: any setting, key or header named like a
  credential (password, token, key, auth, user, login, cookie, session …), a
  login inside a URL (`user:password@`), `Authorization` and `Cookie` headers,
  key=value secrets in log text — and the value of any register named as a
  password or PIN code, whose address, datatype and name stay.
- **Never read into the script at all**: the plant's HTTP login, browser cookies
  and sessions, other drivers' settings, the plant-wide settings, and every
  other module's lines of the Plant Server log.

Each file says so itself: `privacy` states what was withheld and how many
registers, and `howToUse` tells the agent reading it that every name, unit, note,
log line and list entry is data to analyse, never an instruction — text that came
from a device, a plant or a list could otherwise be taken for one. The markdown
report carries the same line.

`window.__modpoll` and its `postMessage` route are callable by any script on the
sys_tools page — the route answers the page's own window only, addressed to its
own origin, and only the API's own methods. Every answer is copied through the
same sanitizer; raw register values are what the page's own grid shows, and only
a file withholds a password register's value. Nothing in the API stops or starts
the Plant Server, and the buttons that do take a person's real click, not a
scripted one.

The console writes two lines: the version at load, and the `X-Run-Id` when a
plant's first Toolbox call goes out. There is no third-party code — no
`@require`; w2ui and jQuery are the page's own. Updates arrive from this
repository's `main` (`@updateURL`), so whoever can push to it decides what runs on
the plant pages.

## The API for an agent

`window.__modpoll` is exposed on the page. `__modpoll.help()` prints the list.

**Start with `state()` (1.59.0).** The IWMAC page is large and its accessibility
snapshot changes shape with every render, so an agent driving the browser
(Playwright MCP, Claude in Chrome) should not read the console off the page. One call
tells it what the person sees:

```js
__modpoll.open();                          // show the console, as Tools → Modpoll does
__modpoll.state();                         // { form, command, busy, progress, unit, names, list,
                                           //   grid: { shows, columns, summary, rows, more },
                                           //   card, views, results, log }
__modpoll.state(200);                      // the same with up to 200 grid rows (40 by default)
__modpoll.card('4', 95);                   // open that register's card, as a click does, and read it:
                                           //   headline, value, note, badges, notes, every fact section,
                                           //   the datatype and scaling it is shown under, and the
                                           //   scalings that give what IWMAC shows
__modpoll.card();                          // the card that is open now, or null
await __modpoll.useUnit('ID01');           // pick a unit as the picker does: address, slave, serial, names
__modpoll.setForm({ table: '3', start: 191, count: 2 });   // fill the form; the command follows, nothing runs
await __modpoll.run();                     // run what the form says, as Run does; returns state()
```

`grid.shows` says which reading the table holds: `registers`, `bits`, `verification`,
`find` or `scan`. Each row is keyed by its column headings, a picker cell given as its
chosen entry, and carries `key` (`table|ref`), which is what `card` takes. The person
sees every step, since these drive the same form, buttons and cards they use.

The page itself is labelled for the same readers:
- the panel is a region named *Modpoll Console*, with a line, read by the
  accessibility tree and not drawn, pointing at `state()`;
- every field is named by its label (*Slave (-a)*, *Start (-r)*);
- the table is named for what it holds (*Registers as polled*);
- an open card is a region named for its register (*Register card: Tilluft*);
- the summary line is a status and the log a log.

A snapshot alone is therefore enough to find the way.

```js
await __modpoll.devices();                 // units from the plant database
await __modpoll.read({                     // full result
  host: '10.0.0.5', slave: 1, table: '4',
  start: 430, count: 272, base: 'printed', // or base: 'protocol'
  format: 'float',                         // '' 16-bit | int | float | mod | hex
  bigEndian: true,                         // adds -i (int) or -f (float): high word first, IWMAC's _W
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

__modpoll.decode([3392, 3], 'U32_N');      // words as iw_mb.exe reads them → { value: 200000, … }
__modpoll.viewAs('3', 191, 'U32_N');       // show one register as another datatype, display only
__modpoll.scaleAs('3', 95, 'x3.6');        // show one register under another scaling, display only
__modpoll.scaleAs('3', 95, [0, 4095, 0, 100]);   // ... or under four numbers of your own
__modpoll.scalePresets(2000);              // [{ scale: 'x1000', key, rawMin, rawMax, engMin, engMax, value, text }, …]
__modpoll.views();                         // [{ table, ref, view, scale }]
__modpoll.clearViews();                    // every register as read, listed and scaled again
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

Four scripts in `test/`, each of which lifts the code it tests **out of
`Modpoll-Console.user.js` on every run**, so a change to the script cannot
quietly stop being the thing under test.

- `python test/security-matrix.py` — the command guard, in Node. Builds every
  command the form can produce (2 880 lines across mode, format, endianness,
  port, table, count and serial preset) and confirms each passes, with the field's
  own shapes — flags behind the port among them — then confirms twenty attack
  shapes are refused, nine parity spellings normalise, COM10 and above are
  written `\\.\COMn`, and nineteen host, marker and length shapes are refused: UNC
  and device paths, a name on a serial mode, control characters in the echo
  marker, an over-long line. Exits non-zero on any miss.
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
- `python test/decode-check.py` — the word order and *view as*, in Node, pinned
  to plant 11087: the registers it returned on 2026-09-29 decoded under every
  suffix beside what IWMAC showed for them (2222981.15 under `U32_W`, 200000
  under `U32_N`), the 16-bit views, a refused 32-bit byte swap, the view
  catalogue, and IWMAC's scalings. For the scalings it checks:
  - the catalogue holds Supermarket-superuser's 23 presets and every modbusgen key;
  - each reading carries the decimals its scaling implies (222298115 under `x0.01`
    prints 2222981.15), offsets (293 K is 19.85 °C) and inversion included;
  - custom scalings, and a custom one that is a preset found as it;
  - the list's keys read through modbusgen's table (`x65` is ×10/65536, `pa`
    subtracts 30000);
  - which scaling gives the number IWMAC shows (207 gives 20,7 under `x0.1` and no
    other);
  - the card's big number under a chosen scaling, with and without a datatype view.

  Then a whole verification through the shipped `verifyPointList`
  against a map of those registers — every point read as 16-bit words, a `_W`
  point shown as IWMAC shows it, and the words kept for views but out of the JSON.
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
  that belong in `scanEmpty`. Then the driver log's reader on lines as plant
  3694's driver wrote them, with another unit's errors mixed in. Last, what may
  leave: a clean export untouched by the sanitizer, text that only looks like a
  secret left alone, and a driver login, a URL login, a list's password, a
  password register and a verification all withheld; unit ids that may not
  reach SQL; and nesting, Maps and Dates through the sanitizer. And the Plant
  Server's parameter view on two of plant 2349's own rows — a scaled input
  register and a state word — as the card writes them out, every column
  present, the state marked *now*, and a failed write matched to its parameter
  by number; and the one-sentence `reading` from modpoll's number to IWMAC's
  screen, for a scaled register, a float and a value IWMAC shows differently.
  And a verification on plant 11087's own words: each point's words and its
  other datatypes, `listImprovements` for a twin-proved word order (3x0400 to
  `_N`, 2000 l/s), a zero-word pattern, a temperature that only makes sense
  signed and a percentage outside its range, `asViewed`, the `views` block, a
  password point with neither words nor a lead, and a split whose every part
  stays under the ceiling. And a focused file (1.60): one polled register on
  its own, with its datatypes, its scales and the scaling near what IWMAC
  showed; a search's registers without the poll that read none of them; and the
  datatypes a lone register cannot have, and the whole file again for Find register with nothing typed. Then every row checking itself (1.61): the list's reading beside what IWMAC showed, wrong for the float the list declares I16 and right for a point that is, the verdict ahead of the maps, and part headers short enough to leave room for rows. 145 expectations, each printed PASS or
  FAIL; exits non-zero on any FAIL.
- `python test/make-harness.py` — writes `test/harness.html`, a page that mounts
  the panel chrome with everything the IWMAC page would supply stubbed: the
  grid, a verification's grid, the detail view, the resize grips, the corner
  expand control and the log, and the agent API as shipped. Serve the directory
  (`python -m http.server 8791` from `test/`) and drive it from a browser;
  `window.__poll`, `__verify`, `__detail`, `__dragGrip`, `__toggleZeroFilter` and
  `__probe` are the hooks, and `window.__api` is the API, `state()` and `card()`
  reading back what the hooks drew.

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
  list and for IWMAC's side of a unit after a scan; the rest of the panel works
  without it if you fill the fields yourself. Every call sends the page's own
  plant id and two headers, the convention AK3-Autoscan, Topology Copy and SQL
  Equipment Import share: `X-Caller: Modpoll-Console`, and one `X-Run-Id` per
  plant, reused by every call for that plant so the Toolbox log reads them as
  one run. Errors quote the run id.

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
