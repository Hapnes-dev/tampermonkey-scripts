// ==UserScript==
// @name         Logic Designer Section Copy/Paste
// @namespace    https://logic-designer-section.local
// @version      1.7.79
// @description  Copy/paste selected node subgraphs (with internal wires and variable bindings) in the iwmac logic designer.
// @author       Henrik Monge
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js
// @match        http://internal.iwmac.local/vv_fbx.qxs*
// @match        https://internal.iwmac.local/vv_fbx.qxs*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      toolbox.iwmac.local
// ==/UserScript==

// ─── Pure helpers (top-level so Node tests can reach them) ──────────

// Build a JSON-serializable clipboard snapshot from per-node info and
// internal wires (both endpoints in the node set). Pure — no host access.
// Inputs come from the host adapter; outputs are the clipboard format.
function buildSnapshot({ nodes, wires }) {
    const refToLocalId = new Map();
    const outNodes = nodes.map((n, i) => {
      const localId = `n${i}`;
      refToLocalId.set(n.ref, localId);
      const out = {
        localId,
        type: n.type,
        position: { x: n.position.x, y: n.position.y },
        data: n.data,
      };
      if (n.unknownType) out.unknownType = true;
      return out;
    });

    const outWires = [];
    for (const w of wires) {
      const fromLocal = refToLocalId.get(w.from?.node);
      const toLocal = refToLocalId.get(w.to?.node);
      if (!fromLocal || !toLocal) continue; // drop wires touching unselected nodes
      outWires.push({
        from: { nodeLocalId: fromLocal, pin: w.from.pin },
        to:   { nodeLocalId: toLocal, pin: w.to.pin },
      });
    }

    return {
      version: 1,
      copiedAt: new Date().toISOString(),
      nodes: outNodes,
      wires: outWires,
    };
  }

  // Session-scoped LIFO history of undo records. Pure — no host access.
  // Records are type-discriminated ({type: 'paste' | 'delete', timestamp, payload})
  // but the stack itself is opaque to record contents. Stack survives only the
  // current page session (in-memory).
  function createUndoHistory(getContext = () => []) {
    const stack = [];
    let context = [];
    let generation = 0;
    function clear() { stack.length = 0; generation++; }
    function sync() {
      const next = getContext();
      if (next.length !== context.length || next.some((value, i) => value !== context[i])) {
        clear();
        context = next.slice();
      }
    }
    return {
      push(record) { sync(); stack.push(record); },
      pop() { sync(); return stack.length > 0 ? stack.pop() : null; },
      size() { sync(); return stack.length; },
      isEmpty() { sync(); return stack.length === 0; },
      generation() { sync(); return generation; },
      clear,
    };
  }

  // Classifies a block by which pin sides it carries. Pure — no host access.
  // Used by the multi-wire marquee observer to infer source/target direction.
  function classifyBlockPinDirection(block) {
    const outs = Array.isArray(block?.outputs) ? block.outputs.length : 0;
    const ins = Array.isArray(block?.inputs) ? block.inputs.length : 0;
    if (outs > 0 && ins > 0) return 'bidirectional';
    if (outs > 0) return 'source-only';
    if (ins > 0) return 'target-only';
    return 'none';
  }

  // Pairs N source pins to M target pins, handling occupied targets and
  // optional expansion of expandable-input blocks. Pure — no host access.
  //
  // Inputs:
  //   sources:           pre-sorted-by-y array of {blockRef, pinIndex, side}
  //   targetBlockRef:    the destination block's ref
  //   targetPins:        array of {connected: bool, pinIndex: number}, sorted by index
  //   targetSide:        'input' | 'output' — opposite of sources' side
  //   startPin:          array offset into targetPins where pairing begins.
  //                      For pin-click, pass the clicked pin's array index;
  //                      for block-body, pass 0 (the offset is ignored beyond that).
  //   targetIsPinClick:  true = user clicked a specific pin; false = block body
  //   expandableMax:     null if not expandable; otherwise max_inputs cap
  //
  // Returns: { pairs, occupiedToDisconnect, expansionNeeded, unpaired }
  //
  // Block-body click: skip occupied target pins, advance to next free.
  // Pin-click: take pins consecutively starting at startPin; mark occupied for disconnect.
  function pairSourcesToTargets({
    sources, targetBlockRef, targetPins, targetSide, startPin, targetIsPinClick, expandableMax,
  }) {
    const pairs = [];
    const occupiedToDisconnect = [];
    let expansionNeeded = null;
    let srcIdx = 0;

    // Phase 1: walk existing target pins from startPin onward.
    for (let i = startPin; i < targetPins.length && srcIdx < sources.length; i++) {
      const tp = targetPins[i];
      if (targetIsPinClick) {
        // Pin-click: take consecutive pins, mark occupied ones for disconnect.
        if (tp.connected) {
          occupiedToDisconnect.push({ dstRef: targetBlockRef, dstPin: tp.pinIndex });
        }
        pairs.push({
          srcRef: sources[srcIdx].blockRef,
          srcPin: sources[srcIdx].pinIndex,
          srcSide: sources[srcIdx].side,
          dstRef: targetBlockRef,
          dstPin: tp.pinIndex,
        });
        srcIdx++;
      } else {
        // Block-body: skip occupied pins.
        if (tp.connected) continue;
        pairs.push({
          srcRef: sources[srcIdx].blockRef,
          srcPin: sources[srcIdx].pinIndex,
          srcSide: sources[srcIdx].side,
          dstRef: targetBlockRef,
          dstPin: tp.pinIndex,
        });
        srcIdx++;
      }
    }

    // Phase 2: expansion (input side only).
    const remaining = sources.length - srcIdx;
    if (remaining > 0 && expandableMax !== null && targetSide === 'input' && targetPins.length < expandableMax) {
      const expansionCount = Math.min(remaining, expandableMax - targetPins.length);
      const newCount = targetPins.length + expansionCount;
      expansionNeeded = { newCount };
      // Add pairs for the new pin indices.
      for (let k = 0; k < expansionCount; k++) {
        const newPinIndex = targetPins.length + k;
        pairs.push({
          srcRef: sources[srcIdx].blockRef,
          srcPin: sources[srcIdx].pinIndex,
          srcSide: sources[srcIdx].side,
          dstRef: targetBlockRef,
          dstPin: newPinIndex,
        });
        srcIdx++;
      }
    }

    const unpaired = sources.length - srcIdx;
    return { pairs, occupiedToDisconnect, expansionNeeded, unpaired };
  }

  // Distributes N sources across M targets, 1-to-1 sliced by visual y.
  // Pure — no host access.
  //
  // Inputs:
  //   sources: array of {blockRef, pinIndex, side, y}, sorted by y
  //   targets: array of {blockRef, pinCount, y, ...other-fields-passed-through}
  //
  // Returns: { slices, unassigned }
  //   slices: array of {target, sources: [sliceOfSources]}, in target order
  //   unassigned: count of leftover sources (shouldn't occur in typical use, but
  //               returned defensively for callers that pass mismatched counts)
  //
  // Distribution rule: floor(N/M) per target, first (N mod M) targets get +1.
  // Equal distribution; per-target capacity NOT considered here — that's the
  // caller's responsibility (call site checks capacity BEFORE invoking).
  function distributeSourcesAcrossTargets({ sources, targets }) {
    if (targets.length === 0) {
      return { slices: [], unassigned: sources.length };
    }
    const sortedSources = [...sources].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const sortedTargets = [...targets].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const n = sortedSources.length;
    const m = sortedTargets.length;
    const base = Math.floor(n / m);
    const remainder = n % m;

    const slices = [];
    let cursor = 0;
    for (let i = 0; i < m; i++) {
      const sliceSize = base + (i < remainder ? 1 : 0);
      slices.push({
        target: sortedTargets[i],
        sources: sortedSources.slice(cursor, cursor + sliceSize),
      });
      cursor += sliceSize;
    }
    return { slices, unassigned: 0 };
  }

  // ─── Sketch quick-open pure helpers (Node-testable) ────────────────

  // Resolve a project row's visible name to its project id, given a
  // load_project_list() result ([{id, name}]). Exact (trimmed) match first,
  // then case-insensitive. Returns the id string, or null if unresolved.
  function matchProjectId(rowName, projects) {
    if (!Array.isArray(projects) || projects.length === 0) return null;
    const name = String(rowName == null ? '' : rowName).trim();
    if (!name) return null;
    for (const p of projects) {
      if (p && String(p.name).trim() === name) return String(p.id);
    }
    const lower = name.toLowerCase();
    for (const p of projects) {
      if (p && String(p.name).trim().toLowerCase() === lower) return String(p.id);
    }
    return null;
  }

  // Build display fields for one sketch list entry. Pure: maps a sketch
  // metadata object {id, name, date, compile_date} to display strings.
  // `changed` = last changed (date), `deployed` = last deployed (compile_date).
  // Author is loaded separately from load_history_list.
  function formatSketchEntry(sketch) {
    const s = sketch || {};
    const name = String(s.name == null ? '' : s.name).trim() || '(untitled)';
    const changed = String(s.date == null ? '' : s.date).trim() || '—';
    const deployed = String(s.compile_date == null ? '' : s.compile_date).trim() || '—';
    return { id: String(s.id), name, changed, deployed };
  }

  // Same history-field convention as the loaded-sketch information widget.
  function historyAuthor(entry) {
    for (const [key, value] of Object.entries(entry || {})) {
      if (!/user|author|by|name/i.test(key)) continue;
      if (typeof value === 'string' && value && !/^\d{4}-\d{2}-\d{2}/.test(value) && !/^\d+$/.test(value)) return value;
    }
    return null;
  }

  // Idempotency predicate for dialog re-open: the "Get started!" window is
  // hidden+reused (not rebuilt), so rows reappear. The DOM code stamps a
  // processed row with el.dataset.ldscpSqo = '1'. Returns true when already
  // stamped, so we don't inject a second arrow.
  function isRowProcessed(markerValue) {
    return typeof markerValue === 'string' && markerValue.length > 0;
  }

  // Parse a host alarm-row string into its parts. Format:
  //   VV_<proj>_<sketch>:<pointer>:<line>   e.g. "VV_1021_3445:41:1"
  // `pointer` matches paper.elements[ref].pointer (the canvas "(NN)" label).
  // Pure — used by both the Node tests and the AlarmHighlight module.
  function parseAlarmToken(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/VV_(\d+)_(\d+):(\d+):(\d+)/);
    if (!m) return null;
    return { proj: Number(m[1]), sketch: Number(m[2]), pointer: Number(m[3]), line: Number(m[4]) };
  }

  // Distinct block pointers from a list of parsed alarms, first-seen order.
  // Drives the "Errors: N" pill count and flashAll(). Pure.
  function distinctPointers(alarms) {
    if (!Array.isArray(alarms)) return [];
    const seen = [];
    for (const a of alarms) {
      if (a && typeof a.pointer === 'number' && !seen.includes(a.pointer)) {
        seen.push(a.pointer);
      }
    }
    return seen;
  }

  // Skip the browser-only body when loaded under Node for tests.
  // Without this guard, the IIFE's references to unsafeWindow / GM_*
  // would throw the moment Node `require()`s this file for pure-helper tests.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    (function () {
      'use strict';

      // ─── User-editable keyboard shortcuts ──────────────────────────
      // Each shortcut: { key: 'w' (single lowercase char), label: 'W' (menu display) }.
      // MULTIWIRE / REMOVE are unmodified canvas keys. PASTE_PLACE is a Ctrl chord.
      // To rebind, change both `key` and `label` so the keyboard handler AND the
      // menu entry stay in sync. PASTE_PLACE additionally has `ctrl: true` so the
      // handler knows to treat it as a Ctrl chord.
      const SHORTCUTS = {
        MULTIWIRE:   { key: 'w', label: 'W' },
        REMOVE:      { key: 'r', label: 'R' },
        PASTE_PLACE: { key: 'b', label: 'Ctrl+B', ctrl: true },
      };

      // ═══════════════════════════════════════════════════════════════
      //  Constants & duplicate-load guard
      // ═══════════════════════════════════════════════════════════════

      const SCRIPT_NAME = 'Logic Designer Section Copy/Paste';
      const VERSION = '1.7.0';
      const LOAD_FLAG = '__LDSCP_LOADED';
      const STORE_KEY = 'ldscp:clipboard:v1';
      const PASTE_OFFSET = { x: 40, y: 40 };
      const undoHistory = createUndoHistory(() => [
        W.logic_designer?.paper, W.application?.current_project,
        W.application?.current_sketch, W.application?.current_process,
      ]);

      const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : null) || window;

      if (W[LOAD_FLAG]) return;
      W[LOAD_FLAG] = true;

      // ─── Cursor tracker (used by GhostPasteMode entry + copy anchor) ──
      // Updated by a passive document mousemove listener installed at bootstrap.
      // `lastCursorClient` is null until the user moves the mouse at least once.
      let lastCursorClient = null;
      // Refs that were selected at the most recent doCopy() — used by
      // GhostPasteMode.buildOverlay to find the live host elements to clone.
      // Not persisted — reset on reload, set on every copy. Null until first copy.
      let latestSelectionRefs = null;

      function installCursorTracker() {
        document.addEventListener('mousemove', (event) => {
          lastCursorClient = { x: event.clientX, y: event.clientY };
        }, { capture: true, passive: true });
      }

      // Project a clientX/clientY pair into the host's SVG world coordinates.
      // Returns null if the host SVG is not reachable or the conversion fails.
      // Used by doCopy (to record cursorAnchor) and by GhostPasteMode (per mousemove).
      function clientToSvgWorld(clientPt) {
        if (!clientPt) return null;
        try {
          const paper = W.logic_designer?.paper;
          const elements = paper?.elements;
          if (!elements) return null;
          // Find any element's owner SVG. Raphael shapes all share the same root.
          let svg = null;
          for (const key of Object.keys(elements)) {
            const node = elements[key]?.set?.items?.[0]?.node;
            if (node?.ownerSVGElement) { svg = node.ownerSVGElement; break; }
          }
          if (!svg || typeof svg.createSVGPoint !== 'function') return null;
          const pt = svg.createSVGPoint();
          pt.x = clientPt.x;
          pt.y = clientPt.y;
          const ctm = svg.getScreenCTM();
          if (!ctm) return null;
          const w = pt.matrixTransform(ctm.inverse());
          return { x: w.x, y: w.y };
        } catch (err) {
          console.warn(`[${SCRIPT_NAME}] clientToSvgWorld failed:`, err);
          return null;
        }
      }

      // Inline monochrome SVG icons (Lucide-style). No network fetches.
      const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      const PASTE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>';
      // Three-dots menu icon for the launcher button.
      const MENU_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>';
      // Curved arrow pointing left ("undo"). Lucide-style.
      const UNDO_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path></svg>';
      // Three lines converging ("git-merge"-ish). Multi-wire mode icon.
      const MULTIWIRE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 9v3a6 6 0 0 0 6 6h3"></path></svg>';
      // Scissors / "remove connector" icon.
      const REMOVE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>';
      // Tag/label icon for the Paste tags menu entry.
      const TAG_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
      // Four-swatch grid icon for the Type colors toggle.
      const TYPECOLOR_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>';

      // ═══════════════════════════════════════════════════════════════
      //  Host adapter — ONLY module that touches unsafeWindow / host.
      //  Implementations follow SPIKE.md. Read-side only in this task;
      //  write-side comes in Task 7.
      // ═══════════════════════════════════════════════════════════════

      const HostAdapter = (() => {
        function getDesigner() {
          const ld = W.logic_designer;
          if (!ld || !ld.paper) {
            throw new Error('[LDSCP] logic_designer.paper not available; is this the right page?');
          }
          return ld;
        }

        function getPaper() {
          return getDesigner().paper;
        }

        // A "real" canvas element key is numeric; string keys are user-block templates.
        function isNumericKey(k) {
          return /^\d+$/.test(String(k));
        }

        function getSelection() {
          const paper = getPaper();
          // Marquee selection yields string keys ('12'); Ctrl-click yields numbers (12).
          // Normalize to numbers so the rest of the adapter doesn't have to handle both.
          const sel = Array.from(paper.selected_blocks || [])
            .filter((ref) => isNumericKey(ref))
            .map(Number)
            .filter((ref) => paper.elements[ref] != null);
          return sel;
        }

        function getNodeType(ref) {
          const paper = getPaper();
          try { return paper.get_block_type(ref); }
          catch { return paper.elements[ref]?.block_type ?? null; }
        }

        function getNodePosition(ref) {
          const el = getPaper().elements[ref];
          const main = el?.set?.items?.[0];
          if (!main) return { x: 0, y: 0 };
          // Raphael stores the on-canvas position in the SVG transform matrix.
          // `matrix.e` / `matrix.f` are the translation x / y. The `_` helper
          // exposes the same values as `dx` / `dy` and is the most stable
          // accessor across Raphael versions.
          const aux = main._;
          if (aux && typeof aux.dx === 'number' && typeof aux.dy === 'number') {
            return { x: aux.dx, y: aux.dy };
          }
          const m = main.matrix;
          if (m && typeof m.e === 'number' && typeof m.f === 'number') {
            return { x: m.e, y: m.f };
          }
          // Local-attribute fallbacks (unlikely to fire but cheap to keep).
          const a = main.attrs;
          if (a) {
            if (typeof a.x === 'number' && typeof a.y === 'number') return { x: a.x, y: a.y };
            if (Array.isArray(a.path) && Array.isArray(a.path[0]) && a.path[0].length >= 3) {
              return { x: a.path[0][1] || 0, y: a.path[0][2] || 0 };
            }
          }
          return { x: 0, y: 0 };
        }

        function getNodeData(ref) {
          const paper = getPaper();
          const el = paper.elements[ref];
          const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
          return {
            type: safe(() => paper.get_block_type(ref), el?.block_type),
            func: safe(() => paper.get_block_func(ref), el?.func),
            compile_type: safe(() => paper.get_block_compile_type(ref), el?.compile_type),
            data: safe(() => paper.get_block_data(ref), el?.data),
            override: (() => {
              // get_block_override often returns null even when the element has
              // {alias_text: "..."}. Prefer the raw element override when present.
              try {
                const fromGetter = paper.get_block_override(ref);
                if (fromGetter && fromGetter.alias_text) return fromGetter;
              } catch { /* fall through */ }
              return el?.override || null;
            })(),
            config: safe(() => paper.get_block_config(ref), el?.config),
            properties: safe(() => paper.get_block_properties(ref), el?.properties),
            runtime: safe(() => paper.get_block_runtime(ref), el?.runtime),
            inputs: safe(() => paper.get_block_inputs(ref), el?.inputs),
            outputs: safe(() => paper.get_block_outputs(ref), el?.outputs),
          };
        }

        function getInternalWires(refs) {
          // Walk each selected destination block's inputs[]. Each connected input
          // points back at its source via inputs[i].connected_to = {ref, put_id}.
          // The destination pin index is the array index `i`. paper.connections
          // entries don't carry usable pin info from script, so we use the
          // per-block inputs array instead (verified via live probe).
          const paper = getPaper();
          const refSet = new Set(refs);
          const out = [];

          for (const toRef of refs) {
            const el = paper.elements[toRef];
            const inputs = el?.inputs;
            if (!Array.isArray(inputs)) continue;

            for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
              const inp = inputs[inputIndex];
              if (!inp || !inp.connected) continue;
              const ct = inp.connected_to;
              if (!ct) continue;

              const fromRef = ct.ref;
              const fromPin = typeof ct.put_id === 'number' ? ct.put_id : 0;
              if (typeof fromRef !== 'number') continue;
              if (!refSet.has(fromRef)) continue; // skip wires from outside the selection

              out.push({
                from: { node: fromRef, pin: fromPin },
                to:   { node: toRef, pin: inputIndex },
              });
            }
          }
          return out;
        }

        function getWiresTouchingNodes(refs) {
          // Returns every wire where at least ONE endpoint is in `refs` (vs
          // getInternalWires which requires BOTH endpoints to be in `refs`).
          // Used by the delete-interceptor to capture the full wire context
          // around blocks that are about to be deleted.
          //
          // Scans ALL canvas blocks: a wire from a deleted block to a
          // surviving block is recorded on the surviving block's inputs[]
          // array, so we have to look at the surviving block to find it.
          const paper = getPaper();
          const refSet = new Set(refs);
          const out = [];

          for (const [key, el] of Object.entries(paper.elements)) {
            if (!/^\d+$/.test(key)) continue;
            const toRef = Number(key);
            const inputs = el?.inputs;
            if (!Array.isArray(inputs)) continue;

            for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
              const inp = inputs[inputIndex];
              if (!inp || !inp.connected) continue;
              const ct = inp.connected_to;
              if (!ct || typeof ct.ref !== 'number') continue;

              const fromRef = ct.ref;
              const fromPin = typeof ct.put_id === 'number' ? ct.put_id : 0;

              // Keep the wire if EITHER endpoint is in refs.
              if (!refSet.has(fromRef) && !refSet.has(toRef)) continue;

              out.push({
                from: { node: fromRef, pin: fromPin },
                to:   { node: toRef, pin: inputIndex },
              });
            }
          }
          return out;
        }

        function nextRefId() {
          const paper = getPaper();
          // The host uses paper.element_pointer as the monotonic next-id counter.
          // Verified during the spike: was 23 on a 22-element canvas; matches `paper.parsed_elements`
          // length plus a small buffer. Fall back to max-of-keys + 1 if the counter is missing.
          if (typeof paper.element_pointer === 'number' && Number.isFinite(paper.element_pointer)) {
            return paper.element_pointer;
          }
          const numericKeys = Object.keys(paper.elements || {})
            .filter((k) => /^\d+$/.test(k))
            .map(Number);
          return numericKeys.length > 0 ? Math.max(...numericKeys) + 1 : 0;
        }

        function bumpRefCounter(usedRef) {
          // Manually advance paper.element_pointer past the ref we just consumed so
          // future host actions don't collide with our new nodes.
          const paper = getPaper();
          if (typeof paper.element_pointer === 'number' && paper.element_pointer <= usedRef) {
            paper.element_pointer = usedRef + 1;
          }
        }

        function createNode({ type, position, payload }) {
          // payload is the host-adapter-shaped node data from the snapshot:
          // { type, func, compile_type, data, override, config, properties, runtime, inputs, outputs }
          // Returns the new host ref (number). Throws on host failure.
          const paper = getPaper();
          const ref = nextRefId();
          if (paper.elements?.[ref] != null) throw new Error(`Block ID ${ref} is already in use.`);
          // Reserve the ID even if a later setter fails after rendering.
          bumpRefCounter(ref);

          // Step 1: __render_block(type, x, y, ref, override, properties)
          // override is {alias_text}; null is acceptable but the host expects an object,
          // so pass `{}` if null.
          const override = payload.override || {};
          const properties = payload.properties != null ? payload.properties : [];
          try {
            paper.__render_block(type, position.x, position.y, ref, override, properties);
            if (payload.func != null) paper.set_block_func(ref, payload.func);
            if (payload.data != null) paper.set_block_data(ref, payload.data);
          } catch (err) {
            if (paper.elements?.[ref] != null) {
              try { deleteNode(ref); }
              catch (cleanupError) { console.error(`[${SCRIPT_NAME}] Partial node cleanup failed:`, cleanupError); }
              if (paper.elements?.[ref] != null) {
                // A failed cleanup must still leave the partial node removable by Undo.
                undoHistory.push({ type: 'paste', timestamp: new Date().toISOString(), payload: { nodeRefs: [ref] } });
              }
            }
            throw err;
          }
          return ref;
        }

        function createWire({ fromNode, fromPin, toNode, toPin }) {
          // From SPIKE.md: paper.__connect({id, put}, {id, put}, manual: boolean)
          const paper = getPaper();
          paper.__connect({ id: fromNode, put: fromPin }, { id: toNode, put: toPin }, true);
        }

        function setSelection(refs) {
          // The host's __select_block requires a real mouse event, so we can't
          // call it from script. Instead, set paper.selected_blocks directly —
          // this is the same array the marquee path populates.
          const paper = getPaper();
          try {
            paper.selected_blocks = Array.from(refs);
          } catch (err) {
            console.warn('[LDSCP] setSelection failed (non-fatal):', err);
          }
        }

        function deleteNode(ref) {
          // Strategy 2 (verified live): temporarily set selection, call
          // __delete_selected, restore selection.
          // Strategy 1 (__delete_block_connection) failed during the spike with
          // a TypeError — it expects a connection object, not a block ref.
          const paper = getPaper();
          const restore = Array.from(paper.selected_blocks || []);
          paper.selected_blocks = [ref];
          try {
            paper.__delete_selected();
          } finally {
            paper.selected_blocks = restore.filter((r) => r !== ref);
          }
        }

        function disconnectWire({ toNode, toPin }) {
          // Verified live (see probe1–probe4): the host's true disconnect API is
          // a pair, not a single call. __disconnect_output takes the source output
          // object plus the put_connection index and removes the visual line and
          // source-side state; __disconnect_input clears the target input state
          // (host does not touch the input from the output-side call).
          //
          // Contract: idempotent. If the pin is already not connected, returns
          // false (nothing to do); the desired post-condition is achieved either
          // way. Returns true when a wire was actually removed.
          const paper = getPaper();
          const tgt = paper.elements?.[toNode];
          const input = tgt?.inputs?.[toPin];

          if (input?.connected && input.connected_to) {
            // Normal path: input still references the source, use it.
            const { ref: srcRef, put_id: srcPutId, put_connection_id: putConn, connection_id: connId } = input.connected_to;
            const srcOutput = paper.elements?.[srcRef]?.outputs?.[srcPutId];
            if (!srcOutput) {
              throw new Error(`disconnectWire: missing source output ${srcRef}:${srcPutId}`);
            }
            // The input-side's put_connection_id can desync from the source's
            // connected_to map. Verify the entry at `putConn` actually matches
            // our wire's connection_id; if not, search by connection_id.
            let effectivePutConn = putConn;
            const entryAtPutConn = srcOutput.connected_to?.[putConn];
            if (!entryAtPutConn || entryAtPutConn.connection_id !== connId) {
              for (const k of Object.keys(srcOutput.connected_to || {})) {
                if (srcOutput.connected_to[k]?.connection_id === connId) {
                  effectivePutConn = k;
                  break;
                }
              }
            }
            paper.__disconnect_output(srcRef, srcOutput, effectivePutConn);
            paper.__disconnect_input(toNode, input);
            return true;
          }

          // Reactive cleanup: input side is already cleared but orphan state may
          // remain on paper.connections + source.outputs.connected_to + SVG DOM
          // (host bookkeeping can desync after sequences of create/undo/create
          // /undo). Find any orphan wire records that should land on this input
          // pin and clean them up directly.
          const conns = paper.connections || [];
          const orphans = [];
          for (let i = 0; i < conns.length; i++) {
            const c = conns[i];
            if (!c?.user) continue;
            if (c.user.target !== toNode) continue;
            // Only orphans on this specific input pin — match via target input's
            // input pin index. The host doesn't expose this directly on the
            // connection, but the connection's `to` Raphael shape has a block_id
            // (target ref); pin index can't be derived without input.connected_to,
            // which is null. As a fallback, treat ALL connections whose target
            // is `toNode` and whose input pin is no longer claimed by any other
            // input as candidates. With a single orphan per pin this is safe.
            orphans.push({ index: i, conn: c });
          }
          if (orphans.length === 0) return false;

          let removedAny = false;
          // Iterate in reverse so splices don't shift later indices.
          for (let i = orphans.length - 1; i >= 0; i--) {
            const { conn } = orphans[i];
            try {
              // Remove SVG.
              try { conn.line?.remove?.(); } catch (e) {}
              try { conn.bg?.remove?.(); } catch (e) {}
              // Clean up source output's connected_to entry pointing here.
              const srcRef = conn.user.source;
              const srcEl = paper.elements?.[srcRef];
              if (srcEl?.outputs) {
                for (const op of srcEl.outputs) {
                  if (!op?.connected_to) continue;
                  for (const k of Object.keys(op.connected_to)) {
                    if (op.connected_to[k]?.connection_id === conn.id) {
                      delete op.connected_to[k];
                      if (typeof op.connections === 'number') op.connections = Math.max(0, op.connections - 1);
                      if (op.connections === 0) {
                        op.connected = false;
                        // Reset pin color if we have set_id + fill_color.
                        try {
                          const elShape = srcEl.set?.[op.set_id];
                          if (elShape && typeof op.fill_color !== 'undefined') {
                            elShape.attr?.('fill', op.fill_color);
                          }
                        } catch (e) {}
                      }
                    }
                  }
                }
              }
              // Clean up target input's connected_to entry (the input side may be
              // still holding a stale reference; symmetric to the source-side
              // cleanup above).
              const tgtRefForCleanup = conn.user.target;
              const tgtElForCleanup = paper.elements?.[tgtRefForCleanup];
              if (tgtElForCleanup?.inputs) {
                for (const inp of tgtElForCleanup.inputs) {
                  if (inp?.connected_to?.connection_id === conn.id) {
                    inp.connected = false;
                    inp.connected_to = null;
                    try {
                      const inputShape = tgtElForCleanup.set?.[inp.set_id];
                      if (inputShape && typeof inp.fill_color !== 'undefined') {
                        inputShape.attr?.('fill', inp.fill_color);
                      }
                    } catch (e) {}
                  }
                }
              }
              // Remove from paper.connections.
              const idx = paper.connections.indexOf(conn);
              if (idx >= 0) paper.connections.splice(idx, 1);
              removedAny = true;
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] disconnectWire orphan cleanup failed:`, conn, err);
            }
          }
          return removedAny;
        }

        function setBlockInputCount(blockRef, newCount) {
          // Direct passthrough to the host method. Captured in v1's write-side
          // spike trace as how FORMULA blocks dynamically grow their input pins.
          const paper = getPaper();
          paper.set_block_input_count(blockRef, newCount);
        }

        function getPinAtTarget(eventTarget) {
          // Resolve a click target → { blockRef, pinIndex, side } | null.
          // The host stores pin shapes on the block's Raphael set, addressed by
          // each pin's `set_id`. Verified live via probe5–probe6: el.set[set_id]
          // returns a Raphael circle whose .node is the SVG DOM element.
          // The plan's original `outputs[i].set` assumption was wrong on this
          // host build — el.set is a per-block collection, not per-pin.
          if (!eventTarget) return null;
          const paper = getPaper();
          const elements = paper?.elements;
          if (!elements) return null;

          for (const key of Object.keys(elements)) {
            if (!/^\d+$/.test(key)) continue;
            const blockRef = Number(key);
            const el = elements[key];
            if (!el?.set) continue;

            if (Array.isArray(el.outputs)) {
              for (let i = 0; i < el.outputs.length; i++) {
                const shape = el.set[el.outputs[i]?.set_id];
                const node = shape?.node;
                if (node && (node === eventTarget || node.contains?.(eventTarget))) {
                  return { blockRef, pinIndex: i, side: 'output' };
                }
              }
            }
            if (Array.isArray(el.inputs)) {
              for (let i = 0; i < el.inputs.length; i++) {
                const shape = el.set[el.inputs[i]?.set_id];
                const node = shape?.node;
                if (node && (node === eventTarget || node.contains?.(eventTarget))) {
                  return { blockRef, pinIndex: i, side: 'input' };
                }
              }
            }
          }
          return null;
        }

        function getWireAtTarget(eventTarget) {
          // Resolve a click target → { connectionId, from:{node,pin}, to:{node,pin} } | null.
          // Hit-tests against c.bg.node and c.line.node (the wire's SVG path elements).
          // For orphan wires (input side cleared but visual + source state remains)
          // returns to.pin = -1 so disconnectWire's reactive cleanup can act on it.
          if (!eventTarget) return null;
          const paper = getPaper();
          const conns = paper?.connections || [];
          for (const c of conns) {
            if (!c) continue;
            const bgNode = c.bg?.node;
            const lineNode = c.line?.node;
            if (bgNode === eventTarget || lineNode === eventTarget ||
                bgNode?.contains?.(eventTarget) || lineNode?.contains?.(eventTarget)) {
              const srcRef = c?.user?.source;
              const tgtRef = c?.user?.target;
              const connId = c?.id;
              if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
              const tgtEl = paper.elements?.[tgtRef];
              if (!tgtEl?.inputs) continue;
              let toPin = null;
              for (let i = 0; i < tgtEl.inputs.length; i++) {
                if (tgtEl.inputs[i]?.connected_to?.connection_id === connId) {
                  toPin = i;
                  break;
                }
              }
              // Orphan case: input side cleared but wire still in paper.connections.
              // Return -1 as toPin so the caller can identify and clean up.
              const srcEl = paper.elements?.[srcRef];
              const fromPinSrc = toPin !== null ? tgtEl.inputs[toPin]?.connected_to?.put_id : null;
              // NOTE: per __connect source, connected_to on the input side has
              // put_id = source output pin INDEX. Different from the output-side
              // connected_to entry. So we CAN read it here when input is healthy.
              const fromPin = typeof fromPinSrc === 'number' ? fromPinSrc : 0;
              const resolvedToPin = toPin !== null ? toPin : -1;
              return {
                connectionId: connId,
                from: { node: srcRef, pin: fromPin },
                to: { node: tgtRef, pin: resolvedToPin },
              };
            }
          }
          return null;
        }

        function getAllWires() {
          // Resolve EVERY connection on the paper → endpoint record plus the
          // wire's SVG path node (for geometric hit-testing in remove mode).
          // Orphan wires (input side already cleared) get to.pin = -1, same
          // convention as getWireAtTarget; disconnectWire cleans those up.
          const paper = getPaper();
          const conns = paper?.connections || [];
          const out = [];
          for (const c of conns) {
            if (!c?.user) continue;
            const srcRef = c.user.source;
            const tgtRef = c.user.target;
            if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
            const tgtEl = paper.elements?.[tgtRef];
            if (!tgtEl?.inputs) continue;
            let toPin = -1;
            for (let i = 0; i < tgtEl.inputs.length; i++) {
              if (tgtEl.inputs[i]?.connected_to?.connection_id === c.id) {
                toPin = i;
                break;
              }
            }
            const fromPin = toPin >= 0 ? (tgtEl.inputs[toPin]?.connected_to?.put_id ?? 0) : 0;
            out.push({
              connectionId: c.id,
              from: { node: srcRef, pin: fromPin },
              to: { node: tgtRef, pin: toPin },
              pathNode: c.line?.node || c.bg?.node || null,
            });
          }
          return out;
        }

        function getWiresInSelection(selectedRefs) {
          // Returns wires where BOTH endpoint blocks are in selectedRefs.
          // Used by Remove-mode marquee gesture.
          const refsSet = new Set(selectedRefs.map((r) => Number(r)));
          const paper = getPaper();
          const conns = paper?.connections || [];
          const out = [];
          for (const c of conns) {
            if (!c?.user) continue;
            const srcRef = c.user.source;
            const tgtRef = c.user.target;
            if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
            if (!refsSet.has(srcRef) || !refsSet.has(tgtRef)) continue;
            const tgtEl = paper.elements?.[tgtRef];
            if (!tgtEl?.inputs) continue;
            let toPin = null;
            for (let i = 0; i < tgtEl.inputs.length; i++) {
              if (tgtEl.inputs[i]?.connected_to?.connection_id === c.id) {
                toPin = i;
                break;
              }
            }
            if (toPin === null) continue;
            const fromPin = tgtEl.inputs[toPin]?.connected_to?.put_id ?? 0;
            out.push({
              connectionId: c.id,
              from: { node: srcRef, pin: fromPin },
              to: { node: tgtRef, pin: toPin },
            });
          }
          return out;
        }

        function getWiresTouchingNode(blockRef) {
          // Returns all wires with either endpoint on blockRef. Shape matches
          // getWiresInSelection. Used by Remove-mode block-body click gesture.
          const ref = Number(blockRef);
          const paper = getPaper();
          const conns = paper?.connections || [];
          const out = [];
          for (const c of conns) {
            if (!c?.user) continue;
            const srcRef = c.user.source;
            const tgtRef = c.user.target;
            if (srcRef !== ref && tgtRef !== ref) continue;
            if (typeof srcRef !== 'number' || typeof tgtRef !== 'number') continue;
            const tgtEl = paper.elements?.[tgtRef];
            if (!tgtEl?.inputs) continue;
            let toPin = null;
            for (let i = 0; i < tgtEl.inputs.length; i++) {
              if (tgtEl.inputs[i]?.connected_to?.connection_id === c.id) {
                toPin = i;
                break;
              }
            }
            if (toPin === null) continue;
            const fromPin = tgtEl.inputs[toPin]?.connected_to?.put_id ?? 0;
            out.push({
              connectionId: c.id,
              from: { node: srcRef, pin: fromPin },
              to: { node: tgtRef, pin: toPin },
            });
          }
          return out;
        }

        return {
          getSelection, getNodeType, getNodePosition, getNodeData, getInternalWires, getWiresTouchingNodes, getPinAtTarget,
          getWireAtTarget, getAllWires, getWiresInSelection, getWiresTouchingNode,
          createNode, createWire, setSelection, deleteNode, disconnectWire, setBlockInputCount,
        };
      })();

      // Shared helper: resolve a DOM event target → block ref (numeric) or null.
      // Used by SelectionInterceptor and MultiWireMode.
      function resolveBlockRefShared(target) {
        if (!target) return null;
        try {
          const paper = W.logic_designer?.paper;
          if (!paper?.elements) return null;
          if (typeof target.block_id === 'number') return target.block_id;
          for (const [key, el] of Object.entries(paper.elements)) {
            if (!/^\d+$/.test(key)) continue;
            const items = el?.set?.items;
            if (!Array.isArray(items)) continue;
            for (const item of items) {
              const node = item?.node;
              if (!node) continue;
              if (node === target || node.contains?.(target)) {
                return Number(key);
              }
            }
          }
        } catch { /* ignore */ }
        return null;
      }

      // ═══════════════════════════════════════════════════════════════
      //  Selection interceptor — Ctrl/Cmd-click toggles a block in/out
      //  of paper.selected_blocks, working across compile_type categories
      //  where the host's native handler does not.
      // ═══════════════════════════════════════════════════════════════

      const SelectionInterceptor = (() => {
        let marquee = null;

        function onMouseDown(event) {
          marquee = null;
          const ctrl = event.ctrlKey || event.metaKey;
          if (event.button !== 0 || MultiWireMode.isActive() || RemoveConnectorsMode.isActive() || GhostPasteMode.isActive()) return;
          if (!ctrl) return;
          // Other modifier chords may carry host meaning — pass through.
          if (event.altKey || event.shiftKey) return;
          // Don't steal Ctrl-click when the user is editing text on the page.
          if (isEditingText(event.target)) return;

          const ref = resolveBlockRefShared(event.target);
          const paper = W.logic_designer?.paper;
          if (!paper) return;
          if (ref == null) {
            if (paper.initialized && paper.paper?.canvas?.contains(event.target)
              && !HostAdapter.getPinAtTarget(event.target) && !HostAdapter.getWireAtTarget(event.target)) {
              marquee = {
                paper, generation: undoHistory.generation(), refs: HostAdapter.getSelection(),
                x: event.clientX, y: event.clientY,
              };
            }
            return; // Let the host draw and resolve its normal marquee.
          }

          // Toggle the ref in selected_blocks (normalize string/number keys to numbers).
          const current = Array.from(paper.selected_blocks || [])
            .filter((r) => /^\d+$/.test(String(r)))
            .map(Number);
          const idx = current.indexOf(ref);
          const next = idx === -1 ? [...current, ref] : current.filter((r) => r !== ref);
          paper.selected_blocks = next;

          // Best-effort visual highlight. The host's __select_block may accept
          // a real event; swallow errors if it doesn't.
          try {
            if (typeof paper.__select_block === 'function') {
              paper.__select_block(ref, event);
            }
          } catch (err) {
            // Silent — visual feedback is nice-to-have, not required.
          }

          event.preventDefault();
          event.stopPropagation();
        }

        function install() {
          document.addEventListener('mousedown', onMouseDown, true); // capture phase
          window.addEventListener('mouseup', (event) => {
            const session = marquee;
            if (!session || event.button !== 0) return;
            // Wait for native mouseup/click handlers to finish replacing selection.
            setTimeout(() => {
              if (marquee !== session) return;
              marquee = null;
              if (Math.hypot(event.clientX - session.x, event.clientY - session.y) < 4
                || W.logic_designer?.paper !== session.paper || undoHistory.generation() !== session.generation
                || MultiWireMode.isActive() || RemoveConnectorsMode.isActive() || GhostPasteMode.isActive()) return;
              const refs = [...new Set([...session.refs, ...HostAdapter.getSelection()].map(Number))]
                .filter((ref) => Number.isInteger(ref) && session.paper.elements?.[ref]);
              HostAdapter.setSelection(refs);
            }, 0);
          }, true);
          window.addEventListener('blur', () => { marquee = null; });
          window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') marquee = null;
          }, true);
        }

        return { install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Delete interceptor — Delete-key on selected blocks captures
      //  state before the host removes them, so doUndo can recreate.
      // ═══════════════════════════════════════════════════════════════

      const DeleteInterceptor = (() => {
        function isDeleteKey(event) {
          return event.key === 'Delete' || event.key === 'Del';
        }

        function captureBlocks(refs) {
          return refs.map((ref) => ({
            ref,
            type: HostAdapter.getNodeType(ref),
            position: HostAdapter.getNodePosition(ref),
            payload: HostAdapter.getNodeData(ref),
          }));
        }

        function onKeyDown(event) {
          if (!isDeleteKey(event)) return;
          if (isEditingText(event.target)) {
            // Typing in a field: Delete must stay plain text editing. The
            // host's shortcut handler doesn't check for text focus and eats
            // the key (Backspace works, Delete doesn't). We run in capture
            // phase before it — stop propagation so it never sees the key.
            // No preventDefault: the browser's forward-delete still runs.
            event.stopPropagation();
            return;
          }

          const sel = HostAdapter.getSelection();
          if (!sel || sel.length === 0) return; // nothing to capture; host no-ops too

          let blocks;
          let wires;
          try {
            blocks = captureBlocks(sel);
            wires = HostAdapter.getWiresTouchingNodes(sel);
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] DeleteInterceptor capture failed:`, err);
            return; // bail without pushing a partial record; host will still delete
          }

          undoHistory.push({
            type: 'delete',
            timestamp: new Date().toISOString(),
            payload: { blocks, wires },
          });

          // Intentionally do NOT preventDefault — the host's __on_shortcuts
          // handler runs as normal and performs the delete.
        }

        function install() {
          document.addEventListener('keydown', onKeyDown, true); // capture phase
        }

        return { install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Multi-wire mode — pick N pins on one side, finalize on the
      //  other side, create N wires top-to-bottom. Includes marquee
      //  observation for selecting whole blocks. Integrates into the
      //  existing undo stack via the 'multi-wire' record type.
      // ═══════════════════════════════════════════════════════════════

      const MultiWireMode = (() => {
        let mode = 'inactive';
        let ctrlHeld = false;
        let activePaper = null;
        let activeGeneration = null;
        let sourceSide = null;
        const sources = []; // [{ blockRef, pinIndex, side, y, overlayEl }]

        let bannerEl = null;

        function setBanner(text) {
          if (!bannerEl) {
            bannerEl = document.createElement('div');
            bannerEl.className = 'ldscp-mode-banner ldscp-mode-banner-wire';
            document.body.appendChild(bannerEl);
          }
          bannerEl.textContent = text;
        }

        function clearBanner() {
          if (bannerEl) {
            bannerEl.remove();
            bannerEl = null;
          }
        }

        function updateBanner() {
          const n = sources.length;
          const prefix = mode === 'fill' ? 'Multi-wire (fill mode — no expansion)'
            : mode === 'all' ? 'Multi-wire (all pins — includes connected outputs)'
            : 'Multi-wire';
          if (n === 0) {
            setBanner(`${prefix}: pick pins to connect. (Esc to cancel)`);
            return;
          }
          const sideLabel = sourceSide === 'output' ? (n === 1 ? 'output' : 'outputs') : (n === 1 ? 'input' : 'inputs');
          setBanner(`${prefix}: ${n} ${sideLabel} picked. Click target; hold Ctrl to keep outputs for another target. (Esc to cancel)`);
        }

        // Resolves the Raphael shape for a pin using the verified per-block
        // el.set[pin.set_id] pattern (NOT the plan's original pin.set.items —
        // see probes 5–6, that field does not exist on this host).
        function getPinShape(blockRef, pinIndex, side) {
          const paper = W.logic_designer?.paper;
          const el = paper?.elements?.[blockRef];
          const pin = (side === 'output' ? el?.outputs : el?.inputs)?.[pinIndex];
          if (!el?.set || !pin) return null;
          const shape = el.set[pin.set_id];
          if (!shape?.node) return null;
          return shape;
        }

        function drawPinOverlay(blockRef, pinIndex, side) {
          // Draw an orange ring overlay on top of the pin's existing circle.
          const shape = getPinShape(blockRef, pinIndex, side);
          if (!shape) return null;
          const svg = shape.node.ownerSVGElement;
          if (!svg) return null;
          const attrs = shape.attrs || {};
          const m = shape.matrix;
          const cx = (m?.e ?? 0) + (typeof attrs.cx === 'number' ? attrs.cx : 0);
          const cy = (m?.f ?? 0) + (typeof attrs.cy === 'number' ? attrs.cy : 0);
          const r = (typeof attrs.r === 'number' ? attrs.r : 5) + 3;
          const ns = 'http://www.w3.org/2000/svg';
          const overlay = document.createElementNS(ns, 'circle');
          overlay.setAttribute('cx', String(cx));
          overlay.setAttribute('cy', String(cy));
          overlay.setAttribute('r', String(r));
          overlay.setAttribute('fill', 'none');
          overlay.setAttribute('stroke', '#ffa500');
          overlay.setAttribute('stroke-width', '2');
          overlay.style.pointerEvents = 'none';
          svg.appendChild(overlay);
          return overlay;
        }

        function pinWorldY(blockRef, pinIndex, side) {
          const shape = getPinShape(blockRef, pinIndex, side);
          if (!shape) return 0;
          const m = shape.matrix;
          const attrs = shape.attrs || {};
          return (m?.f ?? 0) + (typeof attrs.cy === 'number' ? attrs.cy : 0);
        }

        function findSourceIndex(blockRef, pinIndex) {
          return sources.findIndex((s) => s.blockRef === blockRef && s.pinIndex === pinIndex);
        }

        function addSourcePin(blockRef, pinIndex, side) {
          if (sourceSide && sourceSide !== side) return; // wrong side, ignore
          if (!sourceSide) sourceSide = side;
          const idx = findSourceIndex(blockRef, pinIndex);
          if (idx !== -1) {
            // Toggle off
            const removed = sources.splice(idx, 1)[0];
            if (removed.overlayEl) removed.overlayEl.remove();
            if (sources.length === 0) sourceSide = null;
            updateBanner();
            return;
          }
          const y = pinWorldY(blockRef, pinIndex, side);
          const overlayEl = drawPinOverlay(blockRef, pinIndex, side);
          sources.push({ blockRef, pinIndex, side, y, overlayEl });
          updateBanner();
        }

        let lastObservedSelection = null; // string-stringified array, for cheap dedupe
        let pollTimer = null;

        function readSelection() {
          const paper = W.logic_designer?.paper;
          if (!paper) return [];
          return Array.from(paper.selected_blocks || [])
            .filter((r) => /^\d+$/.test(String(r)))
            .map(Number)
            .filter((r) => paper.elements?.[r] != null);
        }

        function observeSelectionPoll() {
          if (mode === 'inactive') return;
          if (!validContext()) { exit(); return; }
          const sel = readSelection();
          const fingerprint = JSON.stringify(sel);
          if (fingerprint === lastObservedSelection) return;
          lastObservedSelection = fingerprint;
          if (sel.length === 0) return; // ignore clears
          processMarqueeSelection(sel);
        }

        function startPolling() {
          stopPolling();
          lastObservedSelection = JSON.stringify(readSelection());
          pollTimer = setInterval(observeSelectionPoll, 150);
        }

        function stopPolling() {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          lastObservedSelection = null;
        }

        function processMarqueeSelection(refs) {
          const noExpand = mode === 'fill';
          const paper = W.logic_designer?.paper;
          if (!paper) return;

          // Classify each selected block.
          const sourceOnly = [];
          const targetOnly = [];
          const bidirectional = [];
          for (const ref of refs) {
            const block = paper.elements[ref];
            const kind = classifyBlockPinDirection(block);
            if (kind === 'source-only') sourceOnly.push(ref);
            else if (kind === 'target-only') targetOnly.push(ref);
            else if (kind === 'bidirectional') bidirectional.push(ref);
          }

          // Step 1: no sources yet.
          if (sources.length === 0) {
            // All source-only → add their outputs as sources.
            if (targetOnly.length === 0 && sourceOnly.length + bidirectional.length > 0) {
              addOutputsOrWarn([...sourceOnly, ...bidirectional]);
              return;
            }
            // All target-only → add their inputs as sources, await source gesture.
            if (sourceOnly.length === 0 && bidirectional.length === 0 && targetOnly.length > 0) {
              sourceSide = 'input';
              for (const ref of targetOnly) addAllPinsOfBlock(ref, 'input');
              return;
            }
            // Mix of source-only AND exactly one target-only → auto-finalize.
            if (sourceOnly.length > 0 && targetOnly.length === 1 && bidirectional.length === 0) {
              if (!addOutputsOrWarn(sourceOnly)) return;
              // Finalize against the single target-only block.
              const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
              const targets = [{ blockRef: targetOnly[0], startPin: 0, side: 'input', isPinClick: false, noExpand }];
              finish(snapshot, targets);
              return;
            }
            // Mix with multiple target-only → check if we can distribute.
            // Distribute when sources fit total target capacity AND no single
            // target absorbs all (mirrors the Step 2 distribute check). Falls
            // back to "Pick a target" toast if capacity rule fails.
            if (sourceOnly.length > 0 && targetOnly.length > 1) {
              // Pre-compute source-pin count: each source-only block contributes
              // its output pin count (1 per pin); we count the total pins, not blocks.
              // Count only the pins the bulk-add below would actually add
              // (connected outputs are filtered outside 'all' mode).
              const sourcePinCount = sourceOnly.reduce((acc, ref) => {
                const outs = paper.elements[ref]?.outputs;
                if (!Array.isArray(outs)) return acc;
                return acc + outs.filter((p) => mode === 'all' || !p?.connected).length;
              }, 0);
              const totalTargetCapacity = targetOnly.reduce((acc, ref) => {
                const b = paper.elements[ref];
                return acc + (Array.isArray(b?.inputs) ? b.inputs.length : 0);
              }, 0);
              const maxSingleTargetCapacity = targetOnly.reduce((acc, ref) => {
                const b = paper.elements[ref];
                return Math.max(acc, Array.isArray(b?.inputs) ? b.inputs.length : 0);
              }, 0);

              if (totalTargetCapacity >= sourcePinCount && maxSingleTargetCapacity < sourcePinCount) {
                // Distribute. Add all source pins, then dispatch a multi-target op.
                if (!addOutputsOrWarn(sourceOnly)) return;
                const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
                const targets = targetOnly.map((ref) => {
                  // Use pin-derived y (matches sources' pinWorldY), not b.matrix
                  // which is undefined on blocks in this host build.
                  const y = pinWorldY(ref, 0, 'input');
                  return {
                    blockRef: ref,
                    startPin: 0,
                    side: 'input',
                    isPinClick: false,
                    y,
                    noExpand,
                  };
                });
                finish(snapshot, targets);
                return;
              }

              // Capacity rule didn't fire — add sources, await user click.
              if (!addOutputsOrWarn(sourceOnly)) return;
              toast('Pick a target to pair into.');
              return;
            }
            return;
          }

          // Step 2: sources already collected. Look for opposite-side candidates.
          const oppositeSide = sourceSide === 'output' ? 'input' : 'output';
          const candidates = refs.filter((ref) => {
            const b = paper.elements[ref];
            const pins = oppositeSide === 'input' ? b?.inputs : b?.outputs;
            return Array.isArray(pins) && pins.length > 0;
          });

          // Fanout: 1 source → multiple targets (one wire per target).
          if (sources.length === 1 && candidates.length > 1) {
            const snapshot = [];
            for (let i = 0; i < candidates.length; i++) {
              // Replicate the single source N times so the slicer gives each target one wire.
              snapshot.push({ ...sources[0] });
            }
            const targets = candidates.map((ref) => {
              const y = pinWorldY(ref, 0, oppositeSide);
              return {
                blockRef: ref,
                startPin: 0,
                side: oppositeSide,
                isPinClick: false,
                y,
                noExpand: mode === 'fill',
              };
            });
            finish(snapshot, targets);
            return;
          }

          if (candidates.length === 1) {
            const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
            const targets = [{ blockRef: candidates[0], startPin: 0, side: oppositeSide, isPinClick: false, noExpand }];
            finish(snapshot, targets);
            return;
          }

          if (candidates.length > 1) {
            // Capacity-check: distribute if sources fit total opposite-side pin
            // capacity AND no single target absorbs all sources.
            const totalCapacity = candidates.reduce((acc, ref) => {
              const b = paper.elements[ref];
              const pins = oppositeSide === 'input' ? b?.inputs : b?.outputs;
              return acc + (Array.isArray(pins) ? pins.length : 0);
            }, 0);
            const maxSingleCapacity = candidates.reduce((acc, ref) => {
              const b = paper.elements[ref];
              const pins = oppositeSide === 'input' ? b?.inputs : b?.outputs;
              return Math.max(acc, Array.isArray(pins) ? pins.length : 0);
            }, 0);
            if (totalCapacity >= sources.length && maxSingleCapacity < sources.length) {
              // Distribute.
              const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
              const targets = candidates.map((ref) => {
                // Use pin-derived y (matches sources' pinWorldY).
                const y = pinWorldY(ref, 0, oppositeSide);
                return {
                  blockRef: ref,
                  startPin: 0,
                  side: oppositeSide,
                  isPinClick: false,
                  y,
                  noExpand,
                };
              });
              finish(snapshot, targets);
              return;
            }
            toast('Multiple targets — click a specific one to pair into.');
            return;
          }

          // No opposite-side candidates — same-side blocks; extend sources.
          for (const ref of refs) {
            const b = paper.elements[ref];
            const pins = sourceSide === 'output' ? b?.outputs : b?.inputs;
            if (Array.isArray(pins) && pins.length > 0) {
              addAllPinsOfBlock(ref, sourceSide);
            }
          }
        }

        function addAllPinsOfBlock(blockRef, side) {
          const block = W.logic_designer?.paper?.elements?.[blockRef];
          const pins = side === 'output' ? block?.outputs : block?.inputs;
          if (!Array.isArray(pins)) return;
          for (let i = 0; i < pins.length; i++) {
            // Marquee bulk-add skips outputs already feeding something, unless
            // in 'all' mode. Explicit pin clicks don't route through here, so
            // a connected output can still be picked deliberately.
            if (side === 'output' && mode !== 'all' && pins[i]?.connected) continue;
            addSourcePin(blockRef, i, side);
          }
        }

        // Step-1 marquee helper: set output side, bulk-add, and reset with a
        // hint when the connected-output filter left nothing to add.
        function addOutputsOrWarn(refs) {
          sourceSide = 'output';
          for (const ref of refs) addAllPinsOfBlock(ref, 'output');
          if (sources.length === 0) {
            sourceSide = null;
            toast(`All outputs already connected — cycle ${SHORTCUTS.MULTIWIRE.label} to all-pins mode to include them.`);
            return false;
          }
          return true;
        }

        function enter() {
          if (mode !== 'inactive') return;
          // Mutually exclusive with remove-mode and ghost-paste.
          if (typeof RemoveConnectorsMode !== 'undefined' && RemoveConnectorsMode.isActive()) {
            RemoveConnectorsMode.exit();
          }
          if (typeof GhostPasteMode !== 'undefined' && GhostPasteMode.isActive()) {
            GhostPasteMode.exit();
          }
          mode = 'collecting';
          activePaper = W.logic_designer?.paper;
          activeGeneration = undoHistory.generation();
          sourceSide = null;
          sources.length = 0;
          updateBanner();
          startPolling();
        }


        function exit() {
          if (mode === 'inactive') return;
          mode = 'inactive';
          sourceSide = null;
          for (const s of sources) {
            if (s.overlayEl) s.overlayEl.remove();
          }
          sources.length = 0;
          clearBanner();
          stopPolling();
        }

        function toggle() {
          // Cycle: inactive → collecting (skips wired outputs) → fill → all pins → inactive.
          // Sources and sourceSide survive mode flips; polling keeps running.
          if (mode === 'inactive') {
            enter();
          } else if (mode === 'collecting') {
            mode = 'fill';
            updateBanner();
          } else if (mode === 'fill') {
            mode = 'all';
            updateBanner();
          } else {
            // mode === 'all'
            exit();
          }
        }

        function isActive() {
          return mode !== 'inactive';
        }

        function validContext() {
          return activePaper === W.logic_designer?.paper && activeGeneration === undoHistory.generation()
            && sources.every((s) => activePaper?.elements?.[s.blockRef]?.[s.side === 'output' ? 'outputs' : 'inputs']?.[s.pinIndex]);
        }

        function finish(snapshot, targets) {
          if (!validContext()) { exit(); return; }
          // Inputs accept only one source; only outputs can be reused for fan-out.
          const repeat = ctrlHeld && sourceSide === 'output';
          if (!repeat) exit();
          doMultiWire({ sources: snapshot, targets });
          if (repeat) {
            lastObservedSelection = JSON.stringify(readSelection());
            updateBanner();
          }
        }

        function onMouseDown(event) {
          ctrlHeld = event.ctrlKey;
          if (mode === 'inactive') return;
          if (event.button !== 0) return;
          if (!validContext()) { exit(); return; }
          if (event.shiftKey) return;
          const pin = HostAdapter.getPinAtTarget(event.target);

          if (pin) {
            // Pin click
            if (!sourceSide || pin.side === sourceSide) {
              event.preventDefault();
              event.stopPropagation();
              addSourcePin(pin.blockRef, pin.pinIndex, pin.side);
              return;
            }
            // Opposite-side pin click → finalize
            if (sources.length === 0) return; // no sources collected yet
            event.preventDefault();
            event.stopPropagation();
            finalizeOnPin(pin);
            return;
          }

          // No pin resolved. Try block-body finalize if we have sources.
          if (sources.length === 0) return;
          const ref = resolveBlockRefShared(event.target);
          if (ref == null) return;
          // Confirm the block has at least one pin on the opposite side
          const block = W.logic_designer?.paper?.elements?.[ref];
          const oppositeSide = sourceSide === 'output' ? 'input' : 'output';
          const oppositePins = oppositeSide === 'input' ? block?.inputs : block?.outputs;
          if (!Array.isArray(oppositePins) || oppositePins.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          finalizeOnBlock(ref);
        }

        function finalizeOnPin(targetPin) {
          const targetSide = sourceSide === 'output' ? 'input' : 'output';
          const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
          const noExpand = mode === 'fill';
          const targets = [{
            blockRef: targetPin.blockRef,
            startPin: targetPin.pinIndex,
            side: targetSide,
            isPinClick: true,
            noExpand,
          }];
          finish(snapshot, targets);
        }

        function finalizeOnBlock(targetBlockRef) {
          const targetSide = sourceSide === 'output' ? 'input' : 'output';
          const snapshot = sources.map((s) => ({ blockRef: s.blockRef, pinIndex: s.pinIndex, side: s.side, y: s.y }));
          const noExpand = mode === 'fill';
          const targets = [{
            blockRef: targetBlockRef,
            startPin: 0,
            side: targetSide,
            isPinClick: false,
            noExpand,
          }];
          finish(snapshot, targets);
        }

        function install() {
          document.addEventListener('mousedown', onMouseDown, true);
          window.addEventListener('keydown', (event) => { ctrlHeld = event.ctrlKey; }, true);
          window.addEventListener('keyup', (event) => { ctrlHeld = event.ctrlKey; }, true);
          window.addEventListener('blur', () => { ctrlHeld = false; });
        }

        return { enter, exit, toggle, isActive, install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Remove-connectors mode — click wires/blocks/marquee to delete.
      //  Mutually exclusive with multi-wire mode. Undo via 'remove-batch'
      //  records (single wire removes get 'wire-remove' from WireObserver).
      //  Gesture handlers land in Tasks 10-11; this is the lifecycle shell.
      // ═══════════════════════════════════════════════════════════════

      const RemoveConnectorsMode = (() => {
        let mode = 'inactive';
        let bannerEl = null;
        let hoveredWireNode = null;
        let dragSession = null; // null or { wiresRemoved: [{from, to, connectionId}, ...] }

        function setBanner(text) {
          if (!bannerEl) {
            bannerEl = document.createElement('div');
            bannerEl.className = 'ldscp-mode-banner ldscp-mode-banner-remove';
            document.body.appendChild(bannerEl);
          }
          bannerEl.textContent = text;
        }

        function clearBanner() {
          if (bannerEl) {
            bannerEl.remove();
            bannerEl = null;
          }
        }

        function clearHover() {
          if (hoveredWireNode) {
            hoveredWireNode.classList?.remove('ldscp-wire-hover');
            hoveredWireNode = null;
          }
        }

        function enter() {
          if (mode === 'active') return;
          // Mutually exclusive with multi-wire and ghost-paste.
          if (MultiWireMode.isActive()) MultiWireMode.exit();
          if (typeof GhostPasteMode !== 'undefined' && GhostPasteMode.isActive()) {
            GhostPasteMode.exit();
          }
          mode = 'active';
          setBanner('Remove mode: click wires/blocks/marquee to delete. (Esc to cancel)');
        }

        function exit() {
          if (mode === 'inactive') return;
          mode = 'inactive';
          clearHover();
          clearBanner();
          dragSession = null;
        }

        function toggle() {
          if (mode === 'active') exit();
          else enter();
        }

        function isActive() {
          return mode === 'active';
        }

        function removeWireSilent(wire) {
          // Removes a wire WITHOUT pushing an undo record. The caller is
          // responsible for accumulating removed wires and pushing one batch
          // at the end of a drag session.
          try {
            WireObserver.suppressNextRemoveFor({ toNode: wire.to.node, toPin: wire.to.pin });
            const ok = HostAdapter.disconnectWire({ toNode: wire.to.node, toPin: wire.to.pin });
            return ok;
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] removeWireSilent failed:`, err);
            return false;
          }
        }

        const WIRE_HIT_PX = 6;    // max screen-px distance from cursor path to count as a hit
        const WIRE_SAMPLE_PX = 8; // spacing of pre-sampled points along each wire path

        function buildHitIndex() {
          // Pre-sample every wire's SVG path into screen coords, once per
          // gesture. Sweeps then hit-test geometrically (segment distance)
          // instead of via elementFromPoint, which steps right over ~2px
          // strokes and randomly missed crossings — the "ignored first wire".
          // ponytail: built at mousedown, never refreshed — zooming/scrolling
          // the canvas mid-drag stales it; release and press again to recover.
          const entries = [];
          for (const wire of HostAdapter.getAllWires()) {
            const node = wire.pathNode;
            if (!node?.getTotalLength || !node.getScreenCTM) continue;
            let len; let ctm;
            try {
              len = node.getTotalLength();
              ctm = node.getScreenCTM();
            } catch { continue; }
            if (!ctm || !len) continue;
            const pts = [];
            for (let d = 0; ; d += WIRE_SAMPLE_PX) {
              const at = Math.min(d, len);
              const p = node.getPointAtLength(at);
              pts.push({ x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f });
              if (at >= len) break;
            }
            entries.push({ wire, pts, removed: false });
          }
          return entries;
        }

        function distToSegmentSq(p, a, b) {
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const lenSq = abx * abx + aby * aby;
          let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
          t = Math.max(0, Math.min(1, t));
          const dx = p.x - (a.x + t * abx);
          const dy = p.y - (a.y + t * aby);
          return dx * dx + dy * dy;
        }

        function sweepRemove(a, b) {
          // Remove every not-yet-removed wire whose sampled path passes within
          // WIRE_HIT_PX of the swept segment a→b. With samples ≤ WIRE_SAMPLE_PX
          // apart, any true crossing has a sample within half that of the
          // segment, so no crossed wire can be skipped at any drag speed.
          const hitSq = WIRE_HIT_PX * WIRE_HIT_PX;
          for (const entry of dragSession.hitIndex) {
            if (entry.removed) continue;
            let hit = false;
            for (const p of entry.pts) {
              if (distToSegmentSq(p, a, b) <= hitSq) { hit = true; break; }
            }
            if (!hit) continue;
            entry.removed = true;
            const w = entry.wire;
            if (dragSession.wiresRemoved.some((r) => r.connectionId === w.connectionId)) continue;
            const ok = removeWireSilent(w);
            if (ok) dragSession.wiresRemoved.push({ from: w.from, to: w.to, connectionId: w.connectionId });
          }
        }

        function onMouseDown(event) {
          if (mode !== 'active') return;
          if (event.altKey || event.shiftKey) return;
          if (event.button !== 0) return;

          const pt = { x: event.clientX, y: event.clientY };

          // Wire hit-test first (exact browser hit-test on the stroke).
          const wire = HostAdapter.getWireAtTarget(event.target);
          if (wire) {
            event.preventDefault();
            event.stopPropagation();
            const ok = removeWireSilent(wire);
            dragSession = { wiresRemoved: [], lastPt: pt, hitIndex: buildHitIndex() };
            if (ok) dragSession.wiresRemoved.push({ from: wire.from, to: wire.to, connectionId: wire.connectionId });
            return;
          }

          // Pin click — absorb but don't start a session.
          const pin = HostAdapter.getPinAtTarget(event.target);
          if (pin) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          // Block body — single-gesture, pushes its own undo record immediately.
          const blockRef = resolveBlockRefShared(event.target);
          if (blockRef != null) {
            event.preventDefault();
            event.stopPropagation();
            removeAllWiresOfBlock(blockRef);
            return;
          }

          // Empty canvas — start a drag session for paint-on-drag. Swallow the
          // event so the host never starts its marquee rectangle. The press
          // point itself counts as a degenerate sweep: wires are thin, so a
          // press within WIRE_HIT_PX of one removes it even though
          // event.target missed the stroke.
          event.preventDefault();
          event.stopPropagation();
          dragSession = { wiresRemoved: [], lastPt: pt, hitIndex: buildHitIndex() };
          sweepRemove(pt, pt);
        }

        function onMouseMove(event) {
          if (!dragSession) return;
          if (mode !== 'active') return;
          const cur = { x: event.clientX, y: event.clientY };
          sweepRemove(dragSession.lastPt, cur);
          dragSession.lastPt = cur;
        }

        function onMouseUp() {
          if (!dragSession) return;
          const removed = dragSession.wiresRemoved;
          dragSession = null;
          if (removed.length === 0) return;
          // Strip connectionId for the undo payload (not needed for undo).
          const payloadWires = removed.map((w) => ({ from: w.from, to: w.to }));
          undoHistory.push({
            type: 'remove-batch',
            timestamp: new Date().toISOString(),
            payload: { wires: payloadWires },
          });
          toast(`Removed ${removed.length} wire${removed.length === 1 ? '' : 's'}.`);
        }

        function removeAllWiresOfBlock(blockRef) {
          const wires = HostAdapter.getWiresTouchingNode(blockRef);
          if (!wires || wires.length === 0) return; // no-op silently
          const removed = [];
          for (const w of wires) {
            try {
              WireObserver.suppressNextRemoveFor({ toNode: w.to.node, toPin: w.to.pin });
              const ok = HostAdapter.disconnectWire({ toNode: w.to.node, toPin: w.to.pin });
              if (ok) removed.push({ from: w.from, to: w.to });
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] removeAllWiresOfBlock failed for wire:`, w, err);
            }
          }
          if (removed.length > 0) {
            undoHistory.push({
              type: 'remove-batch',
              timestamp: new Date().toISOString(),
              payload: { wires: removed },
            });
            toast(`Removed ${removed.length} wire${removed.length === 1 ? '' : 's'}.`);
          }
        }

        function onMouseOver(event) {
          if (mode !== 'active') return;
          // Wire hover hookup lands in Task 11.
        }

        function onMouseOut(event) {
          if (mode !== 'active') return;
          // Wire hover hookup lands in Task 11.
        }

        function install() {
          document.addEventListener('mousedown', onMouseDown, true);
          document.addEventListener('mousemove', onMouseMove, true);
          document.addEventListener('mouseup', onMouseUp, true);
          document.addEventListener('mouseover', onMouseOver, true);
          document.addEventListener('mouseout', onMouseOut, true);
        }

        return { enter, exit, toggle, isActive, install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  GhostPasteMode — Ctrl+B paste with cursor-following ghost.
      //  Reuses the same snapshot Ctrl+V reads. Commits via applySnapshotAt.
      // ═══════════════════════════════════════════════════════════════
      const GhostPasteMode = (() => {
        let active = false;
        let bannerEl = null;
        let overlayEl = null;             // SVG <g> appended to the host paper SVG
        let svgRoot = null;               // cached host SVG element while active
        let snapshot = null;              // the clipboard snapshot for this mode session
        let anchorWorld = null;           // {x,y} in SVG world coords — the snapshot-side anchor
        let lastWorldPt = null;           // {x,y} cursor in SVG world coords (for click commit)

        function setBanner(text) {
          if (!bannerEl) {
            bannerEl = document.createElement('div');
            bannerEl.className = 'ldscp-mode-banner ldscp-mode-banner-paste';
            document.body.appendChild(bannerEl);
          }
          bannerEl.textContent = text;
        }

        function clearBanner() {
          if (bannerEl) {
            bannerEl.remove();
            bannerEl = null;
          }
        }

        // Build the SVG ghost overlay: a single <g class="ldscp-ghost-overlay">
        // appended to the host's Raphael paper SVG, containing per-node
        // <g transform="translate(dx,dy)"> wrappers around cloned shape nodes
        // (or fallback labeled rectangles when the live host elements can't
        // be identified). Internal wires drawn as dashed straight lines.
        //
        // Side effects: writes svgRoot, overlayEl. Returns false if the host
        // SVG can't be located.
        function buildOverlay() {
          const paper = W.logic_designer?.paper;
          const elements = paper?.elements || {};
          let foundSvg = null;
          for (const key of Object.keys(elements)) {
            const node = elements[key]?.set?.items?.[0]?.node;
            if (node?.ownerSVGElement) { foundSvg = node.ownerSVGElement; break; }
          }
          if (!foundSvg) return false;
          svgRoot = foundSvg;

          const ns = 'http://www.w3.org/2000/svg';
          const g = document.createElementNS(ns, 'g');
          g.setAttribute('class', 'ldscp-ghost-overlay');
          g.setAttribute('transform', 'translate(0,0)');

          // Prefer cloning live elements (true-to-render preview).
          const liveRefs = Array.isArray(latestSelectionRefs)
            ? latestSelectionRefs.filter((r) => elements[r] != null)
            : [];
          const refsMatchSnapshot = liveRefs.length === snapshot.nodes.length;

          if (refsMatchSnapshot) {
            for (let i = 0; i < liveRefs.length; i++) {
              const ref = liveRefs[i];
              const snapNode = snapshot.nodes[i];
              const live = elements[ref];
              const items = live?.set?.items || [];
              const nodeGroup = document.createElementNS(ns, 'g');
              const dx = snapNode.position.x - anchorWorld.x;
              const dy = snapNode.position.y - anchorWorld.y;
              nodeGroup.setAttribute('transform', `translate(${dx},${dy})`);
              for (const item of items) {
                const node = item?.node;
                if (!node) continue;
                const clone = node.cloneNode(true);
                // Strip ids to avoid id collisions with the live host tree.
                clone.removeAttribute('id');
                const idChildren = clone.querySelectorAll('[id]');
                for (let k = 0; k < idChildren.length; k++) idChildren[k].removeAttribute('id');
                // The clone carries the original absolute transform. Strip it
                // so the parent <g> translate is the only positioning.
                clone.removeAttribute('transform');
                nodeGroup.appendChild(clone);
              }
              g.appendChild(nodeGroup);
            }
          } else {
            // Fallback: labeled rectangles per snapshot node.
            for (const snapNode of snapshot.nodes) {
              const dx = snapNode.position.x - anchorWorld.x;
              const dy = snapNode.position.y - anchorWorld.y;
              const w = snapNode.data?.config?.width  ?? 80;
              const h = snapNode.data?.config?.height ?? 40;
              const rect = document.createElementNS(ns, 'rect');
              rect.setAttribute('x', String(dx));
              rect.setAttribute('y', String(dy));
              rect.setAttribute('width', String(w));
              rect.setAttribute('height', String(h));
              rect.setAttribute('fill', '#3a3a3a');
              rect.setAttribute('stroke', '#8ad');
              rect.setAttribute('stroke-width', '1');
              g.appendChild(rect);
              const label = document.createElementNS(ns, 'text');
              label.setAttribute('x', String(dx + 6));
              label.setAttribute('y', String(dy + 16));
              label.setAttribute('fill', '#d4d4d4');
              label.setAttribute('font-size', '11');
              label.textContent = snapNode.type;
              g.appendChild(label);
            }
          }

          // Internal wires as dashed straight lines between approximate
          // block midpoints. This is a guide preview, not a precise routing.
          for (const wire of snapshot.wires) {
            const fromNode = snapshot.nodes.find((n) => n.localId === wire.from.nodeLocalId);
            const toNode   = snapshot.nodes.find((n) => n.localId === wire.to.nodeLocalId);
            if (!fromNode || !toNode) continue;
            const x1 = fromNode.position.x - anchorWorld.x + 40;
            const y1 = fromNode.position.y - anchorWorld.y + 20;
            const x2 = toNode.position.x   - anchorWorld.x;
            const y2 = toNode.position.y   - anchorWorld.y + 20;
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('class', 'ldscp-ghost-overlay-wire');
            line.setAttribute('x1', String(x1));
            line.setAttribute('y1', String(y1));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            g.appendChild(line);
          }

          svgRoot.appendChild(g);
          overlayEl = g;
          return true;
        }

        function teardownOverlay() {
          if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
          overlayEl = null;
          svgRoot = null;
        }

        // Pick the anchor point on the snapshot — the point that will be glued
        // to the cursor. If snapshot.cursorAnchor exists (copy was done with
        // mouse over canvas), use the snapshot node closest to it. Otherwise
        // fall back to the bounding-box top-left of the snapshot nodes.
        function chooseAnchor(snap) {
          if (!snap || !snap.nodes || snap.nodes.length === 0) return { x: 0, y: 0 };
          if (snap.cursorAnchor && typeof snap.cursorAnchor.x === 'number') {
            let best = snap.nodes[0];
            let bestD2 = Infinity;
            for (const n of snap.nodes) {
              const dx = n.position.x - snap.cursorAnchor.x;
              const dy = n.position.y - snap.cursorAnchor.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD2) { bestD2 = d2; best = n; }
            }
            return { x: best.position.x, y: best.position.y };
          }
          // Bbox top-left fallback.
          let minX = Infinity, minY = Infinity;
          for (const n of snap.nodes) {
            if (n.position.x < minX) minX = n.position.x;
            if (n.position.y < minY) minY = n.position.y;
          }
          return { x: minX, y: minY };
        }

        function enter() {
          if (active) return;
          const snap = ClipboardStore.load();
          if (!snap || !snap.nodes || snap.nodes.length === 0) {
            toast('Nothing to paste.');
            return;
          }
          const paper = W.logic_designer?.paper;
          if (!paper) {
            toast('Logic designer not ready.', 'error');
            return;
          }
          // Mutex: exit other modes.
          if (MultiWireMode.isActive()) MultiWireMode.exit();
          if (RemoveConnectorsMode.isActive()) RemoveConnectorsMode.exit();

          snapshot = snap;
          anchorWorld = chooseAnchor(snap);
          // overlayEl is populated by buildOverlay (Task 7).
          const built = buildOverlay();
          if (!built) {
            toast('Ghost-paste: could not locate canvas. Try Ctrl+V instead.', 'error');
            snapshot = null;
            return;
          }
          active = true;
          setBanner('Paste-Place — click to drop · Esc / right-click to cancel');
          // Listeners installed once at bootstrap; they bail when !active.
        }

        function exit() {
          if (!active) return;
          active = false;
          teardownOverlay();
          clearBanner();
          snapshot = null;
          anchorWorld = null;
          lastWorldPt = null;
        }

        function toggle() {
          if (active) exit();
          else enter();
        }

        function isActive() {
          return active;
        }

        function onMouseMoveGhost(event) {
          if (!active || !overlayEl) return;
          const world = clientToSvgWorld({ x: event.clientX, y: event.clientY });
          if (!world) return;
          lastWorldPt = world;
          overlayEl.setAttribute('transform', `translate(${world.x},${world.y})`);
        }

        function onClickGhost(event) {
          if (!active) return;
          if (event.button !== 0) return;
          // Only commit if the click landed inside the host SVG.
          if (!svgRoot || !svgRoot.contains(event.target)) return;
          event.preventDefault();
          event.stopPropagation();
          const world = clientToSvgWorld({ x: event.clientX, y: event.clientY }) || lastWorldPt;
          if (!world) {
            toast('Ghost-paste: could not determine drop coordinates.', 'error');
            exit();
            return;
          }
          // Capture snapshot/anchor BEFORE exit() clears them.
          const snap = snapshot;
          const anchor = anchorWorld;
          // Tear down BEFORE applying so the ghost doesn't get caught in any
          // host re-render triggered by createNode.
          exit();
          const result = applySnapshotAt({
            snapshot: snap,
            snapshotOriginAnchor: anchor,
            basePos: world,
          });
          const totalFails = result.nodeFailures.length + result.wireFailures.length;
          let msg = `Pasted ${result.okNodes} of ${result.totalRequestedNodes} nodes, `
                  + `${result.okWires} of ${result.totalRequestedWires} wires.`;
          if (totalFails > 0) {
            msg += ` ${totalFails} failed (see console).`;
            toast(msg, 'error');
          } else {
            toast(msg);
          }
        }

        function onContextMenuGhost(event) {
          if (!active) return;
          event.preventDefault();
          event.stopPropagation();
          exit();
        }

        function onKeyDownGhost(event) {
          if (!active) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            exit();
          }
        }

        function onBlurGhost() {
          if (!active) return;
          exit();
        }

        function install() {
          document.addEventListener('mousemove', onMouseMoveGhost, true);
          document.addEventListener('click', onClickGhost, true);
          document.addEventListener('contextmenu', onContextMenuGhost, true);
          document.addEventListener('keydown', onKeyDownGhost, true);
          window.addEventListener('blur', onBlurGhost);
        }

        // Exposed so other modes can mutex-exit us and so installKeyboardShortcuts
        // can call toggle()/isActive().
        return { enter, exit, toggle, isActive, install };
      })();
      // ═══════════════════════════════════════════════════════════════
      //  Wire observer — wraps paper.__connect / __disconnect_output /
      //  __disconnect_input so host-native wire create/remove gestures
      //  push undo records. Script-initiated wires (multi-wire mode,
      //  remove-mode) suppress via per-endpoint Sets cleared on first hit.
      //  Strategy verified via probes 1-3 (v3 Task 5).
      // ═══════════════════════════════════════════════════════════════

      const WireObserver = (() => {
        const guardedPapers = new WeakSet();
        const suppressNextCreate = new Set();
        const suppressNextRemove = new Set();
        let originalConnect = null;
        let originalDisconnectOutput = null;
        let installed = false;
        let stateMachineRunning = false;
        let recordingActive = false;
        let prevElementsCount = -1;
        let prevConnectionsLength = -1;
        let prevPinCountFingerprint = ''; // serialized 'ref:in,out;ref:in,out;...'

        function buildPinCountFingerprint(paper) {
          // Serializes every block's input + output count to detect host-side
          // count changes (e.g. user resizing a block via host UI causes the
          // host to rebuild wires via __connect — without this fingerprint we'd
          // record 70+ spurious wire-create entries).
          if (!paper?.elements) return '';
          const parts = [];
          const keys = Object.keys(paper.elements).sort();
          for (const k of keys) {
            if (!/^\d+$/.test(k)) continue;
            const el = paper.elements[k];
            const inCount = Array.isArray(el?.inputs) ? el.inputs.length : 0;
            const outCount = Array.isArray(el?.outputs) ? el.outputs.length : 0;
            parts.push(`${k}:${inCount},${outCount}`);
          }
          return parts.join(';');
        }

        function suppressNextCreateFor({ toNode, toPin }) {
          suppressNextCreate.add(`${toNode}:${toPin}`);
        }
        function suppressNextRemoveFor({ toNode, toPin }) {
          suppressNextRemove.add(`${toNode}:${toPin}`);
        }
        const suppressNextFor = suppressNextCreateFor;

        function recordCreateFromArgs(paper, sourceBlock, targetBlock) {
          if (!sourceBlock || !targetBlock) return;
          const conn = paper?.connections?.[paper.connections.length - 1];
          if (!conn) return;
          if (conn?.user?.source !== sourceBlock.id || conn?.user?.target !== targetBlock.id) return;
          const endpoints = {
            from: { node: sourceBlock.id, pin: sourceBlock.put ?? 0 },
            to: { node: targetBlock.id, pin: targetBlock.put ?? 0 },
          };
          const key = `${endpoints.to.node}:${endpoints.to.pin}`;
          if (suppressNextCreate.has(key)) {
            suppressNextCreate.delete(key);
            return;
          }
          undoHistory.push({
            type: 'wire-create',
            timestamp: new Date().toISOString(),
            payload: endpoints,
          });
        }

        function deriveDisconnectEndpoints(paper, sourceBlockId, sourceOutput, putConnection) {
          if (!paper?.connections || !sourceOutput?.connected_to) return null;
          const entry = sourceOutput.connected_to[putConnection];
          if (!entry) return null;
          const connId = entry.connection_id;
          const targetRef = entry.ref;
          // Find the source output pin INDEX by matching putObject against the
          // block's outputs[] array. The host's __connect stores entry.put_id =
          // TARGET pin index, NOT source pin index — so we can't read it from entry.
          const sourceEl = paper.elements?.[sourceBlockId];
          if (!sourceEl?.outputs) return null;
          let fromPin = null;
          for (let i = 0; i < sourceEl.outputs.length; i++) {
            if (sourceEl.outputs[i] === sourceOutput) {
              fromPin = i;
              break;
            }
          }
          if (fromPin === null) return null;
          // Find the target input pin index by matching connection_id.
          const targetEl = paper.elements?.[targetRef];
          if (!targetEl?.inputs) return null;
          let toPin = null;
          for (let i = 0; i < targetEl.inputs.length; i++) {
            if (targetEl.inputs[i]?.connected_to?.connection_id === connId) {
              toPin = i;
              break;
            }
          }
          if (toPin === null) return null;
          return {
            from: { node: sourceBlockId, pin: fromPin },
            to: { node: targetRef, pin: toPin },
          };
        }

        function recordRemoveBeforeCall(paper, blockId, putObject, putConnection) {
          const endpoints = deriveDisconnectEndpoints(paper, blockId, putObject, putConnection);
          if (!endpoints) return;
          const key = `${endpoints.to.node}:${endpoints.to.pin}`;
          if (suppressNextRemove.has(key)) {
            suppressNextRemove.delete(key);
            return;
          }
          undoHistory.push({
            type: 'wire-remove',
            timestamp: new Date().toISOString(),
            payload: endpoints,
          });
        }

        function install() {
          if (stateMachineRunning) return;
          stateMachineRunning = true;
          tick();
        }

        function tick() {
          try {
            const paper = W.logic_designer?.paper;
            // Explicit boundaries cover same-size reloads, templates and new canvases.
            // Install before initialized becomes true, so the first load is covered too.
            if (paper && !guardedPapers.has(paper)) {
              guardedPapers.add(paper);
              for (const name of ['load', 'clear']) {
                const original = paper[name];
                if (typeof original !== 'function') continue;
                paper[name] = function (...args) {
                  VariableNames.reset(this);
                  undoHistory.clear();
                  recordingActive = false;
                  suppressNextCreate.clear();
                  suppressNextRemove.clear();
                  try { return original.apply(this, args); }
                  finally { undoHistory.clear(); VariableNames.reset(this); }
                };
              }
            }
            if (!paper || paper.initialized !== true) {
              recordingActive = false;
              prevElementsCount = -1;
              prevConnectionsLength = -1;
              prevPinCountFingerprint = '';
              setTimeout(tick, 500);
              return;
            }

            // Install wraps on first ready (idempotent).
            if (!installed) {
              installed = true;
              originalConnect = paper.__connect;
              paper.__connect = function (sourceBlock, targetBlock, force) {
                const result = originalConnect.call(this, sourceBlock, targetBlock, force);
                if (recordingActive) {
                  const currElemCount = this.elements ? Object.keys(this.elements).length : 0;
                  const currFingerprint = buildPinCountFingerprint(this);
                  if (currElemCount === prevElementsCount && currFingerprint === prevPinCountFingerprint) {
                    try {
                      recordCreateFromArgs(this, sourceBlock, targetBlock);
                    } catch (err) {
                      console.error(`[${SCRIPT_NAME}] WireObserver __connect record failed:`, err);
                    }
                  }
                  // else: silently skip — host is mid-rebuild
                }
                return result;
              };
              originalDisconnectOutput = paper.__disconnect_output;
              paper.__disconnect_output = function (blockId, putObject, putConnection) {
                if (recordingActive) {
                  const currElemCount = this.elements ? Object.keys(this.elements).length : 0;
                  const currFingerprint = buildPinCountFingerprint(this);
                  if (currElemCount === prevElementsCount && currFingerprint === prevPinCountFingerprint) {
                    try {
                      recordRemoveBeforeCall(this, blockId, putObject, putConnection);
                    } catch (err) {
                      console.error(`[${SCRIPT_NAME}] WireObserver __disconnect_output record failed:`, err);
                    }
                  }
                }
                return originalDisconnectOutput.call(this, blockId, putObject, putConnection);
              };
            }

            const currElementsCount = paper.elements ? Object.keys(paper.elements).length : 0;
            const currConnectionsLength = paper.connections?.length ?? 0;
            const currPinCountFingerprint = buildPinCountFingerprint(paper);

            // Detect host-side block resize: per-block pin count changed
            // (e.g. user resized FORMULA inputs via host UI). The host rebuilds
            // wires by calling __connect for many wires — without this clear
            // those become spurious wire-create undo records.
            const blockResized = recordingActive
              && prevPinCountFingerprint !== ''
              && currPinCountFingerprint !== prevPinCountFingerprint
              && currElementsCount === prevElementsCount; // same blocks, just different pin counts

            if (blockResized) undoHistory.clear();

            // Recording gate: active only when BOTH elements count AND pin count
            // fingerprint are stable.
            if (currElementsCount === prevElementsCount && currPinCountFingerprint === prevPinCountFingerprint) {
              recordingActive = true;
            } else {
              recordingActive = false;
            }

            prevElementsCount = currElementsCount;
            prevConnectionsLength = currConnectionsLength;
            prevPinCountFingerprint = currPinCountFingerprint;

            VariableNames.observe(paper);
            setTimeout(tick, 500);
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] WireObserver tick failed:`, err);
            setTimeout(tick, 1500);
          }
        }

        function uninstall() {
          stateMachineRunning = false;
          recordingActive = false;
          const paper = W.logic_designer?.paper;
          if (paper) {
            if (originalConnect) paper.__connect = originalConnect;
            if (originalDisconnectOutput) paper.__disconnect_output = originalDisconnectOutput;
          }
          originalConnect = null;
          originalDisconnectOutput = null;
          installed = false;
        }

        return { install, uninstall, suppressNextCreateFor, suppressNextRemoveFor, suppressNextFor };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Move observer — wraps paper.__move_block so host-native block
      //  drag-to-move gestures push a 'move-batch' undo record. Contiguous
      //  calls within a short flush window coalesce into one batch so a
      //  single drag (including alt-drag-with-connected or multi-select
      //  drag, which fire one __move_block per affected block) undoes as
      //  one Ctrl+Z step.
      //
      //  The host's __move_block(block, x, y) snaps to a 10px grid via
      //  Math.round(coord/10)*10, sets block.set.transform absolutely
      //  (not by delta), and redraws every wire touching the block via
      //  paper.paper.connection(conn). Undo just calls __move_block with
      //  the recorded FROM coords — wires follow for free.
      // ═══════════════════════════════════════════════════════════════
      const MoveObserver = (() => {
        let originalMove = null;
        let installed = false;
        const SUPPRESS = new Set();      // refs whose next __move_block call is script-initiated (e.g. undo) — skip recording
        let pendingBatch = null;         // accumulator for contiguous calls
        let pendingGeneration = -1;
        let flushTimer = null;
        const FLUSH_MS = 50;             // coalesce window — generous given probe-2 showed sub-ms gaps between back-to-back calls

        function snap(coord) {
          return Math.round(coord / 10) * 10;
        }

        function flush() {
          if (pendingBatch && pendingBatch.length > 0 && pendingGeneration === undoHistory.generation()) {
            undoHistory.push({
              type: 'move-batch',
              timestamp: new Date().toISOString(),
              payload: { moves: pendingBatch },
            });
          }
          pendingBatch = null;
          flushTimer = null;
        }

        function record(move) {
          const generation = undoHistory.generation();
          if (pendingGeneration !== generation) pendingBatch = null;
          pendingGeneration = generation;
          if (!pendingBatch) pendingBatch = [];
          // If the same ref shows up twice in one batch (rare; nested host call),
          // keep the FIRST `from` and the LAST `to` so undo restores the original.
          const existing = pendingBatch.find((m) => m.ref === move.ref);
          if (existing) {
            existing.to = move.to;
          } else {
            pendingBatch.push(move);
          }
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(flush, FLUSH_MS);
        }

        function install() {
          if (installed) return;
          const paper = W.logic_designer?.paper;
          // Defer until host is ready (matches WireObserver's gate). Without
          // this, install runs at script-bootstrap when paper.initialized may
          // still be false and the wrap silently no-ops forever.
          if (!paper || paper.initialized !== true || typeof paper.__move_block !== 'function') {
            setTimeout(install, 500);
            return;
          }
          originalMove = paper.__move_block;
          paper.__move_block = function (block, x, y) {
            const ref = block?.pointer;
            // Capture FROM before host overwrites it. The matrix on the main
            // shape already reflects host's previous snapped coords.
            const main = block?.set?.items?.[0];
            const fromX = (main && main.matrix && typeof main.matrix.e === 'number') ? main.matrix.e : null;
            const fromY = (main && main.matrix && typeof main.matrix.f === 'number') ? main.matrix.f : null;
            const result = originalMove.call(this, block, x, y);
            try {
              if (ref != null && fromX != null && fromY != null && !SUPPRESS.has(ref)) {
                const toX = snap(typeof x === 'number' ? x : fromX);
                const toY = snap(typeof y === 'number' ? y : fromY);
                if (fromX !== toX || fromY !== toY) {
                  record({ ref, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } });
                }
              }
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] MoveObserver record failed:`, err);
            }
            SUPPRESS.delete(ref);
            return result;
          };
          installed = true;
        }

        function uninstall() {
          if (!installed) return;
          const paper = W.logic_designer?.paper;
          if (paper && originalMove) paper.__move_block = originalMove;
          originalMove = null;
          installed = false;
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          pendingBatch = null;
          SUPPRESS.clear();
        }

        function suppressNextFor(ref) {
          if (ref != null) SUPPRESS.add(ref);
        }

        return { install, uninstall, suppressNextFor };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Clipboard store — wraps GM_setValue / GM_getValue
      // ═══════════════════════════════════════════════════════════════

      const ClipboardStore = {
        save(snapshot) {
          try {
            GM_setValue(STORE_KEY, JSON.stringify(snapshot));
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] clipboard save failed:`, err);
          }
        },
        load() {
          try {
            const raw = GM_getValue(STORE_KEY, null);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== 1) return null;
            return parsed;
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] clipboard load failed:`, err);
            return null;
          }
        },
      };

      // ═══════════════════════════════════════════════════════════════
      //  Toast — transient bottom-right message
      // ═══════════════════════════════════════════════════════════════

      function toast(message, kind = 'info') {
        const el = document.createElement('div');
        el.textContent = message;
        el.className = `ldscp-toast ldscp-toast-${kind}`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
      }

      // ═══════════════════════════════════════════════════════════════
      //  Copy action — gathers selection, builds snapshot, persists.
      // ═══════════════════════════════════════════════════════════════

      function doCopy() {
        try {
          const sel = HostAdapter.getSelection();
          if (!sel || sel.length === 0) {
            toast('Select something to copy.');
            return;
          }
          const nodes = sel.map((ref) => {
            const d = HostAdapter.getNodeData(ref);
            return {
              ref,
              type: d.type,
              position: HostAdapter.getNodePosition(ref),
              data: d,
            };
          });
          const wires = HostAdapter.getInternalWires(sel);
          const snap = buildSnapshot({ nodes, wires });
          snap.cursorAnchor = clientToSvgWorld(lastCursorClient);
          ClipboardStore.save(snap);
          latestSelectionRefs = sel.slice();
          toast(`Copied ${snap.nodes.length} nodes, ${snap.wires.length} wires.`);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] copy failed:`, err);
          toast('Copy failed (see console).', 'error');
        }
      }

      // ═══════════════════════════════════════════════════════════════
      //  applySnapshotAt — shared commit path for Ctrl+V offset paste
      //  and Ctrl+B ghost paste. Materializes the snapshot at the given
      //  basePos (designer-space). Records a 'paste' undo entry.
      // ═══════════════════════════════════════════════════════════════
      //
      // basePos semantics: the snapshot stores each node's original position.
      // We compute a translation vector `delta = basePos - snapshotOriginAnchor`,
      // where `snapshotOriginAnchor` is supplied by the caller:
      //   - Ctrl+V: snapshotOriginAnchor = nodes[0].position, basePos = nodes[0].position + PASTE_OFFSET
      //     -> delta = PASTE_OFFSET (original behavior).
      //   - Ctrl+B: snapshotOriginAnchor = the chosen anchor node's position (or bbox top-left),
      //     basePos = cursorDesignerCoords -> delta = cursor - anchor.
      //
      // Returns { okNodes, okWires, totalRequestedNodes, totalRequestedWires,
      //          createdRefs, nodeFailures, wireFailures } for the caller to toast on.
      function applySnapshotAt({ snapshot, snapshotOriginAnchor, basePos }) {
        const delta = {
          x: basePos.x - snapshotOriginAnchor.x,
          y: basePos.y - snapshotOriginAnchor.y,
        };

        const nodes = JSON.parse(JSON.stringify(snapshot.nodes));
        for (const n of nodes) {
          n.position.x += delta.x;
          n.position.y += delta.y;
        }

        const localToRef = new Map();
        const nodeFailures = [];

        for (const n of nodes) {
          try {
            const ref = HostAdapter.createNode({
              type: n.type,
              position: n.position,
              payload: n.data,
            });
            localToRef.set(n.localId, ref);
          } catch (err) {
            nodeFailures.push({ localId: n.localId, type: n.type, err: String(err) });
            console.error(`[${SCRIPT_NAME}] createNode failed for ${n.localId} (${n.type}):`, err);
          }
        }

        const wireFailures = [];
        for (const w of snapshot.wires) {
          const fromNode = localToRef.get(w.from.nodeLocalId);
          const toNode = localToRef.get(w.to.nodeLocalId);
          if (fromNode == null || toNode == null) {
            wireFailures.push({ wire: w, reason: 'endpoint node was not created' });
            continue;
          }
          try {
            HostAdapter.createWire({
              fromNode, fromPin: w.from.pin,
              toNode, toPin: w.to.pin,
            });
          } catch (err) {
            wireFailures.push({ wire: w, reason: String(err) });
            console.error(`[${SCRIPT_NAME}] createWire failed:`, w, err);
          }
        }

        try {
          HostAdapter.setSelection(Array.from(localToRef.values()));
        } catch (err) {
          console.warn(`[${SCRIPT_NAME}] setSelection failed (non-fatal):`, err);
        }

        const createdRefs = Array.from(localToRef.values());
        if (createdRefs.length > 0) {
          undoHistory.push({
            type: 'paste',
            timestamp: new Date().toISOString(),
            payload: { nodeRefs: createdRefs },
          });
        }

        return {
          okNodes: localToRef.size,
          okWires: snapshot.wires.length - wireFailures.length,
          totalRequestedNodes: snapshot.nodes.length,
          totalRequestedWires: snapshot.wires.length,
          createdRefs,
          nodeFailures,
          wireFailures,
        };
      }

      // ═══════════════════════════════════════════════════════════════
      //  Paste action — recreates the saved snapshot.
      // ═══════════════════════════════════════════════════════════════

      function doPaste() {
        const snap = ClipboardStore.load();
        if (!snap) {
          toast('Nothing to paste.');
          return;
        }
        if (!snap.nodes || snap.nodes.length === 0) {
          toast('Nothing to paste.');
          return;
        }

        // Original Ctrl+V behavior: anchor on nodes[0] and offset by PASTE_OFFSET.
        const anchor = snap.nodes[0].position;
        const basePos = { x: anchor.x + PASTE_OFFSET.x, y: anchor.y + PASTE_OFFSET.y };

        const result = applySnapshotAt({
          snapshot: snap,
          snapshotOriginAnchor: anchor,
          basePos,
        });

        const totalFails = result.nodeFailures.length + result.wireFailures.length;
        let msg = `Pasted ${result.okNodes} of ${result.totalRequestedNodes} nodes, `
                + `${result.okWires} of ${result.totalRequestedWires} wires.`;
        if (totalFails > 0) {
          msg += ` ${totalFails} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      //  Undo action — reverses the most recent paste or delete record.
      // ═══════════════════════════════════════════════════════════════

      function doUndo() {
        const record = undoHistory.pop();
        if (!record) {
          toast('Nothing to undo.');
          return;
        }
        if (record.type === 'paste') {
          undoPaste(record);
        } else if (record.type === 'delete') {
          undoDelete(record);
        } else if (record.type === 'multi-wire') {
          undoMultiWire(record);
        } else if (record.type === 'remove-batch') {
          undoRemoveBatch(record);
        } else if (record.type === 'wire-create') {
          undoWireCreate(record);
        } else if (record.type === 'wire-remove') {
          undoWireRemove(record);
        } else if (record.type === 'tag-paste') {
          undoTagPaste(record);
        } else if (record.type === 'move-batch') {
          undoMoveBatch(record);
        } else {
          console.warn(`[${SCRIPT_NAME}] unknown undo record type:`, record.type);
          toast('Unknown undo record (see console).', 'error');
        }
      }

      function undoMoveBatch(record) {
        const paper = W.logic_designer?.paper;
        if (!paper) {
          toast('Undo move: paper not ready.', 'error');
          return;
        }
        const moves = record.payload.moves || [];
        let ok = 0;
        const failures = [];
        for (const m of moves) {
          const block = paper.elements?.[m.ref];
          if (!block) {
            failures.push({ ref: m.ref, reason: 'block no longer exists' });
            continue;
          }
          try {
            MoveObserver.suppressNextFor(m.ref);
            paper.__move_block(block, m.from.x, m.from.y);
            ok++;
          } catch (err) {
            failures.push({ ref: m.ref, reason: String(err) });
            console.error(`[${SCRIPT_NAME}] undoMoveBatch failed for ref ${m.ref}:`, err);
          }
        }
        const noun = moves.length === 1 ? 'block' : 'blocks';
        let msg = `Undid move: ${ok} of ${moves.length} ${noun} restored.`;
        if (failures.length > 0) {
          msg += ` ${failures.length} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      function undoPaste(record) {
        const paper = W.logic_designer?.paper;
        const requested = record.payload.nodeRefs;
        const live = requested.filter((ref) => paper?.elements?.[ref] != null);
        if (live.length === 0) {
          toast('Nothing to undo (refs stale).');
          return;
        }
        const failures = [];
        for (const ref of live) {
          try {
            HostAdapter.deleteNode(ref);
          } catch (err) {
            failures.push({ ref, err: String(err) });
            console.error(`[${SCRIPT_NAME}] deleteNode failed for ${ref}:`, err);
          }
        }
        const ok = live.length - failures.length;
        let msg = `Undid paste: ${ok} of ${requested.length} nodes removed.`;
        if (failures.length > 0) {
          msg += ` ${failures.length} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      function undoDelete(record) {
        // ponytail: restored blocks get new IDs; discard older history rather than
        // maintaining a ref-remapping layer across every undo record type.
        undoHistory.clear();
        const { blocks, wires } = record.payload;
        const oldToNew = new Map();
        const blockFailures = [];

        for (const b of blocks) {
          try {
            const newRef = HostAdapter.createNode({
              type: b.type,
              position: b.position,
              payload: b.payload,
            });
            oldToNew.set(b.ref, newRef);
          } catch (err) {
            blockFailures.push({ ref: b.ref, type: b.type, err: String(err) });
            console.error(`[${SCRIPT_NAME}] undoDelete createNode failed for ${b.ref} (${b.type}):`, err);
          }
        }

        const wireFailures = [];
        const paper = W.logic_designer?.paper;
        for (const w of wires) {
          // Translate either-side ref: if endpoint was deleted, use the new ref;
          // otherwise use the original (it's a surviving external block).
          const fromNode = oldToNew.get(w.from.node) ?? w.from.node;
          const toNode = oldToNew.get(w.to.node) ?? w.to.node;
          // Skip if either endpoint is now missing (failed recreate or
          // surviving block has since been deleted by other means).
          if (!paper?.elements?.[fromNode] || !paper.elements?.[toNode]) {
            wireFailures.push({ wire: w, reason: 'endpoint missing' });
            continue;
          }
          try {
            HostAdapter.createWire({ fromNode, fromPin: w.from.pin, toNode, toPin: w.to.pin });
          } catch (err) {
            wireFailures.push({ wire: w, reason: String(err) });
            console.error(`[${SCRIPT_NAME}] undoDelete createWire failed:`, w, err);
          }
        }

        try {
          HostAdapter.setSelection(Array.from(oldToNew.values()));
        } catch (err) {
          console.warn(`[${SCRIPT_NAME}] setSelection failed (non-fatal):`, err);
        }

        const okBlocks = oldToNew.size;
        const okWires = wires.length - wireFailures.length;
        // Remove restoration observer records, but keep partial-node cleanup
        // recovery entries created by createNode when the host refused deletion.
        const recovery = [];
        for (let entry; (entry = undoHistory.pop());) {
          if (entry.type === 'paste') recovery.unshift(entry);
        }
        undoHistory.clear();
        recovery.forEach((entry) => undoHistory.push(entry));
        let msg = `Restored ${okBlocks} of ${blocks.length} blocks, ${okWires} of ${wires.length} wires. Earlier undo history cleared.`;
        const totalFails = blockFailures.length + wireFailures.length;
        if (totalFails > 0) {
          msg += ` ${totalFails} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      function undoMultiWire(record) {
        const { createdWires, disconnectedWires } = record.payload;
        // expansions handled below (forwards/backwards-compat)
        const deleteFailures = [];
        const restoreFailures = [];

        // 1. Delete created wires.
        for (const w of createdWires) {
          try {
            HostAdapter.disconnectWire({ toNode: w.to.node, toPin: w.to.pin });
          } catch (err) {
            deleteFailures.push({ wire: w, err: String(err) });
            console.error(`[${SCRIPT_NAME}] undoMultiWire disconnectWire failed:`, w, err);
          }
        }

        // 2. Restore disconnected wires.
        for (const w of disconnectedWires) {
          try {
            HostAdapter.createWire({
              fromNode: w.from.node, fromPin: w.from.pin,
              toNode: w.to.node, toPin: w.to.pin,
            });
          } catch (err) {
            restoreFailures.push({ wire: w, err: String(err) });
            console.error(`[${SCRIPT_NAME}] undoMultiWire createWire failed:`, w, err);
          }
        }

        // 3. Shrink any expansions made (multi-target may have multiple).
        const expansionsArr = Array.isArray(record.payload.expansions)
          ? record.payload.expansions
          : (record.payload.expansion ? [record.payload.expansion] : []); // backwards-compat
        for (const exp of expansionsArr) {
          try {
            HostAdapter.setBlockInputCount(exp.ref, exp.oldCount);
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] undoMultiWire setBlockInputCount failed:`, err);
          }
        }

        const okDeleted = createdWires.length - deleteFailures.length;
        const okRestored = disconnectedWires.length - restoreFailures.length;
        const totalFails = deleteFailures.length + restoreFailures.length;
        let msg = `Undid multi-wire: ${okDeleted} wires removed, ${okRestored} wires restored.`;
        if (totalFails > 0) {
          msg += ` ${totalFails} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      function undoWireCreate(record) {
        const { to } = record.payload;
        try {
          WireObserver.suppressNextRemoveFor({ toNode: to.node, toPin: to.pin });
          HostAdapter.disconnectWire({ toNode: to.node, toPin: to.pin });
          toast('Undid wire add.');
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] undoWireCreate failed:`, err);
          toast('Undo wire add failed (see console).', 'error');
        }
      }

      function undoWireRemove(record) {
        const { from, to } = record.payload;
        try {
          WireObserver.suppressNextCreateFor({ toNode: to.node, toPin: to.pin });
          HostAdapter.createWire({ fromNode: from.node, fromPin: from.pin, toNode: to.node, toPin: to.pin });
          toast('Undid wire delete.');
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] undoWireRemove failed:`, err);
          toast('Undo wire delete failed (see console).', 'error');
        }
      }

      function undoRemoveBatch(record) {
        const { wires } = record.payload;
        const failures = [];
        for (const w of wires) {
          try {
            WireObserver.suppressNextCreateFor({ toNode: w.to.node, toPin: w.to.pin });
            HostAdapter.createWire({ fromNode: w.from.node, fromPin: w.from.pin, toNode: w.to.node, toPin: w.to.pin });
          } catch (err) {
            failures.push({ wire: w, err: String(err) });
            console.error(`[${SCRIPT_NAME}] undoRemoveBatch failed:`, w, err);
          }
        }
        const ok = wires.length - failures.length;
        let msg = `Undid remove: ${ok} wire${ok === 1 ? '' : 's'} restored.`;
        if (failures.length > 0) {
          msg += ` ${failures.length} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      //  Paste tags — bulk-update driver_ids on selected PARAMV /
      //  WRITETOUNIT blocks via an inline textarea panel. v1.5.0.
      //  openPasteTagsPanel and applyTagPaste are defined inside
      //  mountLauncher to share closeMenu closure scope.
      // ═══════════════════════════════════════════════════════════════

      function undoTagPaste(record) {
        const { updates } = record.payload;
        const paper = W.logic_designer?.paper;
        if (!paper) {
          toast('Undo tag paste: paper not ready.', 'error');
          return;
        }
        const failures = [];
        for (const u of updates) {
          try {
            paper.set_block_data(u.ref, u.oldData);
            // Restore the visible label too (we set it to the driver_id on apply).
            if (typeof u.oldAliasText === 'string') {
              paper.set_block_override(u.ref, 'alias_text', u.oldAliasText);
            }
          } catch (err) {
            failures.push({ ref: u.ref, err: String(err) });
            console.error(`[${SCRIPT_NAME}] undoTagPaste failed for ${u.ref}:`, err);
          }
        }
        const ok = updates.length - failures.length;
        let msg = `Undid tag paste: ${ok} block${ok === 1 ? '' : 's'} restored.`;
        if (failures.length > 0) {
          msg += ` ${failures.length} failed (see console).`;
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      // Verify live bindings on this plant, then offer an undoable unit swap.
      // Derived variable labels. First observation/load establishes a baseline only.
      const VariableNames = (() => {
        const snapshots = new WeakMap();
        function plan(paper) {
          const entries = Object.entries(paper.elements || {}).filter(([ref]) => /^\d+$/.test(ref));
          const byPointer = new Map(entries.map(([, block]) => [String(block.pointer), block]));
          const memo = new Map();
          function sourceName(block, visiting = new Set()) {
            if (!block || visiting.has(block)) return '';
            if (memo.has(block)) return memo.get(block);
            visiting.add(block);
            let name = '';
            if (block.block_type === 'VARIABLE_INPUT') {
              const output = byPointer.get(String(block.data?.pointer));
              if (output?.block_type === 'VARIABLE_OUTPUT') name = sourceName(output, visiting);
            } else if (block.block_type === 'VARIABLE_OUTPUT') {
              const input = block.inputs?.[0];
              if (input?.connected) name = sourceName(paper.elements[input.connected_to?.ref], visiting);
            } else {
              name = String(block.override?.alias_text || '').trim();
              if (!name) {
                const shape = block.set?.[block.text?.set_id];
                const text = typeof shape?.attr === 'function' ? shape.attr('text') : '';
                const suffix = ' (' + block.pointer + ')';
                name = String(text || '');
                if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
                name = name.trim();
              }
            }
            visiting.delete(block);
            memo.set(block, name);
            return name;
          }
          return entries.filter(([, block]) => ['VARIABLE_INPUT', 'VARIABLE_OUTPUT'].includes(block.block_type))
            .map(([ref, block]) => ({ ref: Number(ref), block,
              name: (block.block_type === 'VARIABLE_OUTPUT' ? 'VarOut:' : 'VarIn:')
                + (sourceName(block) || (block.block_type === 'VARIABLE_OUTPUT' ? 'Unconnected'
                  : block.data?.pointer != null ? 'Connected to ' + block.data.pointer : 'Unconnected')),
              label: block.override?.alias_text ?? '' }));
        }
        function apply(paper, items, manual) {
          const updates = [];
          try {
            for (const item of items) {
              if (!item.name || item.name === item.label) continue;
              updates.push({ ref: item.ref, oldData: item.block.data == null ? null
                : JSON.parse(JSON.stringify(item.block.data)), oldAliasText: item.label });
              paper.set_block_override(item.ref, 'alias_text', item.name);
              paper.changed = true;
            }
          } finally {
            // Automatic labels follow the originating edit's Undo; manual naming has its own batch.
            if (manual && updates.length) undoHistory.push({ type: 'tag-paste',
              timestamp: new Date().toISOString(), payload: { updates } });
          }
          return updates.length;
        }
        function remember(paper, items) {
          snapshots.set(paper, new Map(items.map((item) => [item.ref,
            { block: item.block, name: item.name }])));
        }
        function observe(paper) {
          const items = plan(paper);
          const previous = snapshots.get(paper);
          if (previous) apply(paper, items.filter((item) => {
            const old = previous.get(item.ref);
            return !old || old.block !== item.block || old.name !== item.name;
          }), false);
          remember(paper, items);
        }
        function nameAll() {
          const paper = W.logic_designer?.paper;
          if (!paper?.initialized) { toast('Open a sketch first.', 'error'); return; }
          try {
            const items = plan(paper);
            const count = apply(paper, items, true);
            remember(paper, items);
            toast(count + ' variable names updated. Save the sketch to keep them. Ctrl+Z undoes this batch.', 'info');
          } catch (error) { toast('Variable naming stopped: ' + error.message, 'error'); }
        }
        function installSelector() {
          const host = W.designer_windows;
          if (typeof host?.show_variable_input !== 'function') {
            setTimeout(installSelector, 500);
            return;
          }
          const original = host.show_variable_input;
          host.show_variable_input = function (...args) {
            const creator = this.dd_wnd_variable_input?.creator;
            const paper = W.logic_designer?.paper;
            if (typeof creator?.add !== 'function' || !paper?.elements) return original.apply(this, args);
            const names = new Map();
            try {
              for (const item of plan(paper)) {
                if (item.block.block_type === 'VARIABLE_OUTPUT') {
                  names.set(String(item.block.pointer), item.label || item.name);
                }
              }
            } catch (error) {
              console.warn('[' + SCRIPT_NAME + '] Could not read variable output names:', error);
              return original.apply(this, args);
            }
            const add = creator.add;
            // The probed opener builds this dropdown synchronously. Decorate labels only.
            creator.add = function (label, value, ...rest) {
              const name = names.get(String(value));
              if (name && /^Output\s+\d+$/.test(String(label))) {
                const text = document.createElement('span');
                text.textContent = label + ' — ' + name;
                label = text.innerHTML; // qxs labels may be rendered as HTML.
              }
              return add.call(this, label, value, ...rest);
            };
            try { return original.apply(this, args); }
            finally { creator.add = add; }
          };
        }
        return { observe, nameAll, installSelector, reset: (paper) => snapshots.delete(paper) };
      })();

      const BulkEdit = (() => {
        const dataTypes = ['integer', 'float', 'boolean', 'string'];
        // Native dropdown choices and storage keys confirmed by the user's catalogue probes.
        const typeFields = {
          CONST: { key: 'type', choices: dataTypes },
          VIRTUALOUT: { key: 'type', choices: dataTypes, input: true },
          PROCESSIN: { key: 'type', choices: ['mixed', ...dataTypes] },
          PROCESSOUT: { key: 'type', choices: ['mixed', 'integer', 'float', 'boolean'], input: true },
          TEMP_VALUE: { key: 'type', choices: ['mixed', 'integer', 'float', 'boolean'], input: true },
          FORMULA: { key: 'output_type', choices: dataTypes },
          SELECTOR: { key: 'output_type', choices: dataTypes },
        };
        const attributes = [['name', 'Alias / display name'], ['type', 'Data type'], ['value', 'Initial value'], ['link', 'Link'], ['unit', 'Engineering unit'], ['readonly', 'Read only']];
        function fieldsFor(row) {
          const fields = {};
          const data = row.oldData, type = row.block.block_type;
          const add = (key, value) => { fields[key] = { original: String(value ?? ''), value: String(value ?? '') }; };
          add('name', row.oldAliasText || data?.alias_text || '');
          const spec = typeFields[type];
          if (spec && data && (type !== 'CONST' || data.mode === 'single')) add('type', data[spec.key] ?? (['PROCESSOUT', 'TEMP_VALUE'].includes(type) ? 'mixed' : 'integer'));
          if (type === 'CONST' && data?.mode === 'single' && ['integer', 'float', 'boolean', 'string'].includes(data.type)) add('value', data.initial_value);
          if (type === 'PROCESSIN' && data && Object.hasOwn(data, 'initial_value')) add('value', data.initial_value);
          if (type === 'VARIABLE_INPUT') add('link', data?.pointer);
          if (['PARAMV', 'WRITETOUNIT'].includes(type) && Array.isArray(data?.driver_ids)) add('link', data.driver_ids.join('; '));
          if (type === 'CONST' && data && Object.hasOwn(data, 'eng_unit')) add('unit', data.eng_unit);
          if (type === 'VIRTUALOUT' && data?.engineering && Object.hasOwn(data.engineering, 'unit')) add('unit', data.engineering.unit);
          if (type === 'CONST' && typeof data?.readonly === 'boolean') add('readonly', data.readonly);
          return fields;
        }
        function open(chosen = null) {
          const paper = W.logic_designer?.paper;
          const selection = HostAdapter.getSelection();
          if (!paper?.initialized || !selection.length) { toast('Select blocks to edit first.', 'error'); return; }
          const generation = undoHistory.generation();
          const getPlant = () => String(W.plant_id ?? W.query_string?.plant_id ?? new URLSearchParams(location.search).get('plant_id') ?? '');
          const plant = getPlant();
          const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
          const rows = selection.map((ref) => {
            const block = paper.elements[ref];
            return { ref, block, oldData: clone(block.data), oldAliasText: block.override?.alias_text ?? '', fields: {} };
          });
          for (const row of rows) row.fields = fieldsFor(row);
          if (!chosen) {
            const picker = document.createElement('dialog');
            picker.style.cssText = 'width:480px;max-width:90vw;max-height:85vh;overflow:auto;padding:18px;border:1px solid #888;border-radius:6px;font:13px/1.5 sans-serif';
            const heading = document.createElement('h2'); heading.textContent = 'Choose attributes to edit'; picker.appendChild(heading);
            const hint = document.createElement('p');
            hint.textContent = selection.length + ' selected objects. Only checked attributes will appear in the editor. Counts show which selected objects support each attribute.';
            picker.appendChild(hint);
            const checks = [];
            for (const [key, title] of attributes) {
              const supported = rows.filter((row) => row.fields[key]);
              if (!supported.length) continue;
              const label = document.createElement('label'); label.style.cssText = 'display:block;margin:10px 0';
              const check = document.createElement('input'); check.type = 'checkbox'; check.checked = key === 'name';
              checks.push({ key, check });
              label.append(check, document.createTextNode(' ' + title + ' — ' + supported.length + '/' + rows.length));
              const types = document.createElement('small'); types.style.cssText = 'display:block;margin-left:22px;color:#555';
              types.textContent = [...new Set(supported.map((row) => row.block.block_type))]
                .map((type) => key === 'type' ? type + ': ' + typeFields[type].choices.join(', ') : type).join('; ');
              label.appendChild(types); picker.appendChild(label);
            }
            const note = document.createElement('p');
            note.textContent = 'Data type choices follow each native object editor. Repeated constant values use the native editor.';
            picker.appendChild(note);
            const status = document.createElement('p'); status.setAttribute('role', 'status'); picker.appendChild(status);
            const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Open editor';
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.style.marginLeft = '8px';
            const update = () => { next.disabled = !checks.some(({ check }) => check.checked); };
            checks.forEach(({ check }) => check.addEventListener('change', update));
            next.addEventListener('click', () => {
              if (W.logic_designer?.paper !== paper || generation !== undoHistory.generation() || plant !== getPlant()
                || JSON.stringify(selection) !== JSON.stringify(HostAdapter.getSelection())
                || rows.some((row) => paper.elements[row.ref] !== row.block)) {
                status.textContent = 'Sketch or selection changed. Close and reopen Edit selected objects.'; return;
              }
              const keys = checks.filter(({ check }) => check.checked).map(({ key }) => key);
              if (!keys.length) return;
              picker.close(); open(keys);
            });
            cancel.addEventListener('click', () => picker.close());
            const escape = (event) => {
              if (event.key !== 'Escape' || !picker.contains(event.target)) return;
              event.preventDefault(); event.stopImmediatePropagation(); picker.close();
            };
            window.addEventListener('keydown', escape, true);
            picker.addEventListener('close', () => { window.removeEventListener('keydown', escape, true); picker.remove(); });
            picker.append(next, cancel); document.body.appendChild(picker); picker.showModal(); update();
            return;
          }
          const dialog = document.createElement('dialog');
          dialog.style.cssText = 'width:94vw;max-width:96vw;min-width:min(480px,96vw);height:80vh;min-height:min(360px,94vh);max-height:94vh;box-sizing:border-box;flex-direction:column;resize:both;overflow:auto;padding:18px;border:1px solid #888;border-radius:6px;font:13px/1.4 sans-serif';
          const make = (tag, text, parent = dialog) => {
            const el = document.createElement(tag); el.textContent = text || ''; parent.appendChild(el); return el;
          };
          const title = make('h2', 'Edit selected objects');
          title.style.cssText = 'margin:0 0 8px;cursor:move;user-select:none;touch-action:none;flex-shrink:0';
          title.title = 'Drag to move this window';
          const instructions = make('p', 'One line per object, in the fixed numbered order. Separate fields with |. Leave unsupported fields as —. Use \\| for a literal pipe, \\\\ for a backslash and \\n for a line break within a field.');
          instructions.style.cssText = 'flex-shrink:0;max-height:40px;overflow:auto;margin:4px 0 8px';
          const columns = attributes.filter(([key]) => chosen.includes(key));
          const outputs = Object.values(paper.elements).filter((b) => b?.block_type === 'VARIABLE_OUTPUT');
          const heading = make('div', 'Line / block     ' + columns.map(([, title]) => title).join(' | '));
          heading.style.cssText = 'font:13px/20px monospace;white-space:pre-wrap;padding:8px;background:#eef1f5;flex-shrink:0';
          const scroll = make('div');
          scroll.style.cssText = 'display:flex;flex:1;min-height:40px;min-width:0;border:1px solid #aaa;overflow:hidden';
          const gutter = make('div', '', scroll);
          gutter.setAttribute('aria-label', 'Locked line numbers and block IDs');
          gutter.style.cssText = 'flex:0 0 125px;overflow:hidden;background:#f1f3f5;border-right:1px solid #bbb;padding:8px 0;box-sizing:border-box;font:13px/20px monospace;user-select:none';
          const editor = make('textarea', '', scroll);
          editor.wrap = 'off'; editor.spellcheck = false;
          editor.setAttribute('aria-label', 'Selected objects: ' + columns.map(([, title]) => title).join(', '));
          editor.style.cssText = 'flex:1;min-width:0;box-sizing:border-box;margin:0;padding:8px;border:0;border-radius:0;resize:none;overflow:auto;white-space:pre;font:13px/20px monospace;tab-size:4';
          const encode = (value) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
          editor.value = rows.map((row) => columns.map(([key]) => row.fields[key] ? encode(row.fields[key].original) : '—').join('|')).join('\n');
          const markers = rows.map((row, i) => {
            const marker = make('div', (i + 1) + ' · #' + row.ref, gutter);
            marker.title = row.block.block_type + ': ' + row.oldAliasText;
            marker.style.cssText = 'height:20px;line-height:20px;padding:0 8px;white-space:nowrap;cursor:pointer';
            return marker;
          });
          // Match the textarea's trailing space so both scroll offsets stay aligned.
          const spacer = make('div', '', gutter); spacer.style.height = '24px';
          editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
          const status = make('p'); status.setAttribute('role', 'status');
          status.style.cssText = 'flex-shrink:0;max-height:44px;overflow:auto;margin:8px 0;overflow-wrap:anywhere';
          const message = (text, error = false) => { status.textContent = text; status.style.color = error ? '#a22' : ''; };
          let outline = null;
          let activeLine = -1;
          function focusLine() {
            const index = editor.value.slice(0, editor.selectionStart).split('\n').length - 1;
            if (index === activeLine) return;
            activeLine = index;
            markers.forEach((marker, i) => { marker.style.background = i === index ? '#fff1aa' : ''; });
            outline?.remove(); outline = null;
            const row = rows[index];
            if (row && W.logic_designer?.paper === paper && paper.elements[row.ref] === row.block) {
              outline = AlarmHighlight.outline(row.ref);
              message('Line ' + (index + 1) + ' → block ' + row.ref + ' (' + row.block.block_type + '): ' + (row.oldAliasText || 'unnamed'));
            }
          }
          for (const event of ['click', 'keyup', 'input', 'select']) editor.addEventListener(event, focusLine);
          markers.forEach((marker, i) => marker.addEventListener('click', () => {
            const values = editor.value.split('\n');
            const start = values.slice(0, i).reduce((total, line) => total + line.length + 1, 0);
            editor.focus(); editor.setSelectionRange(start, start + (values[i]?.length || 0)); focusLine();
          }));
          function parseLine(line, number) {
            const values = [''];
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '|') values.push('');
              else if (char === '\\') {
                const escaped = line[++i];
                const escapes = { n: '\n', r: '\r', '\\': '\\', '|': '|' };
                if (!Object.hasOwn(escapes, escaped)) throw new Error('Line ' + number + ': invalid escape. Use \\\\ for a backslash.');
                values[values.length - 1] += escapes[escaped];
              } else values[values.length - 1] += char;
            }
            if (values.length !== columns.length) throw new Error('Line ' + number + ': expected ' + columns.length + ' pipe-separated fields.');
            return values;
          }
          function stageText() {
            const lines = editor.value.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
            if (lines.length !== rows.length) throw new Error('Keep exactly ' + rows.length + ' object lines; received ' + lines.length + '. The locked numbers identify the original objects.');
            const parsed = lines.map((line, i) => parseLine(line, i + 1));
            parsed.forEach((values, i) => columns.forEach(([key], c) => {
              if (!rows[i].fields[key] && values[c] !== '—') throw new Error('Line ' + (i + 1) + ': ' + columns[c][1] + ' is not editable; leave —.');
              if (rows[i].fields[key] && key === 'readonly' && !['true', 'false'].includes(values[c])) throw new Error('Line ' + (i + 1) + ': Read only must be true or false.');
              if (rows[i].fields[key] && key === 'type' && !typeFields[rows[i].block.block_type].choices.includes(values[c].trim().toLowerCase())) {
                throw new Error('Line ' + (i + 1) + ': ' + rows[i].block.block_type + ' accepts ' + typeFields[rows[i].block.block_type].choices.join(', ') + '.');
              }
            }));
            parsed.forEach((values, i) => columns.forEach(([key], c) => { if (rows[i].fields[key]) rows[i].fields[key].value = values[c]; }));
          }
          if (rows.some((row) => row.block.block_type === 'VARIABLE_INPUT')) {
            const help = make('details'); make('summary', 'Available variable output numbers', help);
            help.style.cssText = 'flex-shrink:0;max-height:80px;overflow:auto;margin:4px 0';
            make('pre', outputs.map((block) => block.pointer + ' — ' + (block.override?.alias_text || 'Variable output')).join('\n'), help);
          }
          const actions = make('div'); actions.style.cssText = 'flex-shrink:0;padding-top:8px';
          const apply = make('button', 'Apply changes', actions), close = make('button', 'Close', actions);
          for (const button of [apply, close]) { button.type = 'button'; button.style.marginRight = '8px'; }
          let alive = true;
          const unchanged = () => {
            if (!alive || W.logic_designer?.paper !== paper || plant !== getPlant() || generation !== undoHistory.generation()
              || JSON.stringify(HostAdapter.getSelection()) !== JSON.stringify(selection)
              || rows.some((row) => paper.elements[row.ref] !== row.block || JSON.stringify(row.block.data) !== JSON.stringify(row.oldData)
                || (row.block.override?.alias_text ?? '') !== row.oldAliasText)) throw new Error('Sketch or selection changed. Reopen Edit selected objects.');
          };
          apply.addEventListener('click', async () => {
            apply.disabled = true; scroll.inert = true;
            try {
              unchanged();
              stageText();
              const changes = [], ids = new Set();
              for (const row of rows) {
                const changed = Object.entries(row.fields).filter(([, field]) => field.value !== field.original);
                if (!changed.length) continue;
                let data = clone(row.oldData), name = row.oldAliasText, driverIds = null;
                const editedName = changed.some(([key]) => key === 'name');
                const editedType = changed.some(([key]) => key === 'type');
                if (editedType) data[typeFields[row.block.block_type].key] = row.fields.type.value.trim().toLowerCase();
                for (const [key, field] of changed) {
                  const value = field.value;
                  if (key === 'type') continue;
                  else if (key === 'name') {
                    name = value;
                    if (data && Object.hasOwn(data, 'alias_text')) data.alias_text = value;
                  } else if (key === 'value') {
                    let parsed = value;
                    if (data.type === 'boolean') {
                      if (!/^(true|false|0|1)$/i.test(value.trim())) throw new Error('Block ' + row.ref + ': use true, false, 0 or 1.');
                      parsed = /^(true|1)$/i.test(value.trim());
                      if (typeof data.initial_value === 'number') parsed = parsed ? 1 : 0;
                      else if (typeof data.initial_value === 'string') parsed = parsed ? '1' : '0';
                    } else if (data.type !== 'string' && data.type !== 'mixed') {
                      parsed = Number(value);
                      if (!value.trim() || !Number.isFinite(parsed) || (data.type === 'integer' && !Number.isSafeInteger(parsed))) {
                        throw new Error('Block ' + row.ref + ': invalid ' + data.type + ' value.');
                      }
                    }
                    data.initial_value = parsed;
                  } else if (key === 'readonly') data.readonly = value === 'true';
                  else if (key === 'unit') {
                    if (row.block.block_type === 'CONST') data.eng_unit = value;
                    else data.engineering.unit = value;
                  } else if (row.block.block_type === 'VARIABLE_INPUT') {
                    const output = outputs.find((b) => String(b.pointer) === value.trim());
                    if (!output || !Object.values(paper.elements).includes(output)) throw new Error('Block ' + row.ref + ': choose an existing variable output number.');
                    data = { ...data, pointer: typeof data?.pointer === 'number' ? output.pointer : String(output.pointer) };
                  } else {
                    driverIds = value.split(/[;\s,]+/).filter(Boolean);
                    if (!driverIds.length) throw new Error('Block ' + row.ref + ': enter at least one driver ID.');
                    driverIds.forEach((id) => ids.add(id));
                    data.driver_ids = driverIds;
                  }
                }
                if (editedType && ['CONST', 'PROCESSIN'].includes(row.block.block_type)
                  && Object.hasOwn(data, 'initial_value') && data.type !== 'mixed' && !changed.some(([key]) => key === 'value')) {
                  const value = data.initial_value;
                  if (data.type === 'string') data.initial_value = String(value ?? '');
                  else if (data.type === 'boolean') {
                    if (!/^(true|false|0|1)$/i.test(String(value))) throw new Error('Block ' + row.ref + ': set Initial value to true, false, 0 or 1 for boolean.');
                    data.initial_value = /^(true|1)$/i.test(String(value));
                  } else {
                    const number = typeof value === 'boolean' ? Number(value) : Number(String(value ?? '').trim());
                    if (value == null || String(value).trim() === '' || !Number.isFinite(number)
                      || (data.type === 'integer' && !Number.isSafeInteger(number))) {
                      throw new Error('Block ' + row.ref + ': initial value cannot convert to ' + data.type + '. Include Initial value and edit it too.');
                    }
                    data.initial_value = number;
                  }
                }
                if (editedType && data.type === 'float' && ['CONST', 'PROCESSIN', 'VIRTUALOUT', 'TEMP_VALUE'].includes(row.block.block_type)
                  && !data.precision) data.precision = '%.1f';
                changes.push({ row, data, name, editedName, driverIds });
              }
              if (!changes.length) throw new Error('No fields changed.');
              message('Validating ' + changes.length + ' changed blocks...');
              const resolved = ids.size ? await BindingTools.resolve([...ids], plant, unchanged) : new Map();
              unchanged();
              for (const id of ids) if (!resolved.has(id)) throw new Error('Driver ID does not resolve on this plant: ' + id);
              const pending = new Map(changes.map((change) => [change.row.block, change.data]));
              const retyped = new Set(changes.filter(({ row, data }) => row.fields.type
                && data[typeFields[row.block.block_type].key] !== row.oldData?.[typeFields[row.block.block_type].key]).map(({ row }) => row.block));
              if (retyped.size) {
                if (typeof paper.__get_valid_types_flag !== 'function' || typeof paper.get_valid_output_types !== 'function') {
                  throw new Error('Native type compatibility helpers unavailable. No changes applied.');
                }
                const allTypes = ['mixed', ...dataTypes];
                const flags = (types) => {
                  const list = Array.isArray(types) ? types : [types];
                  if (!list.length || list.some((type) => !allTypes.includes(type))) return null;
                  return paper.__get_valid_types_flag(list) ?? null;
                };
                const sourceTypes = (block, put, visited = new Set()) => {
                  if (!block || visited.has(block)) return null;
                  visited.add(block);
                  const data = pending.get(block) ?? block.data;
                  if (block.block_type === 'VARIABLE_INPUT') {
                    const output = Object.values(paper.elements).find((item) => item?.block_type === 'VARIABLE_OUTPUT'
                      && String(item.pointer) === String(data?.pointer));
                    const pin = output?.inputs?.[0];
                    return pin?.connected ? sourceTypes(paper.elements[pin.connected_to?.ref], pin.connected_to?.put_id, visited) : null;
                  }
                  const spec = typeFields[block.block_type];
                  const explicit = spec ? data?.[spec.key] : block.properties?.output_types?.value?.[put];
                  return flags(explicit ?? block.output_type ?? block.outputs?.[put]?.valid_types);
                };
                // Check the complete proposed graph, so two connected objects can change together.
                // Only edges affected by this batch are checked; existing unrelated errors remain untouched.
                const affected = (block, visited = new Set()) => {
                  if (!block || visited.has(block)) return false;
                  if (retyped.has(block)) return true;
                  visited.add(block);
                  if (block.block_type !== 'VARIABLE_INPUT') return false;
                  const data = pending.get(block) ?? block.data;
                  const output = Object.values(paper.elements).find((item) => item?.block_type === 'VARIABLE_OUTPUT'
                    && String(item.pointer) === String(data?.pointer));
                  const pin = output?.inputs?.[0];
                  return !!pin?.connected && affected(paper.elements[pin.connected_to?.ref], visited);
                };
                for (const [ref, target] of Object.entries(paper.elements)) {
                  if (!/^\d+$/.test(ref)) continue;
                  for (const pin of Object.values(target?.inputs || {})) {
                    if (!pin?.connected) continue;
                    const source = paper.elements[pin.connected_to?.ref];
                    const spec = typeFields[target.block_type];
                    if (!affected(source) && !(retyped.has(target) && spec?.input)) continue;
                    const data = pending.get(target) ?? target.data;
                    const accepts = flags(spec?.input ? data?.[spec.key] ?? (target.block_type === 'VIRTUALOUT' ? 'integer' : 'mixed') : paper.get_valid_output_types(pin));
                    const produces = sourceTypes(source, pin.connected_to?.put_id);
                    if (accepts == null || produces == null || (accepts & produces) !== produces) {
                      throw new Error('Type change conflicts with or cannot resolve connection ' + source?.pointer + ' → ' + target.pointer + '. Review these objects before applying.');
                    }
                  }
                }
              }
              for (const change of changes) {
                if (change.row.block.block_type === 'VARIABLE_INPUT') {
                  const target = outputs.find((block) => String(block.pointer) === String(change.data?.pointer));
                  if (String(change.data?.pointer) !== String(change.row.oldData?.pointer)
                    && (!target || !Object.values(paper.elements).includes(target))) {
                    throw new Error('A selected variable output changed. Reopen the editor.');
                  }
                }
                if (change.driverIds && !change.editedName) {
                  const value = resolved.get(change.driverIds[0]);
                  change.name = change.driverIds.length === 1 ? value.unit_id + ', ' + value.unit_name + ', ' + value.alias_text : 'Multiple parameters';
                }
              }
              const updates = [];
              let failed = null;
              const variableLabels = Object.entries(paper.elements)
                .filter(([ref, block]) => /^\d+$/.test(ref) && ['VARIABLE_INPUT', 'VARIABLE_OUTPUT'].includes(block.block_type))
                .map(([ref, block]) => ({ ref: Number(ref), oldData: clone(block.data), oldAliasText: block.override?.alias_text ?? '' }));
              try {
                for (const { row, data, name } of changes) {
                  updates.push({ ref: row.ref, oldData: row.oldData, oldAliasText: row.oldAliasText });
                  if (JSON.stringify(data) !== JSON.stringify(row.oldData)) paper.set_block_data(row.ref, data);
                  if (name !== row.oldAliasText) paper.set_block_override(row.ref, 'alias_text', name);
                  paper.changed = true;
                }
                VariableNames.observe(paper);
                // Explicit names in this batch take precedence over derived variable names.
                for (const { row, name, editedName } of changes) {
                  if (editedName && ['VARIABLE_INPUT', 'VARIABLE_OUTPUT'].includes(row.block.block_type)) {
                    paper.set_block_override(row.ref, 'alias_text', name);
                  }
                }
              } catch (error) { failed = error; }
              finally {
                for (const old of variableLabels) {
                  if (!updates.some((item) => item.ref === old.ref)
                    && (paper.elements[old.ref]?.override?.alias_text ?? '') !== old.oldAliasText) updates.push(old);
                }
                if (updates.length) undoHistory.push({ type: 'tag-paste', timestamp: new Date().toISOString(), payload: { updates } });
              }
              dialog.close();
              toast(failed ? 'Bulk edit stopped: ' + failed.message + '. Ctrl+Z restores attempted changes.'
                : changes.length + ' blocks updated. Ctrl+Z undoes this batch. Save the sketch to keep it.', failed ? 'error' : 'info');
            } catch (error) { if (alive) message(error.message, true); }
            finally {
              if (alive) { apply.disabled = false; scroll.inert = false; }
            }
          });
          const escape = (event) => {
            if (event.key !== 'Escape' || !dialog.contains(event.target)) return;
            event.preventDefault(); event.stopImmediatePropagation(); dialog.close();
          };
          window.addEventListener('keydown', escape, true);
          close.addEventListener('click', () => dialog.close());
          const geometryKey = 'ldscp:bulk-edit:geometry';
          let geometry = null;
          let saveTimer;
          const remember = () => {
            if (!dialog.open) return;
            const { x, y, width, height } = dialog.getBoundingClientRect();
            geometry = { x, y, width, height };
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => GM_setValue(geometryKey, geometry), 250);
          };
          title.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const box = dialog.getBoundingClientRect();
            const dx = event.clientX - box.left, dy = event.clientY - box.top;
            dialog.style.margin = '0';
            dialog.style.left = box.left + 'px'; dialog.style.top = box.top + 'px';
            title.setPointerCapture(event.pointerId);
            const move = (e) => {
              dialog.style.left = Math.max(0, Math.min(innerWidth - dialog.offsetWidth, e.clientX - dx)) + 'px';
              dialog.style.top = Math.max(0, Math.min(innerHeight - dialog.offsetHeight, e.clientY - dy)) + 'px';
            };
            title.addEventListener('pointermove', move);
            title.addEventListener('lostpointercapture', () => {
              title.removeEventListener('pointermove', move); remember();
            }, { once: true });
          });
          const resizeObserver = new ResizeObserver(remember);
          dialog.addEventListener('close', () => {
            alive = false; outline?.remove(); resizeObserver.disconnect(); clearTimeout(saveTimer);
            if (geometry) GM_setValue(geometryKey, geometry);
            window.removeEventListener('keydown', escape, true); dialog.remove();
          });
          const saved = GM_getValue(geometryKey, null);
          if (saved && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key]))) {
            const width = Math.max(Math.min(480, innerWidth * .96), Math.min(saved.width, innerWidth * .96));
            const height = Math.max(Math.min(360, innerHeight * .94), Math.min(saved.height, innerHeight * .94));
            dialog.style.width = width + 'px'; dialog.style.height = height + 'px'; dialog.style.margin = '0';
            dialog.style.left = Math.max(0, Math.min(saved.x, innerWidth - width)) + 'px';
            dialog.style.top = Math.max(0, Math.min(saved.y, innerHeight - height)) + 'px';
          }
          document.body.appendChild(dialog); dialog.showModal(); dialog.style.display = 'flex';
          remember(); resizeObserver.observe(dialog);
          message(rows.length + ' fixed object lines. Click a gutter number to select its line and highlight the block.');
        }
        function install() {
          let menu = null;
          const closeMenu = () => { menu?.remove(); menu = null; };
          const eligible = (event) => {
            const paper = W.logic_designer?.paper;
            return paper?.initialized && paper.paper?.canvas?.contains(event.target)
              && HostAdapter.getSelection().length >= 2 && !MultiWireMode.isActive()
              && !RemoveConnectorsMode.isActive() && !GhostPasteMode.isActive();
          };
          // Preserve the marquee selection before the host handles a right press.
          const preserveSelection = (event) => {
            if (menu?.contains(event.target)) return;
            closeMenu();
            if (event.button === 2 && eligible(event)) {
              event.stopImmediatePropagation();
            }
          };
          window.addEventListener('pointerdown', preserveSelection, true);
          window.addEventListener('mousedown', preserveSelection, true);
          window.addEventListener('contextmenu', (event) => {
            if (!eligible(event)) return;
            event.preventDefault(); event.stopImmediatePropagation(); closeMenu();
            const paper = W.logic_designer.paper;
            const generation = undoHistory.generation();
            const selection = JSON.stringify(HostAdapter.getSelection());
            menu = document.createElement('div');
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-label', 'Selected objects');
            menu.style.cssText = 'position:fixed;z-index:2147483647;padding:4px;background:white;border:1px solid #aaa;border-radius:5px;box-shadow:0 3px 12px #0003;max-width:95vw';
            const edit = document.createElement('button');
            edit.type = 'button'; edit.setAttribute('role', 'menuitem');
            edit.textContent = 'Edit selected objects…';
            edit.style.cssText = 'padding:8px 12px;cursor:pointer';
            edit.addEventListener('click', () => {
              closeMenu();
              if (paper !== W.logic_designer?.paper || generation !== undoHistory.generation()
                || selection !== JSON.stringify(HostAdapter.getSelection())) {
                toast('Selection changed. Select the objects again.', 'error'); return;
              }
              open();
            });
            menu.appendChild(edit); document.body.appendChild(menu);
            menu.style.left = Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth)) + 'px';
            menu.style.top = Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight)) + 'px';
            edit.focus();
          }, true);
          window.addEventListener('keydown', (event) => {
            if (menu && event.key === 'Escape') {
              event.preventDefault(); event.stopImmediatePropagation(); closeMenu();
            }
          }, true);
          window.addEventListener('blur', closeMenu);
          window.addEventListener('resize', closeMenu);
          document.addEventListener('scroll', closeMenu, true);
        }
        return { open, install };
      })();

      const BindingTools = (() => {
        const PARAM_FILE = '../lib/xml/qxs/views/ext/qxs_param_chooser/runtime/class.param_chooser.php';
        const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        const plantId = () => String(W.plant_id ?? W.query_string?.plant_id
          ?? new URLSearchParams(location.search).get('plant_id') ?? '');
        function labelParts(text) {
          const parts = String(text || '').split(',');
          return { unit: parts.length >= 3 ? parts[0].trim() : '',
            alias: parts.length >= 3 ? parts.slice(2).join(',').trim() : String(text || '') };
        }
        function aliasScore(source, candidate) {
          const a = normalize(source);
          const b = normalize(candidate);
          if (!a || !b) return 0;
          if (a === b) return 100;
          // Historical annotations are not part of the alias; comparison phrases are.
          const strip = (s) => s.replace(/\s*\(old text:.*$/, '').trim();
          if (strip(a) === strip(b)) return 96;
          const numbers = (s) => (strip(s).match(/\d+/g) || []).join(',');
          const sameNumbers = numbers(a) === numbers(b);
          if (sameNumbers && (strip(a).startsWith(strip(b)) || strip(b).startsWith(strip(a)))) return 85;
          const left = new Set(strip(a).match(/[\p{L}\p{N}]+/gu) || []);
          const right = new Set(strip(b).match(/[\p{L}\p{N}]+/gu) || []);
          return Math.round((sameNumbers ? 75 : 55)
            * [...left].filter((word) => right.has(word)).length / Math.max(3, left.size, right.size));
        }
        async function lookup(ids, plant, active) {
          const rows = new Map();
          const unique = [...new Set(ids)];
          for (let offset = 0; offset < unique.length; offset += 100) {
            active();
            const batch = unique.slice(offset, offset + 100);
            const reply = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('Native parameter lookup timed out.')), 15000);
              try {
                W.core.communication.poll({
                  file: PARAM_FILE, func: 'param_chooser->get_values',
                  data: { plant_id: plant, values_to_load: batch },
                  callback: (value) => { clearTimeout(timer); resolve(value); },
                });
              } catch (error) { clearTimeout(timer); reject(error); }
            });
            active();
            const result = typeof reply === 'string' ? JSON.parse(reply) : reply;
            if (result?.ok !== true || !Array.isArray(result.data?.values_to_load)) {
              throw new Error('Native parameter lookup failed; no missing-ID conclusions were made.');
            }
            const returned = new Set(result.data.values_to_load.map((row) => String(row?.driver_id ?? '')));
            if (batch.some((id) => !returned.has(id))) {
              throw new Error('Native lookup returned an incomplete response. Retry verification.');
            }
            for (const row of result.data.values_to_load) {
              const id = String(row?.driver_id ?? '');
              // Removed IDs are returned as null-filled placeholders.
              if (batch.includes(id) && row.unit_id != null && row.element_id != null
                && (row.alias_text == null || typeof row.alias_text === 'string')) {
                rows.set(id, { ...row, alias_text: row.alias_text ?? '', unit_name: row.unit_name ?? '' });
              }
            }
          }
          return rows;
        }

        // Only internally constructed SELECTs. No arbitrary SQL, writes or saved-sketch scans.
        // Values use MySQL hex literals, avoiding quote/backslash SQL-mode differences.
        const sqlValue = (value) => 'CONVERT(0x'
          // Prototype's Array.from replacement ignores its mapper. Use spread + map.
          + [...new TextEncoder().encode(String(value))].map((b) => b.toString(16).padStart(2, '0')).join('')
          + ' USING utf8mb4)';
        function catalog(plant, active, requests) {
          let schema = '';
          const runId = 'ldscp-' + Date.now();
          async function query(sql) {
            active();
            const rows = await new Promise((resolve, reject) => {
              let request;
              const finish = (error, value) => {
                requests.delete(request);
                if (error) reject(error); else resolve(value);
              };
              request = GM_xmlhttpRequest({
                method: 'POST', url: 'http://toolbox.iwmac.local:8505/plant-sql/',
                anonymous: true, timeout: 15000,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                  'X-Caller': 'logic-designer-section', 'X-Run-Id': runId },
                data: new URLSearchParams({ plant_id: plant, caller: 'logic-designer-section',
                  sql_command: sql + ';' }).toString(),
                onload: (response) => {
                  try {
                    if (response.status !== 200) throw new Error('Plant SQL HTTP ' + response.status);
                    const result = JSON.parse(response.responseText);
                    if (result?.success !== true || result.results?.length !== 1
                      || !Array.isArray(result.results[0].data)) throw new Error('Plant SQL returned an invalid or failed result.');
                    finish(null, result.results[0].data);
                  } catch (error) { finish(error); }
                },
                onerror: () => finish(new Error('Plant SQL connection failed.')),
                ontimeout: () => finish(new Error('Plant SQL timed out.')),
                onabort: () => finish(new Error('Plant SQL cancelled.')),
              });
              requests.add(request);
            });
            active();
            return rows;
          }
          async function table() {
            if (!schema) {
              const rows = await query("SELECT table_schema FROM information_schema.tables WHERE table_name='iw_gen_driver_parameters' LIMIT 2");
              const found = rows[0]?.table_schema ?? rows[0]?.TABLE_SCHEMA;
              if (rows.length !== 1 || !/^[A-Za-z0-9_]+$/.test(found || '')) {
                throw new Error('Parameter schema missing or ambiguous; no schema was guessed.');
              }
              schema = found;
            }
            return schema + '.iw_gen_driver_parameters';
          }
          return {
            async units() {
              const name = await table();
              const result = [];
              let after = '';
              for (;;) {
                const page = await query('SELECT unit_id, MAX(unit_name) AS unit_name FROM ' + name
                  + " WHERE unit_id IS NOT NULL AND unit_id <> ''" + (after ? ' AND unit_id > ' + sqlValue(after) : '')
                  + ' GROUP BY unit_id ORDER BY unit_id LIMIT 500');
                if (!page.length) return result;
                const next = String(page[page.length - 1].unit_id);
                if (next === after) throw new Error('Unit pagination did not advance.');
                result.push(...page);
                after = next;
                if (result.length > 50000) throw new Error('Unit list too large; request stopped.');
                // Continue to an empty page, even if the service caps results below LIMIT.
              }
            },
            async parameters(unit) {
              const name = await table();
              const where = ' WHERE unit_id = ' + sqlValue(unit);
              const count = await query('SELECT COUNT(*) AS total FROM ' + name + where);
              const expected = Number(count[0]?.total);
              if (!Number.isSafeInteger(expected) || expected < 0 || expected > 50000) {
                throw new Error('Invalid or excessive parameter count for unit ' + unit);
              }
              const rows = new Map();
              let after = '';
              for (;;) {
                const page = await query('SELECT driver_id, alias_text, unit_id, unit_name, parameter_type FROM '
                  + name + where + (after ? ' AND driver_id > ' + sqlValue(after) : '')
                  + ' ORDER BY driver_id LIMIT 500');
                if (!page.length) break;
                for (const row of page) {
                  if (!row.driver_id || row.unit_id == null
                    || (row.alias_text != null && typeof row.alias_text !== 'string')) {
                    throw new Error('Incomplete parameter metadata for unit ' + unit);
                  }
                  rows.set(String(row.driver_id), { ...row, alias_text: row.alias_text ?? '', unit_name: row.unit_name ?? '' });
                }
                const next = String(page[page.length - 1].driver_id);
                if (next === after || rows.size > 50000) throw new Error('Parameter pagination failed for unit ' + unit);
                after = next;
              }
              if (rows.size !== expected) {
                throw new Error('Incomplete or changing parameter list for ' + unit + ': '
                  + rows.size + ' of ' + expected + '. Retry verification.');
              }
              return rows;
            },
          };
        }
        function capture(scope) {
          const paper = W.logic_designer?.paper;
          if (!paper?.elements) throw new Error('Paper not ready.');
          const selection = HostAdapter.getSelection();
          const refs = scope === 'selected' ? selection
            : Object.keys(paper.elements).filter((key) => /^\d+$/.test(key)).map(Number);
          const blocks = refs.map((ref) => {
            const element = paper.elements[ref];
            if (!['PARAMV', 'WRITETOUNIT'].includes(element?.block_type)) return null;
            const ids = element.data?.driver_ids;
            if (!Array.isArray(ids) || !ids.length) return null;
            return { ref, element, ids: ids.map(String),
              oldData: JSON.parse(JSON.stringify(element.data)),
              oldAliasText: element.override?.alias_text ?? '' };
          }).filter(Boolean);
          if (!blocks.length) throw new Error('No PARAMV or WRITETOUNIT bindings in this scope.');
          const plant = plantId();
          if (!plant) throw new Error('Plant ID not found.');
          return { paper, selection, scope, blocks, plant, generation: undoHistory.generation() };
        }
        function unchanged(scan) {
          return plantId() === scan.plant && W.logic_designer?.paper === scan.paper
            && undoHistory.generation() === scan.generation
            && (scan.scope !== 'selected'
              || JSON.stringify(HostAdapter.getSelection()) === JSON.stringify(scan.selection))
            && scan.blocks.every((block) => scan.paper.elements[block.ref] === block.element
              && JSON.stringify(block.element.data) === JSON.stringify(block.oldData)
              && (block.element.override?.alias_text ?? '') === block.oldAliasText);
        }
        function open({ pointer = null } = {}) {
          const dialog = document.createElement('dialog');
          dialog.className = 'ldscp-binding-dialog';
          const controls = document.createElement('div');
          dialog.appendChild(controls);
          const make = (tag, text, parent = controls) => {
            const el = document.createElement(tag);
            if (text) el.textContent = text;
            parent.appendChild(el);
            return el;
          };
          // Native popovers escape the table's scrolling area and close on outside click/Escape.
          const dropdown = (parent, text) => {
            const button = make('button', text, parent);
            button.type = 'button';
            button.className = 'ldscp-binding-dropdown';
            button.setAttribute('aria-expanded', 'false');
            const panel = make('div', '', dialog);
            panel.popover = 'auto';
            panel.className = 'ldscp-binding-picker';
            panel._trigger = button;
            button.addEventListener('click', () => {
              if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
              panel.showPopover();
              const anchor = button.getBoundingClientRect();
              const box = panel.getBoundingClientRect();
              panel.style.left = Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8)) + 'px';
              panel.style.top = Math.max(8, Math.min(anchor.bottom, innerHeight - box.height - 8)) + 'px';
              const input = panel.querySelector('input');
              input?.focus();
              input?.select();
            });
            panel.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(panel.matches(':popover-open'))));
            return { button, panel };
          };
          const title = make('h2', 'Verify objects / Swap unit');
          title.title = 'Drag to move this window';
          make('p', 'Verify checks bindings on this plant. Swap loads the full new unit. Strong, unambiguous matches are included automatically at the threshold below. Review checked changes before Apply.');
          const field = (text, tag) => make(tag, '', make('label', text));
          const scope = field('Scope', 'select');
          scope.add(new Option('Entire sketch', 'all'));
          scope.add(new Option('Selected blocks', 'selected'));
          const from = field('From unit (Verify and swap)', 'select');
          const unitRow = make('div');
          unitRow.className = 'ldscp-binding-unit-row';
          make('span', 'To unit (swap only)', unitRow);
          const unitPicker = dropdown(unitRow, 'Choose new unit ▾');
          const unitSearch = make('input', '', unitPicker.panel);
          unitSearch.placeholder = 'Search unit ID or name';
          unitSearch.setAttribute('aria-label', 'Search destination units');
          const to = make('select', '', unitPicker.panel);
          to.size = 10;
          to.setAttribute('aria-label', 'Destination unit');
          let unitOptions = [];
          let chosenUnit = '';
          const filterUnits = () => {
            to.replaceChildren(new Option('Choose new unit', ''));
            for (const option of unitOptions) {
              if (normalize(option.text).includes(normalize(unitSearch.value)) || option.value === chosenUnit) {
                to.add(new Option(option.text, option.value));
              }
            }
            to.value = chosenUnit;
          };
          unitSearch.addEventListener('input', filterUnits);
          to.addEventListener('change', () => {
            chosenUnit = to.value;
            unitPicker.button.textContent = (to.selectedOptions[0]?.textContent || 'Choose new unit') + ' ▾';
            unitPicker.panel.hidePopover();
          });
          from.add(new Option('Any unit', '*'));
          from.add(new Option('Missing bindings only', '?'));
          to.add(new Option('Choose new unit', ''));
          const loadButton = make('button', 'Load units', unitRow);
          const threshold = field('Auto-include match at or above (%)', 'input');
          threshold.type = 'number';
          threshold.min = '0';
          threshold.max = '100';
          threshold.value = '95';
          threshold.style.width = '64px';
          threshold.title = 'Tied matches and matches within 5 points remain unchecked.';
          const verifyButton = make('button', 'Verify');
          const swapButton = make('button', 'Preview swap');
          const applyButton = make('button', 'Apply checked changes');
          const closeButton = make('button', 'Close');
          for (const button of [loadButton, verifyButton, swapButton, applyButton, closeButton]) button.type = 'button';
          const status = make('p');
          status.setAttribute('role', 'status');
          const results = make('div', '', dialog);
          results.className = 'ldscp-binding-results';
          let scan = null;
          let alive = true;
          let running = false;
          let proposals = [];
          let activeRow = null;
          let outline = null;
          const requests = new Set();
          const geometryKey = 'ldscp:binding-dialog:geometry';
          let lastGeometry = null;
          let saveTimer;
          const rememberGeometry = () => {
            if (!dialog.open) return;
            const { x, y, width, height } = dialog.getBoundingClientRect();
            lastGeometry = { x, y, width, height };
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => GM_setValue(geometryKey, lastGeometry), 250);
          };
          const resizeObserver = new ResizeObserver(rememberGeometry);
          const message = (text, error = false) => {
            status.textContent = text;
            status.style.color = error ? '#a33' : '';
          };
          const active = () => {
            if (!alive) throw new Error('Dialog closed.');
            if (!scan || !unchanged(scan)) throw new Error('Plant, sketch or selection changed. Run the preview again.');
          };
          const focus = (row, block) => {
            activeRow?.classList.remove('ldscp-binding-active');
            outline?.remove();
            activeRow = row;
            row.classList.add('ldscp-binding-active');
            outline = AlarmHighlight.outline(block.ref);
            outline?.setAttribute('stroke', '#fff000');
          };
          title.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const box = dialog.getBoundingClientRect();
            dialog.style.margin = '0';
            dialog.style.left = box.left + 'px';
            dialog.style.top = box.top + 'px';
            const dx = event.clientX - box.left;
            const dy = event.clientY - box.top;
            title.setPointerCapture(event.pointerId);
            const move = (e) => {
              dialog.style.left = Math.max(0, Math.min(innerWidth - 80, e.clientX - dx)) + 'px';
              dialog.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - dy)) + 'px';
            };
            title.addEventListener('pointermove', move);
            title.addEventListener('lostpointercapture', () => {
              title.removeEventListener('pointermove', move);
              rememberGeometry();
            }, { once: true });
          });
          const updateApply = () => {
            for (const proposal of proposals) {
              const row = proposal.check?.closest('tr');
              row?.classList.toggle('ldscp-binding-matched', !!proposal.chosen);
              row?.classList.toggle('ldscp-binding-included', !!proposal.chosen && proposal.check.checked);
            }
            applyButton.disabled = running || !proposals.some((p) => p.check.checked && p.chosen);
          };
          const clear = () => {
            proposals = [];
            for (const picker of results.querySelectorAll('[data-picker]')) picker._panel?.remove();
            results.replaceChildren();
            outline?.remove();
            outline = null;
            activeRow = null;
            updateApply();
          };
          for (const control of [scope, from, to, threshold]) control.addEventListener('change', () => {
            clear();
            message('Options changed. Run Verify or Preview swap again.');
          });
          function sourceUnits(records) {
            const selected = from.value;
            from.replaceChildren(new Option('Any unit', '*'), new Option('Missing bindings only', '?'));
            const units = new Set(records.map((r) => r.unit).filter(Boolean));
            for (const unit of [...units].sort()) from.add(new Option(unit, unit));
            if ([...from.options].some((o) => o.value === selected)) from.value = selected;
          }
          async function loadUnits() {
            clear();
            scan = capture(scope.value);
            const api = catalog(scan.plant, active, requests);
            message('Loading units from the current plant...');
            const rows = await api.units();
            active();
            const selected = to.value;
            unitOptions = rows.map((row) => ({ text: row.unit_id + ', ' + (row.unit_name || ''), value: String(row.unit_id) }));
            chosenUnit = unitOptions.some((o) => o.value === selected) ? selected : '';
            unitSearch.value = '';
            filterUnits();
            unitPicker.button.textContent = (to.selectedOptions[0]?.textContent || 'Choose new unit') + ' ▾';
            const values = await lookup(scan.blocks.flatMap((b) => b.ids), scan.plant, active);
            sourceUnits(scan.blocks.flatMap((b) => b.ids.map((id) => ({
              unit: String(values.get(id)?.unit_id ?? labelParts(b.oldAliasText).unit),
            }))));
            message(rows.length + ' current-plant units loaded. Choose old and new units, then Preview swap.');
          }
          function picker(cell, includeCell, proposal, candidates, alias, preferred) {
            const check = make('input', '', includeCell);
            check.type = 'checkbox';
            check.setAttribute('aria-label', 'Include mapping for ' + proposal.id);
            proposal.check = check;
            const pickerUI = dropdown(cell, 'Choose replacement ▾');
            pickerUI.button.dataset.picker = 'true';
            pickerUI.button._panel = pickerUI.panel;
            const choose = (candidate) => {
              proposal.chosen = candidate;
              pickerUI.button.textContent = candidate.alias_text + ' [' + candidate.unit_id + '] ▾';
              pickerUI.button.title = candidate.alias_text + ' — ' + candidate.driver_id;
              check.checked = false;
              updateApply();
            };
            const search = make('input', '', pickerUI.panel);
            search.placeholder = 'Search full list; ++ means AND';
            search.setAttribute('aria-label', 'Search replacements for ' + proposal.id);
            const regexLabel = make('label', 'Regex ', pickerUI.panel);
            const regex = make('input', '', regexLabel);
            regex.type = 'checkbox';
            const info = make('div', '', pickerUI.panel);
            info.setAttribute('role', 'status');
            const list = make('div', '', pickerUI.panel);
            list.className = 'ldscp-binding-options';
            const more = make('button', 'Show 10 more', pickerUI.panel);
            more.type = 'button';
            let limit = 10;
            const isPriorityList = (value) => /\bpriority[\s_-]*list\b/i.test(value.alias_text || '');
            const ranked = candidates.map((value) => ({ value, score: aliasScore(alias, value.alias_text) }))
              .sort((a, b) => b.score - a.score || a.value.alias_text.localeCompare(b.value.alias_text));
            const suggested = ranked.filter(({ value }) => !isPriorityList(value));
            const top = suggested[0];
            const unique = top && (!suggested[1] || top.score - suggested[1].score > 5);
            const cutoff = Number(threshold.value);
            if (preferred && !isPriorityList(preferred)) choose(preferred);
            else if (unique && top.score >= Math.min(85, cutoff)) choose(top.value);
            const changesBinding = proposal.chosen && proposal.items.some(({ id, block }) =>
              id !== String(proposal.chosen.driver_id) || (block.ids.length === 1
                && block.oldAliasText !== proposal.chosen.unit_id + ', ' + proposal.chosen.unit_name + ', ' + proposal.chosen.alias_text));
            if (proposal.chosen && top && unique && top.score >= cutoff
              && changesBinding && String(proposal.chosen.driver_id) === String(top.value.driver_id)) check.checked = true;
            const render = () => {
              list.replaceChildren();
              let matches;
              try {
                const re = regex.checked && search.value ? new RegExp(search.value, 'i') : null;
                const terms = normalize(search.value).split('++').map((t) => t.trim()).filter(Boolean);
                matches = ranked.filter(({ value }) => {
                  // Require an explicit Priority search or exact ID, not a broad alias/regex match.
                  if (isPriorityList(value) && !/priority/i.test(search.value)
                    && !terms.includes(normalize(value.driver_id))) return false;
                  const fields = [value.alias_text, String(value.unit_id), value.unit_name || '', String(value.driver_id)];
                  return re ? fields.some((s) => re.test(s))
                    : terms.every((term) => fields.some((s) => normalize(s).includes(term)));
                });
                search.removeAttribute('aria-invalid');
              } catch (error) {
                search.setAttribute('aria-invalid', 'true');
                info.textContent = 'Invalid regex: ' + error.message;
                more.disabled = true;
                check.checked = false;
                updateApply();
                return;
              }
              for (const { value, score } of matches.slice(0, limit)) {
                const option = make('button', '', list);
                option.type = 'button';
                option.classList.toggle('ldscp-binding-match-option', score >= cutoff);
                option.setAttribute('aria-pressed', String(proposal.chosen?.driver_id === value.driver_id));
                make('strong', score + '% — ' + value.alias_text, option);
                make('small', value.unit_id + ' — ' + value.driver_id, option);
                option.addEventListener('click', () => {
                  choose(value);
                  pickerUI.panel.hidePopover();
                  pickerUI.button.focus();
                });
              }
              info.textContent = Math.min(limit, matches.length) + ' of ' + matches.length
                + ' matches; ' + candidates.length + ' parameters loaded.'
                + ' Priority list objects are hidden unless you search for priority or their exact driver ID.'
                + (top && !unique ? ' Ambiguous: review candidates.' : '');
              more.disabled = matches.length <= limit;
            };
            check.addEventListener('change', () => {
              if (!proposal.chosen || search.getAttribute('aria-invalid') === 'true') check.checked = false;
              updateApply();
            });
            search.addEventListener('keydown', (event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); list.querySelector('button')?.focus(); }
            });
            list.addEventListener('keydown', (event) => {
              if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
              event.preventDefault();
              const options = [...list.children];
              const index = options.indexOf(document.activeElement);
              options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
            });
            for (const el of [search, regex]) el.addEventListener('input', () => { limit = 10; render(); });
            more.addEventListener('click', () => { limit += 10; render(); });
            pickerUI.panel.addEventListener('beforetoggle', (event) => { if (event.newState === 'open') render(); });
            render();
          }
          async function preview(swap) {
            clear();
            if (!threshold.value.trim() || !threshold.checkValidity()) throw new Error('Enter a match threshold from 0 to 100.');
            scan = capture(scope.value);
            if (swap && !to.value) throw new Error('Load units and choose a new unit first.');
            message('Checking current bindings...');
            const current = await lookup(scan.blocks.flatMap((b) => b.ids), scan.plant, active);
            const records = scan.blocks.flatMap((block) => block.ids.map((id, index) => {
              const value = current.get(id);
              const label = labelParts(block.oldAliasText);
              return { block, id, index, value, label,
                unit: String(value?.unit_id ?? label.unit) };
            }));
            sourceUnits(records);
            const source = records.filter((r) => (pointer == null || String(r.block.element.pointer) === String(pointer))
              && (from.value === '*' || (from.value === '?' ? !r.value : normalize(r.unit) === normalize(from.value))));
            if (!source.length) throw new Error('No bindings match this source unit.');
            const api = catalog(scan.plant, active, requests);
            const units = new Map();
            const needed = new Set(swap ? [to.value] : source.map((r) => r.unit).filter(Boolean));
            for (const unit of needed) {
              message('Loading the complete parameter list for ' + unit + '...');
              units.set(unit, await api.parameters(unit));
            }
            active();
            const errors = new Map();
            for (const alarm of AlarmHighlight.problems()) {
              const key = String(alarm.pointer);
              errors.set(key, [...(errors.get(key) || []), alarm.text]);
            }
            const groups = new Map();
            for (const item of source) {
              // Repeated bindings share one mapping; differing stored aliases stay separate in Verify.
              const key = JSON.stringify([item.unit, item.id, swap ? '' : item.block.oldAliasText]);
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key).push(item);
            }
            const table = make('table', '', results);
            const head = table.createTHead().insertRow();
            for (const text of ['Include', 'Blocks / stored label', 'Current binding', 'Status / replacement', 'Host error']) make('th', text, head);
            const body = table.createTBody();
            let missing = 0;
            let renamed = 0;
            let catalogWarnings = 0;
            for (const items of groups.values()) {
              const item = items[0];
              const row = body.insertRow();
              const includeCell = row.insertCell();
              const blocksCell = row.insertCell();
              for (const block of new Set(items.map((r) => r.block))) {
                const button = make('button', 'Block ' + block.ref, blocksCell);
                button.type = 'button';
                button.addEventListener('pointerenter', () => focus(row, block));
                button.addEventListener('focus', () => focus(row, block));
                button.addEventListener('click', () => focus(row, block));
                make('div', block.oldAliasText || '(No stored label)', blocksCell);
              }
              row.addEventListener('pointerenter', () => focus(row, item.block));
              const idCell = row.insertCell();
              make('div', item.id, idCell);
              make('div', 'Unit: ' + (item.unit || 'unknown'), idCell);
              make('div', 'Element: ' + (item.value?.element_id ?? 'missing'), idCell);
              const cell = row.insertCell();
              const catalogRows = units.get(swap ? to.value : item.unit);
              const live = catalogRows?.get(item.id);
              if (!swap && item.value && !live) {
                catalogWarnings += items.length;
                make('div', 'Native chooser confirms this binding; absent from this unit\'s catalog list. Replacement coverage may be incomplete.', cell);
              }
              const exists = !!item.value;
              const nameChanged = exists && item.block.ids.length === 1
                && normalize(item.block.oldAliasText) !== normalize(item.value.unit_id + ', '
                  + item.value.unit_name + ', ' + item.value.alias_text);
              if (!exists) missing += items.length;
              if (nameChanged) renamed += items.length;
              const hostErrors = [...new Set(items.flatMap((r) => errors.get(String(r.block.element.pointer)) || []))];
              make('div', swap ? 'Unit swap' : !exists ? (item.unit ? 'Missing driver ID' : 'Missing driver ID; source unit unknown. Use Swap unit.')
                : nameChanged ? 'Name changed' : hostErrors.length ? 'Binding exists; inspect host error' : 'OK', cell);
              if (!swap && exists && !nameChanged && !hostErrors.length) row.classList.add('ldscp-binding-matched');
              const candidates = [...(catalogRows?.values() || [])];
              if (!swap && item.value) {
                // Native metadata remains authoritative for an existing binding/name refresh.
                const index = candidates.findIndex((candidate) => String(candidate.driver_id) === item.id);
                if (index < 0) candidates.push(item.value);
                else candidates[index] = item.value;
              }
              if (swap || !exists || nameChanged || hostErrors.length) {
                const proposal = { id: item.id, items, chosen: null };
                proposals.push(proposal);
                picker(cell, includeCell, proposal, candidates, item.value?.alias_text || item.label.alias,
                  !swap && nameChanged ? item.value : null);
              }
              make('div', hostErrors.join(' | ') || '—', row.insertCell());
            }
            message(source.length + ' bindings checked; ' + missing + ' missing, ' + renamed
              + ' name changes. Catalog lists loaded for ' + needed.size + ' unit(s). '
              + (catalogWarnings ? catalogWarnings + ' binding(s) confirmed only by the native chooser; see row warnings. ' : '')
              + 'Review and tick changes to apply.');
          }
          async function apply() {
            active();
            const selected = proposals.filter((p) => p.check.checked && p.chosen);
            if (!selected.length) throw new Error('Tick at least one reviewed change.');
            const targets = new Map();
            for (const p of selected) {
              const id = String(p.chosen.driver_id);
              if (!targets.has(id)) targets.set(id, new Set());
              targets.get(id).add(p.id);
            }
            if ([...targets.values()].some((ids) => ids.size > 1)
              && !W.confirm('Different old parameters map to the same new parameter. Apply these checked mappings?')) return;
            message('Rechecking chosen replacements with the native chooser...');
            const fresh = await lookup([...targets.keys()], scan.plant, active);
            active();
            const changes = new Map();
            for (const p of selected) {
              const candidate = fresh.get(String(p.chosen.driver_id));
              if (!candidate || String(candidate.unit_id) !== String(p.chosen.unit_id)
                || candidate.alias_text !== p.chosen.alias_text) {
                throw new Error('A chosen parameter is missing or changed. Run the preview again.');
              }
              for (const item of p.items) {
                if (!changes.has(item.block)) changes.set(item.block, []);
                changes.get(item.block).push({ index: item.index, candidate });
              }
            }
            const updates = [];
            let failures = 0;
            for (const [block, replacements] of changes) {
              const ids = block.ids.slice();
              for (const { index, candidate } of replacements) ids[index] = String(candidate.driver_id);
              const value = ids.length === 1 ? replacements[0].candidate : null;
              const label = value ? value.unit_id + ', ' + value.unit_name + ', ' + value.alias_text : block.oldAliasText;
              if (JSON.stringify(ids) === JSON.stringify(block.ids) && label === block.oldAliasText) continue;
              updates.push({ ref: block.ref, oldData: block.oldData, oldAliasText: block.oldAliasText });
              try {
                scan.paper.set_block_data(block.ref, { ...block.oldData, driver_ids: ids });
                scan.paper.set_block_override(block.ref, 'alias_text', label);
              } catch (error) {
                failures++;
                console.error('[' + SCRIPT_NAME + '] Binding update failed:', error);
                break; // Preserve Undo for all attempted writes; stop after the first failure.
              }
            }
            if (!updates.length) throw new Error('Checked mappings make no changes.');
            undoHistory.push({ type: 'tag-paste', timestamp: new Date().toISOString(), payload: { updates } });
            dialog.close();
            toast((updates.length - failures) + ' blocks updated. Ctrl+Z restores attempted changes.', failures ? 'error' : 'info');
          }
          async function run(action) {
            if (running) return;
            running = true;
            for (const panel of dialog.querySelectorAll(':popover-open')) panel.hidePopover();
            for (const el of [scope, from, to, unitPicker.button, unitSearch, threshold, loadButton, verifyButton, swapButton]) el.disabled = true;
            results.inert = true;
            updateApply();
            try { await action(); }
            catch (error) { if (alive) { clear(); message(error.message, true); } }
            finally {
              running = false;
              if (alive) {
                for (const el of [scope, from, to, unitPicker.button, unitSearch, threshold, loadButton, verifyButton, swapButton]) el.disabled = false;
                results.inert = false;
                updateApply();
              }
            }
          }
          loadButton.addEventListener('click', () => run(loadUnits));
          verifyButton.addEventListener('click', () => run(() => preview(false)));
          swapButton.addEventListener('click', () => run(() => preview(true)));
          applyButton.addEventListener('click', () => run(apply));
          closeButton.addEventListener('click', () => dialog.close());
          const dismissTopLayer = () => {
            const panel = dialog.querySelector(':popover-open');
            if (panel) {
              panel.hidePopover();
              panel._trigger?.focus();
            } else dialog.close();
          };
          const onVerifyEscape = (event) => {
            if (event.key !== 'Escape' || !dialog.open || !dialog.contains(event.target)) return;
            // Window capture runs before canvas/document shortcuts can consume Escape.
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) dismissTopLayer();
          };
          window.addEventListener('keydown', onVerifyEscape, true);
          dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            event.stopPropagation();
            dismissTopLayer();
          });
          dialog.addEventListener('close', () => {
            alive = false;
            window.removeEventListener('keydown', onVerifyEscape, true);
            resizeObserver.disconnect();
            clearTimeout(saveTimer);
            if (lastGeometry) GM_setValue(geometryKey, lastGeometry);
            for (const request of requests) request.abort();
            outline?.remove();
            dialog.remove();
          });
          updateApply();
          document.body.appendChild(dialog);
          const saved = GM_getValue(geometryKey, null);
          if (saved && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved[key]))) {
            dialog.style.width = Math.max(Math.min(640, innerWidth * .9), Math.min(saved.width, innerWidth * .96)) + 'px';
            dialog.style.height = Math.max(Math.min(340, innerHeight * .94), Math.min(saved.height, innerHeight * .94)) + 'px';
            dialog.style.margin = '0';
            dialog.style.left = Math.max(0, Math.min(saved.x, innerWidth - parseFloat(dialog.style.width))) + 'px';
            dialog.style.top = Math.max(0, Math.min(saved.y, innerHeight - parseFloat(dialog.style.height))) + 'px';
          }
          dialog.showModal();
          rememberGeometry();
          resizeObserver.observe(dialog);
          try {
            // Stored labels populate the selector immediately, including removed units.
            scan = capture(scope.value);
            sourceUnits(scan.blocks.map((block) => ({ unit: labelParts(block.oldAliasText).unit })));
            if (pointer != null) {
              make('p', 'Reviewing error block ' + pointer + '. Close and reopen Verify objects for the full sketch.');
              run(() => preview(false));
            } else {
              run(async () => {
                message('Resolving units used in this sketch...');
                const rows = await lookup(scan.blocks.flatMap((block) => block.ids), scan.plant, active);
                sourceUnits(scan.blocks.flatMap((block) => block.ids.map((id) => ({
                  unit: String(rows.get(id)?.unit_id ?? labelParts(block.oldAliasText).unit),
                }))));
                message('Sketch units ready. Green means a binding or replacement is matched; darker green means included. Changes are made only with Apply.');
              });
            }
          } catch (error) { message(error.message, true); }
        }
        return { open, resolve: lookup };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Multi-wire orchestrator — pair sources across one or more
      //  targets, create wires. v3: accepts targets[] array; v1.3.0's
      //  single-target signature is supported by passing targets: [one].
      // ═══════════════════════════════════════════════════════════════

      function doMultiWire({ sources, targets }) {
        const paper = W.logic_designer?.paper;
        if (!paper?.elements) {
          toast('Multi-wire: paper not ready.', 'error');
          return;
        }
        if (!Array.isArray(targets) || targets.length === 0) {
          toast('Multi-wire: no target.', 'error');
          return;
        }

        // Slice sources across targets by visual y.
        const targetDescriptorsForSlicer = targets.map((t) => {
          const el = paper.elements[t.blockRef];
          const pinsArr = t.side === 'input' ? el?.inputs : el?.outputs;
          const pinCount = Array.isArray(pinsArr) ? pinsArr.length : 0;
          // y is now passed in by the caller (pin-derived, not block.matrix).
          // Fallback to 0 if absent (e.g. older single-target call sites that
          // don't set y — they only pass one target so the sort is a no-op).
          const y = typeof t.y === 'number' ? t.y : 0;
          return { ...t, pinCount, y };
        });
        const distribution = distributeSourcesAcrossTargets({ sources, targets: targetDescriptorsForSlicer });

        // Per-target: build targetPins, compute pairing, apply.
        const createdWires = [];
        const disconnectedWires = [];
        const expansions = [];
        const wireFailures = [];
        let totalPaired = 0;
        let totalUnpaired = 0;
        let totalSkipped = 0;

        for (const slice of distribution.slices) {
          if (slice.sources.length === 0) continue;
          const t = slice.target;
          const targetEl = paper.elements[t.blockRef];
          if (!targetEl) {
            console.warn(`[${SCRIPT_NAME}] doMultiWire: target block ${t.blockRef} missing.`);
            totalUnpaired += slice.sources.length;
            continue;
          }
          const targetPinsArr = t.side === 'input' ? targetEl.inputs : targetEl.outputs;
          if (!Array.isArray(targetPinsArr) || targetPinsArr.length === 0) {
            totalUnpaired += slice.sources.length;
            continue;
          }
          const targetPins = targetPinsArr.map((p, i) => ({ connected: !!p?.connected, pinIndex: i }));
          let expandableMax = null;
          if (!t.noExpand && t.side === 'input' && targetEl.config?.expandable_inputs) {
            expandableMax = typeof targetEl.config.maximum_inputs === 'number' ? targetEl.config.maximum_inputs : null;
          }

          // Rule A: skip sources whose output already feeds this target block (any pin).
          // Applies both 'output' sourceSide (multi-fanout output) and 'input' (single-wire input).
          const filteredSlice = slice.sources.filter((s) => {
            const srcEl = paper.elements[s.blockRef];
            if (!srcEl) return false;
            if (s.side === 'output') {
              const out = srcEl.outputs?.[s.pinIndex];
              if (!out?.connected_to || typeof out.connected_to !== 'object') return true;
              for (const k of Object.keys(out.connected_to)) {
                if (out.connected_to[k]?.ref === t.blockRef) return false;
              }
              return true;
            }
            // sourceSide === 'input': single connection
            const inp = srcEl.inputs?.[s.pinIndex];
            if (!inp?.connected_to) return true;
            return inp.connected_to.ref !== t.blockRef;
          });
          const skippedThisTarget = slice.sources.length - filteredSlice.length;
          totalSkipped += skippedThisTarget;

          const sortedSlice = [...filteredSlice].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
          const result = pairSourcesToTargets({
            sources: sortedSlice,
            targetBlockRef: t.blockRef,
            targetPins,
            targetSide: t.side,
            startPin: t.startPin,
            targetIsPinClick: t.isPinClick,
            expandableMax,
          });
          if (result.expansionNeeded) {
            const oldCount = targetPinsArr.length;
            try {
              HostAdapter.setBlockInputCount(t.blockRef, result.expansionNeeded.newCount);
              expansions.push({ ref: t.blockRef, oldCount, newCount: result.expansionNeeded.newCount });
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] setBlockInputCount failed for ${t.blockRef}:`, err);
              totalUnpaired += sortedSlice.length;
              continue;
            }
          }

          for (const occ of result.occupiedToDisconnect) {
            const dstEl = paper.elements[occ.dstRef];
            const inp = dstEl?.inputs?.[occ.dstPin];
            const ct = inp?.connected_to;
            const oldFromRef = typeof ct?.ref === 'number' ? ct.ref : null;
            const oldFromPin = typeof ct?.put_id === 'number' ? ct.put_id : 0;
            try {
              WireObserver.suppressNextRemoveFor({ toNode: occ.dstRef, toPin: occ.dstPin });
              const removed = HostAdapter.disconnectWire({ toNode: occ.dstRef, toPin: occ.dstPin });
              if (removed && oldFromRef !== null) {
                disconnectedWires.push({
                  from: { node: oldFromRef, pin: oldFromPin },
                  to: { node: occ.dstRef, pin: occ.dstPin },
                });
              }
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] disconnectWire failed for ${occ.dstRef}:${occ.dstPin}:`, err);
            }
          }

          for (const p of result.pairs) {
            const fromNode = p.srcSide === 'output' ? p.srcRef : p.dstRef;
            const fromPin = p.srcSide === 'output' ? p.srcPin : p.dstPin;
            const toNode = p.srcSide === 'output' ? p.dstRef : p.srcRef;
            const toPin = p.srcSide === 'output' ? p.dstPin : p.srcPin;
            try {
              WireObserver.suppressNextCreateFor({ toNode, toPin });
              HostAdapter.createWire({ fromNode, fromPin, toNode, toPin });
              createdWires.push({ from: { node: fromNode, pin: fromPin }, to: { node: toNode, pin: toPin } });
            } catch (err) {
              wireFailures.push({ pair: p, err: String(err) });
              console.error(`[${SCRIPT_NAME}] multi-wire createWire failed:`, p, err);
            }
          }
          totalPaired += result.pairs.length;
          totalUnpaired += result.unpaired;
        }

        // Push undo record.
        if (createdWires.length > 0 || disconnectedWires.length > 0 || expansions.length > 0) {
          undoHistory.push({
            type: 'multi-wire',
            timestamp: new Date().toISOString(),
            payload: { createdWires, disconnectedWires, expansions },
          });
        }

        // Toast summary.
        const totalRequested = totalPaired + totalUnpaired + distribution.unassigned + totalSkipped;
        let msg = `Wired ${createdWires.length} of ${totalRequested} pairs.`;
        if (disconnectedWires.length > 0) msg += ` Replaced ${disconnectedWires.length} existing.`;
        const totalLeft = totalUnpaired + distribution.unassigned;
        if (totalLeft > 0) msg += ` ${totalLeft} unpaired.`;
        if (totalSkipped > 0) msg += ` ${totalSkipped} skipped (already wired).`;
        if (wireFailures.length > 0) {
          msg += ` ${wireFailures.length} failed (see console).`;
          toast(msg, 'error');
        } else if (totalLeft > 0) {
          toast(msg, 'error');
        } else {
          toast(msg);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      //  Styles
      // ═══════════════════════════════════════════════════════════════

      if (typeof GM_addStyle === 'function') {
        GM_addStyle(`
          .ldscp-launcher {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 99999;
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: rgba(20, 20, 20, 0.92);
            color: #d4d4d4;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            cursor: pointer;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            transition: background 0.12s, color 0.12s;
          }
          .ldscp-launcher:hover { background: rgba(40, 40, 40, 0.96); color: #ffffff; }
          .ldscp-launcher svg { display: block; }
          .ldscp-launcher[hidden] { display: none; }
          .ldscp-alarm-pill {
            position: fixed;
            bottom: 56px;
            right: 16px;
            z-index: 99999;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 8px 5px 10px;
            background: rgba(140, 30, 30, 0.94);
            color: #fff;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 14px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            cursor: pointer;
            user-select: none;
          }
          .ldscp-alarm-pill:hover { background: rgba(165, 40, 40, 0.96); }
          .ldscp-alarm-pill-label { white-space: nowrap; }
          .ldscp-alarm-pill-x {
            opacity: 0.7;
            font-size: 14px;
            line-height: 1;
            padding: 0 2px;
          }
          .ldscp-alarm-pill-x:hover { opacity: 1; }
          .ldscp-menu {
            position: fixed;
            right: 16px;
            bottom: 56px;
            z-index: 99999;
            min-width: 160px;
            padding: 4px;
            background: rgba(20, 20, 20, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
            color: #d4d4d4;
          }
          .ldscp-menu[hidden] { display: none; }
          .ldscp-menu-topbar {
            display: flex;
            align-items: center;
            gap: 2px;
            box-sizing: border-box;
            height: 40px;
            min-width: 0;
            padding: 2px;
            box-shadow: none;
            background: #eee;
            color: #333;
            border-color: #bbb;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: thin;
          }
          .ldscp-menu-topbar .ldscp-menu-item {
            flex: 0 0 auto;
            width: auto;
            height: 28px;
            gap: 5px;
            padding: 4px 7px;
            white-space: nowrap;
          }
          .ldscp-menu-topbar .ldscp-menu-item:hover { background: #ddd; color: #222; }
          .ldscp-menu-topbar .ldscp-menu-item-kbd { display: none; }
          .ldscp-menu-topbar select { background: #f4f4f4 !important; }
          .ldscp-menu-topbar::-webkit-scrollbar { height: 6px; }
          .ldscp-menu-topbar .ldscp-paste-tags-panel {
            position: fixed;
            background: #202020;
            color: #d4d4d4;
            border: 1px solid #555;
            border-radius: 4px;
          }
          .ldscp-menu-floating {
            box-sizing: border-box;
            width: max-content;
            min-width: min(160px, calc(100vw - 16px));
            max-width: calc(100vw - 16px);
            max-height: calc(100vh - 16px);
            overflow: auto;
          }
          .ldscp-menu-floating .ldscp-paste-tags-panel { min-width: 0; }
          .ldscp-menu-horizontal { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
          .ldscp-menu-horizontal .ldscp-menu-item { width: auto; height: 28px; padding: 4px 6px; flex: 0 0 auto; white-space: nowrap; }
          .ldscp-menu-horizontal .ldscp-menu-item > span:not(:first-child) { display: none; }
          .ldscp-menu-horizontal .ldscp-menu-drag { flex: 0 0 auto; width: 28px; height: 28px; padding: 4px 6px; border-bottom: 0; font-size: 0; }
          .ldscp-menu-horizontal .ldscp-menu-drag::before { content: '⋮⋮'; font-size: 13px; }
          .ldscp-menu-orientation[hidden] { display: none; }
          .ldscp-menu-drag {
            position: sticky;
            top: 0;
            z-index: 1;
            display: block;
            width: 100%;
            padding: 5px 8px;
            border: 0;
            border-bottom: 1px solid #555;
            background: #202020;
            color: #d4d4d4;
            font: inherit;
            cursor: grab;
            touch-action: none;
            user-select: none;
          }
          .ldscp-menu-drag[hidden] { display: none; }
          .ldscp-switch-project {
            display: inline-flex;
            align-items: center;
            min-height: 0;
            box-sizing: border-box;
            margin: 0;
            padding: 0 10px;
            border: 0;
            border-left: 1px solid #d1d1d1;
            border-right: 1px solid #d1d1d1;
            border-radius: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            cursor: pointer;
          }
          .ldscp-switch-project:hover { background: #e9e9e9; }
          .ldscp-binding-dialog {
            border: 1px solid #888;
            border-radius: 6px;
            padding: 16px;
            width: min(1080px, 94vw);
            height: 85vh;
            min-width: min(640px, 90vw);
            min-height: min(340px, 94vh);
            max-width: 96vw;
            max-height: 94vh;
            box-sizing: border-box;
            resize: both;
            overflow: auto;
            font: 13px/1.4 sans-serif;
            color: #222;
            background: #fff;
            z-index: 100000;
          }
          .ldscp-binding-dialog[open] { display: flex; flex-direction: column; }
          .ldscp-binding-dialog > div:first-child { flex-shrink: 0; }
          .ldscp-binding-dialog::backdrop { background: rgba(0,0,0,.12); }
          .ldscp-binding-dialog h2 {
            margin: -16px -16px 12px;
            padding: 12px 16px;
            background: #e9eef5;
            cursor: move;
            user-select: none;
            touch-action: none;
          }
          .ldscp-binding-dialog label { display: block; margin: 8px 0; }
          .ldscp-binding-dialog input,
          .ldscp-binding-dialog select,
          .ldscp-binding-dialog textarea { font: inherit; margin-left: 6px; }
          .ldscp-binding-dialog textarea { display: block; width: 98%; min-height: 52px; }
          .ldscp-binding-dialog button { margin: 6px 6px 6px 0; }
          .ldscp-binding-results { flex: 1; min-height: 100px; overflow: auto; }
          .ldscp-binding-results table { width: 100%; border-collapse: collapse; }
          .ldscp-binding-results th,
          .ldscp-binding-results td { border-bottom: 1px solid #ddd; padding: 4px; text-align: left; }
          .ldscp-binding-results td { overflow-wrap: anywhere; }
          .ldscp-binding-results tr.ldscp-binding-matched { background: #eff9f0; }
          .ldscp-binding-results tr.ldscp-binding-included { background: #dcefdc; }
          .ldscp-binding-results tr.ldscp-binding-active { background: #fff1aa; outline: 2px solid #bb7500; }
          .ldscp-binding-results select { width: 100%; min-width: 190px; }
          .ldscp-binding-results table { table-layout: fixed; }
          .ldscp-binding-results th:nth-child(1) { width: 52px; }
          .ldscp-binding-results th:nth-child(2) { width: 21%; }
          .ldscp-binding-results th:nth-child(3) { width: 19%; }
          .ldscp-binding-results th:nth-child(4) { width: 43%; }
          .ldscp-binding-results td { vertical-align: top; }
          .ldscp-binding-results input:not([type="checkbox"]) { box-sizing: border-box; width: 96%; }
          .ldscp-binding-results select { box-sizing: border-box; width: 96%; min-width: 0; }
          .ldscp-binding-unit-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          .ldscp-binding-unit-row .ldscp-binding-dropdown { width: min(440px, 60vw); }
          .ldscp-binding-dialog .ldscp-binding-dropdown {
            display: block; width: 100%; padding: 8px; text-align: left;
            white-space: normal; overflow-wrap: anywhere; cursor: pointer;
          }
          .ldscp-binding-dialog .ldscp-binding-unit-row .ldscp-binding-dropdown { width: min(440px, 60vw); }
          .ldscp-binding-picker {
            position: fixed; inset: auto; margin: 0; padding: 14px;
            width: min(1000px, calc(100vw - 16px)); max-height: calc(100vh - 16px);
            box-sizing: border-box; overflow: auto; border: 1px solid #777;
            border-radius: 5px; background: #fff; color: #222;
            box-shadow: 0 6px 24px #0004; font: 13px/1.4 sans-serif;
          }
          .ldscp-binding-picker input:not([type="checkbox"]), .ldscp-binding-picker select {
            box-sizing: border-box; width: 100%; margin: 0; padding: 8px; font: inherit;
          }
          .ldscp-binding-picker label { display: block; margin: 8px 0; }
          .ldscp-binding-options { max-height: min(480px, 55vh); overflow: auto; margin-top: 8px; }
          .ldscp-binding-options button {
            display: block; width: 100%; text-align: left; padding: 9px;
            white-space: normal; overflow-wrap: anywhere; border: 0;
            border-bottom: 1px solid #ddd; background: #fff; color: #222; cursor: pointer;
          }
          .ldscp-binding-options button:hover, .ldscp-binding-options button:focus-visible,
          .ldscp-binding-options button[aria-pressed="true"] { background: #e4efff; }
          .ldscp-binding-options button.ldscp-binding-match-option { background: #eff9f0; }
          .ldscp-binding-options button.ldscp-binding-match-option:hover,
          .ldscp-binding-options button.ldscp-binding-match-option:focus-visible,
          .ldscp-binding-options button.ldscp-binding-match-option[aria-pressed="true"] { background: #dcefdc; }
          .ldscp-binding-options strong, .ldscp-binding-options small { display: block; }
          .ldscp-menu-item {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 10px;
            background: transparent;
            color: inherit;
            border: 0;
            border-radius: 4px;
            width: 100%;
            text-align: left;
            cursor: pointer;
            font: inherit;
          }
          .ldscp-menu-item:hover { background: rgba(255, 255, 255, 0.08); color: #ffffff; }
          .ldscp-menu-item[disabled] { opacity: 0.35; cursor: default; }
          .ldscp-menu-item svg { display: block; flex: 0 0 16px; }
          .ldscp-menu-item-kbd {
            white-space: nowrap;
            margin-left: auto;
            opacity: 0.5;
            font-size: 11px;
            font-family: ui-monospace, "SF Mono", Menlo, monospace;
          }
          .ldscp-toast {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 99999;
            padding: 8px 12px;
            background: rgba(30, 30, 30, 0.92);
            color: #fff;
            font: 12px/1.3 sans-serif;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            pointer-events: none;
          }
          .ldscp-toast-error { background: rgba(140, 30, 30, 0.92); }
          .ldscp-mode-banner {
            position: fixed;
            top: 14px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            padding: 11px 26px;
            background: rgba(12, 12, 12, 0.95);
            color: #ffffff;
            border: 2px solid #ffa500;
            border-radius: 7px;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55), 0 0 0 4px rgba(255, 165, 0, 0.16);
            font: 600 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            pointer-events: none;
            animation: ldscp-banner-in 0.18s ease-out;
          }
          @keyframes ldscp-banner-in {
            from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
          .ldscp-mode-banner-remove {
            border-color: #ff5555;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55), 0 0 0 4px rgba(255, 85, 85, 0.18);
          }
          .ldscp-mode-banner-paste {
            border-color: #7ab3ff;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55), 0 0 0 4px rgba(122, 179, 255, 0.18);
          }
          .ldscp-formula-ta {
            display: block;
            font: 13px/1.45 Consolas, "Courier New", monospace;
            padding: 4px 6px;
            border: 1px solid #7f9db9;
            resize: vertical;
            box-sizing: border-box;
            min-height: 70px;
          }
          .ldscp-formula-helper {
            font: 11px/1.4 sans-serif;
            color: #555;
            margin: 3px 0 2px;
          }
          .ldscp-formula-funcs {
            font: 10px/1.5 sans-serif;
            color: #777;
            margin-top: 3px;
          }
          .ldscp-formula-help-btn {
            font: bold 10px/1 sans-serif;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            border: 1px solid #999;
            background: #f4f4f4;
            color: #333;
            cursor: pointer;
            padding: 0;
            vertical-align: middle;
          }
          .ldscp-formula-help-btn:hover { background: #e2e2e2; }
          .ldscp-formula-pop {
            position: fixed;
            z-index: 999999;
            background: #fff;
            border: 1px solid #aaa;
            border-radius: 4px;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
            padding: 8px 12px;
            font: 11px/1.55 sans-serif;
            color: #333;
            max-height: 70vh;
            overflow-y: auto;
          }
          .ldscp-formula-pop-h {
            font-weight: 700;
            margin: 7px 0 2px;
            color: #222;
          }
          .ldscp-formula-pop-h:first-child { margin-top: 0; }
          .ldscp-formula-pop-line { margin-left: 2px; }
          .ldscp-formula-helper-warn {
            color: #b3261e;
            font-weight: 600;
          }
          .ldscp-formula-helper-ok {
            color: #1a7f37;
            font-weight: 600;
          }
          .ldscp-formula-verify {
            font: 11px/1.2 sans-serif;
            padding: 2px 10px;
            margin-top: 2px;
            cursor: pointer;
          }
          .ldscp-sketchinfo {
            position: fixed;
            top: 5px;
            right: 185px;
            z-index: 99998;
            font: 11px/1.3 sans-serif;
            color: #333;
            background: rgba(255, 255, 255, 0.88);
            border: 1px solid #c9c9c9;
            border-radius: 3px;
            padding: 2px 8px;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
          }
          .ldscp-sketchinfo-list {
            position: fixed;
            top: 27px;
            right: 185px;
            z-index: 99999;
            background: #fff;
            border: 1px solid #bbb;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
            font: 11px/1.6 sans-serif;
            color: #333;
            padding: 6px 10px;
            max-height: 300px;
            overflow-y: auto;
            min-width: 240px;
          }
          .ldscp-sketchinfo-list div {
            white-space: nowrap;
          }
          .ldscp-wire-hover {
            stroke: #ff5555 !important;
            opacity: 0.85;
          }
          .ldscp-typelegend {
            position: fixed;
            top: 5px;
            right: 185px;
            z-index: 99998;
            display: inline-flex;
            align-items: center;
            gap: 9px;
            padding: 2px 8px;
            background: rgba(255, 255, 255, 0.88);
            color: #333;
            border: 1px solid #c9c9c9;
            border-radius: 3px;
            font: 11px/1.3 sans-serif;
            white-space: nowrap;
            pointer-events: none;
          }
          .ldscp-typelegend-item {
            display: inline-flex;
            align-items: center;
            gap: 4px;
          }
          .ldscp-typelegend-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            display: inline-block;
          }
          .ldscp-ghost-overlay,
          .ldscp-ghost-overlay * {
            pointer-events: none;
          }
          .ldscp-ghost-overlay {
            opacity: 0.45;
          }
          .ldscp-ghost-overlay-wire {
            stroke: #8ad;
            stroke-width: 2;
            stroke-dasharray: 4 3;
            fill: none;
          }
          .ldscp-paste-tags-panel {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 8px;
            min-width: 320px;
          }
          .ldscp-paste-tags-header {
            font-size: 13px;
            font-weight: 600;
            color: #d4d4d4;
          }
          .ldscp-paste-tags-mode {
            font-size: 11px;
            color: #9a9a9a;
            font-style: italic;
          }
          .ldscp-paste-tags-textarea {
            width: 100%;
            height: min(280px, 40vh);
            min-height: 100px;
            max-height: max(100px, calc(100vh - 240px));
            overflow: auto;
            box-sizing: border-box;
            background: #1e1e1e;
            color: #d4d4d4;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 3px;
            padding: 6px 8px;
            font: 12px/1.4 monospace;
            resize: vertical;
            outline: none;
          }
          .ldscp-paste-tags-textarea:focus {
            border-color: rgba(255, 165, 0, 0.6);
          }
          .ldscp-paste-tags-error {
            color: #ff7676;
            font-size: 12px;
            line-height: 1.3;
          }
          .ldscp-paste-tags-buttons {
            display: flex;
            gap: 6px;
            justify-content: flex-end;
          }
          .ldscp-paste-tags-btn {
            background: #2a2a2a;
            color: #d4d4d4;
            border: 1px solid rgba(255, 255, 255, 0.12);
            padding: 5px 12px;
            font-size: 12px;
            border-radius: 3px;
            cursor: pointer;
          }
          .ldscp-paste-tags-btn:hover {
            background: #353535;
          }
          .ldscp-paste-tags-btn-primary {
            background: #2c5d8e;
            border-color: #3d7ab3;
          }
          .ldscp-paste-tags-btn-primary:hover {
            background: #357ab8;
          }
          .ldscp-splash-search {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 4px 3px 4px;
            box-sizing: border-box;
          }
          .ldscp-splash-search input {
            flex: 1 1 auto;
            height: 22px;
            padding: 1px 8px;
            border: 1px solid #8a8a8a;
            border-radius: 3px;
            font-size: 12px;
            box-sizing: border-box;
            min-width: 0;
          }
          .ldscp-splash-search input:focus { outline: none; border-color: #3d7ab3; }
          .ldscp-splash-search-count {
            font-size: 11px;
            color: #555;
            white-space: nowrap;
            flex: 0 0 auto;
          }
          .ldscp-splash-hit { background: #ffe6b3 !important; }
          #comp_application_windows_tbl_wnd_splash_projects {
            position: relative !important;
          }
          #comp_application_windows_tbl_wnd_splash_projects .qxs_table_vertical_div_header,
          #comp_application_windows_tbl_wnd_splash_projects .qxs_table_vertical_div_body,
          #comp_application_windows_tbl_wnd_splash_projects .qxs_table_overlay {
            display: none !important;
          }
          .ldscp-splash-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            column-gap: 18px;
            row-gap: 8px;
            align-items: start;
            overflow: auto;
            position: absolute;
            inset: 0;
            padding: 6px 10px 8px 8px;
            box-sizing: border-box;
            background: #fff;
          }
          .ldscp-splash-card {
            min-width: 0;
            break-inside: avoid;
          }
          .ldscp-splash-grid[data-view="list"] {
            grid-template-columns: minmax(0, 1fr);
            align-content: start;
          }
          .ldscp-splash-grid[data-view="list"] .ldscp-sqo-item {
            justify-content: space-between;
            padding: 2px 0;
          }
          .ldscp-splash-view {
            display: inline-flex;
            flex: 0 0 auto;
          }
          .ldscp-splash-view button {
            min-height: 24px;
            padding: 2px 8px;
            border: 1px solid #8a8a8a;
            background: #f2f2f2;
            color: #222;
            font: inherit;
            font-size: 11px;
            cursor: pointer;
          }
          .ldscp-splash-view button:first-child { border-radius: 3px 0 0 3px; }
          .ldscp-splash-view button:last-child { border-radius: 0 3px 3px 0; margin-left: -1px; }
          .ldscp-splash-view button:hover { background: #e3eaf2; }
          .ldscp-splash-view button[aria-pressed="true"] {
            background: #2c5d8e;
            border-color: #2c5d8e;
            color: #f5f7fa;
          }
          .ldscp-splash-view button:focus-visible {
            outline: 2px solid #3d7ab3;
            outline-offset: 2px;
            position: relative;
            z-index: 1;
          }
          .ldscp-splash-card-title {
            font-weight: 700;
            font-size: 11px;
            line-height: 1.25;
            color: #111;
            cursor: pointer;
            margin: 0 0 1px 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .ldscp-splash-card-title:hover { text-decoration: underline; }
          .ldscp-sqo-list {
            margin: 0 0 0 10px;
            background: transparent;
            border: none;
          }
          .ldscp-splash-sort {
            height: 22px;
            font-size: 11px;
            flex: 0 0 auto;
            max-width: 130px;
          }
          .ldscp-sqo-item {
            display: flex;
            align-items: baseline;
            justify-content: flex-start;
            gap: 6px;
            padding: 0;
            cursor: pointer;
            color: #111;
            font-size: 10px;
            line-height: 1.2;
            font-weight: 400;
          }
          .ldscp-sqo-item:hover { background: #eee; }
          .ldscp-sqo-name {
            color: #111;
            font-weight: 400;
            font-size: 10px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
            flex: 0 1 auto;
          }
          .ldscp-sqo-meta {
            display: inline;
            color: #666;
            white-space: nowrap;
            flex: 0 0 auto;
            font-size: 8px;
          }
          .ldscp-sqo-empty, .ldscp-sqo-error {
            padding: 0;
            color: #666;
            font-size: 10px;
          }
          .ldscp-sqo-error { color: #a33; }
          #comp_application_windows_inp_wnd_splash_name {
            height: 22px !important;
            box-sizing: border-box;
          }
          #comp_application_windows_wnd_splash textarea {
            height: 36px !important;
            box-sizing: border-box;
          }
        `);
      }

      // ═══════════════════════════════════════════════════════════════
      //  Launcher + popup menu (bottom-right). Future features add menu items
      //  without needing more UI work.
      // ═══════════════════════════════════════════════════════════════

      function makeMenuItem(icon, label, kbd, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ldscp-menu-item';
        btn.title = label + (kbd ? ` (${kbd})` : '');
        btn.setAttribute('aria-label', label);
        // Icon is a hardcoded SVG string — innerHTML is safe.
        // Label and kbd are text-typed via textContent so a future caller can
        // pass dynamic strings without XSS.
        const iconSpan = document.createElement('span');
        iconSpan.innerHTML = icon;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);
        if (kbd) {
          const kbdSpan = document.createElement('span');
          kbdSpan.className = 'ldscp-menu-item-kbd';
          kbdSpan.textContent = kbd;
          btn.appendChild(kbdSpan);
        }
        btn.addEventListener('click', onClick);
        return btn;
      }

      function mountLauncher() {
        const launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.className = 'ldscp-launcher';
        launcher.title = 'Logic Designer Section Copy/Paste';
        launcher.innerHTML = MENU_ICON;

        const menu = document.createElement('div');
        menu.className = 'ldscp-menu';
        menu.hidden = true;
        const layoutKey = 'ldscp:button-layout';
        const positionKey = 'ldscp:floating-menu:position';
        const orientationKey = 'ldscp:floating-menu:orientation';
        let layout = 'corner';
        let orientation = 'vertical';
        let floatingPosition = null;
        try {
          const saved = GM_getValue(layoutKey, 'corner');
          if (['top', 'corner', 'free'].includes(saved)) layout = saved;
          const position = GM_getValue(positionKey, null);
          if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) floatingPosition = position;
          if (GM_getValue(orientationKey, 'vertical') === 'horizontal') orientation = 'horizontal';
        }
        catch { /* Keep the default if preference storage is unavailable. */ }
        const dragHandle = document.createElement('button');
        dragHandle.type = 'button';
        dragHandle.className = 'ldscp-menu-drag';
        dragHandle.textContent = '⋮⋮ Move menu';
        dragHandle.title = 'Drag to move; arrow keys move by 10px, Shift by 50px';
        dragHandle.setAttribute('aria-label', 'Move floating menu');
        dragHandle.hidden = true;
        menu.appendChild(dragHandle);
        menu.appendChild(makeMenuItem(COPY_ICON, 'Copy section', 'Ctrl+C', () => {
          closeMenu();
          doCopy();
        }));
        menu.appendChild(makeMenuItem(PASTE_ICON, 'Paste section', `Ctrl+V / ${SHORTCUTS.PASTE_PLACE.label}`, () => {
          closeMenu();
          doPaste();
        }));
        const undoItem = makeMenuItem(UNDO_ICON, 'Undo', 'Ctrl+Z', () => {
          closeMenu();
          doUndo();
        });
        menu.appendChild(undoItem);
        const multiwireItem = makeMenuItem(MULTIWIRE_ICON, 'Multi-wire', SHORTCUTS.MULTIWIRE.label, () => {
          closeMenu();
          MultiWireMode.toggle();
        });
        menu.appendChild(multiwireItem);
        const removeItem = makeMenuItem(REMOVE_ICON, 'Remove connectors', SHORTCUTS.REMOVE.label, () => {
          closeMenu();
          RemoveConnectorsMode.toggle();
        });
        menu.appendChild(removeItem);
        const typeColorsItem = document.createElement('label');
        typeColorsItem.className = 'ldscp-menu-item';
        typeColorsItem.title = 'Type colors';
        const typeColorsIcon = document.createElement('span');
        typeColorsIcon.innerHTML = TYPECOLOR_ICON;
        const typeColorsLabel = document.createElement('span');
        typeColorsLabel.textContent = 'Type colors';
        const typeColorsSelect = document.createElement('select');
        typeColorsSelect.setAttribute('aria-label', 'Type colors mode');
        typeColorsSelect.style.cssText = 'margin-left:auto;font:inherit;color:inherit;background:#252525;border:1px solid #666;border-radius:3px;padding:3px;';
        [['off', 'Off'], ['wires', 'Wires'], ['full', 'Wires + blocks']].forEach(([value, text]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          typeColorsSelect.appendChild(option);
        });
        typeColorsSelect.addEventListener('change', () => TypeColorMode.setMode(typeColorsSelect.value));
        typeColorsSelect.addEventListener('keydown', (event) => event.stopPropagation());
        typeColorsSelect.addEventListener('keyup', (event) => event.stopPropagation());
        typeColorsItem.append(typeColorsIcon, typeColorsLabel, typeColorsSelect);
        menu.appendChild(typeColorsItem);
        const pasteTagsItem = makeMenuItem(TAG_ICON, 'Paste tags', null, () => {
          openPasteTagsPanel();
        });
        menu.appendChild(pasteTagsItem);
        menu.appendChild(makeMenuItem(TAG_ICON, 'Verify objects / Swap unit', null, () => {
          closeMenu();
          BindingTools.open();
        }));
        menu.appendChild(makeMenuItem(TAG_ICON, 'Name variable in/out', null, () => {
          closeMenu();
          VariableNames.nameAll();
        }));
        menu.appendChild(makeMenuItem(TAG_ICON, 'Edit selected objects', null, () => {
          closeMenu();
          BulkEdit.open();
        }));
        const showProjectSelector = () => {
          closeMenu();
          // Re-show the reusable "Get started!" dialog. Save unsaved sketch
          // changes before switching, as with a page reload.
          const wnd = W.application_windows?.wnd_splash;
          if (wnd && typeof wnd.show_modal === 'function') {
            try {
              wnd.show_modal();
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] Switch project show_modal failed:`, err);
              toast('Could not open the project selector (see console).', 'error');
            }
          } else {
            toast('Project selector not reachable on this host build.', 'error');
          }
        };
        const switchProjectButton = document.createElement('button');
        switchProjectButton.type = 'button';
        switchProjectButton.className = 'ldscp-switch-project';
        switchProjectButton.textContent = 'Switch project';
        switchProjectButton.title = 'Switch project or start a new sketch';
        switchProjectButton.addEventListener('click', showProjectSelector);
        // ponytail: a 1s poll remounts after host startup without a global observer.
        const mountSwitchProjectButton = () => {
          const processMode = [...document.querySelectorAll('.iw_oc_menu_top_level, .iw_oc_menu_level')]
            .find((el) => el.getClientRects().length > 0 && [el.getAttribute('title'),
              el.getAttribute('aria-label'), el.getAttribute('value'), el.textContent]
              .some((value) => /^\s*set process mode\b/i.test(value || '')));
          if (processMode) {
            const nativeStyle = getComputedStyle(processMode);
            switchProjectButton.style.font = nativeStyle.font;
            switchProjectButton.style.letterSpacing = nativeStyle.letterSpacing;
            switchProjectButton.style.height = processMode.offsetHeight + 'px';
            if (switchProjectButton.previousElementSibling !== processMode) {
              processMode.insertAdjacentElement('afterend', switchProjectButton);
            }
          }
        };
        mountSwitchProjectButton();

        const layoutItem = document.createElement('label');
        layoutItem.className = 'ldscp-menu-item';
        layoutItem.title = 'Button layout';
        const layoutLabel = document.createElement('span');
        layoutLabel.textContent = 'Layout';
        const layoutSelect = document.createElement('select');
        layoutSelect.setAttribute('aria-label', 'Button layout');
        layoutSelect.style.cssText = typeColorsSelect.style.cssText;
        for (const [value, text] of [['top', 'Top bar'], ['corner', 'Corner button'], ['free', 'Floating menu']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          layoutSelect.appendChild(option);
        }
        layoutSelect.value = layout;
        layoutSelect.addEventListener('change', () => {
          layout = ['top', 'corner', 'free'].includes(layoutSelect.value) ? layoutSelect.value : 'corner';
          try { GM_setValue(layoutKey, layout); }
          catch { toast('Layout changed for this session; could not save the preference.', 'error'); }
          applyToolbarLayout();
          closeMenu();
        });
        layoutSelect.addEventListener('keydown', (event) => event.stopPropagation());
        layoutSelect.addEventListener('keyup', (event) => event.stopPropagation());
        layoutItem.append(layoutLabel, layoutSelect);
        menu.appendChild(layoutItem);

        const orientationItem = document.createElement('label');
        orientationItem.className = 'ldscp-menu-item ldscp-menu-orientation';
        orientationItem.hidden = true;
        const orientationLabel = document.createElement('span');
        orientationLabel.textContent = 'Orientation';
        const orientationSelect = document.createElement('select');
        orientationSelect.setAttribute('aria-label', 'Floating menu orientation');
        orientationSelect.style.cssText = typeColorsSelect.style.cssText;
        for (const [value, text] of [['vertical', 'Vertical'], ['horizontal', 'Horizontal']]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = text;
          orientationSelect.appendChild(option);
        }
        orientationSelect.value = orientation;
        orientationSelect.addEventListener('change', () => {
          orientation = orientationSelect.value === 'horizontal' ? 'horizontal' : 'vertical';
          try { GM_setValue(orientationKey, orientation); }
          catch { toast('Orientation changed for this session; could not save it.', 'error'); }
          applyToolbarLayout();
        });
        orientationSelect.addEventListener('keydown', event => event.stopPropagation());
        orientationSelect.addEventListener('keyup', event => event.stopPropagation());
        orientationItem.append(orientationLabel, orientationSelect);
        menu.appendChild(orientationItem);

        // Build the Paste-tags panel ONCE as a hidden child of the menu.
        // Toggled by openPasteTagsPanel / closeMenu; never destroyed.
        const tagsPanel = document.createElement('div');
        tagsPanel.className = 'ldscp-paste-tags-panel';
        tagsPanel.style.display = 'none';

        const tagsHeader = document.createElement('div');
        tagsHeader.className = 'ldscp-paste-tags-header';
        tagsHeader.textContent = 'Paste tags (one driver_id per line)';
        tagsPanel.appendChild(tagsHeader);

        const tagsMode = document.createElement('div');
        tagsMode.className = 'ldscp-paste-tags-mode';
        tagsPanel.appendChild(tagsMode);

        const tagsTextarea = document.createElement('textarea');
        tagsTextarea.className = 'ldscp-paste-tags-textarea';
        tagsTextarea.rows = 8;
        tagsTextarea.spellcheck = false;
        tagsTextarea.placeholder = '8830_S7MODBUS_..._3_0.10\n8830_S7MODBUS_..._3_0.11\n...';
        tagsPanel.appendChild(tagsTextarea);

        const tagsError = document.createElement('div');
        tagsError.className = 'ldscp-paste-tags-error';
        tagsError.style.display = 'none';
        tagsPanel.appendChild(tagsError);

        const tagsButtons = document.createElement('div');
        tagsButtons.className = 'ldscp-paste-tags-buttons';

        const tagsCancelBtn = document.createElement('button');
        tagsCancelBtn.type = 'button';
        tagsCancelBtn.className = 'ldscp-paste-tags-btn';
        tagsCancelBtn.textContent = 'Cancel';
        tagsCancelBtn.addEventListener('click', () => { closeMenu(); });
        tagsButtons.appendChild(tagsCancelBtn);

        const tagsApplyBtn = document.createElement('button');
        tagsApplyBtn.type = 'button';
        tagsApplyBtn.className = 'ldscp-paste-tags-btn ldscp-paste-tags-btn-primary';
        tagsApplyBtn.textContent = 'Apply';
        let tagPasteSession = 0;
        tagsApplyBtn.addEventListener('click', async () => {
          if (tagsApplyBtn.disabled) return;
          const requestSession = tagPasteSession;
          const lines = tagsTextarea.value.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
          tagsApplyBtn.disabled = true;
          tagsApplyBtn.textContent = 'Resolving labels…';
          tagsError.style.display = 'none';
          try {
            const result = await applyTagPaste(lines, () => requestSession === tagPasteSession);
            if (requestSession !== tagPasteSession) return;
            if (result.ok) closeMenu();
            else {
              tagsError.textContent = result.error;
              tagsError.style.display = 'block';
            }
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] Paste tags failed:`, err);
            if (requestSession === tagPasteSession) {
              tagsError.textContent = 'Paste failed (see console).';
              tagsError.style.display = 'block';
            }
          } finally {
            tagsApplyBtn.disabled = false;
            tagsApplyBtn.textContent = 'Apply';
          }
        });
        tagsButtons.appendChild(tagsApplyBtn);
        tagsPanel.appendChild(tagsButtons);

        // Esc on the panel closes the menu.
        tagsPanel.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
          }
        });

        menu.appendChild(tagsPanel);

        // Restore actions; persistent layouts remain visible.
        const closeMenu = () => {
          tagPasteSession++;
          for (const item of menu.children) {
            if (item === tagsPanel) {
              item.style.display = 'none';
            } else {
              item.style.display = '';
            }
          }
          menu.hidden = layout !== 'free' && !menu.classList.contains('ldscp-menu-topbar');
          if (menu.classList.contains('ldscp-menu-floating')) placeFloatingMenu();
        };

        function placeFloatingMenu(position = floatingPosition) {
          const { width, height } = menu.getBoundingClientRect();
          position ||= { x: innerWidth - width - 16, y: innerHeight - height - 56 };
          floatingPosition = {
            x: Math.max(8, Math.min(position.x, innerWidth - width - 8)),
            y: Math.max(8, Math.min(position.y, innerHeight - height - 8)),
          };
          menu.style.left = floatingPosition.x + 'px';
          menu.style.top = floatingPosition.y + 'px';
          menu.style.right = menu.style.bottom = 'auto';
        }
        const saveFloatingPosition = () => {
          try { GM_setValue(positionKey, floatingPosition); }
          catch { toast('Menu moved for this session; could not save its position.', 'error'); }
        };
        let drag = null;
        dragHandle.addEventListener('pointerdown', event => {
          if (layout !== 'free' || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = menu.getBoundingClientRect();
          drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
          dragHandle.setPointerCapture(event.pointerId);
        });
        dragHandle.addEventListener('pointermove', event => {
          if (!drag || layout !== 'free' || event.pointerId !== drag.id) return;
          placeFloatingMenu({ x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y });
        });
        const finishDrag = event => {
          if (!drag || event.pointerId !== drag.id) return;
          drag = null;
          saveFloatingPosition();
        };
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) dragHandle.addEventListener(event, finishDrag);
        dragHandle.addEventListener('keydown', event => {
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (layout !== 'free' || !delta) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 50 : 10;
          placeFloatingMenu({ x: floatingPosition.x + delta[0] * step, y: floatingPosition.y + delta[1] * step });
          saveFloatingPosition();
        });

        // ponytail: reuse the same buttons/poll; align with the user-probed native row.
        function applyToolbarLayout() {
          const toolbar = layout === 'top'
            ? [...document.querySelectorAll('.css_iw_app_base_alt_top_menu')]
              .find(el => el.getClientRects().length > 0) : null;
          const rect = toolbar?.getBoundingClientRect();
          const visibleBounds = (selector, root = toolbar) => root
            ? [...root.querySelectorAll(selector)].filter(el => el.getClientRects().length > 0)
              .map(el => el.getBoundingClientRect()) : [];
          const controls = visibleBounds('.iw_oc_menu_top_level, .iw_oc_menu_level, .ldscp-switch-project')
            .filter(r => r.top >= rect.top - 1 && r.bottom <= rect.bottom + 2);
          const labels = visibleBounds('.css_iw_app_base_alt_logo')
            .concat(visibleBounds('.ldscp-sketchinfo, .ldscp-typelegend', document))
            .filter(r => rect && r.bottom > rect.top && r.top < rect.bottom);
          const left = Math.max(rect?.left || 0, ...controls.map(r => r.right)) + 8;
          const reference = controls[0];
          const top = reference ? Math.max(rect.top, reference.top + (reference.height - 40) / 2) : 0;
          const right = Math.min(rect?.right || 0, innerWidth, ...labels.map(r => r.left)) - 8;
          const docked = !!reference && rect.height >= 40 && right - left >= 400;
          const floating = layout === 'free';
          const wasDocked = menu.classList.contains('ldscp-menu-topbar');
          menu.classList.toggle('ldscp-menu-topbar', docked);
          menu.classList.toggle('ldscp-menu-floating', floating);
          menu.classList.toggle('ldscp-menu-horizontal', floating && orientation === 'horizontal');
          orientationItem.hidden = !floating;
          dragHandle.hidden = !floating;
          launcher.hidden = docked || floating;
          menu.style.left = docked ? left + 'px' : '';
          menu.style.top = docked ? top + 'px' : '';
          menu.style.right = docked ? 'auto' : '';
          menu.style.bottom = docked ? 'auto' : '';
          menu.style.width = docked ? right - left + 'px' : '';
          tagsPanel.style.left = docked ? left + 'px' : '';
          tagsPanel.style.top = docked ? top + 44 + 'px' : '';
          if (wasDocked !== docked) closeMenu();
          if (docked) {
            menu.hidden = false;
            const size = menu.getBoundingClientRect();
            menu.style.top = Math.max(rect.top, reference.top + (reference.height - size.height) / 2) + 'px';
            tagsPanel.style.top = parseFloat(menu.style.top) + size.height + 4 + 'px';
          } else if (floating) {
            menu.hidden = false;
            placeFloatingMenu();
          }
          if (docked || floating) {
            typeColorsSelect.value = TypeColorMode.getMode();
            undoItem.disabled = undoHistory.isEmpty();
          }
        }

        // openPasteTagsPanel: hide regular items, show panel, clear state, focus.
        function openPasteTagsPanel() {
          for (const item of menu.children) {
            if (item === tagsPanel || item === dragHandle) continue;
            item.style.display = 'none';
          }
          tagsTextarea.value = '';
          tagsError.style.display = 'none';
          tagsError.textContent = '';
          tagsMode.textContent = describePasteTagsMode();
          tagsPanel.style.display = '';
          if (layout === 'free') placeFloatingMenu();
          setTimeout(() => tagsTextarea.focus(), 0);
        }

        // Inspect the current selection and describe which paste-tags mode
        // will apply. Single-block mode fires only when exactly one
        // WRITETOUNIT is selected; everything else falls back to 1-to-1.
        function describePasteTagsMode() {
          const paper = W.logic_designer?.paper;
          if (!paper?.elements) return 'Mode: paper not ready';
          const sel = HostAdapter.getSelection();
          const ELIGIBLE = new Set(['PARAMV', 'WRITETOUNIT']);
          let count = 0;
          let writeToUnitCount = 0;
          for (const ref of sel) {
            const el = paper.elements[ref];
            if (!el || !ELIGIBLE.has(el.block_type)) continue;
            count++;
            if (el.block_type === 'WRITETOUNIT') writeToUnitCount++;
          }
          if (count === 0) return 'Mode: no eligible blocks selected';
          if (count === 1 && writeToUnitCount === 1) {
            return 'Mode: fill one block with all driver_ids';
          }
          return `Mode: one driver_id per block (${count} selected)`;
        }

        function resolveTagAliases(ids) {
          return new Promise((resolve, reject) => {
            const plantId = W.plant_id ?? W.query_string?.plant_id
              ?? new URLSearchParams(location.search).get('plant_id');
            if (plantId == null) { reject(new Error('Plant ID not found.')); return; }
            const timer = setTimeout(() => reject(new Error('Label lookup timed out. No tags changed.')), 15000);
            try {
              W.core.communication.poll({
                file: '../lib/xml/qxs/views/ext/qxs_param_chooser/runtime/class.param_chooser.php',
                func: 'param_chooser->get_values',
                data: { plant_id: plantId, values_to_load: [...new Set(ids)] },
                callback: (reply) => {
                  clearTimeout(timer);
                  try {
                    const result = typeof reply === 'string' ? JSON.parse(reply) : reply;
                    if (result?.ok !== true || !Array.isArray(result.data?.values_to_load)) {
                      throw new Error('Could not resolve parameter labels. No tags changed.');
                    }
                    const aliases = new Map();
                    for (const parameter of result.data.values_to_load) {
                      if (parameter?.driver_id == null || parameter.unit_id == null
                        || typeof parameter.unit_name !== 'string' || typeof parameter.alias_text !== 'string') continue;
                      aliases.set(String(parameter.driver_id), `${parameter.unit_id}, ${parameter.unit_name}, ${parameter.alias_text}`);
                    }
                    const missing = ids.filter((id) => !aliases.has(id));
                    if (missing.length) throw new Error(`Could not resolve ${missing.length} driver ID(s), including ${missing[0]}. No tags changed.`);
                    resolve(aliases);
                  } catch (err) { reject(err); }
                },
              });
            } catch (err) { clearTimeout(timer); reject(err); }
          });
        }

        // Resolve first, then commit bindings and labels together with one undo record.
        async function applyTagPaste(lines, isCurrent = () => true) {
          if (lines.length === 0) {
            return { ok: false, error: 'No tag lines provided.' };
          }
          const paper = W.logic_designer?.paper;
          if (!paper?.elements) {
            return { ok: false, error: 'Paper not ready.' };
          }
          const sel = HostAdapter.getSelection();
          const ELIGIBLE = new Set(['PARAMV', 'WRITETOUNIT']);
          const eligible = [];
          for (const ref of sel) {
            const el = paper.elements[ref];
            if (!el) continue;
            if (!ELIGIBLE.has(el.block_type)) continue;
            const m = el?.set?.items?.[0]?.matrix;
            const y = (m && typeof m.f === 'number') ? m.f : 0;
            eligible.push({
              ref,
              element: el,
              y,
              blockType: el.block_type,
              oldData: el.data ? JSON.parse(JSON.stringify(el.data)) : {},
              oldAliasText: el.override?.alias_text ?? '',
            });
          }
          if (eligible.length === 0) {
            return { ok: false, error: 'No PARAMV or WRITETOUNIT in selection.' };
          }

          // A single WRITETOUNIT accepts all pasted IDs, as in the native chooser.
          const isSingleBlockMode = (
            eligible.length === 1 && eligible[0].blockType === 'WRITETOUNIT'
          );
          if (!isSingleBlockMode && eligible.length !== lines.length) {
            return {
              ok: false,
              error: `${eligible.length} PARAMV/WRITETOUNIT selected but ${lines.length} lines. Adjust and retry.`,
            };
          }
          const generation = undoHistory.generation();
          let aliases;
          try { aliases = await resolveTagAliases(lines); }
          catch (err) { return { ok: false, error: err.message || 'Label lookup failed. No tags changed.' }; }
          if (!isCurrent() || W.logic_designer?.paper !== paper || undoHistory.generation() !== generation
            || JSON.stringify(HostAdapter.getSelection()) !== JSON.stringify(sel)
            || eligible.some(({ ref, element, oldData, oldAliasText }) => paper.elements[ref] !== element
              || JSON.stringify(element.data || {}) !== JSON.stringify(oldData)
              || (element.override?.alias_text ?? '') !== oldAliasText)) {
            return { ok: false, error: 'Sketch, selection or block data changed during lookup. Nothing pasted; retry.' };
          }
          eligible.sort((a, b) => a.y - b.y);
          const updates = [];
          let failures = 0;
          for (let i = 0; i < eligible.length; i++) {
            const { ref, oldData, oldAliasText } = eligible[i];
            const ids = isSingleBlockMode ? lines.slice() : [lines[i]];
            const newData = { ...oldData, driver_ids: ids };
            updates.push({ ref, oldData, oldAliasText });
            try {
              paper.set_block_data(ref, newData);
              paper.set_block_override(ref, 'alias_text', ids.length > 1 ? 'Multiple parameters' : aliases.get(ids[0]));
            } catch (err) {
              failures++;
              console.error(`[${SCRIPT_NAME}] set_block_data/override failed for ${ref}:`, err);
            }
          }
          undoHistory.push({
            type: 'tag-paste',
            timestamp: new Date().toISOString(),
            payload: { updates },
          });
          if (failures) {
            return { ok: false, error: `${updates.length - failures} of ${updates.length} blocks fully updated. Ctrl+Z restores all attempted changes (see console).` };
          }
          toast(`Tagged ${updates.length} block${updates.length === 1 ? '' : 's'}.`);
          return { ok: true };
        }
        const toggleMenu = (event) => {
          event.stopPropagation();
          if (menu.hidden) {
            typeColorsSelect.value = TypeColorMode.getMode();
            // About to open — sync the undo item's disabled state.
            if (undoHistory.isEmpty()) {
              undoItem.setAttribute('disabled', '');
            } else {
              undoItem.removeAttribute('disabled');
            }
          }
          menu.hidden = !menu.hidden;
          if (menu.hidden) tagPasteSession++;
        };

        launcher.addEventListener('click', toggleMenu);
        // Click outside the menu closes it.
        document.addEventListener('click', (event) => {
          if (menu.hidden) return;
          if (menu.contains(event.target) || launcher.contains(event.target)) return;
          closeMenu();
        });
        // Esc closes it.
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && !menu.hidden) closeMenu();
        });

        document.body.appendChild(launcher);
        document.body.appendChild(menu);
        applyToolbarLayout();
        window.addEventListener('resize', applyToolbarLayout);
        setInterval(() => { mountSwitchProjectButton(); applyToolbarLayout(); }, 1000);
      }

      // ═══════════════════════════════════════════════════════════════
      //  Keyboard shortcuts (Ctrl/Cmd + C / V on the canvas)
      // ═══════════════════════════════════════════════════════════════

      function isEditingText(target) {
        if (!target) return false;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (target.isContentEditable) return true;
        return false;
      }

      function hasTextSelection() {
        try {
          const sel = window.getSelection?.();
          return !!(sel && sel.toString().length > 0);
        } catch {
          return false;
        }
      }

      function installKeyboardShortcuts() {
        let shortcutCanvas = null;
        document.addEventListener('pointerdown', (event) => {
          const paper = W.logic_designer?.paper;
          const svg = event.target?.closest?.('svg');
          shortcutCanvas = svg && (paper?.paper?.canvas === svg ||
            Object.values(paper?.elements || {}).some(block =>
              block?.set?.items?.[0]?.node?.ownerSVGElement === svg)) ? svg : null;
        }, true);
        document.addEventListener('focusin', (event) => {
          if (!shortcutCanvas?.contains(event.target)) shortcutCanvas = null;
        }, true);
        window.addEventListener('blur', () => { shortcutCanvas = null; });
        document.addEventListener('keydown', (event) => {
          // Native Find is outside the DOM; require a fresh canvas click afterwards.
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            shortcutCanvas = null;
          }
          // Esc cancels multi-wire mode (handled separately from Ctrl chord checks).
          if (event.key === 'Escape') {
            if (MultiWireMode.isActive()) {
              event.preventDefault();
              MultiWireMode.exit();
              return;
            }
            if (RemoveConnectorsMode.isActive()) {
              event.preventDefault();
              RemoveConnectorsMode.exit();
              return;
            }
            if (GhostPasteMode.isActive()) {
              event.preventDefault();
              GhostPasteMode.exit();
              return;
            }
          }

          // Bare mode keys only after canvas interaction, never while typing.
          if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (!shortcutCanvas?.isConnected || !shortcutCanvas.getClientRects().length ||
                event.repeat || event.isComposing || event.defaultPrevented ||
                isEditingText(event.target) || isEditingText(document.activeElement)) return;
            const k = event.key.toLowerCase();
            if (k === SHORTCUTS.MULTIWIRE.key) {
              event.preventDefault();
              MultiWireMode.toggle();
              return;
            }
            if (k === SHORTCUTS.REMOVE.key) {
              event.preventDefault();
              RemoveConnectorsMode.toggle();
              return;
            }
          }

          const ctrl = event.ctrlKey || event.metaKey;
          if (!ctrl) return;
          if (event.altKey || event.shiftKey) return;
          if (isEditingText(event.target)) return;

          const key = event.key.toLowerCase();
          if (key === 'c') {
            if (hasTextSelection()) return;
            event.preventDefault();
            doCopy();
          } else if (key === 'v') {
            if (hasTextSelection()) return;
            event.preventDefault();
            doPaste();
          } else if (key === SHORTCUTS.PASTE_PLACE.key && SHORTCUTS.PASTE_PLACE.ctrl) {
            if (hasTextSelection()) return;
            event.preventDefault();
            GhostPasteMode.toggle();
          } else if (key === 'z') {
            // Ctrl+Z while any in-flight mode is active cancels the mode instead
            // of running undo. User intent: "abort the in-flight action," not
            // "step further back."
            if (MultiWireMode.isActive()) {
              event.preventDefault();
              MultiWireMode.exit();
              return;
            }
            if (RemoveConnectorsMode.isActive()) {
              event.preventDefault();
              RemoveConnectorsMode.exit();
              return;
            }
            if (GhostPasteMode.isActive()) {
              event.preventDefault();
              GhostPasteMode.exit();
              return;
            }
            // Intentionally no hasTextSelection() guard here: text selection
            // doesn't mean the user wants the browser's (nonexistent) page-text
            // undo. Our script-level undo is the only useful interpretation.
            event.preventDefault();
            doUndo();
          }
        }, true);
      }

      // ═══════════════════════════════════════════════════════════════
      //  Sketch quick-open — augments the host "Get started!" dialog with
      //  a per-project arrow that lists the project's sketches and opens
      //  one directly. Reads logic_designer_manager (project/sketch RPC).
      //  Self-contained; no interaction with the canvas observers.
      // ═══════════════════════════════════════════════════════════════
      const SketchQuickOpen = (() => {
        // Project rows are <tr> in the splash dialog's PROJECTS table. Scope to
        // that table's id — the dialog also holds a Processes table (800+ rows)
        // sharing the .qxsTable_tr class; an unscoped selector grabs those too.
        const ROW_SEL = '#comp_application_windows_tbl_wnd_splash_projects tr.qxsTable_tr';
        const LISTROW_CLASS = 'ldscp-sqo-listrow';
        let projectsCache = null;   // load_project_list result, per dialog session
        const sketchCache = new Map(); // project_id -> sketch array, per dialog session
        let session = 0;
        let projectWaiters = null;
        const sketchWaiters = new Map();
        let sketchLoadsStarted = false;
        const unitIndex = new Map();
        const unitDetails = new Map();
        const unitPairs = new Map();
        const sketchAuthors = new Map();
        const authorQueue = [];
        let authorBusy = false;
        let authorStopped = false;
        let authorTimer = null;

        function enqueueAuthors(sketches) {
          for (const sketch of sketches || []) {
            if (sketch?.id == null) continue;
            const id = String(sketch.id);
            if (sketchAuthors.has(id)) continue;
            sketchAuthors.set(id, null);
            authorQueue.push(id);
          }
          loadNextAuthor();
        }

        function loadNextAuthor() {
          if (authorBusy || authorStopped || !authorQueue.length) return;
          const id = authorQueue.shift();
          const requestSession = session;
          authorBusy = true;
          let settled = false;
          const finish = (reply, stop = false) => {
            if (settled || requestSession !== session) return;
            settled = true;
            clearTimeout(authorTimer);
            authorTimer = null;
            authorBusy = false;
            authorStopped = stop;
            let who = '';
            try {
              const history = typeof reply === 'string' ? JSON.parse(reply) : reply;
              who = Array.isArray(history) ? historyAuthor(history[0]) || '' : '';
            } catch { /* Missing history must not prevent browsing. */ }
            sketchAuthors.set(id, who);
            document.querySelectorAll('.ldscp-sqo-item').forEach(item => {
              if (item.dataset.sketchId !== id) return;
              const label = item.querySelector('.ldscp-sqo-author');
              if (label) label.textContent = who ? ` by ${who}` : '';
            });
            loadNextAuthor();
          };
          // A timed-out request cannot be cancelled; stop rather than pile up calls.
          authorTimer = setTimeout(() => finish(null, true), 15000);
          try {
            if (W.logic_designer_manager.load_history_list(id, finish) === false) finish(null);
          } catch { finish(null); }
        }
        const unitSeen = new Set();
        const unitQueue = [];
        let unitBusy = false;
        let unitStopped = false;
        let unitFailures = 0;
        let unitListFailures = 0;
        let unitTimer = null;

        function unitSearchText(reply, driverIds = new Set()) {
          const saved = typeof reply === 'string' ? JSON.parse(reply) : reply;
          const graph = typeof saved?.sketch === 'string' ? JSON.parse(saved.sketch) : saved?.sketch;
          if (!Array.isArray(graph?.blocks)) return null;
          return graph.blocks.flatMap((block) => {
            const ids = block?.data?.driver_ids;
            if (!Array.isArray(ids) || !ids.length) return [];
            ids.forEach(id => driverIds.add(String(id)));
            return [block.override?.alias_text ?? block.data.alias_text ?? '', ...ids,
              block.data.element_id ?? '', block.data.driver_addr ?? ''];
          }).map(String).join('\n').toLowerCase();
        }

        function refreshUnitSearch() {
          const win = document.getElementById('comp_application_windows_wnd_splash');
          if (win) applyFilter(win);
        }

        function enqueueUnits(sketches) {
          for (const sketch of sketches || []) {
            if (sketch?.id == null) continue;
            const id = String(sketch.id);
            if (unitSeen.has(id)) continue;
            unitSeen.add(id);
            unitQueue.push(id);
          }
          loadNextUnitSketch();
        }

        function loadNextUnitSketch() {
          if (unitBusy || unitStopped || !unitQueue.length) return;
          const id = unitQueue.shift();
          const requestSession = session;
          unitBusy = true;
          let settled = false;
          let baseText = null;
          const driverIds = new Set();
          const finish = (reply, stop = false) => {
            if (settled || requestSession !== session) return;
            settled = true;
            clearTimeout(unitTimer);
            unitTimer = null;
            unitBusy = false;
            unitStopped = stop;
            if (baseText === null || reply === null) unitFailures++;
            // Prototype can replace Array.from with $A, which cannot read Sets.
            if (baseText !== null) unitIndex.set(id, [baseText,
              ...[...driverIds].map(key => unitDetails.get(key)?.text || '')].join('\n'));
            unitPairs.set(id, [...driverIds].map(key => unitDetails.get(key)).filter(Boolean));
            refreshUnitSearch();
            loadNextUnitSketch();
          };
          // Stop on timeout: the host RPC cannot be cancelled, so do not pile up requests.
          unitTimer = setTimeout(() => finish(null, true), 15000);
          try {
            const manager = W.logic_designer_manager;
            // Verified native two-argument form. The instance wrapper updates the
            // current-sketch widget; passing a third with_data argument returned 1.
            const loader = Object.getPrototypeOf(manager)?.load_sketch;
            if (typeof loader !== 'function') { finish(null, true); return; }
            if (loader.call(manager, id, (reply) => {
              if (settled || requestSession !== session) return;
              try {
                baseText = unitSearchText(reply, driverIds);
                if (baseText === null) { finish(null); return; }
                // Keep the existing label/ID search usable even if metadata fails.
                unitIndex.set(id, baseText);
                refreshUnitSearch();
                const missing = [...driverIds].filter(key => !unitDetails.has(key));
                if (!missing.length) { finish(reply); return; }
                const plantId = getPlantId();
                if (!plantId) { finish(null); return; }
                W.core.communication.poll({
                  file: '../lib/xml/qxs/views/ext/qxs_param_chooser/runtime/class.param_chooser.php',
                  func: 'param_chooser->get_values',
                  data: { plant_id: plantId, values_to_load: missing },
                  callback: (response) => {
                    if (settled || requestSession !== session) return;
                    try {
                      const result = typeof response === 'string' ? JSON.parse(response) : response;
                      if (result?.ok !== true || !Array.isArray(result.data?.values_to_load)) {
                        finish(null); return;
                      }
                      for (const value of result.data.values_to_load) {
                        const key = String(value?.driver_id);
                        if (!driverIds.has(key)) continue;
                        unitDetails.set(key, { unitId: String(value.unit_id ?? '').toLowerCase(),
                          elementId: String(value.element_id ?? '').toLowerCase(),
                          text: [value.unit_id, value.element_id, value.driver_addr]
                          .filter(v => typeof v === 'string' || typeof v === 'number')
                          .join('\n').toLowerCase() });
                      }
                      finish(missing.every(key => unitDetails.has(key)) ? reply : null);
                    } catch { finish(null); }
                  },
                });
              } catch { finish(null); }
            }) === false) finish(null);
          } catch { finish(null); }
        }

        function unitSearchStatus() {
          const count = `${unitIndex.size}/${unitSeen.size}`;
          const pending = unitBusy || unitQueue.length || sketchWaiters.size || !sketchLoadsStarted;
          const failures = unitFailures + unitListFailures;
          const state = unitStopped ? 'paused' : pending ? 'loading' : failures ? 'incomplete' : 'ready';
          return `Units ${state} ${count}${failures ? ` (${failures} unreadable)` : ''}`;
        }
        const VIEW_KEY = 'ldscp:splash-view:v2';
        let viewMode = 'grid';
        try {
          if (GM_getValue(VIEW_KEY, 'grid') === 'list') viewMode = 'list';
        } catch { /* Keep the default when storage is unavailable. */ }

        function applyView() {
          const win = document.getElementById('comp_application_windows_wnd_splash');
          if (!win) return;
          const grid = win.querySelector('.ldscp-splash-grid');
          if (grid) grid.dataset.view = viewMode;
          win.querySelectorAll('.ldscp-splash-view button').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.view === viewMode));
          });
        }

        function setView(mode) {
          viewMode = mode === 'list' ? 'list' : 'grid';
          try { GM_setValue(VIEW_KEY, viewMode); } catch { /* Still switch for this session. */ }
          applyView();
        }

        function getPlantId() {
          if (W.plant_id != null) return String(W.plant_id);
          const u = new URLSearchParams(location.search).get('plant_id');
          return u != null ? String(u) : null;
        }

        function dialogVisible() {
          const box = document.getElementById('comp_application_windows_wnd_splash');
          return !!box && box.style.display !== 'none' && box.offsetParent !== null;
        }

        function findProjectRows() {
          if (!dialogVisible()) return [];
          return Array.from(document.querySelectorAll(ROW_SEL));
        }

        function clearCaches() {
          session++;
          clearTimeout(authorTimer);
          authorTimer = null;
          sketchAuthors.clear();
          authorQueue.length = 0;
          authorBusy = false;
          authorStopped = false;
          clearTimeout(unitTimer);
          unitTimer = null;
          unitIndex.clear();
          unitDetails.clear();
          unitPairs.clear();
          unitSeen.clear();
          unitQueue.length = 0;
          unitBusy = false;
          unitStopped = false;
          unitFailures = 0;
          unitListFailures = 0;
          projectsCache = null;
          projectWaiters = null;
          sketchCache.clear();
          sketchWaiters.clear();
          sketchLoadsStarted = false;
          const box = document.getElementById('comp_application_windows_wnd_splash');
          if (!box) return;
          box.querySelectorAll('.ldscp-splash-grid').forEach((grid) => grid.remove());
          box.querySelectorAll(`tr.${LISTROW_CLASS}`).forEach((row) => row.remove());
          box.querySelectorAll('.ldscp-sqo-list').forEach((list) => list.remove());
          box.querySelectorAll('.ldscp-sqo-arrow').forEach((arrow) => arrow.remove());
          box.querySelectorAll('[data-ldscp-sqo]').forEach((row) => { delete row.dataset.ldscpSqo; });
        }

        function ensureProjects(cb) {
          if (projectsCache) { cb(projectsCache); return; }
          if (projectWaiters) { projectWaiters.push(cb); return; }
          const plantId = getPlantId();
          if (plantId == null) { cb([]); return; }
          const requestSession = session;
          projectWaiters = [cb];
          const finish = (projects) => {
            if (requestSession !== session) return;
            const waiters = projectWaiters;
            projectWaiters = null;
            if (Array.isArray(projects)) projectsCache = projects;
            waiters.forEach((callback) => callback(projectsCache || []));
          };
          try {
            W.logic_designer_manager.load_project_list(plantId, finish);
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] SketchQuickOpen load_project_list failed:`, err);
            if (projectWaiters && requestSession === session) finish(null);
          }
        }

        function attachArrow(row, projects) {
          if (isRowProcessed(row.dataset.ldscpSqo)) return;
          // row is a <tr>; its single cell's text is the project name. The
          // header row ("Project Name") matches no project -> id null -> skipped.
          const cell = row.querySelector('td');
          if (!cell) return; // header uses <th>; skip without marking (stays re-checkable)
          const projectId = matchProjectId(projectRowName(row), projects);
          if (projectId == null) return; // failed lookups remain retryable
          row.dataset.ldscpSqo = '1';

          const arrow = document.createElement('span');
          arrow.className = 'ldscp-sqo-arrow';
          arrow.textContent = '▾';
          arrow.title = 'Show sketches';
          arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            toggleList(row, projectId, arrow);
          });
          cell.appendChild(arrow); // into the <td>, not the <tr> (span in tr won't render)
        }

        function attachArrows(rows, projects) {
          rows.forEach((row) => attachArrow(row, projects));
        }

        function sketchTime(sk) {
          const raw = String((sk && (sk.date || sk.compile_date)) || '').trim();
          if (!raw || raw === '—') return 0;
          const t = Date.parse(raw.replace(' ', 'T'));
          if (Number.isFinite(t)) return t;
          const day = Date.parse(raw.split(' ')[0]);
          return Number.isFinite(day) ? day : 0;
        }

        function currentSort() {
          const win = document.getElementById('comp_application_windows_wnd_splash');
          const sel = win && win.querySelector('.ldscp-splash-sort');
          return (sel && sel.value) || 'newest';
        }

        function projectNewest(pid) {
          const sketches = sketchCache.get(pid) || [];
          let max = 0;
          sketches.forEach((sk) => {
            const t = sketchTime(sk);
            if (t > max) max = t;
          });
          return max;
        }

        function sortedSketches(sketches) {
          const list = Array.isArray(sketches) ? sketches.slice() : [];
          const mode = currentSort();
          list.sort((a, b) => {
            if (mode === 'name') {
              return formatSketchEntry(a).name.localeCompare(formatSketchEntry(b).name, undefined, { sensitivity: 'base' });
            }
            const da = sketchTime(a);
            const db = sketchTime(b);
            return mode === 'oldest' ? da - db : db - da;
          });
          return list;
        }

        function projectItems() {
          const items = [];
          const seen = new Set();
          findProjectRows().forEach((row) => {
            if (!row.querySelector('td')) return;
            const name = projectRowName(row);
            const pid = matchProjectId(name, projectsCache || []);
            if (pid == null || seen.has(pid)) return;
            seen.add(pid);
            items.push({ name, pid });
          });
          if (items.length === 0 && Array.isArray(projectsCache)) {
            projectsCache.forEach((p) => {
              if (!p || p.id == null) return;
              const pid = String(p.id);
              if (seen.has(pid)) return;
              seen.add(pid);
              items.push({ name: String(p.name || '').trim(), pid });
            });
          }
          const mode = currentSort();
          items.sort((a, b) => {
            if (mode === 'name') {
              return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            }
            const da = projectNewest(a.pid);
            const db = projectNewest(b.pid);
            if (da !== db) return mode === 'oldest' ? da - db : db - da;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
          return items;
        }

        function renderGrid() {
          const table = document.querySelector('#comp_application_windows_tbl_wnd_splash_projects');
          if (!table) return;
          let grid = table.querySelector('.ldscp-splash-grid');
          if (!grid) {
            grid = document.createElement('div');
            grid.className = 'ldscp-splash-grid';
            table.appendChild(grid);
          }
          const items = projectItems();
          grid.replaceChildren();
          items.forEach(({ name, pid }) => {
            const card = document.createElement('div');
            card.className = 'ldscp-splash-card';
            card.dataset.projectId = pid;
            card.dataset.projectName = name;
            const title = document.createElement('div');
            title.className = 'ldscp-splash-card-title';
            title.textContent = name;
            title.title = `${name} — click to start a new sketch`;
            title.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              openSketch(pid, null); // ponytail: native "project + Ok" = fresh empty sketch
            });
            card.appendChild(title);
            if (sketchCache.has(pid)) {
              card.appendChild(buildList(pid, sortedSketches(sketchCache.get(pid))));
            }
            grid.appendChild(card);
          });
          const win = document.getElementById('comp_application_windows_wnd_splash');
          applyView();
          if (win) applyFilter(win);
        }

        function startSketchLoads(projects) {
          if (sketchLoadsStarted) return;
          sketchLoadsStarted = true;
          (projects || []).forEach((p) => {
            if (!p || p.id == null) return;
            ensureSketches(String(p.id), (sketches) => {
              if (sketches === null) unitListFailures++;
              else {
                enqueueUnits(sketches);
                enqueueAuthors(sketches);
              }
              renderGrid();
            });
          });
        }

        function onDialogPresent() {
          ensureProjects((projects) => {
            const table = document.querySelector('#comp_application_windows_tbl_wnd_splash_projects');
            if (!table || !table.querySelector('.ldscp-splash-grid')) renderGrid();
            startSketchLoads(projects);
          });
        }

        function isListRow(el) {
          return !!(el && el.classList && el.classList.contains(LISTROW_CLASS));
        }

        function expandAllLists() {
          if (!projectsCache) return;
          const box = document.getElementById('comp_application_windows_wnd_splash');
          if (!box) return;
          box.querySelectorAll('.ldscp-sqo-arrow').forEach((arrow) => {
            const row = arrow.closest('tr');
            if (!row) return;
            const projectId = matchProjectId(projectRowName(row), projectsCache);
            if (projectId == null) return;
            openList(row, projectId, arrow);
          });
        }

        function projectRowName(row) {
          const cell = row.querySelector('td');
          if (!cell) return '';
          const clone = cell.cloneNode(true);
          clone.querySelectorAll('.ldscp-sqo-arrow, .ldscp-sqo-list').forEach((el) => el.remove());
          return (clone.textContent || '').replace(/\s+/g, ' ').trim();
        }

        function setTableHeight(table, height) {
          if (!table || height < 160) return;
          table.style.height = height + 'px';
          const header = table.querySelector('.qxs_table_vertical_div_header');
          const body = table.querySelector('.qxs_table_vertical_div_body');
          const headerH = header ? header.offsetHeight : 22;
          if (body) {
            body.style.height = Math.max(120, height - headerH) + 'px';
            body.style.overflow = 'auto';
          }
          const overlay = table.querySelector('.qxs_table_overlay');
          if (overlay && table.querySelector('tbody.qxsTable_body > tr.qxsTable_tr td')) {
            overlay.style.display = 'none';
          }
        }

        function sizeWindow(win) {
          const maxW = Math.min(Math.floor(window.innerWidth * 0.92), 1280);
          const maxH = Math.min(Math.floor(window.innerHeight * 0.90), 960);
          const w = Math.max(760, maxW);
          win.style.width = w + 'px';
          win.style.marginLeft = (-Math.round(w / 2)) + 'px';
          win.style.left = '50%';
          win.style.top = '50%';

          const header = win.querySelector('.qxs_window_header');
          const buttons = win.querySelector('.qxs_window_buttons');
          const chrome = (header ? header.offsetHeight : 32) + (buttons ? buttons.offsetHeight : 42) + 8;
          const tabsH = Math.max(500, maxH - chrome);
          const tabs = win.querySelector('#comp_application_windows_tabs_wnd_splash');
          if (tabs) tabs.style.height = tabsH + 'px';

          const nameInp = win.querySelector('#comp_application_windows_inp_wnd_splash_name');
          const form = nameInp ? nameInp.parentNode : null;
          if (form && form.style) form.style.padding = '4px 10px';
          const search = win.querySelector('.ldscp-splash-search[data-kind="project"]');
          const formH = form && form.offsetHeight ? form.offsetHeight : 96;
          const searchH = search && search.offsetHeight ? search.offsetHeight : 28;
          const reserved = formH + searchH + 96;
          const tableH = Math.max(180, tabsH - reserved);
          setTableHeight(win.querySelector('#comp_application_windows_tbl_wnd_splash_projects'), tableH);
          setTableHeight(win.querySelector('#comp_application_windows_tbl_wnd_splash_processes'), tableH);

          const h = win.offsetHeight;
          if (h > 0) win.style.marginTop = (-Math.round(h / 2)) + 'px';
        }

        function searchWrap(win, kind) {
          return win.querySelector(`.ldscp-splash-search[data-kind="${kind}"]`);
        }

        function searchInput(win, kind) {
          const wrap = searchWrap(win, kind);
          return wrap ? wrap.querySelector('input') : null;
        }

        function searchCount(win, kind) {
          const wrap = searchWrap(win, kind);
          return wrap ? wrap.querySelector('.ldscp-splash-search-count') : null;
        }

        function injectSearch(win, tableId, kind, placeholder) {
          const table = win.querySelector(tableId);
          if (!table || !table.parentNode) return;
          if (searchWrap(win, kind)) return;
          const wrap = document.createElement('div');
          wrap.className = 'ldscp-splash-search';
          wrap.dataset.kind = kind;
          const input = document.createElement('input');
          input.type = 'search';
          input.placeholder = placeholder;
          input.autocomplete = 'off';
          input.spellcheck = false;
          const count = document.createElement('span');
          count.className = 'ldscp-splash-search-count';
          wrap.appendChild(input);
          wrap.appendChild(count);
          if (kind === 'project') {
            const sel = document.createElement('select');
            sel.className = 'ldscp-splash-sort';
            [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z']].forEach(([value, label]) => {
              const opt = document.createElement('option');
              opt.value = value;
              opt.textContent = label;
              sel.appendChild(opt);
            });
            sel.value = 'newest';
            sel.addEventListener('change', () => renderGrid());
            wrap.appendChild(sel);
            const view = document.createElement('div');
            view.className = 'ldscp-splash-view';
            view.setAttribute('role', 'group');
            view.setAttribute('aria-label', 'Project view');
            [['list', 'List'], ['grid', 'Grid']].forEach(([mode, label]) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.dataset.view = mode;
              button.textContent = label;
              button.setAttribute('aria-pressed', String(viewMode === mode));
              button.addEventListener('click', (event) => {
                event.stopPropagation();
                setView(mode);
              });
              // Keep the host's canvas shortcuts out of native button activation.
              button.addEventListener('keydown', (event) => event.stopPropagation());
              button.addEventListener('keyup', (event) => event.stopPropagation());
              view.appendChild(button);
            });
            wrap.appendChild(view);
          }
          table.parentNode.insertBefore(wrap, table);
          input.addEventListener('keydown', (e) => e.stopPropagation());
          input.addEventListener('keyup', (e) => e.stopPropagation());
          input.addEventListener('keypress', (e) => e.stopPropagation());
          input.addEventListener('input', () => applyFilter(win));
        }

        function textMatches(text, q) {
          return !q || String(text || '').toLowerCase().indexOf(q) !== -1;
        }

        function filterProcessRows(win, q) {
          const table = win.querySelector('#comp_application_windows_tbl_wnd_splash_processes');
          const countEl = searchCount(win, 'process');
          if (!table) return;
          const rows = table.querySelectorAll('tbody.qxsTable_body > tr.qxsTable_tr');
          let shown = 0;
          rows.forEach((row) => {
            const match = !q || textMatches(row.textContent, q);
            if (q) row.style.display = match ? '' : 'none';
            else if (row.style.display === 'none') row.style.display = '';
            if (match) shown++;
          });
          if (countEl) countEl.textContent = rows.length ? `${shown} / ${rows.length}` : '';
        }

        function sketchNamesForRow(row) {
          const names = [];
          const list = row.querySelector('.ldscp-sqo-list');
          if (list) {
            list.querySelectorAll('.ldscp-sqo-name').forEach((el) => {
              names.push((el.textContent || '').trim());
            });
          }
          const pid = matchProjectId(projectRowName(row), projectsCache || []);
          if (pid != null && sketchCache.has(pid)) {
            (sketchCache.get(pid) || []).forEach((sk) => {
              const entry = formatSketchEntry(sk);
              if (!names.includes(entry.name)) names.push(entry.name);
            });
          }
          return names;
        }

        function filterProjectRows(win, q) {
          const pair = q.includes(';') ? q.split(';').map(part => part.trim().toLowerCase()) : null;
          const table = win.querySelector('#comp_application_windows_tbl_wnd_splash_projects');
          const countEl = searchCount(win, 'project');
          if (!table) return;
          const cards = table.querySelectorAll('.ldscp-splash-card');
          if (cards.length) {
            let shown = 0;
            cards.forEach((card) => {
              const name = card.dataset.projectName || '';
              const items = Array.from(card.querySelectorAll('.ldscp-sqo-item'));
              const nameHit = !pair && textMatches(name, q);
              const itemMatches = (item) => pair
                ? pair.length === 2 && !!pair[0] && !!pair[1] &&
                  (unitPairs.get(item.dataset.sketchId) || []).some(value =>
                    value.unitId === pair[0] && value.elementId.includes(pair[1]))
                : textMatches(item.textContent, q)
                  || textMatches(unitIndex.get(item.dataset.sketchId) || '', q);
              const sketchHit = items.some(itemMatches);
              const match = !q || nameHit || sketchHit;
              card.style.display = match ? '' : 'none';
              if (match) shown++;
              items.forEach((item) => {
                const itemHit = itemMatches(item);
                item.style.display = (!q || nameHit || itemHit) ? '' : 'none';
                if (q && itemHit) item.classList.add('ldscp-splash-hit');
                else item.classList.remove('ldscp-splash-hit');
              });
            });
            if (countEl) {
              countEl.textContent = `${shown} / ${cards.length} · ${unitSearchStatus()}`;
              countEl.title = 'Searches saved direct unit bindings. Use unit_id;element_id for an exact unit ID and a partial element ID on the same binding. Results are incomplete while loading or if unreadable. Reopen Get started to refresh or retry. Units inside reusable processes are not included.';
            }
            return;
          }
          const rows = table.querySelectorAll('tbody.qxsTable_body > tr.qxsTable_tr');
          let shown = 0;
          rows.forEach((row) => {
            const name = projectRowName(row);
            const sketches = sketchNamesForRow(row);
            const nameHit = !pair && textMatches(name, q);
            const sketchHit = !pair && sketches.some((s) => textMatches(s, q));
            const match = !q || nameHit || sketchHit;
            if (q) row.style.display = match ? '' : 'none';
            else if (row.style.display === 'none') row.style.display = '';
            if (match) shown++;
          });
          if (countEl) countEl.textContent = rows.length ? `${shown} / ${rows.length}` : '';
        }

        function applyFilter(win) {
          const projectInput = searchInput(win, 'project');
          const processInput = searchInput(win, 'process');
          const projectQ = projectInput ? String(projectInput.value || '').trim().toLowerCase() : '';
          const processQ = processInput ? String(processInput.value || '').trim().toLowerCase() : '';
          filterProjectRows(win, projectQ);
          filterProcessRows(win, processQ);
        }

        let splashSized = false;

        function enhanceSplash(justOpened) {
          const win = document.getElementById('comp_application_windows_wnd_splash');
          if (!win) return;
          injectSearch(win, '#comp_application_windows_tbl_wnd_splash_projects', 'project', 'Filter projects, sketches or units…');
          injectSearch(win, '#comp_application_windows_tbl_wnd_splash_processes', 'process', 'Filter processes…');
          if (justOpened) {
            splashSized = false;
            const pIn = searchInput(win, 'project');
            const rIn = searchInput(win, 'process');
            if (pIn) pIn.value = '';
            if (rIn) rIn.value = '';
          }
          if (!splashSized) {
            sizeWindow(win);
            splashSized = true;
          }
          applyFilter(win);
        }

        function ensureSketches(projectId, cb) {
          if (sketchCache.has(projectId)) { cb(sketchCache.get(projectId)); return; }
          if (sketchWaiters.has(projectId)) { sketchWaiters.get(projectId).push(cb); return; }
          const requestSession = session;
          sketchWaiters.set(projectId, [cb]);
          const finish = (sketches) => {
            if (requestSession !== session) return;
            const waiters = sketchWaiters.get(projectId);
            sketchWaiters.delete(projectId);
            const arr = Array.isArray(sketches) ? sketches : null;
            if (arr) sketchCache.set(projectId, arr);
            waiters.forEach((callback) => callback(arr));
          };
          try {
            W.logic_designer_manager.load_sketch_list(projectId, finish);
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] SketchQuickOpen load_sketch_list failed:`, err);
            if (sketchWaiters.has(projectId) && requestSession === session) finish(null);
          }
        }

        function buildList(projectId, sketches) {
          const list = document.createElement('div');
          list.className = 'ldscp-sqo-list';
          if (sketches === null) {
            const e = document.createElement('div');
            e.className = 'ldscp-sqo-error';
            e.textContent = 'Failed to load sketches.';
            list.appendChild(e);
            return list;
          }
          if (sketches.length === 0) {
            const e = document.createElement('div');
            e.className = 'ldscp-sqo-empty';
            e.textContent = '(no sketches)';
            list.appendChild(e);
            return list;
          }
          sketches.forEach((sk) => {
            const entry = formatSketchEntry(sk);
            const item = document.createElement('div');
            item.className = 'ldscp-sqo-item';
            item.dataset.sketchId = entry.id;
            item.title = 'Open sketch';
            const nameEl = document.createElement('span');
            nameEl.className = 'ldscp-sqo-name';
            nameEl.textContent = entry.name;
            const metaEl = document.createElement('span');
            metaEl.className = 'ldscp-sqo-meta';
            const day = (d) => d.split(' ')[0];
            metaEl.appendChild(document.createTextNode(`chg ${day(entry.changed)}`));
            const authorEl = document.createElement('span');
            authorEl.className = 'ldscp-sqo-author';
            const who = sketchAuthors.get(entry.id);
            authorEl.textContent = who ? ` by ${who}` : '';
            metaEl.appendChild(authorEl);
            metaEl.appendChild(document.createTextNode(` · dep ${day(entry.deployed)}`));
            item.title = `${entry.name}  chg ${day(entry.changed)} · dep ${day(entry.deployed)}`;
            item.appendChild(nameEl);
            item.appendChild(metaEl);
            item.addEventListener('click', (e) => {
              e.stopPropagation();
              e.preventDefault();
              openSketch(projectId, entry.id);
            });
            list.appendChild(item);
          });
          return list;
        }

        // Wrap the list div in a <tr><td colspan> so it's a valid sibling row
        // of the project <tr> (a bare <div> can't sit between table rows).
        function makeListRow(row, list) {
          const tr = document.createElement('tr');
          tr.className = LISTROW_CLASS;
          const td = document.createElement('td');
          td.colSpan = row.cells ? row.cells.length || 1 : 1;
          td.appendChild(list);
          tr.appendChild(td);
          return tr;
        }

        function cellList(row) {
          return row.querySelector('td > .ldscp-sqo-list');
        }

        function openList(row, projectId, arrow) {
          if (cellList(row)) {
            arrow.classList.add('ldscp-sqo-open');
            return;
          }
          arrow.classList.add('ldscp-sqo-open');
          ensureSketches(projectId, (sketches) => {
            if (!row.isConnected || !arrow.isConnected || !arrow.classList.contains('ldscp-sqo-open')) return;
            if (cellList(row)) return;
            const cell = row.querySelector('td');
            if (!cell) return;
            cell.appendChild(buildList(projectId, sketches));
            const win = document.getElementById('comp_application_windows_wnd_splash');
            if (win) applyFilter(win);
          });
        }

        function toggleList(row, projectId, arrow) {
          const existing = cellList(row);
          if (arrow.classList.contains('ldscp-sqo-open')) {
            if (existing) existing.remove();
            if (isListRow(row.nextElementSibling)) row.nextElementSibling.remove();
            arrow.classList.remove('ldscp-sqo-open');
            return;
          }
          openList(row, projectId, arrow);
        }

        // Real click (mousedown→mouseup→click) on a host element. The qxs
        // widgets bind on these events; a bare .click() sometimes isn't enough.
        function fireClick(el) {
          if (!el) return false;
          // No `view:` — under the userscript sandbox `window` isn't the real
          // Window MouseEvent accepts, and it's optional for click dispatch.
          for (const type of ['mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
          }
          return true;
        }

        // Hover an element (qxs top-menus open their dropdown on hover, not click).
        function fireHover(el) {
          if (!el) return false;
          for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
          }
          return true;
        }

        // Poll up to ~tries*delayMs for fn() to return truthy, then cb(result|null).
        function pollFor(fn, cb, tries = 40, delayMs = 50) {
          const r = fn();
          if (r) { cb(r); return; }
          if (tries <= 0) { cb(null); return; }
          setTimeout(() => pollFor(fn, cb, tries - 1, delayMs), delayMs);
        }

        // Find a clickable element by visible text within a scope (default: document).
        function findByText(text, selector, scope) {
          const root = scope || document;
          const re = new RegExp(`^\\s*${text}\\s*$`, 'i');
          return Array.from(root.querySelectorAll(selector))
            .find((el) => re.test(el.textContent || el.value || '')) || null;
        }

        function openSketch(projectId, sketchId) {
          ensureProjects((projects) => {
            const project = projects.find((p) => String(p.id) === String(projectId));
            if (!project) { toast('Sketch open: project not found.', 'error'); return; }
            const app = W.application;
            const windows = W.application_windows;
            const hadOpenSketch = app.current_sketch != null
              || (W.logic_designer?.paper?.parsed_elements?.length ?? 0) > 0;
            const configuration = windows.dd_wnd_splash_configuration.get_value();
            if (configuration == null || configuration === '-') {
              toast('Please select a configuration.', 'error');
              return;
            }
            // Same state changes as the host's splash OK handler, using the
            // clicked project's identity instead of its stale table selection.
            // Read the clean name from RPC data; get_cell() includes our arrow HTML.
            app.current_configuration_library = configuration;
            W.core.settings.set('current_configuration_library', configuration);
            app.current_project = project.id;
            app.current_project_name = project.name;
            app.startup(() => {
              clearCaches();
              windows.wnd_splash.hide();
              if (sketchId != null) openLoadDialog(sketchId);
              else if (hadOpenSketch) openNewSketch();
            });
          });
        }

        function openNewSketch() {
          pollFor(
            () => findByText('File', '.iw_oc_menu_top_level, .iw_oc_menu_level'),
            (fileMenu) => {
              if (!fileMenu) { toast('New sketch: File menu not found.', 'error'); return; }
              fireHover(fileMenu); fireClick(fileMenu);
              pollFor(
                () => [...document.querySelectorAll('.iw_oc_menu_dropdown_item, [class*="dropdown_item"]')]
                  .find((el) => /^\s*new sketch\b/i.test(el.textContent || '') && el.offsetParent !== null),
                (newItem) => {
                  if (!newItem) { toast('New sketch: menu item not found.', 'error'); return; }
                  fireClick(newItem);
                }
              );
            }
          );
        }

        function openLoadDialog(sketchId) {
          // Keep the native sketch-load handler (composites, wires and alarms).
          // startup's callback runs after the host has rebuilt the File menu.
          // Open the File menu (qxs top-menus open on HOVER, not click), then
          // click its "Load Sketch" dropdown item (only in DOM once menu open).
          pollFor(
            () => findByText('File', '.iw_oc_menu_top_level, .iw_oc_menu_level'),
            (fileMenu) => {
              if (!fileMenu) { toast('Sketch open: File menu not found.', 'error'); return; }
              fireHover(fileMenu); fireClick(fileMenu);
              pollFor(
                () => Array.from(document.querySelectorAll('.iw_oc_menu_dropdown_item, [class*="dropdown_item"]'))
                  .find((el) => /load sketch/i.test(el.textContent || '') && el.offsetParent !== null),
                (loadItem) => {
                  if (!loadItem) { toast('Sketch open: "Load Sketch" item not found.', 'error'); return; }
                  fireClick(loadItem);

                  pollFor(
                    () => {
                      const win = document.getElementById('comp_application_windows_wnd_load');
                      if (!win || win.offsetParent === null) return null;
                      const row = Array.from(win.querySelectorAll('tr.qxsTable_tr')).find((r) => {
                        const idCell = r.querySelector('td');
                        return idCell && idCell.textContent.trim() === String(sketchId);
                      });
                      return row ? { win, row } : null;
                    },
                    (found) => {
                      if (!found) { toast('Sketch open: row not found in Load dialog.', 'error'); return; }
                      // The qxs table binds selection on the <td>, not the <tr>
                      // (PROBE15: clicking a cell set qxsTable_td_selected). Click
                      // the id cell so the dialog records the selected sketch.
                      const cell = found.row.querySelector('td') || found.row;
                      fireClick(cell);
                      // Verify the host selected this sketch before confirming.
                      pollFor(
                        () => {
                          const table = W.application_windows.tbl_wnd_load;
                          const selected = table.get_selected();
                          return selected != null && String(table.get_user(selected)) === String(sketchId);
                        },
                        (selected) => {
                          if (!selected) { toast('Sketch open: sketch selection failed.', 'error'); return; }
                          const okBtn = findByText('Ok', 'button.qxs_button_container, button', found.win);
                          if (!okBtn) { toast('Sketch open: Load-dialog Ok not found.', 'error'); return; }
                          fireClick(okBtn); // host runs the full native open
                        },
                        4, 30
                      );
                    }
                  );
                }
              );
            }
          );
        }

        function install() {
          const box = document.getElementById('comp_application_windows_wnd_splash');
          if (!box || !W.logic_designer_manager) {
            // Wait for the reusable dialog without watching canvas mutations.
            setTimeout(install, 1000);
            return;
          }
          let wasVisible = false;
          let tick = 0;
          const observeOpts = { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] };
          const update = () => {
            const visible = dialogVisible();
            const justOpened = visible && !wasVisible;
            if (visible !== wasVisible) {
              wasVisible = visible;
              if (!visible) splashSized = false;
              clearCaches();
            }
            if (!visible) return;
            mo.disconnect();
            try {
              enhanceSplash(justOpened);
              onDialogPresent();
            } finally {
              mo.observe(box, observeOpts);
            }
          };
          const mo = new MutationObserver(() => {
            clearTimeout(tick);
            tick = setTimeout(update, 80);
          });
          mo.observe(box, observeOpts);
          window.addEventListener('resize', () => {
            const win = document.getElementById('comp_application_windows_wnd_splash');
            if (!win || !dialogVisible()) return;
            splashSized = false;
            sizeWindow(win);
            splashSized = true;
          });
          update();
        }

        return { install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  AlarmHighlight — flash the block a "Virtual Values alarms" line
      //  refers to. Alarm token VV_<proj>_<sketch>:<pointer>:<line>; the
      //  <pointer> matches paper.elements[ref].pointer (the canvas "(NN)"
      //  label). No host alarm RPC exists, so we scrape the dialog DOM and
      //  retain the list so the "Errors: N" pill can re-flash after the
      //  dialog is closed. Strictly read-only — no host state mutated.
      //  Probed DOM (live, 2026-06-29): the alarm dialog is
      //  div#comp_application_window_problems_tbl_wnd_vv_alarms — a "problems"
      //  window, NOT a qxs_comlayer and NOT a comp_application_windows_wnd_*.
      //  Its rows are tr.qxsTable_tr; each Message cell holds a
      //  VV_<proj>_<sketch>:<pointer>:<line> token.
      // ═══════════════════════════════════════════════════════════════
      const AlarmHighlight = (() => {
        const ALARM_DIALOG_ID = 'comp_application_window_problems_tbl_wnd_vv_alarms';
        // The .qxs_window ancestor whose inline style toggles display:none → shown.
        // Stable id (no random suffix); observing only this element's style attr
        // means we wake on dialog open/close, NOT on every host canvas redraw.
        const ALARM_WINDOW_ID = 'comp_application_window_problems_wnd_vv_alarms';
        const ROW_TOKEN_RE = /VV_\d+_\d+:\d+:\d+/;

        let lastAlarms = [];       // [{ pointer, line, rowEl }]
        let pillEl = null;         // the fixed "Errors: N" pill
        const activeOverlays = []; // outstanding flash <rect>s, for cleanup

        // The alarm dialog by its stable id. offsetParent guards visibility —
        // the element exists (hidden) when the dialog is closed.
        function findAlarmDialog() {
          const dlg = document.getElementById(ALARM_DIALOG_ID);
          return dlg && dlg.offsetParent !== null ? dlg : null;
        }

        // Scan for the element whose .pointer equals the alarm's middle
        // number. Linear over ~tens of blocks — no index needed.
        function refByPointer(pointer) {
          const els = W.logic_designer?.paper?.elements;
          if (!els) return null;
          for (const k in els) {
            if (els[k] && els[k].pointer === pointer) return k;
          }
          return null;
        }

        // Draw an auto-fading orange rect around the block's main shape.
        function drawBlockOutline(ref) {
          const el = W.logic_designer?.paper?.elements?.[ref];
          const main = el?.set?.items?.[0];
          const node = main?.node;
          if (!node) return null;
          const svg = node.ownerSVGElement;
          if (!svg) return null;
          let box;
          try { box = node.getBBox(); } catch { return null; }
          // getBBox() is in the shape's LOCAL coords (pre-transform); the block
          // is positioned by a transform on the shape (matrix.e/f). Add that
          // translation so the rect lands ON the block, not at the SVG origin —
          // same pattern as drawPinOverlay (m.e/f + local coord).
          const m = main.matrix;
          const tx = (m && typeof m.e === 'number') ? m.e : 0;
          const ty = (m && typeof m.f === 'number') ? m.f : 0;
          const pad = 6;
          const ns = 'http://www.w3.org/2000/svg';
          const rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', String(box.x + tx - pad));
          rect.setAttribute('y', String(box.y + ty - pad));
          rect.setAttribute('width', String(box.width + pad * 2));
          rect.setAttribute('height', String(box.height + pad * 2));
          rect.setAttribute('fill', 'none');
          rect.setAttribute('stroke', '#ffa500');
          rect.setAttribute('stroke-width', '3');
          rect.setAttribute('rx', '4');
          rect.style.pointerEvents = 'none';
          rect.style.transition = 'opacity 0.4s ease';
          svg.appendChild(rect);
          return rect;
        }

        function flash(ref) {
          if (ref == null) return;
          const rect = drawBlockOutline(ref);
          if (!rect) return;
          activeOverlays.push(rect);
          setTimeout(() => { rect.style.opacity = '0'; }, 1600);
          setTimeout(() => {
            rect.remove();
            const i = activeOverlays.indexOf(rect);
            if (i !== -1) activeOverlays.splice(i, 1);
          }, 2050);
        }

        function flashAll() {
          let missing = 0;
          for (const p of distinctPointers(lastAlarms)) {
            const ref = refByPointer(p);
            if (ref == null) { missing++; continue; }
            flash(ref);
          }
          if (missing > 0) {
            console.warn(`[${SCRIPT_NAME}] AlarmHighlight: ${missing} alarm block(s) not on this sketch.`);
          }
        }

        // Build lastAlarms from the open alarm dialog and wire each row to
        // flash its own block. Idempotent: rows already wired are skipped.
        function scrapeAlarms() {
          const dlg = findAlarmDialog();
          if (!dlg) return;
          const rows = Array.from(dlg.querySelectorAll('tr.qxsTable_tr'))
            .filter((tr) => ROW_TOKEN_RE.test(tr.textContent || ''));
          const next = [];
          for (const tr of rows) {
            const parsed = parseAlarmToken(tr.textContent);
            if (!parsed) continue;
            next.push({ ...parsed, text: tr.textContent.replace(/\s*Verify object\s*$/, '').trim(), rowEl: tr });
            if (!tr.querySelector('.ldscp-alarm-verify')) {
              const verify = document.createElement('button');
              verify.type = 'button';
              verify.className = 'ldscp-alarm-verify';
              verify.textContent = 'Verify object';
              verify.title = 'Review this block’s parameter bindings and replacements';
              verify.style.marginLeft = '8px';
              verify.addEventListener('click', (event) => {
                event.stopPropagation();
                const alarm = parseAlarmToken(tr.textContent);
                if (!alarm || !problems().some((item) => item.proj === alarm.proj
                  && item.sketch === alarm.sketch && item.pointer === alarm.pointer)) {
                  toast('Open the sketch referenced by this error before verifying its object.', 'error');
                  return;
                }
                const ref = refByPointer(alarm.pointer);
                const block = W.logic_designer?.paper?.elements?.[ref];
                if (!['PARAMV', 'WRITETOUNIT'].includes(block?.block_type)) {
                  flash(ref);
                  toast('This error is not a parameter binding. Review the highlighted block and its error message.', 'info');
                  return;
                }
                BindingTools.open({ pointer: alarm.pointer });
              });
              (tr.lastElementChild || tr).appendChild(verify);
            }
            if (tr.dataset.ldscpAlarm !== '1') {
              tr.dataset.ldscpAlarm = '1';
              tr.style.cursor = 'pointer';
              tr.addEventListener('click', () => { flash(refByPointer(parsed.pointer)); });
            }
          }
          lastAlarms = next;
          renderPill();
        }

        function renderPill() {
          // Count alarm ROWS (what the dialog lists), not distinct blocks —
          // two alarms on the same block should read "Errors: 2". flashAll still
          // de-dupes by pointer so a shared block only flashes once.
          const count = lastAlarms.length;
          if (count === 0) {
            if (pillEl) { pillEl.remove(); pillEl = null; }
            return;
          }
          if (!pillEl) {
            pillEl = document.createElement('div');
            pillEl.className = 'ldscp-alarm-pill';
            pillEl.title = 'Flash blocks referenced by Virtual Values alarms';
            const label = document.createElement('span');
            label.className = 'ldscp-alarm-pill-label';
            label.addEventListener('click', flashAll);
            const close = document.createElement('span');
            close.className = 'ldscp-alarm-pill-x';
            close.textContent = '×';
            close.title = 'Dismiss';
            close.addEventListener('click', (e) => {
              e.stopPropagation();
              lastAlarms = [];
              renderPill();
            });
            pillEl.appendChild(label);
            const verify = document.createElement('button');
            verify.type = 'button';
            verify.textContent = 'Verify objects';
            verify.title = 'Review parameter bindings in the current sketch';
            verify.addEventListener('click', (event) => { event.stopPropagation(); BindingTools.open(); });
            pillEl.appendChild(verify);
            pillEl.appendChild(close);
            document.body.appendChild(pillEl);
          }
          pillEl.querySelector('.ldscp-alarm-pill-label').textContent = `⚠ Errors: ${count}`;
        }

        function install() {
          // Observe ONLY the alarm window element's style attribute — it flips
          // display:none → shown on open. This avoids a page-wide observer that
          // would wake on every host canvas redraw. scrapeAlarms only runs when
          // the dialog is actually visible (findAlarmDialog guards on
          // offsetParent), so our own DOM writes can't loop it.
          const win = document.getElementById(ALARM_WINDOW_ID);
          if (!win) {
            // Not in the DOM yet — retry shortly (host builds dialogs lazily on
            // some loads). Bounded by the natural page lifetime; no busy loop.
            setTimeout(install, 1000);
            return;
          }
          const mo = new MutationObserver(() => {
            if (findAlarmDialog()) scrapeAlarms();
          });
          mo.observe(win, { attributes: true, attributeFilter: ['style'] });
        }

        function problems() {
          scrapeAlarms();
          const projectId = W.application?.current_project;
          const current = W.application?.current_sketch;
          const sketchId = (typeof current === 'object' ? current?.id ?? current?.sketch_id : current)
            ?? SketchInfoWidget.currentSketchId();
          if (projectId == null || (sketchId == null && !findAlarmDialog())) return [];
          return lastAlarms.filter((alarm) => String(alarm.proj) === String(projectId)
            && (sketchId == null || String(alarm.sketch) === String(sketchId)));
        }

        return { install, problems, outline: drawBlockOutline };
      })();

      // Visual overlays never change the host's selection, bindings or saved sketch.
      const VariableUsageHighlight = (() => {
        let clicked = null;
        let panel = null;
        let panelKey = '';
        let paintKey = '';
        let canvas = null;
        let overlays = [];
        const clearPaint = () => { for (const node of overlays) node.remove(); overlays = []; };
        function refresh() {
          if (document.hidden) return;
          const paper = W.logic_designer?.paper;
          if (!paper?.initialized) {
            clearPaint(); panel?.remove(); panel = null; clicked = null; paintKey = ''; return;
          }
          if (canvas !== paper.paper?.canvas) {
            clearPaint(); paintKey = ''; canvas = paper.paper?.canvas;
          }
          if (clicked && (clicked.paper !== paper || paper.elements[clicked.ref] !== clicked.block)) clicked = null;
          const entries = Object.entries(paper.elements).filter(([ref]) => /^\d+$/.test(ref));
          let family = [];
          if (clicked) {
            const pointer = clicked.block.block_type === 'VARIABLE_OUTPUT'
              ? clicked.block.pointer : clicked.block.data?.pointer;
            family = entries.filter(([, block]) =>
              (block.block_type === 'VARIABLE_OUTPUT' && String(block.pointer) === String(pointer))
              || (block.block_type === 'VARIABLE_INPUT' && pointer != null && String(block.data?.pointer) === String(pointer)))
              .sort((a, b) => (a[1].block_type === 'VARIABLE_OUTPUT' ? -1 : 1)
                - (b[1].block_type === 'VARIABLE_OUTPUT' ? -1 : 1) || Number(a[0]) - Number(b[0]));
          }
          const nextPanelKey = JSON.stringify(family.map(([ref, block]) => [ref, block.override?.alias_text]));
          if (nextPanelKey !== panelKey || (!panel && family.length)) {
            panelKey = nextPanelKey;
            panel?.remove(); panel = null;
            if (family.length) {
              panel = document.createElement('div');
              panel.style.cssText = 'position:fixed;bottom:16px;right:64px;z-index:99990;background:#fff;color:#222;border:1px solid #8b36c7;border-radius:6px;padding:10px;max-width:calc(100vw - 90px);max-height:150px;overflow:auto;font:13px sans-serif;box-shadow:0 2px 10px #0004';
              const heading = document.createElement('div');
              heading.textContent = 'Variable uses: ' + family.filter(([, b]) => b.block_type === 'VARIABLE_INPUT').length
                + ' input(s). Purple = linked; orange = selected. Click a button to find it.';
              panel.appendChild(heading);
              for (const [ref, block] of family) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = (block.block_type === 'VARIABLE_OUTPUT' ? 'Out ' : 'In ') + block.pointer;
                button.title = block.override?.alias_text || button.textContent;
                button.style.margin = '6px 5px 0 0';
                button.addEventListener('click', () => {
                  if (W.logic_designer?.paper !== paper || paper.elements[ref] !== block) return;
                  block.set?.items?.[0]?.node?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                });
                panel.appendChild(button);
              }
              const close = document.createElement('button');
              close.type = 'button'; close.textContent = 'Close';
              close.addEventListener('click', () => { clicked = null; refresh(); });
              panel.appendChild(close);
              document.body.appendChild(panel);
            }
          }
          const refs = new Map(family.map(([ref]) => [String(ref), 'linked']));
          for (const ref of HostAdapter.getSelection()) refs.set(String(ref), 'selected');
          const geometry = [...refs].map(([ref, kind]) => {
            const main = paper.elements[ref]?.set?.items?.[0];
            let box;
            try { box = main?.node?.getBBox(); } catch { /* block is rendering */ }
            return [ref, kind, box?.x, box?.y, box?.width, box?.height, main?.matrix?.e, main?.matrix?.f];
          });
          const key = JSON.stringify(geometry);
          if (key === paintKey && overlays.every((node) => node.isConnected)) return;
          paintKey = key;
          clearPaint();
          for (const [ref, kind] of refs) {
            const rect = AlarmHighlight.outline(ref);
            if (!rect) { paintKey = ''; continue; }
            rect.setAttribute('stroke', kind === 'selected' ? '#d65b00' : '#8b27c7');
            rect.setAttribute('stroke-width', '1.8');
            rect.setAttribute('stroke-opacity', '.95');
            rect.setAttribute('vector-effect', 'non-scaling-stroke');
            rect.setAttribute('fill', kind === 'selected' ? '#d65b00' : '#8b27c7');
            rect.setAttribute('fill-opacity', '.035');
            // Tighten the padding and draw below every SVG label, including neighbours.
            for (const attr of ['x', 'y']) rect.setAttribute(attr, String(Number(rect.getAttribute(attr)) + 3));
            for (const attr of ['width', 'height']) rect.setAttribute(attr, String(Math.max(0, Number(rect.getAttribute(attr)) - 6)));
            const svg = rect.ownerSVGElement;
            let firstText = svg.querySelector('text');
            while (firstText && firstText.parentNode !== svg) firstText = firstText.parentNode;
            svg.insertBefore(rect, firstText || svg.firstChild);
            overlays.push(rect);
          }
        }
        function install() {
          document.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            const paper = W.logic_designer?.paper;
            if (!paper?.paper?.canvas?.contains(event.target)) return;
            const ref = resolveBlockRefShared(event.target);
            const block = paper.elements?.[ref];
            clicked = ['VARIABLE_INPUT', 'VARIABLE_OUTPUT'].includes(block?.block_type)
              ? { paper, ref, block } : null;
            setTimeout(refresh, 0);
          }, true);
          setInterval(refresh, 150);
        }
        return { install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  FormulaDialogHelper — the host "Configure formula" dialog edits
      //  formulas in a single-line <input>. We wrap the host's opener,
      //  designer_windows.show_formula(block, data) (probed 2026-07-10:
      //  every open path routes through it), and swap the input
      //  #comp_designer_windows_inp_wnd_formula_formula for a synced
      //  multi-line monospace textarea. Edits mirror back through the
      //  component's own set_value(), so the Ok handler's get_value()
      //  reads exactly what was typed. A Verify button runs the same
      //  logic_designer_manager.verify_math RPC the Ok button runs —
      //  live validation without closing the dialog. Read-only helper;
      //  nothing is saved or synced by it.
      // ═══════════════════════════════════════════════════════════════
      const FormulaDialogHelper = (() => {
        const INPUT_ID = 'comp_designer_windows_inp_wnd_formula_formula';
        let verifyRevision = 0;

        // Full quick-reference shown by the "?" button. Contents verified
        // against the VV runtime implementation (2026-07-10): formulas are
        // interpreted as PHP expressions; function calls pass a
        // function_exists gate at deploy (any PHP function + the IWMAC helper
        // functions below). verify_math runs the same parser with that gate
        // disabled — hence "syntax only". Runtime failures raise
        // VIRTUAL_VALUES_FORMULA_ERROR alarms (visible in the Errors pill).
        const HELP_SECTIONS = [
          ['Inputs', 'inp0 … inpN (the block\'s input pins) · constants: true, false, null'],
          ['Functions', [
            'Any PHP function works: round, abs, min, max, floor, ceil, sqrt, pow, exp, log, time, date, strtotime, …',
            { text: 'Full list: php.net function index ↗', href: 'https://www.php.net/manual/en/indexes.functions.php' },
          ]],
          ['Operators', '+ - * / % · == != < <= > >= · a>b ? x : y · && || · (int) (float) casts'],
          ['Examples', [
            '(inp0 + inp1) / 2 — average of two inputs',
            'inp0 > 25 ? 1 : 0 — 1 when inp0 is above 25, else 0',
            'round(inp0 * 1.8 + 32, 1) — °C to °F with one decimal',
            'abs(time() - strtotime(inp0)) <= 150 ? 1 : 0 — 1 if timestamp inp0 is within 150 s of now',
            'date("H") >= 7 && date("H") < 23 ? 1 : 0 — 1 during daytime (07–23)',
            'alarm_delay(600, inp0) — alarm only after inp0 has held 1 for 10 minutes',
          ]],
          ['Watch out', [
            'Returning null (or false!) writes NOTHING — the output is skipped that cycle. Use cond ? 1048 : null for write-once gating; use 1 : 0 when you mean zero',
            '^ is bitwise XOR — use pow(x,y) for powers',
            'Unary minus only works on plain numbers — write 0-inp0, not -inp0',
            'No if(…) — use the ternary form: a>b ? x : y',
            'avg, sum, ln do not exist in PHP — Verify passes, but the plant raises a formula error alarm',
            'Decimal point, not comma (0.5, not 0,5)',
            'Verify checks syntax only — a wrong function name fails first at deploy (formula error alarm)',
          ]],
          ['IWMAC helpers', [
            'alarm_delay(sec, ref) — 1 once ref has held 1 for sec seconds (alarm on-delay)',
            'alarm_delay_min(min, ref) — same, delay in minutes',
            'alarm_multi_delay(ref, onSec, offSec) — separate on- and off-delays',
            'multi_delay(ref, delays) — general delayed output switching (advanced)',
            'check_value_higher(ref, limit, min) — 1 if the value stayed ≥ limit for the last min minutes',
            'check_value_lower(ref, limit, min) — 1 if it stayed ≤ limit for the last min minutes',
            'check_value_updated(sec, ref) — 1 if ref has NOT updated within sec seconds',
            'vv_event(name) — trigger event-driven lines in other VV threads',
          ]],
        ];

        let helpPopEl = null;

        function hostInput() {
          return document.getElementById(INPUT_ID);
        }

        function buildHelpPop() {
          const pop = document.createElement('div');
          pop.className = 'ldscp-formula-pop';
          for (const [title, body] of HELP_SECTIONS) {
            const h = document.createElement('div');
            h.className = 'ldscp-formula-pop-h';
            h.textContent = title;
            pop.appendChild(h);
            for (const line of (Array.isArray(body) ? body : [body])) {
              const d = document.createElement('div');
              d.className = 'ldscp-formula-pop-line';
              if (typeof line === 'object' && line.href) {
                const a = document.createElement('a');
                a.textContent = line.text;
                a.href = line.href;
                a.target = '_blank';
                a.rel = 'noopener';
                d.appendChild(a);
              } else {
                d.textContent = line;
              }
              pop.appendChild(d);
            }
          }
          // Clicks inside must not reach the document-level close listener.
          pop.addEventListener('click', (e) => e.stopPropagation());
          return pop;
        }

        function closeHelpPop() {
          if (helpPopEl) {
            helpPopEl.remove();
            helpPopEl = null;
          }
        }

        function toggleHelpPop(anchorBtn) {
          if (helpPopEl) { closeHelpPop(); return; }
          helpPopEl = buildHelpPop();
          document.body.appendChild(helpPopEl);
          const w = Math.min(420, window.innerWidth - 24);
          helpPopEl.style.width = `${w}px`;
          // Attach beside the Configure-formula dialog window — right side if
          // it fits, else left. Falls back to below the ? button if the dialog
          // element can't be found.
          const dlg = document.getElementById('comp_designer_windows_wnd_edit_formula');
          const dr = dlg?.getBoundingClientRect();
          let left; let top;
          if (dr && dr.width > 0) {
            top = Math.max(8, dr.top);
            left = (dr.right + 8 + w <= window.innerWidth - 8)
              ? dr.right + 8
              : Math.max(8, dr.left - w - 8);
          } else {
            const r = anchorBtn.getBoundingClientRect();
            left = Math.max(8, Math.min(r.left, window.innerWidth - w - 12));
            top = r.bottom + 6;
          }
          helpPopEl.style.left = `${left}px`;
          helpPopEl.style.top = `${Math.max(8, Math.min(top, window.innerHeight - helpPopEl.offsetHeight - 12))}px`;
          setTimeout(() => document.addEventListener('click', closeHelpPop, { once: true }), 0);
        }

        function currentInputCount() {
          // Same lookup the host's Ok handler uses.
          try {
            const blk = W.designer_windows?.current_block;
            if (blk == null) return 0;
            const inputs = W.logic_designer?.paper?.get_block_inputs?.(blk, true);
            return Array.isArray(inputs) ? inputs.length : 0;
          } catch {
            return 0;
          }
        }

        function flatten(v) {
          // The host parser sees one expression regardless of textarea wrapping.
          return v.replace(/\s*\n\s*/g, ' ').trim();
        }

        function mirror(v) {
          const flat = flatten(v);
          const comp = W.designer_windows?.inp_wnd_formula_formula;
          if (comp?.set_value) {
            comp.set_value(flat);
          } else {
            const input = hostInput();
            if (input) input.value = flat;
          }
        }

        function setStatus(ta, text, kind) {
          // Not ta.nextElementSibling — the funcs cheat-sheet sits between
          // the textarea and the status line.
          const helper = document.querySelector('div.ldscp-formula-helper');
          if (!helper) return;
          helper.textContent = text;
          helper.classList.toggle('ldscp-formula-helper-warn', kind === 'warn');
          helper.classList.toggle('ldscp-formula-helper-ok', kind === 'ok');
        }

        // Hints only: the server remains the PHP-expression syntax authority.
        function syntaxHint(text) {
          const stack = [];
          let quote = null, quoteStart = 0;
          const pairs = { ')': '(', ']': '[', '}': '{' };
          for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (quote) {
              if (ch === '\\') { i++; continue; }
              if (ch === quote) quote = null;
              continue;
            }
            if (ch === '"' || ch === "'") { quote = ch; quoteStart = i; continue; }
            if (text.startsWith('//', i) || ch === '#') {
              const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue;
            }
            if (text.startsWith('/*', i)) {
              const end = text.indexOf('*/', i + 2);
              if (end < 0) return { index: i, length: 2, message: 'Close this comment with */.' };
              i = end + 1; continue;
            }
            if ('“”‘’'.includes(ch)) return { index: i, length: 1, message: 'Use straight quotes (" or \u0027), not curly quotes.' };
            if (/[a-z_]/i.test(ch)) {
              const token = text.slice(i).match(/^[a-z_][a-z_0-9]*/i)[0];
              if (token.toLowerCase() === 'if' && /^\s*\(/.test(text.slice(i + token.length))) {
                return { index: i, length: token.length, message: 'Use condition ? valueIfTrue : valueIfFalse, for example inp0 > 25 ? 1 : 0.' };
              }
              i += token.length - 1; continue;
            }
            if ('([{'.includes(ch)) stack.push({ ch, index: i });
            else if (pairs[ch]) {
              if (stack.at(-1)?.ch !== pairs[ch]) return { index: i, length: 1, message: 'This closing bracket does not match its opening bracket.' };
              stack.pop();
            }
          }
          if (quote) return { index: quoteStart, length: 1, message: 'Close this quoted string with ' + quote + '.' };
          if (stack.length) {
            const opening = stack.at(-1);
            return { index: opening.index, length: 1, message: 'Missing closing bracket for this ' + opening.ch + '.' };
          }
          return null;
        }

        function showHint(ta, hint, prefix = '') {
          const before = ta.value.slice(0, hint.index);
          const line = before.split('\n').length;
          const column = hint.index - before.lastIndexOf('\n');
          setStatus(ta, `${prefix}Hint — line ${line}, column ${column}: ${hint.message} `, 'warn');
          const helper = document.querySelector('div.ldscp-formula-helper');
          if (!helper) return;
          const locate = document.createElement('button');
          locate.type = 'button'; locate.textContent = 'Show in formula';
          locate.addEventListener('click', (event) => {
            event.preventDefault(); event.stopPropagation();
            ta.focus(); ta.setSelectionRange(hint.index, hint.index + hint.length);
            const height = parseFloat(getComputedStyle(ta).lineHeight) || 18;
            ta.scrollTop = Math.max(0, (line - 2) * height);
          });
          helper.appendChild(locate);
        }

        function refreshHelper(ta) {
          const hint = syntaxHint(ta.value);
          if (hint) { showHint(ta, hint); return; }
          const count = Number(ta.dataset.ldscpInputs || 0);
          const names = count > 0
            ? [...Array(count).keys()].map((i) => `inp${i}`).join(', ')
            : 'inp0, inp1, …';
          const bad = [];
          if (count > 0) {
            for (const m of ta.value.matchAll(/inp(\d+)/g)) {
              const n = Number(m[1]);
              if (n >= count && !bad.includes(`inp${n}`)) bad.push(`inp${n}`);
            }
          }
          if (bad.length > 0) {
            setStatus(ta, `⚠ ${bad.join(', ')} not on this block — available: ${names}`, 'warn');
          } else {
            setStatus(ta, `Inputs: ${names}`, '');
          }
        }

        function verifyNow(ta) {
          const revision = ++verifyRevision;
          const original = ta.value;
          const count = Number(ta.dataset.ldscpInputs || 0);
          const mgr = W.logic_designer_manager;
          if (!mgr?.verify_math) {
            setStatus(ta, 'Verify unavailable (no logic_designer_manager).', 'warn');
            return;
          }
          setStatus(ta, 'Verifying…', '');
          try {
            mgr.verify_math(flatten(original), Math.max(count, 1), (reply, error) => {
              if (revision !== verifyRevision || !ta.isConnected || ta.value !== original) return;
              if (reply && reply.ok === true && reply.data === true) {
                // verify_math is syntax-only; the nuance lives in the "?" popup.
                setStatus(ta, '✓ Syntax OK.', 'ok');
              } else {
                const msg = (reply && reply.message) || String(error || 'invalid');
                const prefix = `✗ ${msg} (The server checks one flattened line.) `;
                let hint = syntaxHint(original);
                // A unique literal unexpected token gives a useful place to look,
                // but the actual mistake can be immediately before that token.
                const token = String(msg).match(/unexpected\s+(?:token\s+)?["']([^"']+)["']/i)?.[1];
                if (!hint && token) {
                  const index = original.indexOf(token);
                  if (index >= 0 && original.indexOf(token, index + 1) < 0) {
                    hint = { index, length: token.length, message: 'Check this token and the expression before it: missing operator, comma, or bracket?' };
                  }
                }
                if (hint) showHint(ta, hint, prefix);
                else setStatus(ta, prefix + 'Check matching brackets, operators between values, commas between function arguments, and both ? and : in conditional expressions. Use ? for examples.', 'warn');
              }
            });
          } catch (err) {
            setStatus(ta, `✗ Verify failed: ${err.message}`, 'warn');
          }
        }

        function enhance() {
          const input = hostInput();
          if (!input) return;

          let ta = document.querySelector('textarea.ldscp-formula-ta');
          if (!ta) {
            ta = document.createElement('textarea');
            ta.className = 'ldscp-formula-ta';
            ta.rows = 4;
            ta.spellcheck = false;
            if (input.offsetWidth > 0) ta.style.width = `${input.offsetWidth}px`;
            // One short line; the "?" popup carries the full reference.
            const funcs = document.createElement('div');
            funcs.className = 'ldscp-formula-funcs';
            const funcsText = document.createElement('span');
            funcsText.textContent = 'ƒ Runs as PHP — any PHP function + IWMAC helpers ';
            const helpBtn = document.createElement('button');
            helpBtn.type = 'button';
            helpBtn.className = 'ldscp-formula-help-btn';
            helpBtn.textContent = '?';
            helpBtn.title = 'Formula quick reference';
            helpBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleHelpPop(helpBtn);
            });
            funcs.appendChild(funcsText);
            funcs.appendChild(helpBtn);
            const helper = document.createElement('div');
            helper.className = 'ldscp-formula-helper';
            helper.setAttribute('role', 'status');
            const verifyBtn = document.createElement('button');
            verifyBtn.type = 'button';
            verifyBtn.className = 'ldscp-formula-verify';
            verifyBtn.textContent = 'Verify';
            verifyBtn.title = 'Check the formula on the server (same check as Ok) without closing the dialog';
            verifyBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              verifyNow(ta);
            });
            ta.addEventListener('input', () => {
              verifyRevision++;
              mirror(ta.value);
              refreshHelper(ta);
            });
            // Keep Enter/keys in the textarea away from host shortcut handlers.
            ta.addEventListener('keydown', (e) => e.stopPropagation());
            input.insertAdjacentElement('afterend', ta);
            ta.insertAdjacentElement('afterend', funcs);
            funcs.insertAdjacentElement('afterend', helper);
            helper.insertAdjacentElement('afterend', verifyBtn);
            input.style.display = 'none';
          }

          // (Re)sync for this open: host's show_formula already prefilled the
          // input via set_value before our wrapper runs.
          ta.value = input.value;
          verifyRevision++;
          ta.dataset.ldscpInputs = String(currentInputCount());
          refreshHelper(ta);
        }

        function install() {
          const dw = W.designer_windows;
          if (!dw || typeof dw.show_formula !== 'function') {
            // Host not ready yet — retry; harmless if it never appears.
            setTimeout(install, 1000);
            return;
          }
          const orig = dw.show_formula;
          dw.show_formula = function (block, data) {
            const result = orig.apply(this, arguments);
            try {
              enhance();
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] FormulaDialogHelper enhance failed:`, err);
            }
            return result;
          };
        }

        return { install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  SketchInfoWidget — compact pill in the top bar (left of the
      //  IWMAC logo / green stream indicator) showing the open sketch's
      //  last-saved and last-deployed dates, plus who, from
      //  load_history_list. Click for the recent history entries.
      //  Ids are captured by wrapping load_sketch (no global holds the
      //  current sketch id — probed 2026-07-10); save_sketch's callback
      //  is wrapped to auto-refresh. STRICTLY READ-ONLY: only load_*
      //  RPCs are called, never revert/save/publish.
      // ═══════════════════════════════════════════════════════════════
      const SketchInfoWidget = (() => {
        let pillEl = null;
        let listEl = null;
        let current = null; // { sketchId, projectId, name }
        let state = {};     // { savedDate, deployDate, who, hist }
        let loggedSample = false;

        const short = (d) => (typeof d === 'string' && d.length >= 16) ? d.slice(0, 16) : (d || '—');

        const fieldWho = historyAuthor;

        function fieldDate(entry) {
          for (const v of Object.values(entry || {})) {
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
          }
          return null;
        }

        function render() {
          if (!pillEl) {
            pillEl = document.createElement('div');
            pillEl.className = 'ldscp-sketchinfo';
            pillEl.title = 'Last saved / last deployed (click for history)';
            pillEl.addEventListener('click', toggleHistory);
            document.body.appendChild(pillEl);
          }
          const who = state.who ? ` by ${state.who}` : '';
          const n = state.hist?.length;
          pillEl.textContent = `💾 ${short(state.savedDate)}${who} · 🚀 ${short(state.deployDate)}`
            + (n ? ` · 🕘${n}` : '');
        }

        function closeList() {
          if (listEl) {
            listEl.remove();
            listEl = null;
          }
        }

        function toggleHistory(e) {
          e.stopPropagation();
          if (listEl) { closeList(); return; }
          listEl = document.createElement('div');
          listEl.className = 'ldscp-sketchinfo-list';
          const hist = state.hist || [];
          if (hist.length === 0) {
            listEl.textContent = 'No history entries.';
          } else {
            for (const h of hist.slice(0, 12)) {
              const row = document.createElement('div');
              const date = fieldDate(h);
              const who = fieldWho(h);
              // One extra string field (comment/label), if the entry has one.
              const extra = Object.values(h).find((v) =>
                typeof v === 'string' && v && v !== date && v !== who
                && !/^\d+$/.test(v) && !/^\d{4}-\d{2}-\d{2}/.test(v));
              row.textContent = `${short(date)} — ${who || '?'}${extra ? ' — ' + extra : ''}`;
              listEl.appendChild(row);
            }
          }
          document.body.appendChild(listEl);
          setTimeout(() => document.addEventListener('click', closeList, { once: true }), 0);
        }

        function refresh() {
          if (!current) return;
          const M = W.logic_designer_manager;
          if (!M) return;
          state = {};
          closeList();
          if (current.projectId != null) {
            try {
              M.load_sketch_list(String(current.projectId), (list) => {
                const e = Array.isArray(list)
                  ? list.find((s) => String(s.id) === String(current.sketchId)) : null;
                if (!e) return;
                state.savedDate = e.date;
                state.deployDate = e.compile_date;
                render();
              });
            } catch (err) {
              console.error(`[${SCRIPT_NAME}] SketchInfoWidget sketch_list failed:`, err);
            }
          }
          try {
            M.load_history_list(String(current.sketchId), (hist) => {
              state.hist = Array.isArray(hist) ? hist : [];
              state.who = fieldWho(state.hist[0]);
              if (!loggedSample && state.hist[0]) {
                loggedSample = true;
                console.debug(`[${SCRIPT_NAME}] history_list sample entry:`, state.hist[0]);
              }
              render();
            });
          } catch (err) {
            console.error(`[${SCRIPT_NAME}] SketchInfoWidget history_list failed:`, err);
          }
        }

        function install() {
          const M = W.logic_designer_manager;
          if (!M || typeof M.load_sketch !== 'function') {
            setTimeout(install, 1000);
            return;
          }
          const origLoad = M.load_sketch;
          M.load_sketch = function (id, cb) {
            return origLoad.call(this, id, function (env) {
              try {
                const o = typeof env === 'string' ? JSON.parse(env) : env;
                current = {
                  sketchId: o?.sketch_id ?? id,
                  projectId: o?.project_id ?? null,
                  name: o?.sketch_name ?? '',
                };
              } catch {
                current = { sketchId: id, projectId: null, name: '' };
              }
              setTimeout(refresh, 500);
              return cb.apply(this, arguments);
            });
          };
          if (typeof M.save_sketch === 'function') {
            const origSave = M.save_sketch;
            M.save_sketch = function (...args) {
              const last = args.length - 1;
              if (typeof args[last] === 'function') {
                const scb = args[last];
                args[last] = function () {
                  setTimeout(refresh, 800);
                  return scb.apply(this, arguments);
                };
              } else {
                setTimeout(refresh, 1500);
              }
              return origSave.apply(this, args);
            };
          }
        }

        return { install, currentSketchId: () => current?.sketchId ?? null };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  UploadAutoSelect — when the host Upload Manager opens, tick the
      //  sketch that is loaded on the canvas (once per opening; the user
      //  can untick). Only ticks the checkbox through its own onchange →
      //  on_checkbox_change, exactly like a click. NEVER presses Upload.
      //  Rows: tbl_wnd_upload_manager_sketches.get_user(i) =
      //  { sketch_id, plant_id } (row 0 = plant group header → null).
      //  ponytail: 1s visibility poll, an observer if the delay annoys.
      // ═══════════════════════════════════════════════════════════════
      const UploadAutoSelect = (() => {
        const WIN_ID = 'comp_application_window_upload_manager_wnd_upload_manager';
        let done = false;

        function tick() {
          const win = document.getElementById(WIN_ID);
          if (!win || win.offsetParent === null) { done = false; return; }
          if (done) return;
          const id = SketchInfoWidget.currentSketchId();
          const t = W.application_window_upload_manager?.tbl_wnd_upload_manager_sketches;
          if (id == null || !t) return;
          const n = t.get_row_count();
          for (let i = 0; i < n; i++) {
            if (String(t.get_user(i)?.sketch_id) !== String(id)) continue;
            const cb = document.getElementById(`tbl_wnd_upload_manager_sketches_checkbox_${i}_0`)
              || t.get_cell_dom?.(i, 0)?.querySelector('input[type=checkbox]');
            if (!cb) return; // row there, checkbox not rendered yet — retry next tick
            done = true;
            cb.scrollIntoView({ block: 'center' });
            if (!cb.checked) {
              cb.checked = true;
              cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }
        }

        function install() {
          setInterval(() => {
            try { tick(); } catch (err) { console.error(`[${SCRIPT_NAME}] UploadAutoSelect:`, err); }
          }, 1000);
        }

        return { install };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  TypeColorMode — recolor wires (stroke) and block bodies (fill)
      //  by resolved type (bool / int / float / string, distinct colors).
      //  Launcher-menu toggle cycles off → wires only → wires + blocks;
      //  the chosen mode persists per user (GM storage). Purely visual:
      //  inline styles only, everything restored on toggle-off. Untyped
      //  blocks/wires keep their original look. ponytail: a 1.5s repaint
      //  interval + post-interaction quick repaint cover moved blocks,
      //  new wires and host select/deselect fill-wipes.
      // ═══════════════════════════════════════════════════════════════
      const TypeColorMode = (() => {
        const PREF_KEY = 'ldscp:typecolors:v1'; // 'off' | 'wires' | 'full' (older builds stored a boolean)
        let mode = 'off';
        let running = false;
        let timer = null;
        let legendEl = null;

        function persistPref() {
          try { GM_setValue(PREF_KEY, mode); } catch { /* ignore */ }
        }

        const TYPES = [
          { re: /bool/i, color: '#9b5de5', label: 'bool' },
          { re: /int/i, color: '#1d7fd6', label: 'int' },
          { re: /float|double|real|analog/i, color: '#2a9d34', label: 'float' },
          { re: /string|text/i, color: '#f77f00', label: 'string' },
        ];

        function colorFor(outputType) {
          // Probed shapes: a string ('boolean', 'mixed') OR an array of
          // possible types (['integer'], ['integer','float'], all four for
          // pass-through blocks). Only a single definite type maps directly;
          // multi-type / 'mixed' return null (callers infer via inputs).
          let t = outputType;
          if (Array.isArray(t)) {
            if (t.length !== 1) return null;
            t = t[0];
          }
          t = String(t ?? '');
          if (!t || /mixed/i.test(t)) return null;
          for (const ty of TYPES) {
            if (ty.re.test(t)) return ty.color;
          }
          return null;
        }

        function configuredColor(el) {
          // Blocks like CONST declare ALL types in output_type; the actually
          // configured type (dialog "Input type"/"Output type") lives in the
          // block's data. Known field names first, then any data value that
          // IS a type name (accepts the rare false hit of a string constant
          // whose literal value is e.g. "float").
          const d = el?.data;
          if (!d || typeof d !== 'object') return null;
          for (const cand of [d.input_type, d.output_type, d.type, d.data_type]) {
            const c = colorFor(cand);
            if (c) return c;
          }
          for (const v of Object.values(d)) {
            if (typeof v === 'string' && /^(boolean|integer|float|string)$/i.test(v)) {
              return colorFor(v);
            }
          }
          return null;
        }

        function effectiveColor(ref, seen = new Set()) {
          // Resolution order: definite declared output_type → configured type
          // in block data (CONST, configured Selector) → trace the
          // bottom-most CONNECTED input's source, recursively (pass-through
          // blocks: the VALUE arrives on the bottom input — user-confirmed
          // for If; pin order = input index order). `seen` guards wire cycles.
          const paper = W.logic_designer?.paper;
          const el = paper?.elements?.[ref];
          if (!el || seen.has(ref)) return null;
          seen.add(ref);
          const own = colorFor(el.output_type);
          if (own) return own;
          const conf = configuredColor(el);
          if (conf) return conf;
          if (!Array.isArray(el.inputs)) return null;
          for (let i = el.inputs.length - 1; i >= 0; i--) {
            const inp = el.inputs[i];
            if (inp?.connected && typeof inp.connected_to?.ref === 'number') {
              return effectiveColor(inp.connected_to.ref, seen);
            }
          }
          return null;
        }

        function paintWires() {
          const paper = W.logic_designer?.paper;
          if (!paper?.connections) return;
          for (const c of paper.connections) {
            const node = c?.line?.node;
            if (!node) continue;
            const color = effectiveColor(c?.user?.source);
            if (!color) continue;
            if (!node.dataset.ldscpTypePrev) {
              node.dataset.ldscpTypePrev = node.style.stroke || '-';
            }
            node.style.stroke = color;
          }
        }

        function unpaintWires() {
          for (const node of document.querySelectorAll('[data-ldscp-type-prev]')) {
            const prev = node.dataset.ldscpTypePrev;
            node.style.stroke = prev === '-' ? '' : prev;
            delete node.dataset.ldscpTypePrev;
          }
        }

        function unpaintNode(node) {
          const prev = node.dataset.ldscpTypePrevFill;
          if (prev === undefined) return;
          node.style.fill = prev === '-' ? '' : prev;
          delete node.dataset.ldscpTypePrevFill;
        }

        function paintBlocks() {
          // Recolor the block BODY (the main Raphael shape) via inline
          // style.fill — beats the SVG fill attribute/gradient, and removing
          // the inline style restores the original look exactly. Host
          // select/deselect wipes the inline style; quickRefresh reapplies
          // right after, so blocks stay type-colored while selected.
          const paper = W.logic_designer?.paper;
          if (!paper?.elements) return;
          for (const [key, el] of Object.entries(paper.elements)) {
            if (!/^\d+$/.test(key)) continue;
            const node = el?.set?.items?.[0]?.node;
            if (!node) continue;
            const color = effectiveColor(Number(key));
            if (!color) continue;
            if (!node.dataset.ldscpTypePrevFill) {
              node.dataset.ldscpTypePrevFill = node.style.fill || '-';
            }
            node.style.fill = color;
          }
        }

        function unpaintBlocks() {
          for (const node of document.querySelectorAll('[data-ldscp-type-prev-fill]')) {
            unpaintNode(node);
          }
        }

        function refresh() {
          paintWires();
          if (mode === 'full') paintBlocks();
          positionLegend();
        }

        function positionLegend() {
          // Dock the legend just left of the sketch-info pill in the top bar;
          // the pill's width varies (dates/user), so measure it live.
          if (!legendEl) return;
          const pill = document.querySelector('.ldscp-sketchinfo');
          const right = pill
            ? Math.round(window.innerWidth - pill.getBoundingClientRect().left + 8)
            : 185;
          legendEl.style.right = `${right}px`;
        }

        function showLegend() {
          if (legendEl) return;
          legendEl = document.createElement('div');
          legendEl.className = 'ldscp-typelegend';
          for (const ty of TYPES) {
            const item = document.createElement('span');
            item.className = 'ldscp-typelegend-item';
            const dot = document.createElement('span');
            dot.className = 'ldscp-typelegend-dot';
            dot.style.background = ty.color;
            item.appendChild(dot);
            item.appendChild(document.createTextNode(ty.label));
            legendEl.appendChild(item);
          }
          document.body.appendChild(legendEl);
          positionLegend();
        }

        let quickTimer = null;

        function quickRefresh() {
          // Host select/deselect re-fills blocks (wiping our inline style,
          // which showed as a blue flash until the next interval tick).
          // Repaint right after any interaction instead.
          if (!running) return;
          if (quickTimer) clearTimeout(quickTimer);
          quickTimer = setTimeout(() => {
            quickTimer = null;
            refresh();
          }, 80);
        }

        function start() {
          if (running) return;
          running = true;
          showLegend();
          timer = setInterval(refresh, 1500);
          document.addEventListener('mouseup', quickRefresh, true);
          document.addEventListener('keyup', quickRefresh, true);
        }

        function stop() {
          if (!running) return;
          running = false;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          if (quickTimer) {
            clearTimeout(quickTimer);
            quickTimer = null;
          }
          document.removeEventListener('mouseup', quickRefresh, true);
          document.removeEventListener('keyup', quickRefresh, true);
          unpaintWires();
          unpaintBlocks();
          if (legendEl) {
            legendEl.remove();
            legendEl = null;
          }
        }

        function setMode(next) {
          mode = next;
          persistPref();
          if (mode === 'off') {
            stop();
            return;
          }
          start();
          if (mode === 'wires') unpaintBlocks();
          refresh();
        }

        function toggle() {
          // Cycle: off → wires only → wires + blocks → off.
          setMode(mode === 'off' ? 'wires' : mode === 'wires' ? 'full' : 'off');
        }

        function isActive() {
          return mode !== 'off';
        }

        function stateLabel() {
          return mode === 'wires' ? 'wires only' : mode === 'full' ? 'wires + blocks' : 'off';
        }

        function install() {
          // Restore the per-user preference. Older builds stored a boolean —
          // true maps to the previous behavior (wires + blocks).
          try {
            let saved = GM_getValue(PREF_KEY, 'off');
            if (saved === true) saved = 'full';
            if (saved === 'wires' || saved === 'full') setMode(saved);
          } catch { /* ignore */ }
        }

        return { toggle, isActive, stateLabel, setMode, install, getMode: () => mode };
      })();

      // ═══════════════════════════════════════════════════════════════
      //  Stray-selection guard — dragging a text selection from the side
      //  panels into the canvas leaves the pale-blue ::selection highlight
      //  stuck over canvas elements: the host preventDefaults canvas
      //  mousedowns, so the browser never collapses the selection on the
      //  next click. Clear any non-editing text selection whenever the
      //  mouse presses or releases on the canvas SVG.
      // ═══════════════════════════════════════════════════════════════
      function installStraySelectionGuard() {
        const clearIfOnCanvas = (event) => {
          if (event.button !== 0) return;
          if (isEditingText(event.target)) return;
          if (event.target?.namespaceURI !== 'http://www.w3.org/2000/svg') return;
          const sel = window.getSelection?.();
          if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
          try { sel.removeAllRanges(); } catch { /* ignore */ }
        };
        document.addEventListener('mousedown', clearIfOnCanvas, true);
        document.addEventListener('mouseup', clearIfOnCanvas, true);
      }

      // ═══════════════════════════════════════════════════════════════
      //  Bootstrap
      // ═══════════════════════════════════════════════════════════════

      mountLauncher();
      installStraySelectionGuard();
      installCursorTracker();
      installKeyboardShortcuts();
      SelectionInterceptor.install();
      DeleteInterceptor.install();
      MultiWireMode.install();
      BulkEdit.install();
      RemoveConnectorsMode.install();
      GhostPasteMode.install();
      WireObserver.install();
      VariableNames.installSelector();
      MoveObserver.install();
      SketchQuickOpen.install();
      AlarmHighlight.install();
      VariableUsageHighlight.install();
      FormulaDialogHelper.install();
      SketchInfoWidget.install();
      UploadAutoSelect.install();
      TypeColorMode.install();

    })();
  }

  // ─── Node-only export footer (browser ignores this) ─────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSnapshot, createUndoHistory, pairSourcesToTargets, classifyBlockPinDirection, distributeSourcesAcrossTargets, matchProjectId, formatSketchEntry, historyAuthor, isRowProcessed, parseAlarmToken, distinctPointers };
  }
