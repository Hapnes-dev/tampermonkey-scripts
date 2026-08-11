#!/usr/bin/env python3
"""Pixel-level checks for a Maskin background edit. One implementation, two callers.

`tests/test_maskin_equipment_removal.py` runs these against the committed
miniature fixture; `maskin-visual-qa.py` runs the same functions against a real
decoded `panel.image_data` and writes the crops and the QA manifest.

WHY THIS EXISTS AS A MODULE.

`validate-maskin-panel.py` judges a panel document. The background inside that
document is a base64 blob, so every defect this file looks for - a receiver
clipped by an oversized erase rectangle, a transparent canvas flattened to
black, a riser that stops one row short of its header, a bypass drawn two
columns wide where the circuit is three - is invisible to it. These are the
`M-A10`-`M-A19` rules of MASKIN-GENERATION-CONTRACT.md #17, and none of them is
enforceable from JSON.

Every function here takes a raster in the fixture's own shape::

    {"width": W, "height": H, "pixels": [[[r, g, b, a], ...W], ...H]}

and a *spec* - the machine-readable circuit-routing inventory and junction
ledger the contract requires to be written down BEFORE any pixel changes. The
spec is evidence about one drawing; nothing here carries a default colour,
thickness or alpha, because there is no such thing as a default (`M-A03`).

Raises AssertionError with a message that names the rule and the repair, so a
test failure and a review comment say the same thing.

No network access. Pure stdlib.
"""

from __future__ import annotations

import collections

# --------------------------------------------------------------------------
# Raster primitives
# --------------------------------------------------------------------------


def validate_raster_shape(raster):
    width, height, pixels = raster["width"], raster["height"], raster["pixels"]
    assert len(pixels) == height, f"raster rows: expected {height}, got {len(pixels)}"
    for index, row in enumerate(pixels):
        assert len(row) == width, (
            f"raster row {index}: expected width {width}, got {len(row)}")
        for pixel in row:
            assert len(pixel) == 4 and all(
                isinstance(channel, int) and 0 <= channel <= 255
                for channel in pixel), f"invalid RGBA pixel {pixel}"


def at(raster, x, y):
    return tuple(raster["pixels"][y][x])


def region_points(box):
    """Every (x, y) inside a {x, y, width, height} box."""
    return [(x, y)
            for y in range(box["y"], box["y"] + box["height"])
            for x in range(box["x"], box["x"] + box["width"])]


def in_any_region(point, boxes):
    x, y = point
    return any(box["x"] <= x < box["x"] + box["width"]
               and box["y"] <= y < box["y"] + box["height"] for box in boxes)


def circuit_pixels(raster, circuit):
    """Every point whose RGB is this circuit's, at any alpha above zero.

    Alpha is deliberately not filtered here: an antialiasing row IS the pipe
    (`M-A16`), and a check that drops it measures a different pipe than the one
    the source drew.
    """
    rgb = tuple(circuit["rgb"])
    return {(x, y)
            for y, row in enumerate(raster["pixels"])
            for x, pixel in enumerate(row)
            if tuple(pixel[:3]) == rgb and pixel[3] > 0}


def opaque_circuit_pixels(raster, circuit):
    """The full-alpha core only - what a junction must actually join on."""
    rgb = tuple(circuit["rgb"])
    return {(x, y)
            for y, row in enumerate(raster["pixels"])
            for x, pixel in enumerate(row)
            if tuple(pixel[:3]) == rgb and pixel[3] == 255}


def circuit_components(raster, circuit, background, opaque_only=True):
    """Connected components of one circuit, bridged where another circuit crosses it.

    Two orthogonal lines cannot both be continuous and disjoint in one raster
    layer: at the crossing, one of them is drawn over the other. The convention
    this repository uses is that the FOREGROUND circuit is carried over by a
    bypass and the crossed circuit keeps its own continuity - it is interrupted
    only by the bypass itself, inside the window the routing inventory declared,
    and by nothing else.

    So the crossed circuit's components are computed over its own pixels plus
    the declared crossing windows. A background gap, a dark cleanup smear or a
    cleared corridor anywhere in that window is exactly what stops bridging it,
    which is the defect this whole check exists for.
    """
    points = (opaque_circuit_pixels(raster, circuit) if opaque_only
              else circuit_pixels(raster, circuit))
    for box in circuit.get("bridged_by", []):
        for x, y in region_points(box):
            pixel = tuple(raster["pixels"][y][x])
            if pixel[3] > 0 and pixel != tuple(background):
                points.add((x, y))
    return connected_components(points)


def connected_components(points):
    """4-connected components of a point set, largest first."""
    remaining = set(points)
    components = []
    while remaining:
        seed = remaining.pop()
        component = {seed}
        pending = [seed]
        while pending:
            x, y = pending.pop()
            for neighbour in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbour in remaining:
                    remaining.remove(neighbour)
                    component.add(neighbour)
                    pending.append(neighbour)
        components.append(component)
    components.sort(key=len, reverse=True)
    return components


def component_holding(components, point):
    for index, component in enumerate(components):
        if point in component:
            return index
    return None


def touching(points_a, points_b):
    """The 4-adjacent contact points between two sets, plus any shared point."""
    contacts = set()
    for x, y in points_a:
        for neighbour in ((x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if neighbour in points_b:
                contacts.add(neighbour)
    return contacts


# --------------------------------------------------------------------------
# M-A12 - the background-fill contract
# --------------------------------------------------------------------------

def classify_background(raster, spec):
    """Count the four pixel classes the background-fill contract separates.

    Transparent and opaque-background are NOT the same thing, and dark artwork
    is not background at any colour. Conflating either pair is what turns a
    requested light panel black.
    """
    background = spec["background"]
    requested = tuple(background["requested_rgba"])
    circuits = {tuple(circuit["rgb"]) for circuit in spec["circuits"].values()}
    counts = collections.Counter()
    for row in raster["pixels"]:
        for pixel in row:
            rgba = tuple(pixel)
            if rgba[3] == 0:
                counts["transparent"] += 1
            elif rgba == requested:
                counts["background"] += 1
            elif rgba[:3] in circuits:
                counts["circuit"] += 1
            elif max(rgba[:3]) <= background.get("dark_artwork_max_channel", 96):
                counts["dark_artwork"] += 1
            else:
                counts["other_artwork"] += 1
    return dict(counts)


def check_background_fill(raster, spec):
    """`M-A12`: the delivered canvas shows the requested background colour.

    Three distinct failures, one check, because they are indistinguishable to
    the eye until you sample: transparency that the host renders as whatever is
    behind it, a flatten that used opaque black as its cleanup colour, and a
    flatten that missed one blank area.
    """
    validate_raster_shape(raster)
    background = spec["background"]
    requested = tuple(background["requested_rgba"])

    leftover = [(x, y)
                for y, row in enumerate(raster["pixels"])
                for x, pixel in enumerate(row) if pixel[3] == 0]
    assert not leftover, (
        f"{len(leftover)} fully transparent pixel(s) remain, first at "
        f"{leftover[0]}. A transparent pixel is not a background colour: it "
        f"shows whatever the host puts behind it, which is how a panel asked "
        f"for in the normal light background arrives black (M-A12)")

    wrong = [(x, y) for (x, y) in
             [tuple(point) for point in background["sample_points"]]
             if at(raster, x, y) != requested]
    if wrong:
        got = {at(raster, x, y) for x, y in wrong}
        raise AssertionError(
            f"{len(wrong)} background sample point(s) are not the requested "
            f"background {requested}: {sorted(wrong)} carry {sorted(got)}. "
            f"Sample several blank points across the main canvas AND the "
            f"sidebar - one sample proves one pixel (M-A12)")


def check_no_cleanup_residue(raster, spec):
    """`M-A13`: an edited area carries artwork or background, never leftovers.

    Repeated erase-and-redraw leaves two signatures on a pipe: opaque cleanup
    pixels in a colour that belongs to no circuit, and partial-alpha ghosts at
    alpha values the source profile never had. Both read as dirt at native
    size and neither shows up in any JSON check.
    """
    validate_raster_shape(raster)
    background = tuple(spec["background"]["requested_rgba"])
    allowed_alphas = collections.defaultdict(set)
    for circuit in spec["circuits"].values():
        rgb = tuple(circuit["rgb"])
        for profile in ("horizontal_profile", "vertical_profile"):
            for row in circuit.get(profile, []):
                allowed_alphas[rgb].add(row["alpha"])
    allowed_rgba = {tuple(box["rgba"]) for box in spec.get("artwork_colours", [])}

    residue = []
    for box in spec["edit_masks"]:
        for x, y in region_points(box):
            rgba = at(raster, x, y)
            if rgba == background or rgba in allowed_rgba:
                continue
            if rgba[:3] in allowed_alphas:
                if rgba[3] in allowed_alphas[rgba[:3]]:
                    continue
                residue.append((box["name"], (x, y), rgba, "alpha not in the "
                                "circuit's measured profile"))
                continue
            residue.append((box["name"], (x, y), rgba, "colour belongs to no "
                            "circuit and to no declared artwork"))
    if residue:
        name, point, rgba, why = residue[0]
        raise AssertionError(
            f"{len(residue)} cleanup residue pixel(s) inside the edit masks; "
            f"first in {name!r} at {point}: {rgba} - {why}. Restore the area "
            f"from the retained original and redraw once, rather than painting "
            f"over the last attempt (M-A13, M-A10)")


# --------------------------------------------------------------------------
# M-A16 - thickness and alpha acceptance
# --------------------------------------------------------------------------

def sample_cross_section(raster, start, orientation, length, depth):
    """`depth` runs across the pipe, `length` along it. Returns rows of pixels."""
    x, y = start
    rows = []
    for offset in range(depth):
        if orientation == "horizontal":
            rows.append([at(raster, x + step, y + offset) for step in range(length)])
        else:
            rows.append([at(raster, x + offset, y + step) for step in range(length)])
    return rows


def profile_of(circuit, orientation):
    key = "horizontal_profile" if orientation == "horizontal" else "vertical_profile"
    profile = circuit.get(key)
    assert profile, (
        f"circuit {circuit.get('role')!r} has no measured {orientation} profile. "
        f"Measure it from the source before drawing: a horizontal and a vertical "
        f"run of one circuit may legitimately differ (M-A16)")
    return profile


def check_pipe_profiles(raster, spec):
    """`M-A16`: a repaired run matches the adjacent untouched source run exactly.

    Not "about two pixels wide". The comparison is against a sample of the SAME
    circuit that the edit did not touch, row by row and alpha by alpha, because
    a line that is two opaque rows plus one partial-alpha row is not a two-pixel
    line and does not join what the three-row line joined.
    """
    validate_raster_shape(raster)
    for name, circuit in spec["circuits"].items():
        for sample in circuit.get("samples", []):
            orientation = sample["orientation"]
            profile = profile_of(circuit, orientation)
            depth = len(profile)
            expected = [tuple(circuit["rgb"]) + (row["alpha"],) for row in profile]

            reference = sample_cross_section(
                raster, sample["reference_start"], orientation,
                sample["length"], depth)
            repaired = sample_cross_section(
                raster, sample["repaired_start"], orientation,
                sample["length"], depth)

            for index, (want, got_rows) in enumerate(zip(expected, reference)):
                bad = [point for point in got_rows if point != want]
                assert not bad, (
                    f"{name} {sample['name']}: the UNTOUCHED reference sample at "
                    f"{sample['reference_start']} does not match the declared "
                    f"profile on row {index} ({want} expected, {bad[0]} found). "
                    f"The inventory is wrong, or the edit damaged the run it was "
                    f"measured from (M-A14)")
            for index, (want, got_rows) in enumerate(zip(expected, repaired)):
                bad = [point for point in got_rows if point != want]
                if bad:
                    raise AssertionError(
                        f"{name} {sample['name']}: repaired run at "
                        f"{sample['repaired_start']} differs from the adjacent "
                        f"source run on row {index} of {depth}: expected {want}, "
                        f"found {bad[0]}. Apparent thickness includes the "
                        f"antialiasing rows - copy the source profile, do not "
                        f"redraw it at a guessed width (M-A16)")

            after = sample_cross_section(
                raster, sample["repaired_start"], orientation,
                sample["length"], depth + 1)[depth]
            overrun = [point for point in after if point[:3] == tuple(circuit["rgb"])]
            assert not overrun, (
                f"{name} {sample['name']}: the repaired run is at least "
                f"{depth + 1} rows deep and its own source measures {depth}. "
                f"Thickness is per-source and per-orientation, never carried "
                f"over from another run (M-A16)")


# --------------------------------------------------------------------------
# M-A15 / M-A17 - crossing, junction, bend, termination
# --------------------------------------------------------------------------

def junction_ledger(raster, spec):
    """`M-A17`: one ledger row per connection the edit touched.

    Returns rows rather than raising, because the ledger is a deliverable in its
    own right - QA reports it whether it passed or failed.
    """
    validate_raster_shape(raster)
    background = spec["background"]["requested_rgba"]
    rows = []
    for junction in spec["junctions"]:
        circuit = spec["circuits"][junction["circuit"]]
        opaque = opaque_circuit_pixels(raster, circuit)
        components = circuit_components(raster, circuit, background)
        faint = circuit_components(raster, circuit, background, opaque_only=False)
        overlap = region_points(junction["overlap"])
        overlap_opaque = [point for point in overlap if point in opaque]

        a = tuple(junction["endpoint_a"])
        b = tuple(junction["endpoint_b"])
        index_a = component_holding(components, a)
        index_b = component_holding(components, b)

        failures = []
        if index_a is None:
            failures.append(f"endpoint_a {a} carries no opaque {junction['circuit']} pixel")
        if index_b is None:
            failures.append(f"endpoint_b {b} carries no opaque {junction['circuit']} pixel")
        if index_a is not None and index_b is not None and index_a != index_b:
            faint_a = component_holding(faint, a)
            faint_b = component_holding(faint, b)
            if faint_a is not None and faint_a == faint_b:
                failures.append(
                    "only antialiasing pixels touch: the faint edge rows bridge "
                    "the junction while the opaque centrelines remain separated. "
                    "A junction joins the cores, not the halo")
            else:
                failures.append(
                    "one or more background pixels separate the two segments: "
                    "the horizontal stops short of the riser, or the riser stops "
                    "short of the header")
        if not overlap_opaque:
            failures.append(
                f"the expected shared rectangle {junction['overlap']} contains no "
                f"opaque {junction['circuit']} pixel at all")

        rows.append({
            "junction": junction["name"],
            "circuit": junction["circuit"],
            "endpoint_a": list(a),
            "endpoint_b": list(b),
            "expected_overlap": junction["overlap"],
            "opaque_overlap_pixels": len(overlap_opaque),
            "result": "pass" if not failures else "fail",
            "failures": failures,
        })
    return rows


def check_junctions(raster, spec):
    rows = junction_ledger(raster, spec)
    failed = [row for row in rows if row["result"] == "fail"]
    if failed:
        first = failed[0]
        raise AssertionError(
            f"{len(failed)} of {len(rows)} junction(s) are not continuous; first "
            f"{first['junction']!r} ({first['circuit']}): "
            f"{'; '.join(first['failures'])}. A pipe that stops one row short of "
            f"its header is a broken circuit at native size and a perfect panel "
            f"to every JSON check there is (M-A17)")
    return rows


def check_crossings(raster, spec):
    """`M-A15`: a non-connected crossing stays visibly separate, with a bypass.

    Three failures live here and they look alike from far away: the two circuits
    were merged into one drawn line, the over-circuit was simply cut where the
    other one passes, and a bypass was drawn but outside the geometry that was
    inventoried for it.
    """
    validate_raster_shape(raster)
    background = spec["background"]["requested_rgba"]
    results = []
    for crossing in spec["crossings"]:
        over = spec["circuits"][crossing["over"]]
        under = spec["circuits"][crossing["under"]]
        over_points = circuit_pixels(raster, over)
        under_points = circuit_pixels(raster, under)

        if crossing.get("connected"):
            results.append({"crossing": crossing["name"], "kind": "connected",
                            "result": "pass", "failures": []})
            continue

        failures = []
        window = crossing["straight_through_window"]
        straight = [point for point in region_points(window) if point in over_points]
        if straight:
            failures.append(
                f"{len(straight)} pixel(s) of {crossing['over']!r} run straight "
                f"along their own centreline through {window}, where "
                f"{crossing['under']!r} passes: first at {sorted(straight)[0]}. "
                f"With no bypass, a reader cannot tell this crossing from a "
                f"junction")

        bypass = crossing["bypass"]
        carried = [point for point in region_points(bypass) if point in over_points]
        if not carried:
            failures.append(
                f"the declared bypass footprint {bypass} carries no "
                f"{crossing['over']!r} pixel: nothing bridges the crossing")

        # The two circuits are allowed to meet in exactly one declared window -
        # the pixels where the bypass passes over the crossed pipe. Contact
        # anywhere else is an unintended connection.
        allowed = crossing["overlap"]
        dilated = {"x": allowed["x"] - 1, "y": allowed["y"] - 1,
                   "width": allowed["width"] + 2, "height": allowed["height"] + 2}
        stray = sorted(point for point in touching(over_points, under_points)
                       if not in_any_region(point, [dilated]))
        if stray:
            failures.append(
                f"{len(stray)} pixel(s) of {crossing['over']!r} touch "
                f"{crossing['under']!r} outside the declared crossing window "
                f"{allowed}, first at {stray[0]}: an accidental junction")

        components = connected_components(over_points)
        a = tuple(crossing["approach_a"])
        b = tuple(crossing["approach_b"])
        index_a = component_holding(components, a)
        index_b = component_holding(components, b)
        if index_a is None or index_b is None or index_a != index_b:
            failures.append(
                f"{crossing['over']!r} does not run continuously from "
                f"{a} to {b}: the circuit was cut at the crossing instead of "
                f"being carried over it")

        results.append({
            "crossing": crossing["name"],
            "kind": "non-connected",
            "bypass": bypass,
            "straight_through_pixels": len(straight),
            "stray_contact_pixels": len(stray),
            "result": "pass" if not failures else "fail",
            "failures": failures,
        })

    failed = [row for row in results if row["result"] == "fail"]
    if failed:
        first = failed[0]
        raise AssertionError(
            f"{len(failed)} of {len(results)} crossing(s) failed; first "
            f"{first['crossing']!r}: {'; '.join(first['failures'])}. Two circuits "
            f"that cross without connecting must be drawn so a reader sees it at "
            f"native size: the foreground circuit bridges, in its own measured "
            f"style, and no pixel of the two ever meets (M-A15)")
    return results


def check_connectivity(raster, spec):
    """`M-A17`: the anchors a circuit must reach, and the ones it must not.

    Junctions are checked one at a time; this asks the whole-path question the
    ledger cannot: is the header actually reachable from the branch, through
    every bend, after every repair.
    """
    validate_raster_shape(raster)
    background = spec["background"]["requested_rgba"]
    connectivity = spec["connectivity"]
    for requirement in connectivity["same_component"]:
        circuit = spec["circuits"][requirement["circuit"]]
        components = circuit_components(raster, circuit, background)
        indexes = {}
        for anchor in requirement["anchors"]:
            point = tuple(anchor)
            indexes[point] = component_holding(components, point)
        missing = [point for point, index in indexes.items() if index is None]
        assert not missing, (
            f"{requirement['circuit']}: no opaque pixel at required anchor(s) "
            f"{missing}. The circuit does not reach where the inventory says it "
            f"terminates (M-A17)")
        distinct = set(indexes.values())
        assert len(distinct) == 1, (
            f"{requirement['circuit']}: the required anchors fall in "
            f"{len(distinct)} connected components, not one - "
            f"{ {point: index for point, index in indexes.items()} }. Every "
            f"anchor on one circuit belongs to one component unless a documented "
            f"non-connected crossing separates them (M-A17)")


# --------------------------------------------------------------------------
# M-A10 / M-A11 / M-A18 - protection boundary and diff scope
# --------------------------------------------------------------------------

def check_protected_regions(before, after, spec):
    """`M-A11`: nothing inside a protected component changed.

    The receiver is one artwork object even though it is drawn as a dozen
    strokes: body, rounded ends, outline, internal detail, level bar, its labels
    and its connection pixels. An erase rectangle that takes a corner of it
    takes the whole component, because a partial vessel is not a vessel.
    """
    validate_raster_shape(before)
    validate_raster_shape(after)
    damaged = collections.OrderedDict()
    for region in spec["protected_regions"]:
        hits = [point for point in region_points(region)
                if before["pixels"][point[1]][point[0]]
                != after["pixels"][point[1]][point[0]]]
        if hits:
            damaged[region["name"]] = (region, hits)
    if damaged:
        name, (region, hits) = next(iter(damaged.items()))
        raise AssertionError(
            f"{len(damaged)} protected component(s) changed; first {name!r} "
            f"({region.get('kind', 'artwork')}) lost or altered {len(hits)} "
            f"pixel(s), first at {hits[0]}. Determine the smallest safe edit mask "
            f"before erasing anything, and restore the component from the "
            f"retained original if a cleanup ever reaches its boundary (M-A11)")


def diff_scopes(before, after, spec):
    """`M-A18`: split the pixel diff into the scopes that were authorised.

    A background-colour conversion legitimately touches most of the canvas, and
    an equipment removal touches a few hundred pixels. Reported as one number
    they hide each other; reported separately, each one is checkable.
    """
    validate_raster_shape(before)
    validate_raster_shape(after)
    edit_masks = spec["edit_masks"]
    conversion = spec.get("background_conversion") or {}
    conversion_regions = conversion.get("regions", [])

    inside_edit, inside_conversion, outside = [], [], []
    for y in range(after["height"]):
        for x in range(after["width"]):
            if before["pixels"][y][x] == after["pixels"][y][x]:
                continue
            point = (x, y)
            if in_any_region(point, edit_masks):
                inside_edit.append(point)
            elif conversion.get("applies") and in_any_region(point, conversion_regions):
                inside_conversion.append(point)
            else:
                outside.append(point)
    return {
        "edit_mask_pixels_changed": len(inside_edit),
        "background_conversion_pixels_changed": len(inside_conversion),
        "unauthorised_pixels_changed": len(outside),
        "unauthorised_examples": [list(point) for point in outside[:12]],
        "edit_masks": edit_masks,
        "background_conversion": conversion,
    }


def check_diff_scope(before, after, spec):
    report = diff_scopes(before, after, spec)
    assert report["unauthorised_pixels_changed"] == 0, (
        f"{report['unauthorised_pixels_changed']} pixel(s) changed outside the "
        f"union of the documented edit masks"
        + (" and the declared background-colour conversion"
           if (spec.get("background_conversion") or {}).get("applies") else "")
        + f"; first at {report['unauthorised_examples'][0]}. Compare the delivery "
        f"with the retained original, not with the previous attempt, and report "
        f"the two scopes separately (M-A18)")
    return report


def check_component_removed(after, spec):
    """`M-A11`: the component the request named is gone, and only that one."""
    validate_raster_shape(after)
    removed = spec["removed_component"]
    background = tuple(spec["background"]["requested_rgba"])
    left = [point for point in region_points(removed)
            if at(after, *point) != background]
    assert not left, (
        f"{len(left)} pixel(s) of {removed['name']!r} survive the removal, first "
        f"at {left[0]} carrying {at(after, *left[0])}. The request named this "
        f"component; a partial erase leaves an artefact that reads as damage "
        f"rather than as a removal (M-A11)")


# --------------------------------------------------------------------------
# The manifest
# --------------------------------------------------------------------------

def qa_manifest(before, after, spec):
    """Everything the pixel checks can decide, as data. Nothing it cannot.

    Deliberately not called a visual QA pass: this proves continuity, profile,
    scope and protection. Whether the drawing now *reads* correctly is decided
    by looking at the renders this manifest lists, at native size.
    """
    def attempt(name, function):
        try:
            function()
            return {"check": name, "result": "pass", "detail": ""}
        except AssertionError as error:
            return {"check": name, "result": "fail", "detail": str(error)}

    ledger = junction_ledger(after, spec)
    crossings = []
    try:
        crossings = check_crossings(after, spec)
    except AssertionError:
        for crossing in spec["crossings"]:
            crossings.append({"crossing": crossing["name"], "result": "fail"})

    return {
        "canvas": {"width": after["width"], "height": after["height"]},
        "pixel_classes": classify_background(after, spec),
        "checks": [
            attempt("M-A11 requested component fully removed",
                    lambda: check_component_removed(after, spec)),
            attempt("M-A11 protected components unchanged",
                    lambda: check_protected_regions(before, after, spec)),
            attempt("M-A12 background fill",
                    lambda: check_background_fill(after, spec)),
            attempt("M-A13 no cleanup residue",
                    lambda: check_no_cleanup_residue(after, spec)),
            attempt("M-A15 crossings and bypasses",
                    lambda: check_crossings(after, spec)),
            attempt("M-A16 pipe cross-sections",
                    lambda: check_pipe_profiles(after, spec)),
            attempt("M-A17 junction continuity",
                    lambda: check_junctions(after, spec)),
            attempt("M-A17 circuit connectivity",
                    lambda: check_connectivity(after, spec)),
            attempt("M-A18 pixel-diff scope",
                    lambda: check_diff_scope(before, after, spec)),
        ],
        "junction_ledger": ledger,
        "crossings": crossings,
        "diff_scope": diff_scopes(before, after, spec),
        "not_decided_here": [
            "Whether the drawing reads correctly to an operator at native size.",
            "Whether the removed component was the one the user meant.",
            "Whether a dynamic object lands inside the pill the artwork draws.",
            "Whether the requested background colour is the right colour for "
            "this plant - that is evidence from the task or the source raster.",
        ],
    }
