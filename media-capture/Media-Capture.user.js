// ==UserScript==
// @name         Media Capture
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.0
// @description  Lists the images and media files (video, audio, streams) the page you are on has loaded, with a download button for each. Opens as a panel you can drag and resize to any size, or pops out into its own window with no size limit.
// @match        *://*/*
// @grant        GM_download
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/media-capture/Media-Capture.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/media-capture/Media-Capture.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '__mediaCaptureItems';
  const IS_TOP = window.top === window;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)$/i;
  const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|avi|flv|mp3|m4a|aac|ogg|oga|ogv|opus|wav|flac|m3u8|mpd|ts|m4s)$/i;
  const FILTERS = [['all', 'All'], ['image', 'Images'], ['media', 'Media']];

  // ---------------------------------------------------------------- capture

  const items = new Map(); // url -> { url, filename, kind }

  function absolute(url) {
    try {
      const u = new URL(url, location.href);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
    } catch {
      return null;
    }
  }

  // The initiator says what kind of element asked for the file; the extension
  // decides for everything else (CSS backgrounds, fetch/XHR media segments).
  function kindOf(u, initiator) {
    if (initiator === 'img' || initiator === 'image' || initiator === 'input') return 'image';
    if (initiator === 'video' || initiator === 'audio') return 'media';
    if (IMAGE_EXT.test(u.pathname)) return 'image';
    if (MEDIA_EXT.test(u.pathname)) return 'media';
    return null;
  }

  function filenameOf(u) {
    let name = u.pathname.split('/').pop() || '';
    try { name = decodeURIComponent(name); } catch { /* keep the raw segment */ }
    return name || u.hostname;
  }

  function add(url, initiator) {
    const u = absolute(url);
    if (!u) return;
    const kind = kindOf(u, initiator);
    if (!kind || items.has(u.href)) return;
    const item = { url: u.href, filename: filenameOf(u), kind };
    items.set(item.url, item);
    if (IS_TOP) scheduleRender();
    else forward(item);
  }

  // A frame has no panel of its own; it hands what it saw to the top page.
  function forward(item) {
    try { window.top.postMessage({ [TAG]: [item] }, '*'); } catch { /* detached frame */ }
  }

  function scanDom() {
    if (!document.querySelectorAll) return;
    for (const el of document.querySelectorAll('img')) add(el.currentSrc || el.src, 'img');
    for (const el of document.querySelectorAll('video, audio')) add(el.currentSrc || el.src, 'video');
    for (const el of document.querySelectorAll('video source, audio source')) add(el.src, 'video');
    for (const el of document.querySelectorAll('video[poster]')) add(el.poster, 'img');
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) add(entry.name, entry.initiatorType);
    }).observe({ type: 'resource', buffered: true });
  } catch { /* no resource timing here; the DOM events below still work */ }

  document.addEventListener('load', (e) => {
    const el = e.target;
    if (el && el.tagName === 'IMG') add(el.currentSrc || el.src, 'img');
  }, true);
  document.addEventListener('loadedmetadata', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) add(el.currentSrc || el.src, 'video');
  }, true);
  document.addEventListener('DOMContentLoaded', scanDom);

  if (!IS_TOP) return;

  window.addEventListener('message', (e) => {
    const list = e.data && e.data[TAG];
    if (!Array.isArray(list)) return;
    for (const it of list) {
      if (it && typeof it.url === 'string') add(it.url, it.kind === 'image' ? 'img' : it.kind === 'media' ? 'video' : '');
    }
  });

  // ---------------------------------------------------------------- storage

  function load(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return Object.assign({}, fallback, GM_getValue(key, {}));
    } catch { /* fall through */ }
    return fallback;
  }

  function save(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch { /* the size is simply not remembered */ }
  }

  // --------------------------------------------------------------------- UI

  const CSS = `
.frame { box-sizing: border-box; position: relative; display: flex; min-width: 280px; min-height: 160px; overflow: hidden; resize: both;
  border: 1px solid #c4c9d1; border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.28); background: #f4f5f7; }
.mc { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; width: 100%; height: 100%;
  font: 13px/1.4 system-ui, 'Segoe UI', Roboto, sans-serif; color: #222; background: #f4f5f7; container-type: inline-size; }
.mc * { box-sizing: border-box; font: inherit; }
.head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 10px; background: #fff;
  border-bottom: 1px solid #d9dde3; user-select: none; }
.head.drag { cursor: move; }
.title { font-weight: 600; margin-right: 4px; }
.spacer { flex: 1 1 auto; }
.note { color: #b3261e; font-size: 12px; }
button { padding: 4px 10px; border: 1px solid #c4c9d1; border-radius: 4px; background: #fff; color: #222; cursor: pointer; }
button:hover { background: #eef2fb; }
button.tab.on { background: #4285f4; border-color: #4285f4; color: #fff; }
.body { display: flex; flex: 1 1 auto; min-height: 0; }
.list { flex: 1 1 60%; min-width: 0; margin: 0; padding: 8px; list-style: none; overflow-y: auto; }
.list li { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; padding: 6px 8px; background: #fff;
  border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
.list li:hover { background: #e8f0fe; }
.list li.empty { justify-content: center; color: #777; box-shadow: none; background: none; }
.thumb { flex: 0 0 36px; width: 36px; height: 36px; object-fit: cover; border-radius: 3px; background: #e3e6ea; }
.badge { flex: 0 0 36px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  border-radius: 3px; background: #e3e6ea; color: #555; font-size: 10px; font-weight: 600; }
.list a { flex: 1 1 auto; min-width: 0; color: #1a56c4; text-decoration: none; overflow-wrap: anywhere; }
.list a:hover { text-decoration: underline; }
.list button { flex: 0 0 auto; border-color: #34a853; background: #34a853; color: #fff; }
.list button:hover { background: #2c8c46; }
.preview { flex: 1 1 40%; min-width: 0; display: flex; align-items: flex-start; justify-content: center; padding: 8px;
  border-left: 1px solid #d9dde3; }
.preview img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
.preview.off { display: none; }
@container (max-width: 520px) { .preview { display: none; } }
`;

  const state = { filter: 'all' };
  const views = new Set();
  let panel = null;
  let popWin = null;
  let renderTimer = null;

  function el(doc, tag, props, ...children) {
    const node = doc.createElement(tag);
    if (props) Object.assign(node, props);
    for (const child of children) node.appendChild(child);
    return node;
  }

  // A constructed sheet is not an inline style, so a strict page CSP lets it
  // through; the <style> element is the fallback where it cannot be adopted.
  function addStyles(doc, target) {
    try {
      const sheet = new doc.defaultView.CSSStyleSheet();
      sheet.replaceSync(CSS);
      target.adoptedStyleSheets = [sheet];
    } catch {
      const style = doc.createElement('style');
      style.textContent = CSS;
      (target.head || target).appendChild(style);
    }
  }

  function buildView(doc, popout) {
    const head = el(doc, 'div', { className: 'head' + (popout ? '' : ' drag') });
    head.appendChild(el(doc, 'span', { className: 'title', textContent: 'Media Capture' }));

    const tabs = {};
    for (const [key, label] of FILTERS) {
      const tab = el(doc, 'button', { type: 'button', className: 'tab' });
      tab.dataset.label = label;
      tab.addEventListener('click', () => { state.filter = key; renderAll(); });
      tabs[key] = tab;
      head.appendChild(tab);
    }

    const note = el(doc, 'span', { className: 'note' });
    head.appendChild(el(doc, 'span', { className: 'spacer' }));
    head.appendChild(note);

    const rescan = el(doc, 'button', { type: 'button', textContent: 'Rescan', title: 'Look through the page again' });
    rescan.addEventListener('click', () => { scanDom(); renderAll(); });
    const clear = el(doc, 'button', { type: 'button', textContent: 'Clear' });
    clear.addEventListener('click', () => { items.clear(); renderAll(); });
    head.appendChild(rescan);
    head.appendChild(clear);

    if (!popout) {
      const pop = el(doc, 'button', { type: 'button', textContent: 'Pop out', title: 'Open in its own window, any size' });
      pop.addEventListener('click', openPopout);
      const close = el(doc, 'button', { type: 'button', textContent: '✕', title: 'Close' });
      close.addEventListener('click', closePanel);
      head.appendChild(pop);
      head.appendChild(close);
    }

    const list = el(doc, 'ul', { className: 'list' });
    const previewImg = el(doc, 'img', { alt: '' });
    const preview = el(doc, 'div', { className: 'preview' }, previewImg);
    const root = el(doc, 'div', { className: 'mc' }, head, el(doc, 'div', { className: 'body' }, list, preview));

    const view = { doc, root, head, tabs, note, list, preview, previewImg };
    views.add(view);
    return view;
  }

  function buildRow(view, item) {
    const doc = view.doc;
    const li = doc.createElement('li');

    if (item.kind === 'image') {
      li.appendChild(el(doc, 'img', { className: 'thumb', loading: 'lazy', alt: '', src: item.url }));
      li.addEventListener('mouseenter', () => { view.previewImg.src = item.url; });
    } else {
      const ext = (item.filename.split('.').pop() || '').slice(0, 4).toUpperCase();
      li.appendChild(el(doc, 'span', { className: 'badge', textContent: ext || 'MEDIA' }));
    }

    li.appendChild(el(doc, 'a', {
      href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.url, textContent: item.filename,
    }));

    const button = el(doc, 'button', { type: 'button', textContent: 'Download' });
    button.addEventListener('click', () => download(item, button));
    li.appendChild(button);
    return li;
  }

  function renderView(view) {
    const all = [...items.values()];
    const counts = { all: all.length, image: 0, media: 0 };
    for (const it of all) counts[it.kind]++;

    for (const [key] of FILTERS) {
      const tab = view.tabs[key];
      tab.textContent = `${tab.dataset.label} (${counts[key]})`;
      tab.classList.toggle('on', state.filter === key);
    }

    const shown = all
      .filter((it) => state.filter === 'all' || it.kind === state.filter)
      .sort((a, b) => a.filename.localeCompare(b.filename));

    const top = view.list.scrollTop;
    if (shown.length) {
      view.list.replaceChildren(...shown.map((it) => buildRow(view, it)));
    } else {
      view.list.replaceChildren(el(view.doc, 'li', { className: 'empty', textContent: 'Nothing captured on this page yet.' }));
    }
    view.list.scrollTop = top;
    view.preview.classList.toggle('off', state.filter === 'media' || counts.image === 0);
  }

  function renderAll() {
    clearTimeout(renderTimer);
    renderTimer = null;
    for (const view of views) renderView(view);
  }

  function scheduleRender() {
    if (renderTimer || !views.size) return;
    renderTimer = setTimeout(renderAll, 200);
  }

  function safeName(name) {
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'download';
  }

  function download(item, button) {
    const openInTab = () => { window.open(item.url, '_blank', 'noopener'); };
    if (typeof GM_download !== 'function') { openInTab(); return; }
    button.textContent = 'Saving…';
    GM_download({
      url: item.url,
      name: safeName(item.filename),
      saveAs: false,
      onload: () => { button.textContent = 'Saved'; },
      onerror: () => { button.textContent = 'Opened in tab'; openInTab(); },
      ontimeout: () => { button.textContent = 'Opened in tab'; openInTab(); },
    });
  }

  // ------------------------------------------------------------------ panel

  function openPanel() {
    if (popWin && !popWin.closed) { popWin.focus(); return; }
    if (panel) return;

    const geo = load('panel', { w: 560, h: 440, x: null, y: null });
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;';
    if (geo.x !== null && geo.y !== null) {
      const x = Math.max(0, Math.min(geo.x, window.innerWidth - 80));
      const y = Math.max(0, Math.min(geo.y, window.innerHeight - 40));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
      host.style.right = 'auto';
    }

    const shadow = host.attachShadow({ mode: 'open' });
    addStyles(document, shadow);
    const view = buildView(document, false);
    const frame = el(document, 'div', { className: 'frame' }, view.root);
    frame.style.width = geo.w + 'px';
    frame.style.height = geo.h + 'px';
    shadow.appendChild(frame);
    (document.body || document.documentElement).appendChild(host);

    let saveTimer = null;
    const remember = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const box = host.getBoundingClientRect();
        if (!box.width) return;
        save('panel', { w: Math.round(frame.offsetWidth), h: Math.round(frame.offsetHeight), x: Math.round(box.left), y: Math.round(box.top) });
      }, 300);
    };
    const sizeWatch = new ResizeObserver(remember);
    sizeWatch.observe(frame);

    view.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const box = host.getBoundingClientRect();
      const dx = e.clientX - box.left;
      const dy = e.clientY - box.top;
      view.head.setPointerCapture(e.pointerId);
      const move = (m) => {
        host.style.left = Math.max(0, Math.min(m.clientX - dx, window.innerWidth - 80)) + 'px';
        host.style.top = Math.max(0, Math.min(m.clientY - dy, window.innerHeight - 40)) + 'px';
        host.style.right = 'auto';
      };
      const up = () => {
        view.head.removeEventListener('pointermove', move);
        view.head.removeEventListener('pointerup', up);
        remember();
      };
      view.head.addEventListener('pointermove', move);
      view.head.addEventListener('pointerup', up);
      e.preventDefault();
    });

    panel = { host, view, sizeWatch };
    scanDom();
    renderAll();
  }

  function closePanel() {
    if (!panel) return;
    panel.sizeWatch.disconnect();
    views.delete(panel.view);
    panel.host.remove();
    panel = null;
  }

  function togglePanel() {
    if (panel) closePanel();
    else openPanel();
  }

  // ---------------------------------------------------------------- pop-out

  // A real browser window: it takes any size the user drags it to, where an
  // extension's toolbar popup stops at 800x600.
  function openPopout() {
    if (popWin && !popWin.closed) { popWin.focus(); return; }

    const size = load('popout', { w: 900, h: 700 });
    const win = window.open('', 'mediaCapturePopout', `popup=yes,width=${size.w},height=${size.h}`);
    if (!win) {
      if (panel) panel.view.note.textContent = 'Pop-up blocked — allow pop-ups for this site.';
      return;
    }

    popWin = win;
    const doc = win.document;
    doc.title = 'Media Capture — ' + location.hostname;
    doc.documentElement.style.height = '100%';
    doc.body.style.cssText = 'margin:0;height:100%;';
    doc.body.replaceChildren();
    addStyles(doc, doc);
    const view = buildView(doc, true);
    doc.body.appendChild(view.root);

    let saveTimer = null;
    win.addEventListener('resize', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!win.closed) save('popout', { w: win.innerWidth, h: win.innerHeight });
      }, 300);
    });
    win.addEventListener('pagehide', () => {
      views.delete(view);
      if (popWin === win) popWin = null;
    });

    closePanel();
    scanDom();
    renderAll();
  }

  // The window is drawn by this page's script, so it cannot outlive the page.
  window.addEventListener('pagehide', () => {
    if (popWin && !popWin.closed) popWin.close();
  });

  // ---------------------------------------------------------------- opening

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open Media Capture (Alt+Shift+M)', togglePanel);
  }
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyM') {
      e.preventDefault();
      togglePanel();
    }
  }, true);
})();
