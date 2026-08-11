#!/usr/bin/env python3
"""Render an Oversikt panel to a native-size HTML preview for QA stage C.

    python render-oversikt-panel.py reference_data/oversikt-10113-sanitized.json
    python render-oversikt-panel.py CANDIDATE.json --source SOURCE.json
    python render-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json

WHY THIS EXISTS SEPARATELY FROM render-maskin-panel.py.

Both draw the embedded background and overlay the objects, but they answer
different questions. Maskin QA asks "does this value box land on the pill drawn
for it" - a two-pixel alignment question, so that renderer crops by operational
role group. Oversikt QA asks "is this cluster on the case it monitors" - a
spatial question about the store, so this renderer crops by CONTROLLER CLUSTER
and labels each crop with the controller and its coverage. A cluster in the
aisle beside its case is invisible in JSON and obvious here.

--source draws the source panel's clusters as dashed ghosts underneath. Every
ghost with no cluster inside it is a controller the candidate lost, and every
ghost with a long leader line to its cluster is a cluster that moved. That is
the 2026-08-10 failure, made visible in one image.

--footprints draws an iwmac-oversikt-footprints sidecar: the measured equipment
box in amber, its centre as a crosshair, and a dashed amber box where the value
object would sit if it were centred on it. Where the dashed box and the blue
value box coincide, the temperature bubble is in the centre of the equipment;
where they do not, the gap is the 2026-08-11 correction, at the exact size it
was made. This overlay draws SOMEBODY'S MEASUREMENT over the artwork - it does
not measure anything and it cannot confirm the measurement is of the right box.
Judge the amber box against the artwork under it first; if it is not around the
visible case, the sidecar is wrong, not the panel.

WHAT IS STILL APPROXIMATE. Object artwork - the alarm bell, the cooling and
defrost symbols, the value box chrome - is served by the host and is not in this
repository, so objects are drawn as their exact bounding boxes with a role
colour, not as their sprites. Box position and size are exact. Sprite appearance
is not shown at all, and neither is any live value.

Open the output at 100% zoom. The full panel is rendered at its native size
because a scaled preview cannot answer a placement question honestly. Crop panes
are magnified deliberately and each states its own magnification.

Output is HTML only, written next to the panel as <name>-preview.html, which
.gitignore already excludes. This file performs no network access.
"""

from __future__ import annotations

import argparse
import base64
import collections
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"

# Colour by cluster ROLE, not by z-index band: on an Oversikt every symbol
# shares band 375 and only the value box sits at 110, so a band legend would
# collapse three of the four roles into one colour and hide exactly what a
# reviewer is looking for.
ROLE_COLOURS = {
    "alarm":   ("#c0392b", "rgba(192,57,43,0.20)"),
    "value":   ("#1a4f8a", "rgba(26,79,138,0.16)"),
    "cooling": ("#1f6f43", "rgba(31,111,67,0.18)"),
    "defrost": ("#6c3fb5", "rgba(108,63,181,0.18)"),
}
UNKNOWN_ROLE = ("#ff00ff", "rgba(255,0,255,0.30)")

# Amber, and used for nothing else. A measured footprint is a different KIND of
# thing from everything else on this page - the four role colours and the ghost
# outline all come out of a panel JSON, this one comes out of somebody's ruler.
FOOTPRINT_COLOUR = "#d98200"

CROP_PAD = 40
CROP_SCALE = 3
CROP_MAX_WIDTH = 1360


def px(value, default=0):
    """The host parses geometry with parseInt, so "120px" -> 120."""
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return int(value)
    match = re.match(r"^\s*([-+]?\d+)", str(value))
    return int(match.group(1)) if match else default


def envelope_of(document):
    if isinstance(document, dict) and isinstance(document.get("envelope"), dict):
        return document["envelope"]
    return document


def objects_of(document):
    panel = envelope_of(document).get("panel") or {}
    return panel.get("single_objects") or []


def load_roles():
    """Role names come from documentation-rules.json, never from a literal here,
    so the renderer, the validator and the fixture agree on what a cluster is."""
    try:
        rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    cluster = ((rules.get("panel_types") or {}).get("oversikt") or {}).get("cluster") or {}
    return {entry["obj_id"]: entry["role"] for entry in cluster.get("roles", [])}


def controller_key(obj):
    """Mirrors validate-oversikt-panel.controller_key. unit_id, then the
    normalized driver prefix, then nothing - never proximity."""
    unit = (obj.get("unit_id") or "").strip()
    if unit and unit != "undefined":
        return unit
    driver = (obj.get("driver_id") or "").strip()
    if driver and driver != "driver_id":
        parts = driver.split("_")
        return "_".join(parts[:5]) if len(parts) >= 5 else driver
    return None


def clusters_of(objects, roles):
    clusters = collections.OrderedDict()
    for obj in objects:
        key = controller_key(obj)
        entry = clusters.setdefault(key, {"key": key, "members": []})
        entry["members"].append(obj)
    for entry in clusters.values():
        members = entry["members"]
        entry["bbox"] = (
            min(px(o.get("posLeft")) for o in members),
            min(px(o.get("posTop")) for o in members),
            max(px(o.get("posLeft")) + px(o.get("posWidth")) for o in members),
            max(px(o.get("posTop")) + px(o.get("posHeight")) for o in members),
        )
        entry["roles"] = collections.Counter(
            roles.get(o.get("obj_id"), o.get("obj_id")) for o in members)
    return clusters


def background_css(panel):
    """image_data is a data URI already; image_svg is raw markup and has to be
    wrapped into one."""
    data = panel.get("image_data")
    if data:
        return ('url("%s")' % data,
                "embedded raster (panel.image_data, %d chars)" % len(data))
    svg = panel.get("image_svg")
    if svg:
        encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return ('url("data:image/svg+xml;base64,%s")' % encoded,
                "authored vector (panel.image_svg, %d chars)" % len(svg))
    return "none", ("NO BACKGROUND. Every coordinate below is being judged "
                    "against a blank canvas, which proves nothing - and for an "
                    "Oversikt the artwork IS the specification.")


def object_markup(objects, roles):
    parts = []
    for obj in objects:
        role = roles.get(obj.get("obj_id"), "?")
        stroke, fill = ROLE_COLOURS.get(role, UNKNOWN_ROLE)
        left, top = px(obj.get("posLeft")), px(obj.get("posTop"))
        width, height = px(obj.get("posWidth")), px(obj.get("posHeight"))
        alias = str(obj.get("alias_text", "") or "")
        unit = str(obj.get("unit_id", "") or "-")
        parts.append(
            '<div class="o" style="left:%dpx;top:%dpx;width:%dpx;height:%dpx;'
            'z-index:%s;border-color:%s;background:%s" title="%s"></div>'
            % (left, top, width, height, html.escape(str(obj.get("zIndex", "")) or "auto"),
               stroke, fill,
               html.escape("%s  %s  %s  (%d,%d) %dx%d  unit=%s  %s"
                           % (obj.get("name", ""), role, obj.get("obj_id", ""),
                              left, top, width, height, unit, alias))))
    return "\n".join(parts)


def cluster_markup(clusters, klass="c", label=True):
    parts = []
    for entry in clusters.values():
        if entry["key"] is None:
            continue
        left, top, right, bottom = entry["bbox"]
        roles = " ".join("%s%d" % (r[0].upper(), n)
                         for r, n in sorted(entry["roles"].items()))
        caption = ('<span class="clbl">%s <b>%s</b></span>'
                   % (html.escape(str(entry["key"])), html.escape(roles))) if label else ""
        parts.append(
            '<div class="%s" style="left:%dpx;top:%dpx;width:%dpx;height:%dpx" '
            'title="%s">%s</div>'
            % (klass, left - 4, top - 4, right - left + 8, bottom - top + 8,
               html.escape("%s - %d object(s): %s"
                           % (entry["key"], len(entry["members"]), roles)),
               caption))
    return "\n".join(parts)


def half_up(value):
    """Round .5 away from zero. Mirrors validate-oversikt-panel.half_up().

    The preview has to draw the expected position the validator computes, to the
    pixel. A renderer that rounded differently would show a one-pixel gap where
    O-G08 reports a clean pass, and a reviewer would trust the picture.
    """
    return int(value + 0.5) if value >= 0 else -int(-value + 0.5)


def footprint_geometry(footprints, clusters, roles, width, height):
    """Scale a footprint sidecar onto this canvas. Returns unit -> geometry.

    Header values are the per-record defaults, same as the validator. A record
    this renderer cannot place - no footprint, no resolution, a controller not
    in this panel - is skipped rather than drawn approximately, because an amber
    box in the wrong place is worse than no amber box.
    """
    if not isinstance(footprints, dict):
        return {}
    header = footprints
    records = footprints.get("records")
    if not isinstance(records, list):
        return {}
    placed = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        unit = str(record.get("unit_id") or "").strip()
        entry = clusters.get(unit)
        if not unit or entry is None:
            continue
        box = record.get("footprint")
        if not isinstance(box, dict):
            continue
        try:
            left, top = float(box["left"]), float(box["top"])
            box_w, box_h = float(box["width"]), float(box["height"])
        except (KeyError, TypeError, ValueError):
            continue
        if box_w <= 0 or box_h <= 0:
            continue
        image_size = record.get("source_image_size") or header.get("source_image_size")
        panel_size = record.get("panel_size") or header.get("panel_size") or [width, height]
        try:
            scale_x = float(panel_size[0]) / float(image_size[0])
            scale_y = float(panel_size[1]) / float(image_size[1])
        except (TypeError, ValueError, ZeroDivisionError, IndexError):
            continue
        left, top = left * scale_x, top * scale_y
        box_w, box_h = box_w * scale_x, box_h * scale_y

        value = next((o for o in entry["members"]
                      if roles.get(o.get("obj_id")) == "value"), None)
        if value is None:
            continue
        size = (px(value.get("posWidth")), px(value.get("posHeight")))
        expected = (half_up(left + (box_w - size[0]) / 2),
                    half_up(top + (box_h - size[1]) / 2))
        actual = (px(value.get("posLeft")), px(value.get("posTop")))
        placed[unit] = {
            "box": (half_up(left), half_up(top), half_up(box_w), half_up(box_h)),
            "centre": (left + box_w / 2, top + box_h / 2),
            "expected": expected,
            "size": size,
            "drift": (actual[0] - expected[0], actual[1] - expected[1]),
            "note": str(record.get("evidence_note") or ""),
            "production_proven": bool(record.get("production_proven")),
        }
    return placed


def footprint_markup(placed):
    parts = []
    for unit in sorted(placed):
        entry = placed[unit]
        left, top, box_w, box_h = entry["box"]
        dx, dy = entry["drift"]
        title = ("%s - measured footprint (%d,%d) %dx%d; value expected at (%d,%d), "
                 "drift (%+d,%+d)%s. %s"
                 % (unit, left, top, box_w, box_h, entry["expected"][0],
                    entry["expected"][1], dx, dy,
                    " [production_proven]" if entry["production_proven"] else "",
                    entry["note"] or "no evidence note recorded"))
        parts.append('<div class="fp" style="left:%dpx;top:%dpx;width:%dpx;height:%dpx" '
                     'title="%s"></div>' % (left, top, box_w, box_h, html.escape(title)))
        cx, cy = entry["centre"]
        parts.append('<div class="fpx" style="left:%dpx;top:%dpx" title="%s"></div>'
                     % (half_up(cx) - 5, half_up(cy) - 5,
                        html.escape("%s - centre of the measured footprint" % unit)))
        parts.append('<div class="fpe" style="left:%dpx;top:%dpx;width:%dpx;height:%dpx" '
                     'title="%s"></div>'
                     % (entry["expected"][0], entry["expected"][1],
                        entry["size"][0], entry["size"][1],
                        html.escape("%s - where the value object sits when centred on "
                                    "this footprint" % unit)))
    return "\n".join(parts)


def crop_regions(clusters, width, height, placed=None):
    regions = []
    placed = placed or {}
    for entry in clusters.values():
        if entry["key"] is None:
            continue
        left, top, right, bottom = entry["bbox"]
        measured = placed.get(str(entry["key"]))
        if measured:
            # Widen to the measured box. A value object dropped on the label
            # beside its case is exactly the defect worth seeing, and a crop cut
            # to the cluster alone would show the bubble and not the box.
            fl, ft, fw, fh = measured["box"]
            left, top = min(left, fl), min(top, ft)
            right, bottom = max(right, fl + fw), max(bottom, ft + fh)
        left, top = max(0, left - CROP_PAD), max(0, top - CROP_PAD)
        right, bottom = min(width, right + CROP_PAD), min(height, bottom + CROP_PAD)
        w, h = right - left, bottom - top
        regions.append({
            "name": str(entry["key"]),
            "left": left, "top": top, "width": w, "height": h,
            "count": len(entry["members"]),
            "roles": ", ".join("%s %d" % (r, n) for r, n in sorted(entry["roles"].items())),
            "scale": min(CROP_SCALE, max(1, CROP_MAX_WIDTH // max(w, 1))),
        })
    regions.sort(key=lambda r: (r["top"], r["left"]))
    return regions


PAGE = """<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8">
<title>{title}</title>
<style>
  :root {{ --bg: {background}; }}
  html, body {{ margin: 0; padding: 0; background: #2f3a44; color: #e7edf2;
                font: 13px/1.5 Arial, Helvetica, sans-serif; }}
  h1 {{ font-size: 15px; margin: 12px 16px 4px; }}
  h2 {{ font-size: 13px; margin: 20px 16px 6px; font-weight: bold; }}
  p.note {{ margin: 4px 16px 12px; max-width: 1360px; color: #c3ced7; }}
  .canvas {{
    position: relative; width: {width}px; height: {height}px;
    background-image: var(--bg); background-repeat: no-repeat;
    background-size: {width}px {height}px; background-color: #ffffff;
  }}
  #panel {{ margin: 0 16px; box-shadow: 0 0 0 1px #10202e; }}
  .o {{ position: absolute; box-sizing: border-box; border: 1px solid; }}
  .c {{ position: absolute; box-sizing: border-box; border: 1px solid #10202e;
        z-index: 4000; }}
  .g {{ position: absolute; box-sizing: border-box; z-index: 3900;
        border: 1px dashed #d13b8a; background: rgba(209,59,138,0.10); }}
  .fp {{ position: absolute; box-sizing: border-box; z-index: 3800;
         border: 2px solid {footprint}; background: transparent; }}
  .fpe {{ position: absolute; box-sizing: border-box; z-index: 3850;
          border: 2px dashed {footprint}; background: transparent; }}
  .fpx {{ position: absolute; width: 11px; height: 11px; z-index: 3860;
          background:
            linear-gradient({footprint},{footprint}) center/11px 1px no-repeat,
            linear-gradient({footprint},{footprint}) center/1px 11px no-repeat; }}
  .clbl {{ position: absolute; left: 0; bottom: 100%; font: 9px/1.2 Arial, sans-serif;
           white-space: nowrap; color: #10202e;
           text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff; }}
  body.hide-overlay .o {{ display: none; }}
  body.hide-clusters .c {{ display: none; }}
  body.hide-clusters .g {{ display: none; }}
  body.hide-labels .clbl {{ display: none; }}
  body.hide-footprints .fp {{ display: none; }}
  body.hide-footprints .fpe {{ display: none; }}
  body.hide-footprints .fpx {{ display: none; }}
  #controls {{ margin: 8px 16px 14px; }}
  #controls label {{ margin-right: 18px; }}
  #legend span {{ display: inline-block; margin: 0 14px 4px 0; }}
  #legend i {{ display: inline-block; width: 10px; height: 10px; margin-right: 4px;
               vertical-align: -1px; border: 1px solid; }}
  #crops {{ display: flex; flex-wrap: wrap; gap: 16px; margin: 0 16px 24px; }}
  .crop {{ background: #3b4753; padding: 8px; border-radius: 3px; }}
  .crop h3 {{ font-size: 12px; margin: 0 0 6px; font-weight: bold; }}
  .crop .win {{ position: relative; overflow: hidden; background: #fff;
                box-shadow: 0 0 0 1px #10202e; }}
  .crop .win > .canvas {{ position: absolute; transform-origin: 0 0; }}
</style>
<h1>{title}</h1>
<p class="note">{note}</p>
<div id="controls">
  <label><input type="checkbox" id="ov" checked> object boxes</label>
  <label><input type="checkbox" id="cl" checked> cluster outlines</label>
  <label><input type="checkbox" id="lb" checked> controller labels</label>
  {footprint_toggle}
  <span id="legend">{legend}</span>
</div>
<h2>Full panel &mdash; native size, {width}x{height}, no scaling</h2>
<div id="panel" class="canvas">
{ghosts}
{footprints}
{clusters}
{objects}
</div>
<h2>Per-controller crops &mdash; up to {scale}x magnification</h2>
<p class="note">One window per controller cluster, sized to that cluster plus
{pad} px of margin. The window is derived from the cluster inventory, never
hand-placed. The question each pane answers is the only one an Oversikt asks:
is this cluster ON the case, cabinet or room it monitors, or beside it? A pane
too wide for {scale}x drops to 1x rather than lose its right-hand edge.</p>
<div id="crops">
{crops}
</div>
<script>
  var body = document.body;
  function bind(id, cls) {{
    document.getElementById(id).onchange = function () {{
      body.classList.toggle(cls, !this.checked);
    }};
  }}
  bind('ov', 'hide-overlay');
  bind('cl', 'hide-clusters');
  bind('lb', 'hide-labels');
  if (document.getElementById('fp')) {{ bind('fp', 'hide-footprints'); }}
</script>
</html>
"""

CROP = """<div class="crop">
  <h3>{name} &mdash; {count} object(s): {roles} &mdash; ({left},{top}) {width}x{height}, {scale}x</h3>
  <div class="win" style="width:{win_w}px;height:{win_h}px">
    <div class="canvas" style="transform:scale({scale}) translate({tx}px,{ty}px)">
{ghosts}
{footprints}
{clusters}
{objects}
    </div>
  </div>
</div>"""


def render(document, title, source_document=None, footprints=None):
    envelope = envelope_of(document)
    panel = envelope.get("panel") or {}
    width = px(panel.get("panel_width"), 1400)
    height = px(panel.get("panel_height"), 750)
    objects = panel.get("single_objects") or []

    roles = load_roles()
    clusters = clusters_of(objects, roles)
    background, background_note = background_css(panel)

    markup = object_markup(objects, roles)
    outlines = cluster_markup(clusters)

    ghosts = ""
    ghost_note = ""
    if source_document is not None:
        source_clusters = clusters_of(objects_of(source_document), roles)
        ghosts = cluster_markup(source_clusters, klass="g", label=False)
        lost = [k for k in source_clusters if k is not None and k not in clusters]
        ghost_note = (" Dashed pink outlines are the SOURCE cluster positions. "
                      "%d source controller(s) have no cluster in this candidate%s."
                      % (len(lost), (": " + ", ".join(map(str, sorted(lost)))) if lost else ""))

    placed = {}
    footprint_boxes = ""
    footprint_toggle = ""
    footprint_note = ""
    if footprints is not None:
        placed = footprint_geometry(footprints, clusters, roles, width, height)
        footprint_boxes = footprint_markup(placed)
        footprint_toggle = ('<label><input type="checkbox" id="fp" checked> '
                            'measured footprints</label>')
        named_keys = {str(k) for k, v in clusters.items() if k is not None}
        missing = sorted(named_keys - set(placed))
        off = sorted(u for u, e in placed.items() if max(map(abs, e["drift"])) > 2)
        footprint_note = (
            " Amber is a MEASUREMENT SOMEBODY MADE, not something this panel proves: "
            "solid is the equipment footprint, the crosshair is its centre, and the "
            "dashed box is where the value object would sit if it were centred on it. "
            "Check the amber box against the artwork under it before believing "
            "anything it implies about the blue box. %d of %d controller(s) measured"
            % (len(placed), len(named_keys)))
        if missing:
            footprint_note += ("; unmeasured, and therefore unproven, not passed: "
                               + ", ".join(missing))
        footprint_note += (("; more than 2px off centre: " + ", ".join(off))
                           if off else "; every measured value box is on its centre.")
        if footprints.get("synthetic") or footprints.get("source") == "synthetic-back-derived":
            footprint_note += (" WARNING: this sidecar is SYNTHETIC - the footprints were "
                               "derived from the value objects they appear to verify. The "
                               "amber boxes are not on the equipment and mean nothing about "
                               "this store.")

    legend = "".join(
        '<span><i style="border-color:%s;background:%s"></i>%s</span>'
        % (ROLE_COLOURS[role][0], ROLE_COLOURS[role][1], role)
        for role in ("alarm", "value", "cooling", "defrost"))
    legend += ('<span><i style="border-color:#10202e;background:transparent"></i>'
               'cluster</span>')
    if source_document is not None:
        legend += ('<span><i style="border-color:#d13b8a;'
                   'background:rgba(209,59,138,0.10)"></i>source cluster</span>')
    if footprints is not None:
        legend += ('<span><i style="border-color:%s;background:transparent"></i>'
                   'measured footprint</span>'
                   '<span><i style="border-color:%s;background:transparent;'
                   'border-style:dashed"></i>value centred on it</span>'
                   % (FOOTPRINT_COLOUR, FOOTPRINT_COLOUR))

    named = [c for c in clusters.values() if c["key"] is not None]
    totals = collections.Counter()
    for entry in named:
        totals.update(entry["roles"])
    note = ("%d objects in %d controller cluster(s) on a %dx%d canvas: %s. "
            "Background: %s. Boxes are exact; the object SPRITES are served by "
            "the host and are not shown, and no live value is drawn anywhere. "
            "Toggle the object boxes off to see the store plan alone - the "
            "cabinets, rooms and captions belong to the artwork, and the four "
            "symbols belong to the Designer. Counts are evidence, not targets."
            % (len(objects), len(named), width, height,
               ", ".join("%s %d" % (r, n) for r, n in sorted(totals.items())),
               background_note)) + ghost_note + footprint_note

    crops = "\n".join(
        CROP.format(name=html.escape(region["name"]), count=region["count"],
                    roles=html.escape(region["roles"]),
                    left=region["left"], top=region["top"],
                    width=region["width"], height=region["height"],
                    win_w=region["width"] * region["scale"],
                    win_h=region["height"] * region["scale"],
                    scale=region["scale"], tx=-region["left"], ty=-region["top"],
                    ghosts=ghosts, clusters=outlines, objects=markup,
                    footprints=footprint_boxes)
        for region in crop_regions(clusters, width, height, placed))

    return PAGE.format(title=html.escape(title), background=background,
                       width=width, height=height, objects=markup,
                       clusters=outlines, ghosts=ghosts, legend=legend,
                       crops=crops, note=html.escape(note),
                       scale=CROP_SCALE, pad=CROP_PAD,
                       footprint=FOOTPRINT_COLOUR, footprints=footprint_boxes,
                       footprint_toggle=footprint_toggle)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("panel", type=pathlib.Path)
    parser.add_argument("--source", type=pathlib.Path, default=None,
                        help="draw this panel's clusters as dashed ghosts underneath")
    parser.add_argument("--footprints", type=pathlib.Path, default=None,
                        help="draw an iwmac-oversikt-footprints sidecar over the "
                             "artwork: measured equipment box, its centre, and the "
                             "centred value position")
    parser.add_argument("-o", "--output", type=pathlib.Path, default=None)
    args = parser.parse_args(argv)

    document = json.loads(args.panel.read_text(encoding="utf-8"))
    source = (json.loads(args.source.read_text(encoding="utf-8"))
              if args.source else None)
    footprints = (json.loads(args.footprints.read_text(encoding="utf-8"))
                  if args.footprints else None)
    out = args.output or args.panel.with_name(args.panel.stem + "-preview.html")
    out.write_text(render(document, args.panel.name, source, footprints),
                   encoding="utf-8", newline="\n")

    panel = envelope_of(document).get("panel") or {}
    objects = panel.get("single_objects") or []
    clusters = [k for k in clusters_of(objects, load_roles()) if k is not None]
    print("wrote %s (%d objects, %d clusters, %sx%s, background %s)"
          % (out, len(objects), len(clusters), panel.get("panel_width"),
             panel.get("panel_height"),
             "embedded" if panel.get("image_data") or panel.get("image_svg") else "MISSING"))
    print("Open at 100% zoom. The full panel is native size on purpose.")
    if footprints is not None:
        placed = footprint_geometry(footprints, clusters_of(objects, load_roles()),
                                    load_roles(), px(panel.get("panel_width"), 1400),
                                    px(panel.get("panel_height"), 750))
        print("%d footprint(s) from %s drawn in amber. Check each amber box against the "
              "artwork first - the overlay draws a measurement, it does not make one."
              % (len(placed), args.footprints))
    return 0


if __name__ == "__main__":
    sys.exit(main())
