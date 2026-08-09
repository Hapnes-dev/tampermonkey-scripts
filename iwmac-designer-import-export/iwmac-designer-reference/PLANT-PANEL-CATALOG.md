# Coop Extra fleet — plant panel catalog

Surveyed 2026-08-08 from the live compiled-panel store (read-only `iw_load_ctrls.php` fetches), 41 Coop Extra plants, 231+ panels. Machine-readable raw data: [reference_data/plant-panel-survey.json](reference_data/plant-panel-survey.json). Panel-type conventions and best copy-sources: [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md).

**How to read the tables:** *Vis* ✅ = visible in the plant view, *hidden* = `visible=4` (reachable by navigation/panel-order only). *Linked* = objects with a real `driver_id` / total objects (incl. container items). *Cont* = containers. *BG* = embedded background image size ( — = none).

## Fleet summary

- **41 plants, 231 stored panels** (plus 9914's extra room panels — 35 total there).
- **Standard inventory:** every plant has `Oversikt` + `Maskin`; most add `Energi` and one or more `Ventilasjon` panels; common extras: `VGV`/`Varmegjenvinning`/`Akkumulator`, `Kondenssystem`, `Varme`/`320.001`, `Kurver`.
- **Sizes:** 201 panels at **1400×750** (the fleet standard), 26 at **1280×1024** (older-era panels, mostly Kurver/Swegon detail pages + all of 9149), 3 at 1440×750 (9585), 1 at 1400×755.
- **Zero V2-era objects** in the whole fleet — everything is modern V3 style.
- **Containers are rare** (only 9652/9653 Ventilasjon with 1, and 9914's room-card panels); **graphics: 0 everywhere**.
- **Backgrounds:** ~98% of panels sit on an embedded PNG. Ventilasjon panels typically use the 6 KB blank background and draw the duct layout with objects.
- **Backup convention:** `_old`, `Gammel`, `_copy`, `_relinked` suffixed panels are kept hidden as history — never edit those, they are snapshots.
- **9914 (EXTRA Hunstad)** is the outlier: 35 panels including a container-built per-room system (`Romtype*`, `Rom NNN`) and `Plan 1`/`Plan 2` floor plans — the only plant in the fleet using containers at scale.
- **9486 (Coop Extra Igor Mitt)** is Swedish (`Översikt`, panel `KA1`).

## Separate MENY ventilation batch — 20 attempted plants

This is not part of the Coop Extra fleet totals above. The focused [MENY ventilation corpus](VENTILATION-CORPUS.md) derives from the corrected [101-panel raw batch](reference_data/plant-panel-survey-meny-20.json) and its [machine-readable match set](reference_data/ventilation-panel-corpus.json). The authenticated GET-only rerun passed offline validation: 20 plants, 42 JSON-backed panels, 59 XML-only panels, and no plant, unit, or panel errors.

- **Matched (16):** `8001`, `8002`, `8016`, `8049`, `8075`, `8088`, `8124`, `8132`, `8146`, `8150`, `8158`, `8205`, `8214`, `8232`, `8239`, `8272`.
- **Zero match (4):** `8045`, `8076`, `8098`, `8289`. **Partial: 0; failed: 0.**
- **34 matched panels:** 14 JSON / 20 XML-only; 33 visible / 1 hidden; 30 V2-bearing.
- **Discovery:** 2 panel-and-unit (`both`), 30 exact panel-linked unit-name, 2 panel-name only. Opaque IDs and unrelated plant-wide unit names never classify a panel.
- **Compiled XML binding:** retain a unit ID only when a valid `<id>` (= `driver_id`) and valid `<unit_id>` occur on the same `<data>` object.

Plant `9099` remains the separate canonical production example outside this MENY batch: panel `360.001 Ventilasjon` joins `V01` to the exact live same-plant inventory name `360.001Ventilasjon`. The spaced SQL sample is sample/stale formatting and does not override that live name. Generated `ventilation_demo_360001.json` remains demo-only and contributes to no production total. It is **not a file in this repository** — it was an uncommitted 2026-08-08 session artifact, recorded in the corpus only as a counter-example (`present_in_repository: false`).

The table below contains all 34 matched records plus one coverage row for every zero-match plant. `—` means the corpus does not know that field; in particular, XML-only dimensions and linked totals are not zero. All matched panel `fetch_error` fields and all four zero-match plant/unit error fields are null.

| Plant | Panel | Match / outcome | Source | Vis | Size | Objects | Linked | Error |
|---|---|---|---|---|---|---:|---:|---|
| 8001 MENY Rona | Ventilasjon | `both` | JSON | visible | 1280×1024 | 80 | 57/80 | none |
| 8001 MENY Rona | Energi | `unit_name` | JSON | visible | 1050×745 | 12 | 12/12 | none |
| 8002 MENY Bekkestua | 360.01 Ventilasjon | `both` | XML-only | visible | — | 77 | — | none |
| 8002 MENY Bekkestua | Energi | `unit_name` | JSON | visible | 1050×745 | 14 | 14/14 | none |
| 8016 MENY Støletorget | 360.01 Butikk | `unit_name` | XML-only | visible | — | 59 | — | none |
| 8016 MENY Støletorget | Energi | `unit_name` | JSON | visible | 852×713 | 8 | 8/8 | none |
| 8049 MENY Osloveien Hønefoss | 360.01 Butikk | `unit_name` | XML-only | visible | — | 107 | — | none |
| 8049 MENY Osloveien Hønefoss | Energi | `unit_name` | XML-only | visible | — | 18 | — | none |
| 8075 Meny GS | 360.01 Butikk | `unit_name` | XML-only | visible | — | 103 | — | none |
| 8075 Meny GS | Energi | `unit_name` | XML-only | visible | — | 4 | — | none |
| 8088 MENY Romeriksenteret | 360.01 Butikk | `unit_name` | XML-only | visible | — | 84 | — | none |
| 8088 MENY Romeriksenteret | Energi | `unit_name` | XML-only | visible | — | 4 | — | none |
| 8124 MENY Alna | 360.01 Ventilasjon | `panel_name` | JSON | visible | 1280×1024 | 95 | 71/95 | none |
| 8124 MENY Alna | Energi | `unit_name` | JSON | visible | 1400×750 | 17 | 17/17 | none |
| 8132 MENY Rasta | 360.01 Butikk | `unit_name` | XML-only | visible | — | 77 | — | none |
| 8132 MENY Rasta | Energi | `unit_name` | XML-only | visible | — | 4 | — | none |
| 8146 MENY Høvik | Tørrkjøler og beredersystem | `unit_name` | JSON | visible | 1280×1024 | 84 | 52/84 | none |
| 8146 MENY Høvik | 360.01 Butikk | `unit_name` | XML-only | visible | — | 68 | — | none |
| 8146 MENY Høvik | Energi | `unit_name` | JSON | visible | 1050×745 | 16 | 16/16 | none |
| 8150 MENY Stovner | Tørrkjøler og beredersystem | `unit_name` | JSON | visible | 1280×1024 | 38 | 32/38 | none |
| 8150 MENY Stovner | 360.01 Butikk | `unit_name` | XML-only | visible | — | 91 | — | none |
| 8150 MENY Stovner | Energi | `unit_name` | XML-only | visible | — | 8 | — | none |
| 8158 Meny Trekanten | Tørrkjøler | `unit_name` | XML-only | visible | — | 49 | — | none |
| 8158 Meny Trekanten | 360.01 Butikk | `unit_name` | XML-only | visible | — | 35 | — | none |
| 8158 Meny Trekanten | Energi | `unit_name` | JSON | visible | 1400×750 | 6 | 6/6 | none |
| 8205 MENY Brakerøya | Tørrkjøler og beredersystem | `unit_name` | JSON | visible | 1280×1024 | 38 | 32/38 | none |
| 8205 MENY Brakerøya | 360.01 Butikk | `unit_name` | XML-only | visible | — | 110 | — | none |
| 8205 MENY Brakerøya | Energi | `unit_name` | JSON | visible | 1400×750 | 12 | 12/12 | none |
| 8205 MENY Brakerøya | 360.01 UR | `unit_name` | XML-only | hidden | — | 30 | — | none |
| 8214 MENY Langhus | Energi | `unit_name` | JSON | visible | 1280×1024 | 10 | 10/10 | none |
| 8232 MENY Askim | Energi | `unit_name` | JSON | visible | 1280×1024 | 24 | 16/24 | none |
| 8239 MENY Vollebekk | 360.01 Ventilasjon | `panel_name` | XML-only | visible | — | 33 | — | none |
| 8239 MENY Vollebekk | Energi | `unit_name` | XML-only | visible | — | 4 | — | none |
| 8272 MENY Åssiden | Energi | `unit_name` | XML-only | visible | — | 4 | — | none |
| 8045 MENY Nanset | — | `zero_match` | — | — | — | — | — | none |
| 8076 MENY Slependen | — | `zero_match` | — | — | — | — | — | none |
| 8098 MENY Stortorvet | — | `zero_match` | — | — | — | — | — | none |
| 8289 MENY Fantoft | — | `zero_match` | — | — | — | — | — | none |

## Per-plant inventory

### 9099 — EXTRA Dokka NY

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 147 | 142/147 |  | 52 KB |
| Maskin | ✅ | 1400×750 | 70 | 65/70 |  | 131 KB |
| Maskin Gammel | hidden | 1400×750 | 68 | 61/68 |  | 99 KB |
| 360.001 Ventilasjon | ✅ | 1400×750 | 102 | 57/102 |  | 6 KB |
| Akkumulator | ✅ | 1400×750 | 12 | 12/12 |  | 11 KB |

### 9148 — EXTRA Hafjell

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 158 | 156/158 |  | 61 KB |
| Maskin | ✅ | 1400×750 | 70 | 66/70 |  | 104 KB |
| Akkumulering og VGV | ✅ | 1400×750 | 15 | 14/15 |  | 13 KB |
| Ventilasjon | ✅ | 1400×750 | 101 | 56/101 |  | 6 KB |

### 9149 — Extra Sædalen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 93 | 93/93 |  | 37 KB |
| Maskin | ✅ | 1280×1024 | 43 | 41/43 |  | 64 KB |
| Ventilasjon | ✅ | 1280×1024 | 84 | 46/84 |  | 6 KB |
| Energi | ✅ | 1280×1024 | 4 | 4/4 |  | 24 KB |
| Maskin_Old | hidden | 1400×750 | 0 | 0/0 |  | 4 KB |

### 9486 — Coop Extra Igor Mitt

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Översikt | ✅ | 1400×750 | 199 | 151/199 |  | 32 KB |
| KA1 | ✅ | 1400×750 | 55 | 53/55 |  | 88 KB |
| Energi | ✅ | 1400×750 | 28 | 22/28 |  | 35 KB |

### 9558 — Extra Tolvsrød

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 132 | 132/132 |  | 41 KB |
| Maskin | ✅ | 1400×750 | 57 | 57/57 |  | 80 KB |
| Energi | ✅ | 1400×750 | 4 | 4/4 |  | 20 KB |

### 9585 — Extra Evje Ny bygg 1

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 135 | 135/135 |  | 46 KB |
| Maskin | ✅ | 1440×750 | 64 | 63/64 |  | 80 KB |
| 360.001 Ventilasjon | ✅ | 1440×750 | 98 | 50/98 |  | 6 KB |
| Energi | ✅ | 1400×750 | 13 | 13/13 |  | 46 KB |
| Varme | ✅ | 1440×750 | 26 | 17/26 |  | 29 KB |

### 9643 — EXTRA Kjerulfsgate

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 102 | 102/102 |  | 35 KB |
| Maskin | ✅ | 1400×750 | 67 | 67/67 |  | 81 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 31 KB |
| Ventilasjon | ✅ | 1400×750 | 85 | 41/85 |  | 6 KB |
| Varmegjenvinning | ✅ | 1400×750 | 22 | 17/22 |  | 17 KB |

### 9652 — EXTRA Mascot

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 230 | 217/230 |  | 43 KB |
| Maskin | ✅ | 1400×750 | 68 | 64/68 |  | 80 KB |
| Energi | ✅ | 1400×750 | 20 | 15/20 |  | 31 KB |
| Ventilasjon | ✅ | 1400×750 | 98 | 51/105 | 1 | 6 KB |
| Snøsmelt | ✅ | 1400×750 | 44 | 27/44 |  | 7 KB |
| test | hidden | 1400×750 | 0 | 5/11 | 1 | — |

### 9653 — Extra Uvdal

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 59 | 56/59 |  | 36 KB |
| Oversikt_OLD | hidden | 1400×750 | 62 | 57/62 |  | 33 KB |
| Hydroloop | ✅ | 1400×750 | 27 | 16/27 |  | 12 KB |
| Energi | ✅ | 1400×750 | 9 | 9/9 |  | 30 KB |
| Ventilasjon 360.01 | ✅ | 1400×750 | 78 | 41/85 | 1 | 6 KB |
| Ventilasjon 360.02 | ✅ | 1400×750 | 59 | 27/59 |  | 6 KB |

### 9655 — EXTRA Heimdal

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 149 | 149/149 |  | 42 KB |
| Maskin | ✅ | 1400×750 | 60 | 60/60 |  | 79 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 30 KB |
| VGV AC | ✅ | 1400×750 | 30 | 23/30 |  | 18 KB |

### 9661 — Extra Kvantum

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 126 | 126/126 |  | 41 KB |
| Maskin | ✅ | 1400×750 | 59 | 58/59 |  | 80 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 31 KB |

### 9662 — EXTRA Karasjok

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 120 | 120/120 |  | 43 KB |
| Maskin | ✅ | 1400×750 | 60 | 60/60 |  | 83 KB |
| Ventilasjon | ✅ | 1400×750 | 86 | 47/86 |  | 6 KB |
| Energi | ✅ | 1400×750 | 8 | 8/8 |  | 24 KB |

### 9664 — EXTRA Rakkestad

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 186 | 185/186 |  | 41 KB |
| Maskin | ✅ | 1400×750 | 63 | 63/63 |  | 79 KB |
| Energi | ✅ | 1400×750 | 9 | 9/9 |  | 29 KB |
| 360.01 Ventilasjon Butikk | ✅ | 1400×750 | 78 | 42/78 |  | 6 KB |
| 360.002 Ventilasjon Sosiale rom | ✅ | 1400×750 | 59 | 27/59 |  | 6 KB |
| Varmegjenvinning | ✅ | 1400×750 | 21 | 17/21 |  | 22 KB |
| Varmegjenvinning_relinked | hidden | 1400×750 | 21 | 15/21 |  | 22 KB |

### 9673 — Extra Vennesla

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 206 | 206/206 |  | 71 KB |
| Maskin | ✅ | 1400×750 | 68 | 65/68 |  | 103 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 46 KB |
| Ventilasjon | ✅ | 1400×750 | 91 | 49/91 |  | 6 KB |
| Wireless Overview | ✅ | 1400×750 | 175 | 106/175 |  | 0 KB |
| Varmeanlegg | ✅ | 1400×750 | 22 | 14/22 |  | 29 KB |

### 9677 — EXTRA Ørmelen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 130 | 130/130 |  | 42 KB |
| Maskin | ✅ | 1400×750 | 46 | 44/46 |  | 64 KB |
| Energi | ✅ | 1400×750 | 4 | 4/4 |  | 20 KB |
| 360.001 Utleiedel | ✅ | 1400×750 | 73 | 40/73 |  | 6 KB |
| 360.001 Kurve | hidden | 1280×1024 | 12 | 11/12 |  | 13 KB |
| 360.002 Butikk | ✅ | 1400×750 | 85 | 46/85 |  | 6 KB |
| 360.002 Kurve | hidden | 1280×1024 | 12 | 11/12 |  | 13 KB |
| 310.001/320.001 | ✅ | 1400×750 | 59 | 28/59 |  | 8 KB |
| 320.001-IE001 Kurve | hidden | 1280×1024 | 12 | 11/12 |  | 12 KB |
| 320.001-RT402 Kurve | hidden | 1280×1024 | 12 | 11/12 |  | 12 KB |
| Swegon PM Gold 1.09 Main Settings - status and operation | hidden | 1280×1024 | 14 | 6/14 |  | 7 KB |
| Swegon PM Gold 1.09 Fan Settings - Pressure | hidden | 1280×1024 | 17 | 8/17 |  | 7 KB |
| Swegon PM Gold 1.09 Fan Settings - Demand | hidden | 1280×1024 | 21 | 10/21 |  | 7 KB |
| Swegon PM Gold 1.09 Temp Settings - Supply air | hidden | 1280×1024 | 3 | 1/3 |  | 7 KB |
| Swegon PM Gold 1.09 Kurve - ERS-2 | hidden | 1280×1024 | 12 | 11/12 |  | 12 KB |
| Swegon PM Gold 1.09 Kurve - ORS | hidden | 1280×1024 | 12 | 11/12 |  | 13 KB |
| Swegon PM Gold 1.09 Fan Settings - Flow | hidden | 1280×1024 | 14 | 6/14 |  | 7 KB |

### 9683 — Extra Havnesenteret

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 126 | 126/126 |  | 46 KB |
| Maskin | ✅ | 1400×750 | 67 | 67/67 |  | 87 KB |
| 360.01 Ventilasjon | ✅ | 1400×750 | 83 | 46/83 |  | 6 KB |
| Energi | ✅ | 1400×750 | 8 | 8/8 |  | 29 KB |

### 9697 — EXTRA Glomfjord NY

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 134 | 125/134 |  | 48 KB |
| Maskin | ✅ | 1400×750 | 60 | 59/60 |  | 81 KB |
| Varmegjenvinning | ✅ | 1400×750 | 13 | 13/13 |  | 27 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 31 KB |
| Ventilasjon | ✅ | 1400×750 | 93 | 50/93 |  | 6 KB |

### 9699 — EXTRA Kirkegata Levanger

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 119 | 119/119 |  | 39 KB |
| Maskin | ✅ | 1400×750 | 46 | 46/46 |  | 64 KB |
| 360.001 Ventilasjon | ✅ | 1400×750 | 92 | 50/92 |  | 6 KB |
| 360.001 Kurver | hidden | 1280×1024 | 0 | 0/0 |  | 4 KB |
| 360.002 Ventilasjon | ✅ | 1400×750 | 53 | 28/53 |  | 6 KB |
| 360.002 Kurver | hidden | 1280×1024 | 0 | 0/0 |  | 4 KB |
| Energi | ✅ | 1400×750 | 4 | 4/4 |  | 20 KB |

### 9767 — EXTRA Åssiden

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 132 | 132/132 |  | 44 KB |
| Maskin | ✅ | 1400×750 | 55 | 55/55 |  | 80 KB |
| Energi | ✅ | 1400×750 | 4 | 4/4 |  | 20 KB |

### 9812 — EXTRA Frekhaug

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 122 | 122/122 |  | 42 KB |
| Maskin | ✅ | 1400×750 | 58 | 58/58 |  | 79 KB |
| Energi | ✅ | 1400×750 | 4 | 4/4 |  | 20 KB |
| 360.001 Ventilasjon | ✅ | 1400×750 | 97 | 55/97 |  | — |
| VGV | ✅ | 1400×750 | 13 | 12/13 |  | 25 KB |
| Maskin_Oldy | hidden | 1400×750 | 58 | 58/58 |  | 79 KB |

### 9839 — EXTRA Vestby Storsenter

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 242 | 228/242 |  | 53 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 30 KB |
| Maskin | ✅ | 1400×750 | 62 | 62/62 |  | 79 KB |

### 9856 — EXTRA Løten

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 215 | 214/215 |  | 44 KB |
| Maskin | ✅ | 1400×750 | 72 | 71/72 |  | 81 KB |
| Varmegjenvinning | ✅ | 1400×750 | 37 | 27/37 |  | 28 KB |
| 360.001 Ventilasjon | ✅ | 1400×750 | 103 | 57/103 |  | 6 KB |
| Energi | ✅ | 1400×750 | 42 | 42/42 |  | 40 KB |
| Hydroloop | hidden | 1400×750 | 20 | 4/20 |  | 11 KB |
| Hydroloop_relinked | hidden | 1400×750 | 20 | 4/20 |  | 11 KB |
| Hydroloop_relinked_copy | hidden | 1400×750 | 20 | 4/20 |  | 11 KB |
| Hydroloop_relinked_copy_copy | hidden | 1400×750 | 20 | 4/20 |  | 11 KB |

### 9857 — EXTRA Otta

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 207 | 206/207 |  | 47 KB |
| Maskin | ✅ | 1400×750 | 72 | 71/72 |  | 81 KB |
| VGV | ✅ | 1400×750 | 29 | 21/29 |  | 21 KB |
| 360.001 Ventilasjon | ✅ | 1400×750 | 102 | 57/102 |  | 6 KB |
| Energi | ✅ | 1400×750 | 78 | 44/78 |  | 38 KB |
| Brytere kjølfrys | hidden | 1280×1024 | 11 | 0/11 |  | — |

### 9862 — EXTRA Holmedalen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 115 | 114/115 |  | 43 KB |
| Kondenssystem | ✅ | 1400×750 | 24 | 19/24 |  | 45 KB |
| Maskin | ✅ | 1400×750 | 59 | 59/59 |  | 79 KB |
| Energi | ✅ | 1400×750 | 12 | 12/12 |  | 32 KB |
| VGV | ✅ | 1400×750 | 35 | 24/35 |  | 15 KB |
| VGV_copy | hidden | 1400×750 | 22 | 18/22 |  | 20 KB |
| Ventilasjon | ✅ | 1400×750 | 101 | 55/101 |  | 6 KB |
| 360.001 Butikk | hidden | 1280×1024 | 97 | 60/97 |  | 6 KB |
| Ventilasjon 360.01 | hidden | 1400×750 | 92 | 49/92 |  | 6 KB |
| Ventilasjon_copy | hidden | 1400×755 | 108 | 63/108 |  | 6 KB |
| Kondenssystem_g | hidden | 1400×750 | 49 | 48/49 |  | 41 KB |

### 9868 — EXTRA Ugla Trondheim

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 160 | 150/160 |  | 43 KB |
| Maskin | ✅ | 1400×750 | 64 | 62/64 |  | 81 KB |
| Energi | ✅ | 1280×1024 | 9 | 9/9 |  | 29 KB |
| Ventilasjon | ✅ | 1400×750 | 90 | 51/90 |  | 6 KB |
| Ventilasjon_copy | hidden | 1280×1024 | 96 | 52/96 |  | — |
| 360.02 Ventilasjon ny del | hidden | 1280×1024 | 78 | 42/78 |  | 7 KB |
| Wireless Overview | ✅ | 1400×750 | 92 | 43/92 |  | 0 KB |

### 9893 — EXTRA Haugesund Park+

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 120 | 120/120 |  | 38 KB |
| Maskin | ✅ | 1400×750 | 61 | 60/61 |  | 82 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 30 KB |
| VGV | ✅ | 1400×750 | 35 | 24/35 |  | 15 KB |
| Ventilasjon | ✅ | 1400×750 | 103 | 56/103 |  | 6 KB |
| 360.001 Ventilasjon | hidden | 1400×750 | 92 | 46/92 |  | 6 KB |
| 360.001 Kurver | hidden | 1280×1024 | 0 | 0/0 |  | 4 KB |
| 360.001 Reserve 1 | hidden | 1280×1024 | 0 | 0/0 |  | 4 KB |
| 360.001 Reserve 2 | hidden | 1280×1024 | 0 | 0/0 |  | 4 KB |

### 9902 — EXTRA Charlottenlund

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 110 | 109/110 |  | 37 KB |
| Maskin | ✅ | 1400×750 | 57 | 57/57 |  | 80 KB |
| Energi | ✅ | 1400×750 | 9 | 9/9 |  | 29 KB |
| Energi_old | hidden | 1280×1024 | 10 | 4/10 |  | 30 KB |
| Fan Coil | ✅ | 1400×750 | 22 | 17/22 |  | 10 KB |

### 9914 — EXTRA Hunstad

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt butikk | ✅ | 1400×750 | 220 | 219/220 |  | 48 KB |
| Maskin | hidden | 1400×750 | 79 | 74/79 |  | 90 KB |
| VGV | hidden | 1400×750 | 50 | 31/50 |  | 19 KB |
| Plan 1 | hidden | 1400×750 | 2 | 34/34 | 14 | 49 KB |
| Plan 2 | hidden | 1400×750 | 2 | 5/5 | 1 | 38 KB |
| Energi | hidden | 1400×750 | 24 | 24/24 |  | 40 KB |
| Driftsignaler | hidden | 1400×750 | 6 | 6/32 | 2 | 6 KB |
| 360.01 Ventilasjon | hidden | 1400×750 | 87 | 50/87 |  | 6 KB |
| 360.02 Ventilasjon | hidden | 1400×750 | 77 | 44/77 |  | 6 KB |
| Energi_copy | hidden | 1400×750 | 10 | 10/10 |  | 30 KB |
| VGV_old | hidden | 1400×750 | 38 | 22/38 |  | 19 KB |
| Oversikt | ✅ | 1400×750 | 21 | 9/21 |  | 4 KB |
| Romtype1 | hidden | 1400×750 | 1 | 4/13 | 6 | 4 KB |
| Romtype4 | hidden | 1400×750 | 1 | 13/33 | 15 | 4 KB |
| 360.003 | hidden | 1400×750 | 99 | 52/99 |  | 6 KB |
| 320.001 | hidden | 1400×750 | 25 | 17/31 | 3 | 10 KB |
| 320.001 Varmepumpe | hidden | 1400×750 | 27 | 13/27 |  | 6 KB |
| romtype3 | hidden | 1400×750 | 1 | 13/32 | 14 | 4 KB |
| romtypevav3 | hidden | 1400×750 | 1 | 4/15 | 6 | 4 KB |
| romtypevav1 | hidden | 1400×750 | 1 | 5/15 | 6 | 4 KB |
| romtypevav2 | hidden | 1400×750 | 1 | 5/15 | 6 | 4 KB |
| Rom 103 | hidden | 1400×750 | 1 | 3/8 | 3 | 4 KB |
| Rom 104 | hidden | 1400×750 | 1 | 6/15 | 6 | 4 KB |
| Rom 105 | hidden | 1400×750 | 1 | 6/15 | 6 | 4 KB |
| Rom 118a | hidden | 1400×750 | 1 | 6/15 | 6 | 4 KB |
| Rom 114 | hidden | 1400×750 | 1 | 12/28 | 12 | 4 KB |
| Rom 113 | hidden | 1400×750 | 1 | 12/28 | 12 | 4 KB |
| Rom 109 | hidden | 1400×750 | 1 | 3/8 | 3 | 4 KB |
| Rom 110 | hidden | 1400×750 | 1 | 3/8 | 3 | 4 KB |
| Rom 107 | hidden | 1400×750 | 1 | 3/8 | 3 | 4 KB |
| Rom 106 | hidden | 1400×750 | 1 | 3/8 | 3 | 4 KB |
| Rom 108 | hidden | 1400×750 | 1 | 3/8 | 3 | 4 KB |
| Rom 200 | hidden | 1400×750 | 1 | 6/15 | 6 | 4 KB |
| Rom 100a | hidden | 1400×750 | 1 | 5/14 | 5 | 4 KB |
| Rom 100 | hidden | 1400×750 | 1 | 11/26 | 11 | 4 KB |

### 9916 — EXTRA St. Olavsgt (NY)

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 108 | 108/108 |  | 36 KB |
| Maskin | ✅ | 1400×750 | 43 | 43/43 |  | 64 KB |
| Energi | ✅ | 1400×750 | 4 | 4/4 |  | 20 KB |
| Ventilasjon | ✅ | 1400×750 | 92 | 52/92 |  | 6 KB |

### 9921 — EXTRA Irisgården

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 150 | 150/150 |  | 39 KB |
| Maskin | ✅ | 1400×750 | 61 | 61/61 |  | 82 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 31 KB |
| Ventilasjon | ✅ | 1400×750 | 105 | 54/105 |  | 6 KB |
| Kondenssystem | ✅ | 1400×750 | 23 | 19/23 |  | 44 KB |
| Varmegjenvinning | ✅ | 1400×750 | 25 | 17/25 |  | 12 KB |

### 9956 — EXTRA Tiller

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 144 | 131/144 |  | 43 KB |
| Maskin | ✅ | 1400×750 | 58 | 58/58 |  | 82 KB |

### 9957 — EXTRA Klæbu

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 131 | 119/131 |  | 40 KB |
| Maskin | ✅ | 1400×750 | 53 | 53/53 |  | 82 KB |

### 9959 — EXTRA Ringvålveien

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 141 | 141/141 |  | 39 KB |
| Maskin | ✅ | 1400×750 | 55 | 53/55 |  | 69 KB |

### 9960 — EXTRA Meråker

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 120 | 112/120 |  | 41 KB |
| Maskin | ✅ | 1400×750 | 55 | 55/55 |  | 80 KB |

### 9961 — EXTRA Skatval

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 100 | 100/100 |  | 37 KB |
| Maskin | ✅ | 1400×750 | 56 | 56/56 |  | 76 KB |

### 9962 — EXTRA Ila

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 156 | 156/156 |  | 40 KB |
| Maskin | ✅ | 1400×750 | 50 | 46/50 |  | 72 KB |
| Maskin_Old | hidden | 1400×750 | 43 | 43/43 |  | 70 KB |

### 9963 — EXTRA Flatåsen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 104 | 104/104 |  | 43 KB |
| Maskin | ✅ | 1400×750 | 43 | 41/43 |  | 67 KB |

### 9964 — EXTRA Lilleby

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 104 | 104/104 |  | 38 KB |
| Maskin | ✅ | 1400×750 | 50 | 48/50 |  | 60 KB |

### 9965 — EXTRA Byneset

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 118 | 118/118 |  | 40 KB |
| Maskin | ✅ | 1400×750 | 55 | 53/55 |  | 66 KB |

### 9972 — EXTRA Grim

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 134 | 134/134 |  | 42 KB |
| Maskin | ✅ | 1400×750 | 40 | 39/40 |  | 62 KB |
| VGV | ✅ | 1400×750 | 33 | 22/33 |  | 15 KB |
| VGV_old | hidden | 1400×750 | 36 | 0/36 |  | 15 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 31 KB |
| Ventilasjon 360.01 | ✅ | 1400×750 | 87 | 50/87 |  | 6 KB |

### 9982 — EXTRA Fauske

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 240 | 240/240 |  | 52 KB |
| Maskin | ✅ | 1400×750 | 64 | 64/64 |  | 84 KB |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 31 KB |
