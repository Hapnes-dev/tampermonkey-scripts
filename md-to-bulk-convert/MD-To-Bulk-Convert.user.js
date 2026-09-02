// ==UserScript==
// @name         MD-To Bulk Convert
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.0
// @description  Drag a whole folder of .md files onto md-to.com and get every one back as .docx, in a single ZIP
// @author       Hapnes
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @match        https://md-to.com/
// @match        https://md-to.com/?*
// @match        https://md-to.com/#*
// @match        https://md-to.com/markdown-to-word/*
// @match        https://md-to.com/markdown-to-word
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/md-to-bulk-convert/MD-To-Bulk-Convert.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/md-to-bulk-convert/MD-To-Bulk-Convert.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * How this works
 * --------------
 * md-to.com converts markdown to .docx entirely in the browser: the page module
 * calls generateDocx(markdown) -> Packer.toBlob(doc) -> saveAs(blob, name), with
 * no server round-trip. This script imports that same module and drives it in a
 * loop, so a bulk run is exactly the conversion the site would have done -- same
 * renderer, same template, no API and no rate limit.
 *
 * The module lives at a content-hashed URL (_astro/docx-generator.<hash>.js) that
 * changes on every deploy, and its exports are minified to single letters. So we
 * resolve the URL from the page's own script tags and identify the three exports
 * by shape rather than by name -- see loadDocxModule().
 */

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.0';
    const NS = 'mdtobulk';
    const LS_OPTIONS = 'mdtobulk:options';

    const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt'];
    const SKIP_DIRS = ['node_modules', '.git', '.svn', '.obsidian', '__pycache__'];
    const MAX_FILES = 500;
    const WORD_PAGE = '/markdown-to-word/';

    // The home page has the hero drop box but no editor and no template picker;
    // the Word page has both.
    const onWordPage = location.pathname.replace(/\/$/, '') === WORD_PAGE.replace(/\/$/, '');

    const options = loadOptions();

    /* ---------------------------------------------------------------- state */

    /** @type {{path: string, file: File, checked: boolean}[]} */
    let queue = [];
    let converting = false;
    let dragDepth = 0;

    /* ------------------------------------------------------------ zip writer */

    // Stored (uncompressed) ZIP. A .docx is already a compressed ZIP, so deflating
    // it again buys nothing and would cost a dependency.

    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function dosStamp(d) {
        return {
            time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
            date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
        };
    }

    function buildZip(entries) {
        const enc = new TextEncoder();
        const { time, date } = dosStamp(new Date());
        const parts = [];
        const central = [];
        let offset = 0;

        for (const entry of entries) {
            const name = enc.encode(entry.name);
            const size = entry.data.length;
            const crc = crc32(entry.data);

            const local = new Uint8Array(30 + name.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);      // version needed
            lv.setUint16(6, 0x0800, true);  // UTF-8 names
            lv.setUint16(8, 0, true);       // method: store
            lv.setUint16(10, time, true);
            lv.setUint16(12, date, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, size, true);
            lv.setUint32(22, size, true);
            lv.setUint16(26, name.length, true);
            local.set(name, 30);

            const dir = new Uint8Array(46 + name.length);
            const dv = new DataView(dir.buffer);
            dv.setUint32(0, 0x02014b50, true);
            dv.setUint16(4, 20, true);      // version made by
            dv.setUint16(6, 20, true);      // version needed
            dv.setUint16(8, 0x0800, true);
            dv.setUint16(10, 0, true);
            dv.setUint16(12, time, true);
            dv.setUint16(14, date, true);
            dv.setUint32(16, crc, true);
            dv.setUint32(20, size, true);
            dv.setUint32(24, size, true);
            dv.setUint16(28, name.length, true);
            dv.setUint32(42, offset, true);
            dir.set(name, 46);

            parts.push(local, entry.data);
            central.push(dir);
            offset += local.length + size;
        }

        const centralSize = central.reduce((a, c) => a + c.length, 0);
        const end = new Uint8Array(22);
        const ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, entries.length, true);
        ev.setUint16(10, entries.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);

        return new Blob([...parts, ...central, end], { type: 'application/zip' });
    }

    /* ------------------------------------------------------- docx generator */

    let modulePromise = null;

    function loadDocxModule() {
        if (!modulePromise) modulePromise = resolveDocxModule();
        return modulePromise;
    }

    async function resolveDocxModule() {
        // On the Word page the generator is already among the page's own scripts.
        // On the home page it isn't, so fall back to reading the Word page's HTML
        // for its script list -- the module itself imports and runs fine anywhere.
        let candidates = [...document.querySelectorAll('script[src]')]
            .map(s => s.src)
            .filter(src => src.startsWith(location.origin) && src.includes('/_astro/'));

        for (let round = 0; round < 2; round++) {
            for (const src of candidates) {
                let text;
                try {
                    text = await (await fetch(src)).text();
                } catch (err) {
                    continue;
                }
                const hit = text.match(/["'](\.\/docx-generator\.[^"']+\.js)["']/);
                if (!hit) continue;

                const mod = await import(new URL(hit[1], src).href);
                const picked = await identifyExports(mod);
                if (picked) return picked;
            }

            if (round) break;
            try {
                const html = await (await fetch(WORD_PAGE)).text();
                candidates = [...html.matchAll(/src="(\/_astro\/[^"]+\.js)"/g)]
                    .map(m => new URL(m[1], location.origin).href);
            } catch (err) {
                break;
            }
        }

        throw new Error(
            'Could not find md-to.com\'s docx generator. The site was probably ' +
            'rebuilt - the script needs an update.'
        );
    }

    // The module exports three functions with minified names. Tell them apart by
    // what they carry: FileSaver has .saveAs, Packer has .toBlob, and whatever is
    // left that actually produces a document is generateDocx.
    async function identifyExports(mod) {
        let Packer = null;
        const generators = [];

        for (const key of Object.keys(mod)) {
            const value = mod[key];
            if (typeof value !== 'function') continue;
            if (typeof value.saveAs === 'function') continue;
            else if (typeof value.toBlob === 'function') Packer = value;
            else generators.push(value);
        }
        if (!Packer || !generators.length) return null;

        for (const generateDocx of generators) {
            try {
                const blob = await Packer.toBlob(await generateDocx('# probe\n'));
                if (blob && blob.size > 0) return { generateDocx, Packer };
            } catch (err) {
                /* not this one */
            }
        }
        return null;
    }

    async function markdownToDocx(markdown) {
        const { generateDocx, Packer } = await loadDocxModule();
        return Packer.toBlob(await generateDocx(markdown));
    }

    // Hand the main thread back between documents so the progress bar can paint.
    // setTimeout would do it, except Chrome clamps it to one tick per second in a
    // background tab, which would stall a long run the moment you switch away.
    const yieldChannel = new MessageChannel();
    function breathe() {
        if (window.scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
        return new Promise(resolve => {
            yieldChannel.port1.onmessage = () => resolve();
            yieldChannel.port2.postMessage(0);
        });
    }

    /* ------------------------------------------------------- file collection */

    function isMarkdown(name) {
        const lower = name.toLowerCase();
        return MD_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    function isSkippable(name) {
        return name.startsWith('.') || SKIP_DIRS.includes(name);
    }

    function readAllEntries(reader) {
        // readEntries() hands back at most 100 at a time and signals the end with
        // an empty batch, so it has to be drained in a loop.
        return new Promise((resolve, reject) => {
            const all = [];
            const next = () => reader.readEntries(batch => {
                if (!batch.length) return resolve(all);
                all.push(...batch);
                next();
            }, reject);
            next();
        });
    }

    async function walkEntry(entry, prefix, out) {
        if (out.length >= MAX_FILES) return;

        if (entry.isFile) {
            if (!isMarkdown(entry.name) || isSkippable(entry.name)) return;
            const file = await new Promise((res, rej) => entry.file(res, rej));
            out.push({ path: prefix + entry.name, file, checked: true });
            return;
        }
        if (entry.isDirectory) {
            if (prefix && isSkippable(entry.name)) return;
            const children = await readAllEntries(entry.createReader());
            for (const child of children) await walkEntry(child, prefix + entry.name + '/', out);
        }
    }

    async function collectFromDataTransfer(dataTransfer) {
        // webkitGetAsEntry() has to be called before we await anything, because the
        // DataTransfer is emptied as soon as the drop handler yields.
        const roots = [];
        const loose = [];
        for (const item of dataTransfer.items) {
            if (item.kind !== 'file') continue;
            const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
            if (entry) roots.push(entry);
            else {
                const file = item.getAsFile();
                if (file) loose.push(file);
            }
        }

        const out = [];
        for (const root of roots) await walkEntry(root, '', out);
        for (const file of loose) {
            if (isMarkdown(file.name)) out.push({ path: file.name, file, checked: true });
        }
        return out;
    }

    function collectFromInput(input) {
        return [...input.files]
            .map(file => ({ path: file.webkitRelativePath || file.name, file, checked: true }))
            .filter(item => isMarkdown(item.file.name) && !item.path.split('/').some(isSkippable))
            .slice(0, MAX_FILES);
    }

    function addToQueue(items) {
        const seen = new Set(queue.map(q => q.path));
        let added = 0;
        for (const item of items) {
            if (seen.has(item.path) || queue.length >= MAX_FILES) continue;
            seen.add(item.path);
            queue.push(item);
            added++;
        }
        queue.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
        renderQueue();
        return added;
    }

    /* ------------------------------------------------------- output naming */

    function outputName(path, keepStructure) {
        const withExt = path.replace(/\.[^./]+$/, '') + '.docx';
        return keepStructure ? withExt : withExt.split('/').pop();
    }

    function dedupe(names) {
        const used = new Map();
        return names.map(name => {
            const count = used.get(name) || 0;
            used.set(name, count + 1);
            if (!count) return name;
            return name.replace(/\.docx$/, ` (${count + 1}).docx`);
        });
    }

    function zipName() {
        const roots = new Set(queue.filter(q => q.checked).map(q => q.path.split('/')[0]));
        if (roots.size === 1) {
            const only = [...roots][0];
            if (only && !isMarkdown(only)) return only + '.zip';
        }
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `markdown-docx-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`;
    }

    function saveBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    /* ------------------------------------------------------------ conversion */

    async function runConversion() {
        const selected = queue.filter(q => q.checked);
        if (!selected.length || converting) return;

        converting = true;
        updateControls();

        const results = [];
        const failures = [];

        try {
            await loadDocxModule();
        } catch (err) {
            converting = false;
            updateControls();
            setStatus(err.message, 'error');
            return;
        }

        for (let i = 0; i < selected.length; i++) {
            const item = selected[i];
            setProgress(i, selected.length, item.path);
            markRow(item.path, 'working');

            try {
                const markdown = await item.file.text();
                const blob = await markdownToDocx(markdown);
                results.push({ item, bytes: new Uint8Array(await blob.arrayBuffer()) });
                markRow(item.path, 'done');
            } catch (err) {
                failures.push({ path: item.path, message: err.message });
                markRow(item.path, 'failed', err.message);
            }

            await breathe();
        }

        setProgress(selected.length, selected.length, 'Packaging');

        if (results.length) {
            if (options.zip) {
                const names = dedupe(results.map(r => outputName(r.item.path, options.keepStructure)));
                saveBlob(buildZip(results.map((r, i) => ({ name: names[i], data: r.bytes }))), zipName());
            } else {
                const names = dedupe(results.map(r => outputName(r.item.path, false)));
                for (let i = 0; i < results.length; i++) {
                    saveBlob(new Blob([results[i].bytes], {
                        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    }), names[i]);
                    await new Promise(r => setTimeout(r, 350));
                }
            }
        }

        converting = false;
        updateControls();

        const noun = results.length === 1 ? 'file' : 'files';
        if (failures.length) {
            setStatus(`Converted ${results.length} ${noun}, ${failures.length} failed.`, 'error');
        } else if (results.length) {
            setStatus(`Converted ${results.length} ${noun}.`, 'ok');
        } else {
            setStatus('Nothing was converted.', 'error');
        }
    }

    /* -------------------------------------------------------------- options */

    function loadOptions() {
        const defaults = { zip: true, keepStructure: true, catchDrops: true };
        try {
            return Object.assign(defaults, JSON.parse(localStorage.getItem(LS_OPTIONS) || '{}'));
        } catch (err) {
            return defaults;
        }
    }

    function saveOptions() {
        try {
            localStorage.setItem(LS_OPTIONS, JSON.stringify(options));
        } catch (err) {
            /* private mode; options just won't persist */
        }
    }

    /* ------------------------------------------------------------------- ui */

    const el = {};

    function css() {
        const style = document.createElement('style');
        style.id = NS + '-style';
        style.textContent = `
.${NS}-launch{position:fixed;right:1rem;bottom:5rem;z-index:60;display:flex;align-items:center;gap:.5rem;
  padding:.6rem .9rem;border-radius:9999px;border:1px solid hsl(var(--border,0 0% 80%));
  background:hsl(var(--primary,140 50% 45%));color:hsl(var(--primary-foreground,0 0% 100%));
  font:600 13px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;
  box-shadow:0 6px 20px rgb(0 0 0 / .25);transition:transform .15s,filter .15s}
.${NS}-launch:hover{transform:translateY(-1px);filter:brightness(1.08)}

.${NS}-backdrop{position:fixed;inset:0;z-index:70;background:rgb(0 0 0 / .55);
  display:flex;align-items:center;justify-content:center;padding:1.5rem}
.${NS}-panel{width:min(680px,100%);max-height:min(86vh,760px);display:flex;flex-direction:column;
  border-radius:calc(var(--radius,.5rem) + .25rem);border:1px solid hsl(var(--border,0 0% 80%));
  background:hsl(var(--card,0 0% 100%));color:hsl(var(--foreground,0 0% 10%));
  font:400 14px/1.45 ui-sans-serif,system-ui,sans-serif;box-shadow:0 24px 60px rgb(0 0 0 / .4);overflow:hidden}

.${NS}-head{display:flex;align-items:center;gap:.75rem;padding:1rem 1.15rem;
  border-bottom:1px solid hsl(var(--border,0 0% 80%))}
.${NS}-title{font-weight:600;font-size:15px;flex:1}
.${NS}-ver{font-size:11px;opacity:.5;font-variant-numeric:tabular-nums}
.${NS}-x{border:0;background:none;color:inherit;opacity:.6;cursor:pointer;font-size:20px;line-height:1;padding:.15rem .4rem;border-radius:.35rem}
.${NS}-x:hover{opacity:1;background:hsl(var(--muted,0 0% 94%))}

.${NS}-body{padding:1.15rem;overflow-y:auto;display:flex;flex-direction:column;gap:1rem}

.${NS}-drop{border:2px dashed hsl(var(--primary,140 50% 45%) / .4);border-radius:var(--radius,.5rem);
  padding:1.5rem 1rem;text-align:center;transition:background .15s,border-color .15s}
.${NS}-drop.over{border-color:hsl(var(--primary,140 50% 45%));background:hsl(var(--primary,140 50% 45%) / .08)}
.${NS}-drop p{margin:0 0 .15rem;font-weight:500}
.${NS}-drop small{opacity:.6}
.${NS}-pickers{display:flex;gap:.5rem;justify-content:center;margin-top:.9rem}

.${NS}-btn{border:1px solid hsl(var(--border,0 0% 80%));background:hsl(var(--background,0 0% 100%));
  color:inherit;border-radius:var(--radius,.5rem);padding:.45rem .8rem;font:500 13px/1 inherit;cursor:pointer}
.${NS}-btn:hover{background:hsl(var(--muted,0 0% 94%))}
.${NS}-btn.primary{background:hsl(var(--primary,140 50% 45%));color:hsl(var(--primary-foreground,0 0% 100%));border-color:transparent;font-weight:600;padding:.55rem 1.1rem}
.${NS}-btn.primary:hover{filter:brightness(1.08);background:hsl(var(--primary,140 50% 45%))}
.${NS}-btn:disabled{opacity:.45;cursor:not-allowed;filter:none}

.${NS}-listhead{display:flex;align-items:center;gap:.5rem;font-size:12px}
.${NS}-count{flex:1;opacity:.7;font-variant-numeric:tabular-nums}
.${NS}-link{border:0;background:none;color:hsl(var(--primary,140 50% 45%));cursor:pointer;font:500 12px/1 inherit;padding:.2rem .3rem}
.${NS}-link:hover{text-decoration:underline}

.${NS}-list{border:1px solid hsl(var(--border,0 0% 80%));border-radius:var(--radius,.5rem);
  max-height:230px;overflow-y:auto}
.${NS}-row{display:flex;align-items:center;gap:.6rem;padding:.4rem .65rem;font-size:13px;
  border-bottom:1px solid hsl(var(--border,0 0% 80%) / .5)}
.${NS}-row:last-child{border-bottom:0}
.${NS}-row input{accent-color:hsl(var(--primary,140 50% 45%));cursor:pointer;flex:none}
.${NS}-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.${NS}-size{opacity:.5;font-size:11px;font-variant-numeric:tabular-nums;flex:none}
.${NS}-mark{flex:none;width:1.1rem;text-align:center;font-size:12px}
.${NS}-row[data-state=working] .${NS}-mark{opacity:.7}
.${NS}-row[data-state=done] .${NS}-mark{color:hsl(var(--primary,140 50% 45%))}
.${NS}-row[data-state=failed] .${NS}-mark{color:hsl(var(--destructive,0 70% 50%))}
.${NS}-row[data-state=failed] .${NS}-path{color:hsl(var(--destructive,0 70% 50%))}

.${NS}-opts{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;font-size:13px}
.${NS}-opt{display:flex;align-items:center;gap:.45rem;cursor:pointer}
.${NS}-opt input{accent-color:hsl(var(--primary,140 50% 45%));cursor:pointer}
.${NS}-opt.off{opacity:.45;cursor:not-allowed}
.${NS}-note{font-size:12px;opacity:.6;margin:0}
.${NS}-note a{color:hsl(var(--primary,140 50% 45%))}

.${NS}-foot{display:flex;align-items:center;gap:.85rem;padding:.9rem 1.15rem;
  border-top:1px solid hsl(var(--border,0 0% 80%));background:hsl(var(--muted,0 0% 96%) / .35)}
.${NS}-status{flex:1;font-size:12.5px;min-height:1.2em}
.${NS}-status.ok{color:hsl(var(--primary,140 50% 45%))}
.${NS}-status.error{color:hsl(var(--destructive,0 70% 50%))}

.${NS}-bar{height:4px;border-radius:2px;background:hsl(var(--muted,0 0% 90%));overflow:hidden;margin-bottom:.35rem;display:none}
.${NS}-bar.on{display:block}
.${NS}-bar>i{display:block;height:100%;width:0;background:hsl(var(--primary,140 50% 45%));transition:width .15s}

.${NS}-overlay{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;
  background:hsl(var(--background,0 0% 100%) / .82);backdrop-filter:blur(3px)}
.${NS}-overlay.on{display:flex}
.${NS}-overlay div{border:3px dashed hsl(var(--primary,140 50% 45%));border-radius:1rem;
  padding:3rem 4rem;text-align:center;color:hsl(var(--foreground,0 0% 10%));
  font:600 18px/1.5 ui-sans-serif,system-ui,sans-serif}
.${NS}-overlay small{display:block;font-weight:400;font-size:13px;opacity:.65;margin-top:.35rem}
.${NS}-hidden{display:none !important}`;
        document.head.appendChild(style);
    }

    function build() {
        css();

        el.launch = document.createElement('button');
        el.launch.className = NS + '-launch';
        el.launch.type = 'button';
        el.launch.title = 'Bulk convert markdown files to Word';
        el.launch.innerHTML = '<span>&#128193;</span><span>Bulk convert</span>';
        el.launch.addEventListener('click', openPanel);
        document.body.appendChild(el.launch);

        el.overlay = document.createElement('div');
        el.overlay.className = NS + '-overlay';
        el.overlay.innerHTML =
            '<div>Drop .md files or a folder' +
            '<small>Everything inside gets converted to Word</small></div>';
        document.body.appendChild(el.overlay);

        el.backdrop = document.createElement('div');
        el.backdrop.className = NS + '-backdrop ' + NS + '-hidden';
        el.backdrop.innerHTML = `
<div class="${NS}-panel" role="dialog" aria-modal="true" aria-label="Bulk convert markdown to Word">
  <div class="${NS}-head">
    <span class="${NS}-title">Bulk convert to Word</span>
    <span class="${NS}-ver">v${SCRIPT_VERSION}</span>
    <button class="${NS}-x" type="button" aria-label="Close">&times;</button>
  </div>
  <div class="${NS}-body">
    <div class="${NS}-drop">
      <p>Drop a folder or .md files here</p>
      <small>Subfolders are included</small>
      <div class="${NS}-pickers">
        <button class="${NS}-btn" type="button" data-pick="dir">Choose folder</button>
        <button class="${NS}-btn" type="button" data-pick="files">Choose files</button>
      </div>
    </div>
    <div class="${NS}-listhead">
      <span class="${NS}-count"></span>
      <button class="${NS}-link" type="button" data-sel="all">Select all</button>
      <button class="${NS}-link" type="button" data-sel="none">None</button>
      <button class="${NS}-link" type="button" data-sel="clear">Clear</button>
    </div>
    <div class="${NS}-list"></div>
    <div class="${NS}-opts">
      <label class="${NS}-opt"><input type="checkbox" data-opt="zip"> Download as one ZIP</label>
      <label class="${NS}-opt" data-wrap="keepStructure"><input type="checkbox" data-opt="keepStructure"> Keep folder structure</label>
      <label class="${NS}-opt"><input type="checkbox" data-opt="catchDrops"> Catch drops anywhere on the page</label>
    </div>
    <p class="${NS}-note">${onWordPage
        ? 'Uses the template selected on this page, so pick one above before converting.'
        : 'Uses the default Word template. To pick a different one, run this from the <a href="' + WORD_PAGE + '">Markdown to Word</a> page.'}</p>
  </div>
  <div class="${NS}-foot">
    <div style="flex:1">
      <div class="${NS}-bar"><i></i></div>
      <div class="${NS}-status"></div>
    </div>
    <button class="${NS}-btn primary" type="button" data-go>Convert</button>
  </div>
</div>`;
        document.body.appendChild(el.backdrop);

        el.panel = el.backdrop.querySelector('.' + NS + '-panel');
        el.drop = el.backdrop.querySelector('.' + NS + '-drop');
        el.list = el.backdrop.querySelector('.' + NS + '-list');
        el.count = el.backdrop.querySelector('.' + NS + '-count');
        el.status = el.backdrop.querySelector('.' + NS + '-status');
        el.bar = el.backdrop.querySelector('.' + NS + '-bar');
        el.fill = el.bar.querySelector('i');
        el.go = el.backdrop.querySelector('[data-go]');

        el.dirInput = document.createElement('input');
        el.dirInput.type = 'file';
        el.dirInput.multiple = true;
        el.dirInput.webkitdirectory = true;
        el.dirInput.className = NS + '-hidden';
        el.dirInput.dataset[NS] = 'dir';

        el.fileInput = document.createElement('input');
        el.fileInput.type = 'file';
        el.fileInput.multiple = true;
        el.fileInput.accept = MD_EXTENSIONS.join(',');
        el.fileInput.className = NS + '-hidden';
        el.fileInput.dataset[NS] = 'files';

        for (const input of [el.dirInput, el.fileInput]) {
            input.addEventListener('change', () => {
                const added = addToQueue(collectFromInput(input));
                if (added) setStatus(`Added ${added} file${added === 1 ? '' : 's'}.${capNote()}`, capNote() ? 'error' : '');
                else setStatus('No markdown files found.', 'error');
                input.value = '';
            });
            document.body.appendChild(input);
        }

        el.backdrop.querySelector('.' + NS + '-x').addEventListener('click', closePanel);
        el.backdrop.addEventListener('mousedown', e => { if (e.target === el.backdrop) closePanel(); });
        el.backdrop.querySelector('[data-pick=dir]').addEventListener('click', () => el.dirInput.click());
        el.backdrop.querySelector('[data-pick=files]').addEventListener('click', () => el.fileInput.click());
        el.go.addEventListener('click', runConversion);

        el.backdrop.querySelectorAll('[data-sel]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.sel;
                if (mode === 'clear') queue = [];
                else queue.forEach(q => { q.checked = mode === 'all'; });
                setStatus('');
                renderQueue();
            });
        });

        el.backdrop.querySelectorAll('[data-opt]').forEach(input => {
            input.checked = !!options[input.dataset.opt];
            input.addEventListener('change', () => {
                options[input.dataset.opt] = input.checked;
                saveOptions();
                updateControls();
            });
        });

        el.list.addEventListener('change', e => {
            const row = e.target.closest('[data-path]');
            if (!row) return;
            const item = queue.find(q => q.path === row.dataset.path);
            if (item) item.checked = e.target.checked;
            updateControls();
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !el.backdrop.classList.contains(NS + '-hidden') && !converting) closePanel();
        });

        wireDragAndDrop();
        renderQueue();
    }

    function wireDragAndDrop() {
        const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

        // Capture phase, so the page's own single-file drop handler never sees it.
        window.addEventListener('dragenter', e => {
            if (!options.catchDrops || !hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            dragDepth++;
            el.overlay.classList.add('on');
        }, true);

        window.addEventListener('dragover', e => {
            if (!options.catchDrops || !hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        }, true);

        window.addEventListener('dragleave', e => {
            if (!options.catchDrops || !hasFiles(e)) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (!dragDepth) el.overlay.classList.remove('on');
        }, true);

        window.addEventListener('drop', e => {
            if (!options.catchDrops || !hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            dragDepth = 0;
            el.overlay.classList.remove('on');
            acceptDrop(e.dataTransfer);
        }, true);

        // The panel's own zone works even when page-wide catching is switched off.
        el.drop.addEventListener('dragenter', e => { e.preventDefault(); el.drop.classList.add('over'); });
        el.drop.addEventListener('dragover', e => { e.preventDefault(); el.drop.classList.add('over'); });
        el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'));
        el.drop.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            el.drop.classList.remove('over');
            acceptDrop(e.dataTransfer);
        });
    }

    async function acceptDrop(dataTransfer) {
        if (converting) return;
        openPanel();
        setStatus('Reading\u2026');
        const found = await collectFromDataTransfer(dataTransfer);
        const added = addToQueue(found);
        if (added) setStatus(`Added ${added} file${added === 1 ? '' : 's'}.${capNote()}`, capNote() ? 'error' : '');
        else setStatus(found.length ? 'Those files are already listed.' : 'No markdown files in there.', found.length ? '' : 'error');
    }

    function capNote() {
        return queue.length >= MAX_FILES ? ` Stopped at the ${MAX_FILES}-file limit.` : '';
    }

    function openPanel() {
        el.backdrop.classList.remove(NS + '-hidden');
    }

    function closePanel() {
        el.backdrop.classList.add(NS + '-hidden');
    }

    function humanSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function renderQueue() {
        if (!el.list) return;

        if (!queue.length) {
            el.list.innerHTML = `<div class="${NS}-row" style="opacity:.55">Nothing queued yet.</div>`;
        } else {
            el.list.innerHTML = queue.map(item => `
<label class="${NS}-row" data-path="${escapeHtml(item.path)}">
  <input type="checkbox"${item.checked ? ' checked' : ''}>
  <span class="${NS}-path" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</span>
  <span class="${NS}-size">${humanSize(item.file.size)}</span>
  <span class="${NS}-mark"></span>
</label>`).join('');
        }
        updateControls();
    }

    function updateControls() {
        if (!el.count) return;
        const selected = queue.filter(q => q.checked).length;

        el.count.textContent = queue.length
            ? `${queue.length} file${queue.length === 1 ? '' : 's'} \u00b7 ${selected} selected`
            : 'No files yet';

        el.go.disabled = converting || !selected;
        el.go.textContent = converting
            ? 'Converting\u2026'
            : selected ? `Convert ${selected} file${selected === 1 ? '' : 's'}` : 'Convert';

        const keepWrap = el.backdrop.querySelector(`[data-wrap=keepStructure]`);
        const keepInput = keepWrap.querySelector('input');
        keepInput.disabled = !options.zip;              // only a ZIP can hold folders
        keepWrap.classList.toggle('off', !options.zip);

        el.backdrop.querySelectorAll('[data-opt]').forEach(i => { i.disabled = converting || (i.dataset.opt === 'keepStructure' && !options.zip); });
        el.backdrop.querySelectorAll('[data-sel],[data-pick]').forEach(b => { b.disabled = converting; });
    }

    function markRow(path, state, title) {
        const row = el.list.querySelector(`[data-path="${cssEscape(path)}"]`);
        if (!row) return;
        row.dataset.state = state;
        const mark = row.querySelector('.' + NS + '-mark');
        mark.textContent = state === 'working' ? '\u2026' : state === 'done' ? '\u2713' : state === 'failed' ? '\u2717' : '';
        if (title) row.title = title;
    }

    function setProgress(done, total, label) {
        el.bar.classList.add('on');
        el.fill.style.width = (total ? (done / total) * 100 : 0) + '%';
        setStatus(`${done}/${total} \u00b7 ${label}`);
    }

    function setStatus(text, kind) {
        el.status.textContent = text || '';
        el.status.className = NS + '-status' + (kind ? ' ' + kind : '');
        if (!converting && !text) el.bar.classList.remove('on');
    }

    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function cssEscape(s) {
        return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
    }

    /* ------------------------------------------------------------------ boot */

    let bootTries = 0;

    function boot() {
        if (document.getElementById(NS + '-style')) return;
        const anchor = onWordPage ? 'editor-input' : 'hero-file-input';
        if (!document.getElementById(anchor)) {
            // The Astro island may not have painted yet. Give it 30s, then give up
            // rather than spin forever on a page that isn't what we expected.
            if (++bootTries > 100) return;
            return setTimeout(boot, 300);
        }
        build();
        // Warm the module up so the first conversion isn't the slow one.
        loadDocxModule().catch(() => { /* reported when the user converts */ });
    }

    boot();
})();
