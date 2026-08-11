#!/usr/bin/env python3
"""Produce the visual-QA evidence for a Maskin artwork edit, and a QA manifest.

    python maskin-visual-qa.py PANEL.json --spec ROUTING.json --out qa/
    python maskin-visual-qa.py PANEL.json --spec ROUTING.json --original SOURCE.json --out qa/
    python maskin-visual-qa.py PANEL.json --out qa/ --crop receiver:760,340,220,240

WHAT THIS IS FOR.

MASKIN-QA-CHECKLIST.md stage C0 requires a background-only render at native
size, a crop of the affected equipment, one crop per edited crossing and
junction, a nearest-neighbour magnification of each critical junction, and
before/after pairs at the same bounds. Producing those by hand is where the
evidence quietly stops being produced. This makes them deterministically, and
writes `qa-manifest.json` beside them so a review can check that the crops it
was shown are the crops the edit needed.

WHAT THIS IS NOT.

It does not decide whether the drawing is right. It decodes the background,
cuts the crops, and runs the pixel checks in maskin_raster_qa.py - continuity,
cross-section, protection, scope. Whether the result *reads* correctly to an
operator at native size is a human act, and the manifest says so in
`not_decided_here` rather than implying otherwise. `--spec` is the machine
readable circuit-routing inventory and junction ledger; without it only the
crops and the pixel census are produced, and the manifest says which checks did
not run.

Decodes 8-bit non-interlaced PNG (greyscale, RGB, palette, and both alpha
variants) with nothing but zlib, because this repository has no image
dependency and adding one for a QA helper would put the QA behind an install.

No network access. Reads and writes only the paths given on the command line.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import pathlib
import struct
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parent


def _load_qa():
    spec = importlib.util.spec_from_file_location(
        "maskin_raster_qa", ROOT / "maskin_raster_qa.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


qa = _load_qa()


# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------

CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def _unfilter(data, height, width, channels):
    stride = width * channels
    out = []
    previous = bytearray(stride)
    index = 0
    for _ in range(height):
        filter_type = data[index]
        index += 1
        line = bytearray(data[index:index + stride])
        index += stride
        for position in range(stride):
            left = line[position - channels] if position >= channels else 0
            up = previous[position]
            upleft = previous[position - channels] if position >= channels else 0
            value = line[position]
            if filter_type == 1:
                value += left
            elif filter_type == 2:
                value += up
            elif filter_type == 3:
                value += (left + up) >> 1
            elif filter_type == 4:
                delta = left + up - upleft
                da, db, dc = abs(delta - left), abs(delta - up), abs(delta - upleft)
                value += left if (da <= db and da <= dc) else (up if db <= dc else upleft)
            elif filter_type != 0:
                raise SystemExit(f"unsupported PNG row filter {filter_type}")
            line[position] = value & 0xFF
        out.append(bytes(line))
        previous = line
    return out


def decode_png(blob):
    """Return the fixture-shaped raster this repository's QA works on."""
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("not a PNG: this helper reads the raster backgrounds "
                         "that panel.image_data actually carries")
    width = height = depth = colour = None
    idat = bytearray()
    palette = transparency = None
    index = 8
    while index < len(blob):
        length, kind = struct.unpack(">I4s", blob[index:index + 8])
        body = blob[index + 8:index + 8 + length]
        index += 12 + length
        if kind == b"IHDR":
            width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8:
                raise SystemExit(f"PNG bit depth {depth} is not supported; export the "
                                 f"background as 8-bit")
            if interlace:
                raise SystemExit("interlaced PNG is not supported")
            if colour not in CHANNELS:
                raise SystemExit(f"PNG colour type {colour} is not supported")
        elif kind == b"PLTE":
            palette = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif kind == b"tRNS":
            transparency = body
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break

    channels = CHANNELS[colour]
    rows = _unfilter(zlib.decompress(bytes(idat)), height, width, channels)
    pixels = []
    for row in rows:
        line = []
        for x in range(width):
            sample = row[x * channels:(x + 1) * channels]
            if colour == 6:
                line.append(list(sample))
            elif colour == 2:
                line.append(list(sample) + [255])
            elif colour == 0:
                line.append([sample[0]] * 3 + [255])
            elif colour == 4:
                line.append([sample[0]] * 3 + [sample[1]])
            else:
                entry = palette[sample[0]]
                alpha = (transparency[sample[0]]
                         if transparency and sample[0] < len(transparency) else 255)
                line.append(list(entry) + [alpha])
        pixels.append(line)
    return {"width": width, "height": height, "pixels": pixels}


def encode_png(raster):
    raw = bytearray()
    for row in raster["pixels"]:
        raw.append(0)
        for pixel in row:
            raw.extend(bytes(pixel))

    def chunk(kind, body):
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", raster["width"],
                                         raster["height"], 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def crop(raster, box):
    x0, y0 = max(0, box["x"]), max(0, box["y"])
    x1 = min(raster["width"], box["x"] + box["width"])
    y1 = min(raster["height"], box["y"] + box["height"])
    return {"width": x1 - x0, "height": y1 - y0,
            "pixels": [[list(raster["pixels"][y][x]) for x in range(x0, x1)]
                       for y in range(y0, y1)]}


def magnify(raster, factor):
    """Nearest neighbour, so one source pixel stays one readable square.

    Any smoothing here would invent the continuity the crop exists to check.
    """
    pixels = []
    for row in raster["pixels"]:
        wide = [list(pixel) for pixel in row for _ in range(factor)]
        pixels.extend([list(pixel) for pixel in wide] for _ in range(factor))
    return {"width": raster["width"] * factor,
            "height": raster["height"] * factor, "pixels": pixels}


# --------------------------------------------------------------------------

def background_of(document, label):
    envelope = document.get("envelope", document)
    panel = envelope.get("panel") or {}
    data = panel.get("image_data") or ""
    if not data.startswith("data:image"):
        raise SystemExit(
            f"{label}: panel.image_data is not a data URI ({data[:40]!r}). This "
            f"helper reads the delivered background; a panel whose artwork lives "
            f"anywhere else has nothing here to inspect")
    return decode_png(base64.b64decode(data.split(",", 1)[1]))


def parse_crop(text):
    name, _, numbers = text.partition(":")
    x, y, width, height = (int(part) for part in numbers.split(","))
    return {"name": name, "x": x, "y": y, "width": width, "height": height}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("panel", type=pathlib.Path)
    parser.add_argument("--original", type=pathlib.Path, default=None,
                        help="the retained source panel, for before/after pairs "
                             "and the pixel-diff scope")
    parser.add_argument("--spec", type=pathlib.Path, default=None,
                        help="the circuit-routing inventory and junction ledger")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--crop", action="append", default=[],
                        metavar="NAME:X,Y,W,H",
                        help="an extra crop; repeatable")
    parser.add_argument("--zoom", type=int, default=None,
                        help="nearest-neighbour factor for the magnified crops")
    args = parser.parse_args(argv)

    panel_doc = json.loads(args.panel.read_text(encoding="utf-8"))
    after = background_of(panel_doc, str(args.panel))
    before = None
    if args.original:
        before = background_of(
            json.loads(args.original.read_text(encoding="utf-8")), str(args.original))

    spec = json.loads(args.spec.read_text(encoding="utf-8")) if args.spec else None
    boxes = [parse_crop(text) for text in args.crop]
    zoom = args.zoom
    if spec:
        boxes = list(spec.get("visual_qa", {}).get("crops", [])) + boxes
        zoom = zoom or spec.get("visual_qa", {}).get("zoom_factor")
    zoom = zoom or 8

    args.out.mkdir(parents=True, exist_ok=True)
    for folder in ("crops", "zoom", "before"):
        (args.out / folder).mkdir(exist_ok=True)

    written = []
    (args.out / "background.png").write_bytes(encode_png(after))
    written.append({"file": "background.png", "what": "the delivered background "
                    "alone, at native size, with no object on top"})

    for box in boxes:
        piece = crop(after, box)
        name = box["name"].replace(" ", "-")
        (args.out / "crops" / f"{name}.png").write_bytes(encode_png(piece))
        (args.out / "zoom" / f"{name}@{zoom}x.png").write_bytes(
            encode_png(magnify(piece, zoom)))
        written.append({"file": f"crops/{name}.png", "bounds": box})
        written.append({"file": f"zoom/{name}@{zoom}x.png", "bounds": box,
                        "magnification": zoom})
        if before is not None:
            (args.out / "before" / f"{name}.png").write_bytes(
                encode_png(crop(before, box)))
            written.append({"file": f"before/{name}.png", "bounds": box,
                            "what": "the same bounds on the retained original"})

    manifest = {
        "panel": str(args.panel),
        "original": str(args.original) if args.original else None,
        "spec": str(args.spec) if args.spec else None,
        "canvas": {"width": after["width"], "height": after["height"]},
        "artefacts": written,
        "required_by_stage_C0": [
            "background-only render at native size - background.png, above",
            "full panel render at native size - render-maskin-panel.py, NOT this "
            "script: it draws the dynamic objects this one deliberately omits",
            "one crop of the affected equipment",
            "one crop per edited crossing",
            "one crop per edited junction",
            "a nearest-neighbour magnification of each critical junction",
            "before/after crops at the same bounds",
            "a report listing every modified bounding box",
        ],
    }

    if spec:
        if before is not None:
            manifest["pixel_checks"] = qa.qa_manifest(before, after, spec)
        else:
            manifest["pixel_checks"] = {
                "skipped": "no --original: protection and diff-scope checks "
                           "compare against the retained source raster and "
                           "cannot run without it",
                "pixel_classes": qa.classify_background(after, spec),
                "junction_ledger": qa.junction_ledger(after, spec),
            }
    else:
        manifest["pixel_checks"] = {
            "skipped": "no --spec: the circuit-routing inventory and junction "
                       "ledger are the input to every pixel check. Write the "
                       "inventory before changing pixels, not after"}

    (args.out / "qa-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    failures = [check for check in
                (manifest["pixel_checks"].get("checks") or [])
                if check["result"] == "fail"]
    print(f"wrote {len(written)} artefact(s) and qa-manifest.json to {args.out}")
    for check in failures:
        print(f"FAIL {check['check']}: {check['detail'][:160]}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
