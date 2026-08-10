#!/usr/bin/env python3
"""Render a Maskin panel to a native-size HTML preview for QA stage C.

    python render-maskin-panel.py reference_data/maskin-10229-sanitized.json

WHY THIS IS NOT render-ventilation-panel.py.

A Ventilasjon panel's artwork is served by the host, so that renderer can only
draw where objects ARE. A Maskin panel carries its own background inside the
JSON - panel.image_data is the machine-room drawing as a data URI - so this
renderer draws the REAL artwork and overlays the dynamic objects on top. That
turns the one question Maskin QA actually asks into something a human can
answer by looking:

    does every value box land on the empty pill drawn for it?

The background owns the pipes, the compressors, the labels and the empty white
pills. The Designer objects own only the live numbers. If the two disagree, the
panel shows a number floating next to a hole. No structural check can see that;
this preview can.

WHAT IS STILL APPROXIMATE. Object artwork (the AK-PC status strips, the LEDs,
the pump symbol) is served by the host and is not in this repository, so those
are drawn as their exact bounding boxes, not as their sprites. Box position and
size are exact. Sprite appearance is not shown at all.

Open the output at 100% zoom. The full panel is rendered at 1400x750 - its
native size - because a scaled preview cannot answer a 2-pixel alignment
question. The crop panes below it are magnified deliberately and are labelled
with their magnification.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
RULES_PATH = ROOT / "documentation-rules.json"

# Colour by z-index band, using the MASKIN bands. These are not the Ventilasjon
# bands and the two must not be confused: on Maskin 1100 is the value pill and
# 110 is the json / no-connection family, which is the other way round from
# what CLAUDE.md's Ventilasjon-scoped table says.
BANDS = {
    "110":  ("#b5651d", "rgba(181,101,29,0.18)",  "custom json / no-connection"),
    "360":  ("#1f6f43", "rgba(31,111,67,0.16)",   "AK-PC status strip"),
    "375":  ("#c0392b", "rgba(192,57,43,0.20)",   "alarm / LED / pump"),
    "1000": ("#6c3fb5", "rgba(108,63,181,0.16)",  "enabled / disabled"),
    "1100": ("#1a4f8a", "rgba(26,79,138,0.14)",   "value / setpoint pill"),
}
UNKNOWN_BAND = ("#ff00ff", "rgba(255,0,255,0.35)", "UNKNOWN z-index")

CROP_PAD = 24
CROP_SCALE = 2
# A pane wider than the page is silently clipped, which loses exactly the part
# of a role group a reviewer did not think to look for. Wide groups drop to 1x
# rather than lose their right-hand edge, and every pane states its own scale.
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


def background_css(panel):
    """Return (css-value, description). image_data is a data URI already;
    image_svg is raw markup and has to be wrapped into one."""
    data = panel.get("image_data")
    if data:
        return 'url("%s")' % data, "embedded raster (panel.image_data, %d chars)" % len(data)
    svg = panel.get("image_svg")
    if svg:
        encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        return ('url("data:image/svg+xml;base64,%s")' % encoded,
                "authored vector (panel.image_svg, %d chars)" % len(svg))
    return "none", ("NO BACKGROUND. Every coordinate below is being judged "
                    "against a blank canvas, which proves nothing.")


def load_roles():
    """Crop regions are derived from the role inventory in
    documentation-rules.json, never hand-placed - an invented crop window would
    quietly hide the part of the panel it excludes."""
    try:
        rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    roles = ((rules.get("panel_types") or {}).get("maskin") or {}).get("roles") or {}
    return {name: set(spec.get("aliases", [])) for name, spec in roles.items()}


def crop_regions(objects, roles):
    """One crop per operational role group, sized to the objects it contains."""
    regions = []
    for name, aliases in roles.items():
        members = [o for o in objects if o.get("alias_text") in aliases]
        if not members:
            continue
        left = min(px(o.get("posLeft")) for o in members) - CROP_PAD
        top = min(px(o.get("posTop")) for o in members) - CROP_PAD
        right = max(px(o.get("posLeft")) + px(o.get("posWidth")) for o in members) + CROP_PAD
        bottom = max(px(o.get("posTop")) + px(o.get("posHeight")) for o in members) + CROP_PAD
        left, top = max(0, left), max(0, top)
        width, height = right - left, bottom - top
        regions.append({
            "name": name,
            "left": left,
            "top": top,
            "width": width,
            "height": height,
            "count": len(members),
            "scale": min(CROP_SCALE, max(1, CROP_MAX_WIDTH // max(width, 1))),
        })
    regions.sort(key=lambda r: (r["top"], r["left"]))
    return regions


def object_markup(objects):
    parts = []
    bands_seen = []
    for obj in objects:
        z = str(obj.get("zIndex", "")).strip()
        stroke, fill, _ = BANDS.get(z, UNKNOWN_BAND)
        if z not in bands_seen:
            bands_seen.append(z)
        left, top = px(obj.get("posLeft")), px(obj.get("posTop"))
        width, height = px(obj.get("posWidth")), px(obj.get("posHeight"))
        alias = str(obj.get("alias_text", "") or "")
        parts.append(
            '<div class="o" style="left:%dpx;top:%dpx;width:%dpx;height:%dpx;'
            'z-index:%s;border-color:%s;background:%s" title="%s">'
            '<span class="lbl" style="color:%s">%s</span></div>'
            % (left, top, width, height, html.escape(z) or "auto", stroke, fill,
               html.escape("%s  %s  (%d,%d) %dx%d  z=%s  %s"
                           % (obj.get("name", ""), obj.get("obj_id", ""), left, top,
                              width, height, z, alias)),
               stroke, html.escape(alias))
        )
    return "\n".join(parts), bands_seen


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
  .o {{ position: absolute; box-sizing: border-box; border: 1px solid;
        overflow: visible; }}
  .lbl {{ position: absolute; left: 0; top: 100%; font: 9px/1 Arial, sans-serif;
          white-space: nowrap; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }}
  body.hide-overlay .o {{ display: none; }}
  body.hide-labels .lbl {{ display: none; }}
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
  <label><input type="checkbox" id="ov" checked> object overlay</label>
  <label><input type="checkbox" id="lb" checked> alias labels</label>
  <span id="legend">{legend}</span>
</div>
<h2>Full panel &mdash; native size, {width}x{height}, no scaling</h2>
<div id="panel" class="canvas">
{objects}
</div>
<h2>Role crops &mdash; up to {scale}x magnification</h2>
<p class="note">Each window is sized to the objects of one operational role
group plus {pad} px of margin, taken from the role inventory in
documentation-rules.json. Nothing here is hand-placed. A group too wide to show
at {scale}x drops to 1x rather than lose its right-hand edge; every pane states
its own scale.</p>
<div id="crops">
{crops}
</div>
<script>
  var body = document.body;
  document.getElementById('ov').onchange = function () {{
    body.classList.toggle('hide-overlay', !this.checked);
  }};
  document.getElementById('lb').onchange = function () {{
    body.classList.toggle('hide-labels', !this.checked);
  }};
</script>
</html>
"""

CROP = """<div class="crop">
  <h3>{name} &mdash; {count} objects, ({left},{top}) {width}x{height}, {scale}x</h3>
  <div class="win" style="width:{win_w}px;height:{win_h}px">
    <div class="canvas" style="transform:scale({scale}) translate({tx}px,{ty}px)">
{objects}
    </div>
  </div>
</div>"""


def render(document, title):
    envelope = envelope_of(document)
    panel = envelope.get("panel") or {}
    width = px(panel.get("panel_width"), 1400)
    height = px(panel.get("panel_height"), 750)
    objects = panel.get("single_objects") or []

    background, background_note = background_css(panel)
    markup, bands_seen = object_markup(objects)

    legend = "".join(
        '<span><i style="border-color:%s;background:%s"></i>z %s &mdash; %s</span>'
        % (BANDS.get(z, UNKNOWN_BAND)[0], BANDS.get(z, UNKNOWN_BAND)[1],
           html.escape(z), BANDS.get(z, UNKNOWN_BAND)[2])
        for z in sorted(bands_seen, key=lambda v: px(v, 99999)))

    crops = "\n".join(
        CROP.format(name=html.escape(region["name"]), count=region["count"],
                    left=region["left"], top=region["top"],
                    width=region["width"], height=region["height"],
                    win_w=region["width"] * region["scale"],
                    win_h=region["height"] * region["scale"],
                    scale=region["scale"], tx=-region["left"], ty=-region["top"],
                    objects=markup)
        for region in crop_regions(objects, load_roles()))

    note = ("%d objects on a %dx%d canvas. Background: %s. Boxes are exact; the "
            "object SPRITES are served by the host and are not shown, so this "
            "answers alignment and coverage, not appearance. Toggle the overlay "
            "off to see the artwork alone - every value box should sit on an "
            "empty white pill drawn into the background."
            % (len(objects), width, height, background_note))

    return PAGE.format(title=html.escape(title), background=background,
                       width=width, height=height, objects=markup,
                       legend=legend, crops=crops, note=html.escape(note),
                       scale=CROP_SCALE, pad=CROP_PAD)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("panel", type=pathlib.Path)
    parser.add_argument("-o", "--output", type=pathlib.Path, default=None)
    args = parser.parse_args(argv)

    document = json.loads(args.panel.read_text(encoding="utf-8"))
    out = args.output or args.panel.with_name(args.panel.stem + "-preview.html")
    out.write_text(render(document, args.panel.name), encoding="utf-8", newline="\n")

    panel = envelope_of(document).get("panel") or {}
    print("wrote %s (%d objects, %sx%s, background %s)"
          % (out, len(panel.get("single_objects") or []),
             panel.get("panel_width"), panel.get("panel_height"),
             "embedded" if panel.get("image_data") or panel.get("image_svg") else "MISSING"))
    print("Open at 100% zoom. The full panel is native size on purpose.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
