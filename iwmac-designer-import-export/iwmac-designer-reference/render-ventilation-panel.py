#!/usr/bin/env python3
"""Render a panel JSON to a native-scale HTML preview for QA stage C.

    python render-ventilation-panel.py panel.json -o preview.html

WHAT THIS IS, AND WHAT IT IS NOT.

The Designer serves every object's artwork from the host (legacy.iwmac.local).
Those sprites are not in this repository, so this preview cannot show what a
panel LOOKS like. It shows where every object IS: each object is drawn as its
exact bounding box at its exact coordinates on a 1400x750 canvas, coloured by
z-index band, with its tag_text rendered in the real font at the real size.

That is enough to decide the questions QA stage C actually asks:

  - is a value box attached to the thing it describes, or floating?
  - do two labels collide once their glyphs are drawn?
  - is a cluster complete, and are its members at the right offsets?
  - is the LED inside the heater body?
  - is a duct continuous under its damper?
  - is a sidebar section built once?

It is NOT enough to judge artwork, shading or symbol orientation. A preview
produced by this script is approximate by construction and must be labelled as
such when shown, per AI-BRIEFING.txt section 9.

Rendered glyph extents are the point. The validator is deliberately
dependency-free and therefore cannot measure text; it estimates, and every
width-dependent finding it reports is a warning for that reason (rule V-P08).
This script hands the measuring to a browser, which does it properly. Open the
output at a 1400x750 viewport, at 100% zoom, or the measurement is worthless.
"""

from __future__ import annotations

import argparse
import html
import json
import io
import os
import sys


# The host parses geometry with parseInt, so "120px" -> 120 and "196.5" -> 196.
# Mirror it exactly here: a preview must show what the host would draw, not
# what the JSON literally says.
def px(value, default=0):
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return default
    sign = 1
    if text[0] in "+-":
        if text[0] == "-":
            sign = -1
        text = text[1:]
    digits = ""
    for ch in text:
        if ch.isdigit():
            digits += ch
        else:
            break
    if not digits:
        return default
    return sign * int(digits)


def envelope_of(document):
    """Accept both the committed {_note, envelope} wrapper and a flat export."""
    if isinstance(document, dict) and "envelope" in document:
        return document["envelope"]
    return document


# Colour by z-index band. The bands are the panel's own structure, so colouring
# by band makes a mixed or defaulted z-index visible at a glance.
BANDS = {
    "5":    ("#8fa6b8", "rgba(143,166,184,0.35)", "duct / pipe / connector"),
    "15":   ("#b8c4cc", "rgba(184,196,204,0.30)", "dummy arrow"),
    "20":   ("#4a7fb5", "rgba(74,127,181,0.25)",  "sub-page navigation"),
    "40":   ("#3f4b57", "rgba(63,75,87,0.28)",    "equipment body"),
    "110":  ("#1f6f43", "rgba(255,255,255,0.92)", "value / setpoint / json"),
    "300":  ("#b5651d", "rgba(181,101,29,0.25)",  "dummy 2-way motor"),
    "375":  ("#c0392b", "rgba(192,57,43,0.30)",   "alarm / LED / pump / valve"),
    "1100": ("#6c3fb5", "rgba(108,63,181,0.12)",  "text label"),
}
UNKNOWN_BAND = ("#ff00ff", "rgba(255,0,255,0.35)", "UNKNOWN z-index")

# Font sizes the host uses, keyed by the object families that render text.
# Anything else falls back to 11 px, which is the host default.
FONT_SIZES = [
    ("number_v3_label_8px", 8),
    ("number_v3_label_11px", 11),
    ("number_v3_label_13px", 13),
    ("number_v3_label_16px", 16),
]


def font_size_for(obj_id):
    for prefix, size in FONT_SIZES:
        if obj_id.startswith(prefix):
            return size
    return 11


# WHERE THE TAG RENDERS, and how much of that this script actually knows.
#
# A plain label object draws its text at its own top-left, so for that family
# the glyph positions here are exact and a collision found in this preview is a
# real collision. Two other families do not, and getting this wrong in either
# direction is worse than useless: text drawn in the wrong place invents
# collisions that are not there and hides ones that are.
#
#   *_tag_up_center  - the id states it: the tag renders ABOVE the box, centred.
#                      Direction and alignment are both readable from the name,
#                      so they are applied.
#   *_con_left/right/top/down
#                    - a connector stub occupies one edge and the text sits clear
#                      of it. The SIDE is readable from the name; the stub WIDTH
#                      is not, and it is not recorded anywhere in this
#                      repository. Rather than invent an inset, the text is
#                      centred in the box and flagged.
#
# Flagged text is drawn in a different colour and listed in the legend, so a
# reader knows which glyph positions to trust. Do not "improve" this by guessing
# an inset: an invented offset would make the preview look authoritative while
# being wrong, which is the failure this whole contract exists to prevent.
def text_placement(obj_id):
    """Return (css, exact) — exact is False when the position is approximate."""
    if "tag_up_center" in obj_id:
        # above the box, centred: both stated by the id
        return ("left:0;right:0;bottom:100%;text-align:center;", True)
    for direction in ("con_left", "con_right", "con_top", "con_down"):
        if direction in obj_id:
            return ("left:0;right:0;top:50%;transform:translateY(-50%);"
                    "text-align:center;", False)
    return ("left:1px;top:0;", True)


PAGE = """<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8">
<title>{title}</title>
<style>
  html, body {{ margin: 0; padding: 0; background: #52606d; }}
  #canvas {{
    position: relative;
    width: {width}px;
    height: {height}px;
    /* The standard blank Ventilasjon sidebar background, approximated: the
       real PNG is served by the host. Only the split matters for QA. */
    background: #eef2f5;
    border-right: 0;
    overflow: visible;
    font-family: Arial, Helvetica, sans-serif;
  }}
  #canvas::after {{
    /* the sidebar gutter, at the x where production header bars start */
    content: "";
    position: absolute; left: {sidebar_x}px; top: 0;
    width: 1px; height: {height}px;
    background: rgba(0,0,0,0.12);
  }}
  .o {{
    position: absolute;
    box-sizing: border-box;
    border: 1px solid;
    overflow: visible;
    white-space: nowrap;
  }}
  .t {{
    position: absolute;
    line-height: 1;
    color: #10202e;
  }}
  /* Text whose position this script can only approximate - see
     text_placement(). Do not read a collision involving one of these as a
     finding without confirming it against the host. */
  .approx {{ color: #8a4b00; }}
  /* A text label carries no box of its own in the real panel, so drawing its
     border would invent a collision that is not there. Show it faintly. */
  .band1100 {{ border-style: dashed; }}
  #legend {{
    position: absolute; top: {height}px; left: 0;
    width: {width}px; padding: 6px 8px; box-sizing: border-box;
    font: 11px Arial, sans-serif; color: #e7edf2; background: #52606d;
  }}
  #legend span {{ display: inline-block; margin-right: 14px; }}
  #legend i {{ display: inline-block; width: 10px; height: 10px;
               margin-right: 4px; vertical-align: -1px; border: 1px solid; }}
</style>
<div id="canvas">
{objects}
</div>
<div id="legend">{legend}<br>{note}</div>
</html>
"""


def render(document, title):
    env = envelope_of(document)
    panel = env["panel"]
    width = px(panel.get("panel_width"), 1400)
    height = px(panel.get("panel_height"), 750)
    objects = panel.get("single_objects", []) or []

    parts = []
    seen_bands = []
    approx_count = 0
    for obj in objects:
        obj_id = str(obj.get("obj_id", ""))
        z = str(obj.get("zIndex", "")).strip()
        stroke, fill, _label = BANDS.get(z, UNKNOWN_BAND)
        if z not in seen_bands:
            seen_bands.append(z)

        left, top = px(obj.get("posLeft")), px(obj.get("posTop"))
        w, h = px(obj.get("posWidth")), px(obj.get("posHeight"))

        tag = str(obj.get("tag_text", "") or "")
        # A single space is deliberate on room-endpoint values; it renders as
        # nothing and must not be drawn as if it were a caption.
        text_html = ""
        if tag.strip():
            placement, exact = text_placement(obj_id)
            if not exact:
                approx_count += 1
            text_html = '<span class="t%s" style="%sfont-size:%dpx">%s</span>' % (
                "" if exact else " approx",
                placement,
                font_size_for(obj_id),
                html.escape(tag),
            )

        band_class = " band1100" if z == "1100" else ""
        parts.append(
            '<div class="o%s" style="left:%dpx;top:%dpx;width:%dpx;height:%dpx;'
            'z-index:%s;border-color:%s;background:%s" title="%s">%s</div>'
            % (
                band_class, left, top, w, h,
                html.escape(z) or "auto", stroke, fill,
                html.escape("%s  %s  (%d,%d) %dx%d z=%s  %s"
                            % (obj.get("name", ""), obj_id, left, top, w, h, z,
                               obj.get("alias_text", ""))),
                text_html,
            )
        )

    legend = "".join(
        '<span><i style="border-color:%s;background:%s"></i>z %s &mdash; %s</span>'
        % (BANDS.get(z, UNKNOWN_BAND)[0], BANDS.get(z, UNKNOWN_BAND)[1], z,
           BANDS.get(z, UNKNOWN_BAND)[2])
        for z in sorted(seen_bands, key=lambda v: px(v, 99999))
    )
    note = ("APPROXIMATE. Boxes and text are drawn from the JSON coordinates; "
            "object artwork is served by the host and is not shown. "
            "%d objects, canvas %dx%d. "
            "%d tags are drawn in brown because their exact position inside "
            "the box is not recorded anywhere: the connector families inset "
            "their text past a stub of unknown width. Confirm any collision "
            "involving one of those against the host before reporting it."
            % (len(objects), width, height, approx_count))

    return PAGE.format(
        title=html.escape(title),
        width=width,
        height=height,
        sidebar_x=1150,
        objects="\n".join(parts),
        legend=legend,
        note=html.escape(note),
    )


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("panel", help="panel JSON (wrapped or flat)")
    ap.add_argument("-o", "--output", default=None,
                    help="output HTML path (default: alongside the input)")
    args = ap.parse_args(argv)

    with io.open(args.panel, encoding="utf-8") as fh:
        document = json.load(fh)

    out = args.output or os.path.splitext(args.panel)[0] + "-preview.html"
    with io.open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(render(document, os.path.basename(args.panel)))

    env = envelope_of(document)
    print("wrote %s (%d objects, %sx%s)" % (
        out,
        len(env["panel"].get("single_objects", []) or []),
        env["panel"].get("panel_width"),
        env["panel"].get("panel_height"),
    ))
    print("Open it at a 1400x750 viewport at 100% zoom, or the rendered text "
          "extents are meaningless.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
