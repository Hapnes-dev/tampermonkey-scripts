# Coop Extra + MENY fleets — plant panel catalog

Surveyed 2026-08-08 from the live compiled-panel stores (read-only panel-list and `iw_load_ctrls.php` fetches), 82 plants across Coop Extra and MENY, 457+ panels. Machine-readable raw data: [reference_data/plant-panel-survey.json](reference_data/plant-panel-survey.json). Panel-type conventions and best copy-sources: [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md).

**How to read the tables:** *Vis* ✅ = visible in the plant view, *hidden* = `visible=4` (reachable by navigation/panel-order only). *Linked* = objects with a real `driver_id` / total objects (incl. container items). *Cont* = containers. *BG* = embedded background image size ( — = none). MENY panels found only in the XML store show `XML-only` under *Size* and `—` for fields the JSON store did not expose.

## Fleet summary — Coop Extra

- **41 plants, 231 stored panels** (plus 9914's extra room panels — 35 total there).
- **Standard inventory:** every plant has `Oversikt` + `Maskin`; most add `Energi` and one or more `Ventilasjon` panels; common extras: `VGV`/`Varmegjenvinning`/`Akkumulator`, `Kondenssystem`, `Varme`/`320.001`, `Kurver`.
- **Sizes:** 201 panels at **1400×750** (the fleet standard), 26 at **1280×1024** (older-era panels, mostly Kurver/Swegon detail pages + all of 9149), 3 at 1440×750 (9585), 1 at 1400×755.
- **Zero V2-era objects** in the whole fleet — everything is modern V3 style.
- **Containers are rare** (only 9652/9653 Ventilasjon with 1, and 9914's room-card panels); **graphics: 0 everywhere**.
- **Backgrounds:** ~98% of panels sit on an embedded PNG. Ventilasjon panels typically use the 6 KB blank background and draw the duct layout with objects.
- **Backup convention:** `_old`, `Gammel`, `_copy`, `_relinked` suffixed panels are kept hidden as history — never edit those, they are snapshots.
- **9914 (EXTRA Hunstad)** is the outlier: 35 panels including a container-built per-room system (`Romtype*`, `Rom NNN`) and `Plan 1`/`Plan 2` floor plans — the only plant in the fleet using containers at scale.
- **9486 (Coop Extra Igor Mitt)** is Swedish (`Översikt`, panel `KA1`).

## Per-plant inventory — Coop Extra

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

## Fleet summary — MENY

- **41 plants, 226 panels:** 116 are present in the JSON store and **110 are XML-only** (the JSON fetch returned empty).
- **Standard inventory:** the MENY pattern is `Oversikt` + `Maskin` + `Tørrkjøler`/`Tørrkjøler og beredersystem` + a `360.NN Butikk`/`Ventilasjon` page + `Energi`. All 41 plants have an overview (45 panels because split floor plans are common); 40 have a Maskin page, 36 a dry-cooler page, and 39 an Energi page.
- **JSON-store sizes:** 53 panels at **1280×1024**, 52 at **1400×750**, 10 at **1050×745**, and 1 at **852×713**. XML-only records do not expose dimensions.
- **Legacy mix:** unlike the all-V3 Coop Extra fleet, the MENY JSON panels contain 3,181 V2-era objects. Containers remain rare (1 total), graphics are 0, and 115 of 116 JSON panels have a background.
- **Store overviews are often split** into `Oversikt Øvre`/`Nedre` or `Oversikt Plan 1`/`Plan 2`; treat the pair as one store map when copying.
- **9850 Meny Levert Hjem Oslo** is a warehouse/distribution site, not the standard supermarket pattern: two plan overviews, `IK001`–`IK003`, and multiple `K0N Sone` pages among 18 panels.
- **8918 MENY Åråsen** adds `Tappevann`, `Akkumuleringskurve`, and `Behovskurve` to the normal inventory.
- **9867 Meny Gressbanen and 9922 Meny Down Town** carry `Wireless Overview` + `VGV`, matching the newer Extra-fleet expansion pattern.

## Per-plant inventory — MENY

### 8001 — MENY Rona

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt Øvre | ✅ | 1280×1024 | 62 | 60/62 |  | 87 KB |
| Oversikt Nedre | ✅ | 1280×1024 | 131 | 131/131 |  | 108 KB |
| Maskin | ✅ | XML-only | 47 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 35 | — | — | — |
| Ventilasjon | ✅ | 1280×1024 | 80 | 57/80 |  | 17 KB |
| Energi | ✅ | 1050×745 | 12 | 12/12 |  | 59 KB |

### 8002 — MENY Bekkestua

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt Øvre | ✅ | 1280×1024 | 174 | 174/174 |  | 105 KB |
| Maskin | ✅ | XML-only | 48 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 41 | — | — | — |
| 360.01 Ventilasjon | ✅ | XML-only | 77 | — | — | — |
| Energi | ✅ | 1050×745 | 14 | 14/14 |  | 29 KB |

### 8016 — MENY Støletorget

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt øvre | ✅ | XML-only | 118 | — | — | — |
| Oversikt nedre | ✅ | XML-only | 45 | — | — | — |
| Maskinrom | ✅ | 1280×1024 | 69 | 66/69 |  | 119 KB |
| Tørrkjøler | ✅ | XML-only | 33 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 59 | — | — | — |
| 360.02 Innekondensatorer | ✅ | XML-only | 28 | — | — | — |
| Energi | ✅ | 852×713 | 8 | 8/8 |  | 24 KB |

### 8045 — MENY Nanset

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 197 | 197/197 |  | 121 KB |
| Maskin | ✅ | XML-only | 48 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 38 | — | — | — |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 33 KB |

### 8049 — MENY Osloveien Hønefoss

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 198 | 198/198 |  | 110 KB |
| Maskin | ✅ | XML-only | 48 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 55 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 107 | — | — | — |
| Energi | ✅ | XML-only | 18 | — | — | — |

### 8075 — Meny GS

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | XML-only | 170 | — | — | — |
| Maskin | ✅ | XML-only | 54 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 36 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 103 | — | — | — |
| Energi | ✅ | XML-only | 4 | — | — | — |

### 8076 — MENY Slependen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 150 | 150/150 |  | 119 KB |
| Maskin | ✅ | 1280×1024 | 37 | 35/37 |  | 37 KB |

### 8088 — MENY Romeriksenteret

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 182 | 182/182 |  | 134 KB |
| Maskin | ✅ | XML-only | 46 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 32 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 84 | — | — | — |
| Energi | ✅ | XML-only | 4 | — | — | — |

### 8098 — MENY Stortorvet

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 182 | 182/182 |  | 143 KB |
| Maskin | ✅ | 1280×1024 | 69 | 61/69 |  | 90 KB |
| Tørrkjøler | ✅ | XML-only | 28 | — | — | — |
| Energi | ✅ | 1050×745 | 6 | 6/6 |  | 18 KB |

### 8124 — MENY Alna

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 234 | 233/234 |  | 82 KB |
| Maskin | ✅ | 1280×1024 | 74 | 71/74 |  | 77 KB |
| Tørrkjøler | ✅ | 1280×1024 | 46 | 45/46 |  | 85 KB |
| 360.01 Ventilasjon | ✅ | 1280×1024 | 95 | 71/95 |  | 13 KB |
| Energi | ✅ | 1400×750 | 17 | 17/17 |  | 19 KB |
| Test coolteam | hidden | 1280×1024 | 0 | 0/0 |  | — |

### 8132 — MENY Rasta

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | XML-only | 214 | — | — | — |
| Maskin | ✅ | XML-only | 44 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 24 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 77 | — | — | — |
| Energi | ✅ | XML-only | 4 | — | — | — |

### 8146 — MENY Høvik

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1050×745 | 349 | 347/349 |  | 225 KB |
| Maskin | ✅ | XML-only | 50 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | 1280×1024 | 84 | 52/84 |  | 27 KB |
| 360.01 Butikk | ✅ | XML-only | 68 | — | — | — |
| Energi | ✅ | 1050×745 | 16 | 16/16 |  | 29 KB |

### 8150 — MENY Stovner

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1050×745 | 272 | 272/272 |  | 35 KB |
| Maskin | ✅ | XML-only | 53 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | 1280×1024 | 38 | 32/38 |  | 20 KB |
| 360.01 Butikk | ✅ | XML-only | 91 | — | — | — |
| Energi | ✅ | XML-only | 8 | — | — | — |

### 8158 — Meny Trekanten

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 221 | 218/221 |  | 112 KB |
| Maskin | ✅ | XML-only | 60 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 49 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 35 | — | — | — |
| Energi | ✅ | 1400×750 | 6 | 6/6 |  | 30 KB |

### 8205 — MENY Brakerøya

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1050×745 | 240 | 224/240 |  | 105 KB |
| Maskin | ✅ | XML-only | 63 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | 1280×1024 | 38 | 32/38 |  | 21 KB |
| 360.01 Butikk | ✅ | XML-only | 110 | — | — | — |
| Energi | ✅ | 1400×750 | 12 | 12/12 |  | 37 KB |
| 360.01 UR | hidden | XML-only | 30 | — | — | — |

### 8214 — MENY Langhus

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 172 | 169/172 |  | 48 KB |
| Maskin | ✅ | XML-only | 52 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 52 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 88 | — | — | — |
| Energi | ✅ | 1280×1024 | 10 | 10/10 |  | 21 KB |

### 8232 — MENY Askim

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 174 | 172/174 |  | 142 KB |
| Maskin | ✅ | XML-only | 51 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 23 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 101 | — | — | — |
| Energi | ✅ | 1280×1024 | 24 | 16/24 |  | 22 KB |

### 8239 — MENY Vollebekk

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt Øvre | ✅ | 1280×1024 | 156 | 153/156 |  | 127 KB |
| Oversikt Nedre og Høyre | ✅ | 1050×745 | 35 | 35/35 |  | 76 KB |
| Maskin | ✅ | XML-only | 53 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 48 | — | — | — |
| 360.01 Ventilasjon | ✅ | XML-only | 33 | — | — | — |
| 360.01 Soner | ✅ | XML-only | 8 | — | — | — |
| Energi | ✅ | XML-only | 4 | — | — | — |

### 8272 — MENY Åssiden

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1050×745 | 178 | 178/178 |  | 97 KB |
| Maskin | ✅ | XML-only | 60 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 17 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 139 | — | — | — |
| Energi | ✅ | XML-only | 4 | — | — | — |

### 8289 — MENY Fantoft

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 161 | 161/161 |  | 112 KB |
| Maskin | ✅ | XML-only | 53 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 50 | — | — | — |
| Energi | ✅ | 1050×745 | 8 | 8/8 |  | 22 KB |

### 8292 — MENY Holmen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 212 | 205/212 |  | 128 KB |
| Maskin | ✅ | XML-only | 62 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 39 | — | — | — |
| 360.01 Meny Holmen | ✅ | XML-only | 94 | — | — | — |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 36 KB |

### 8338 — MENY Sverresborg

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | XML-only | 170 | — | — | — |
| Maskin | ✅ | XML-only | 52 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 37 | — | — | — |
| 360.01 Ventilasjon | ✅ | 1280×1024 | 111 | 48/111 |  | 12 KB |
| Energi | ✅ | XML-only | 8 | — | — | — |
| 360.01 Ur | hidden | XML-only | 143 | — | — | — |

### 8345 — MENY Nordstrand

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 216 | 216/216 |  | 123 KB |
| Maskin | ✅ | XML-only | 61 | — | — | — |
| Tørrkjøler og beredersystem | ✅ | XML-only | 28 | — | — | — |
| 360.02 Ventilasjon | ✅ | XML-only | 94 | — | — | — |
| Energi | ✅ | 1400×750 | 8 | 8/8 |  | 26 KB |

### 8426 — MENY Bogstadveien

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 169 | 165/169 |  | 63 KB |
| Maskin | ✅ | 1280×1024 | 39 | 38/39 |  | 77 KB |
| Tørrkjøler | ✅ | XML-only | 48 | — | — | — |
| Ventilasjon | ✅ | XML-only | 78 | — | — | — |
| Energi | ✅ | XML-only | 8 | — | — | — |

### 8456 — MENY Kolsås

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 239 | 236/239 |  | 70 KB |
| Maskin | ✅ | 1280×1024 | 50 | 44/50 |  | 73 KB |
| Tørrkjøler | ✅ | 1280×1024 | 40 | 38/40 |  | 57 KB |
| Ventilasjon | ✅ | 1280×1024 | 66 | 43/66 |  | 15 KB |
| Energi | ✅ | 1400×750 | 8 | 8/8 |  | 26 KB |
| Ventilasjon kurve | hidden | XML-only | 13 | — | — | — |

### 8477 — MENY Gystadmarka

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 207 | 204/207 |  | 66 KB |
| Maskin | ✅ | 1280×1024 | 74 | 74/74 |  | 78 KB |
| Tørrkjøler | ✅ | XML-only | 47 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 82 | — | — | — |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 32 KB |

### 8482 — MENY Torvet

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 161 | 161/161 |  | 53 KB |
| Maskin | ✅ | XML-only | 77 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 26 | — | — | — |
| Energi | ✅ | XML-only | 4 | — | — | — |

### 8488 — MENY Skedsmo Senter

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 204 | 204/204 |  | 64 KB |
| Maskin | ✅ | 1280×1024 | 65 | 65/65 |  | 64 KB |
| Tørrkjøler | ✅ | XML-only | 39 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 94 | — | — | — |
| Energi | ✅ | 1280×1024 | 12 | 12/12 |  | 34 KB |

### 8509 — MENY Albert

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | XML-only | 210 | — | — | — |
| Maskin | ✅ | XML-only | 65 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 46 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 83 | — | — | — |
| Energi | ✅ | 1400×750 | 12 | 12/12 |  | 39 KB |

### 8545 — MENY Ravnanger

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 178 | 182/182 | 1 | 54 KB |
| Maskin | ✅ | 1280×1024 | 65 | 65/65 |  | 62 KB |
| Tørrkjøler | ✅ | 1400×750 | 36 | 34/36 |  | 57 KB |
| 360.01 Butikk | ✅ | XML-only | 65 | — | — | — |
| Energi | ✅ | 1280×1024 | 32 | 20/32 |  | 35 KB |

### 8554 — MENY Oppsal senteret

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | XML-only | 186 | — | — | — |
| Maskin | ✅ | XML-only | 65 | — | — | — |
| Tørrkjøler | ✅ | 1280×1024 | 42 | 41/42 |  | 71 KB |
| 360.14 Backup2 | hidden | XML-only | 65 | — | — | — |
| Energi | ✅ | XML-only | 14 | — | — | — |
| 360.14 | ✅ | 1280×1024 | 105 | 69/105 |  | 16 KB |
| 360.14 Backup | hidden | XML-only | 0 | — | — | — |

### 8673 — MENY Lietorvet

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 170 | 170/170 |  | 56 KB |
| Maskin | ✅ | XML-only | 68 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 29 | — | — | — |
| Energi | ✅ | XML-only | 10 | — | — | — |

### 8679 — MENY Oasen Haugesund

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 159 | 159/159 |  | 71 KB |
| Maskin | ✅ | XML-only | 75 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 39 | — | — | — |
| 360.13 Butikk | ✅ | XML-only | 103 | — | — | — |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 23 KB |

### 8682 — MENY Fosnavåg

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | XML-only | 90 | — | — | — |
| Maskin | ✅ | XML-only | 63 | — | — | — |
| Tørrkjøler | ✅ | XML-only | 8 | — | — | — |

### 8713 — MENY Vestkanten

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 197 | 195/197 |  | 65 KB |
| Maskin | ✅ | 1280×1024 | 67 | 67/67 |  | 73 KB |
| Tørrkjøler | ✅ | XML-only | 27 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 101 | — | — | — |
| Energi | ✅ | 1400×750 | 10 | 10/10 |  | 32 KB |

### 8723 — MENY Sørlandsparken

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 220 | 220/220 |  | 50 KB |
| Maskin | ✅ | 1400×750 | 66 | 65/66 |  | 64 KB |
| Tørrkjøler | ✅ | 1400×750 | 40 | 38/40 |  | 70 KB |
| 360.01 Butikk | ✅ | XML-only | 88 | — | — | — |
| Energi | ✅ | 1400×750 | 28 | 20/28 |  | 44 KB |

### 8869 — MENY Lillo gård

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 196 | 196/196 |  | 81 KB |
| Maskin | ✅ | 1280×1024 | 71 | 70/71 |  | 74 KB |
| Tørrkjøler | ✅ | XML-only | 42 | — | — | — |
| 360.01 Butikk | ✅ | XML-only | 107 | — | — | — |
| Energi | ✅ | XML-only | 10 | — | — | — |

### 8918 — MENY Åråsen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1280×1024 | 182 | 180/182 |  | 53 KB |
| Maskin | ✅ | XML-only | 88 | — | — | — |
| Varmegjenvinning | ✅ | 1400×750 | 39 | 32/39 |  | 52 KB |
| Tappevann | ✅ | XML-only | 23 | — | — | — |
| 360.01 Ventilasjon | ✅ | 1280×1024 | 105 | 79/105 |  | 13 KB |
| Energi | ✅ | 1400×750 | 44 | 44/44 |  | 54 KB |
| Akkumuleringskurve | hidden | XML-only | 18 | — | — | — |
| Behovskurve | hidden | XML-only | 18 | — | — | — |

### 9850 — Meny Levert Hjem Oslo

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt Plan 1 | ✅ | 1400×750 | 149 | 120/149 |  | 45 KB |
| Oversikt Plan 2 | ✅ | 1400×750 | 87 | 70/87 |  | 38 KB |
| IK001 | ✅ | 1400×750 | 103 | 93/103 |  | 92 KB |
| IK002 | ✅ | 1400×750 | 87 | 87/87 |  | 92 KB |
| IK003 | ✅ | 1400×750 | 46 | 46/46 |  | 64 KB |
| Energi | ✅ | 1400×750 | 24 | 24/24 |  | 33 KB |
| K01 Sone 1/2 | hidden | 1400×750 | 69 | 55/69 |  | 74 KB |
| K03 Sone 1/2 | hidden | 1400×750 | 88 | 73/88 |  | 74 KB |
| K03 Sone 3/4 | hidden | 1400×750 | 89 | 71/89 |  | 73 KB |
| K03 Sone 5/6 | hidden | 1400×750 | 79 | 64/79 |  | 60 KB |
| K04 Sone 1/2 | hidden | 1400×750 | 89 | 79/89 |  | 74 KB |
| K04 Sone 3/4 | hidden | 1400×750 | 72 | 62/72 |  | 63 KB |
| 320.001 70/45°C | hidden | 1400×750 | 35 | 20/35 |  | 49 KB |
| 350.020 -10/-5 °C | hidden | 1400×750 | 30 | 22/30 |  | 35 KB |
| 320.006 45/30°C | hidden | 1400×750 | 35 | 20/35 |  | 49 KB |
| 320.011 25/15°C | hidden | 1400×750 | 35 | 19/35 |  | 49 KB |
| 360.003 Kurve | hidden | 1400×750 | 9 | 9/9 |  | 12 KB |
| 360.005 Kurve | hidden | 1400×750 | 9 | 9/9 |  | 12 KB |

### 9867 — Meny Gressbanen

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 261 | 257/261 |  | 47 KB |
| Maskin | ✅ | 1400×750 | 91 | 84/91 |  | 85 KB |
| VGV | ✅ | 1400×750 | 52 | 41/52 |  | 69 KB |
| Ventilasjon | ✅ | 1400×750 | 127 | 90/127 |  | 21 KB |
| Energi | ✅ | 1400×750 | 16 | 16/16 |  | 37 KB |
| Wireless Overview | ✅ | 1400×750 | 170 | 103/170 |  | 0 KB |

### 9922 — Meny Down Town

| Panel | Vis | Size | Objects | Linked | Cont | BG |
|---|---|---|---|---|---|---|
| Oversikt | ✅ | 1400×750 | 244 | 244/244 |  | 55 KB |
| Maskin | ✅ | 1400×750 | 103 | 91/103 |  | 110 KB |
| VGV | ✅ | 1400×750 | 55 | 40/55 |  | 35 KB |
| Ventilasjon | ✅ | 1400×750 | 122 | 88/122 |  | 21 KB |
| Energi | ✅ | 1400×750 | 16 | 16/16 |  | 37 KB |
| Maskin_copy | hidden | 1400×750 | 83 | 14/83 |  | 86 KB |
| Wireless Overview | ✅ | 1400×750 | 370 | 256/370 |  | 0 KB |
| Maskin_copy_copy | hidden | 1400×750 | 83 | 6/83 |  | 92 KB |
