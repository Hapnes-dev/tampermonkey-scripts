'use strict';
/* Zendesk ⇄ General Chat (Rocketlane improvements 1.73.0) in a real browser: the userscript's sync - engine, button
 * and panel - on a page at a Rocketlane chat path, its transports answered in the page by an in-memory Rocketlane and
 * Zendesk. Link a ticket from the queue, a customer's reply into the chat, a /reply message out to the ticket; an older
 * Chat Bridge's button keeps this one away, and the Chat Bridge's links come over through its own hand-over.
 *   node rocketlane-younium-status/test/chat-sync-e2e.js   (screenshots in rocketlane-younium-status/test/out/) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/Thomas/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = path.join(__dirname, 'out');
const src = fs.readFileSync(path.join(__dirname, '..', 'rocketlane-younium-status.user.js'), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('  // @@ZDSYNC-ENGINE-START'), to = src.indexOf('  // @@ZDSYNC-END');
assert.ok(from > 0 && to > from, 'the sync is in the userscript, between its markers');
const SYNC = src.slice(from, to);
// the Chat Bridge's hand-over (its 1.19.0), to see its links come over
const bridge = fs.readFileSync(path.join(__dirname, '..', '..', 'rocketlane-chat-bridge', 'rocketlane-chat-bridge.user.js'), 'utf8').replace(/\r\n/g, '\n');
const HANDOVER = bridge.slice(bridge.indexOf('  // @@ZDSYNC-HANDOVER-START'), bridge.indexOf('  // @@ZDSYNC-HANDOVER-END'));
assert.ok(HANDOVER.includes('function handOverZendeskChatSync'), 'the hand-over is in the Chat Bridge');
// the script's transports (sections 5b and 8) as the sync is given them, here over the page's GM_xmlhttpRequest
const NET = `{
  zdHost: 'https://iwmac.zendesk.com',
  zdRequest: (method, p, body) => window.__send(method, /^https:/.test(p) ? p : 'https://iwmac.zendesk.com/api/v2' + p,
    method === 'GET' ? {} : { 'X-CSRF-Token': GM_getValue('zdCsrfToken', '') }, body),
  rlRequest: (method, p, query, body) => window.__send(method, 'https://kiona.api.rocketlane.com/api/v1' + p, { 'api-key': 'rl-key' }, body),
  userId: () => '1',
  plantFieldId: async () => ((await window.__send('GET', 'https://iwmac.zendesk.com/api/v2/ticket_fields.json', {}, null)).ticket_fields
    .find((f) => f.title === 'Plant ID') || {}).id || 0,
  pusher: () => null,
  zdFile: (url) => window.__zdFile(url),
  rlUpload: (projectId, blob, name) => window.__rlUpload(projectId, blob, name),
  rlFile: (id) => window.__rlFile(id),
  zdUpload: (blob, name) => window.__zdUpload(blob, name),
}`;
const START = '(function(){' + SYNC + '\nstartZendeskChatSync(' + NET + ');})();';

// the page's stand-ins: Tampermonkey's storage and menu, and GM_xmlhttpRequest answered by a fake Rocketlane + Zendesk
const SHIM = `
window.__menu = [];
window.GM_getValue = (k, d) => { const v = localStorage.getItem('gm:' + k); return v == null ? d : JSON.parse(v); };
window.GM_setValue = (k, v) => localStorage.setItem('gm:' + k, JSON.stringify(v));
window.GM_registerMenuCommand = (name, fn) => window.__menu.push({ name, fn });
const W = window.__world = {
  chat: [{ commentId: 12, messageType: 'USER_MESSAGE', content: '<p>Gammel melding</p>', createdAt: Date.now() - 60000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } }],
  zd: [{ id: 4001, author_id: 700, public: true, plain_body: 'Gammel kundemelding', created_at: '2026-10-27T08:00:00Z', attachments: [] }],
  queue: [
    { id: 53125, subject: 'Laksvollen ny bruker', status: 'new', updated_at: '2026-10-27T08:00:00Z', custom_fields: [{ id: 27741611, value: 0 }] },
    { id: 53123, subject: 'SV: 41584 Extra Laksvollen - alarm', status: 'open', updated_at: '2026-10-28T09:00:00Z', custom_fields: [{ id: 27741611, value: 10263 }] },
    { id: 53130, subject: 'Annen butikk', status: 'pending', updated_at: '2026-10-28T09:30:00Z', custom_fields: [{ id: 27741611, value: 4836 }] },
    { id: 53126, subject: '10263 gammel sak', status: 'solved', updated_at: '2026-10-20T08:00:00Z' },
    { id: 53131, subject: 'Service på vent', status: 'hold', updated_at: '2026-10-26T08:00:00Z', custom_fields: [{ id: 27741611, value: 2792 }] },
  ],
  queries: [],
  addZd(c) { W.zd.push(c); const t = W.queue.find((x) => x.id === 53123); if (t) t.updated_at = new Date(Date.now() + W.zd.length).toISOString(); },
  puts: [], posts: [], nextRl: 100, nextZd: 5000,
  // Zendesk's files by their token: pictures drawn at their size, a PDF as a few bytes
  files: { shot: { w: 1010, h: 842, type: 'image/png' }, icon: { w: 26, h: 26, type: 'image/png' }, logo: { w: 226, h: 88, type: 'image/png' }, pdf: { type: 'application/pdf' } },
  uploads: [], zdUploads: [],
};
// the script's file transports: a Zendesk file by its token address, and an upload to Rocketlane
window.__zdFile = async (url) => {
  const f = W.files[new URL(url).pathname.split('/')[3]];
  if (!f) throw new Error('HTTP 404');
  if (f.type !== 'image/png') return new Blob(['%PDF-1.4 test'], { type: f.type });
  const c = new OffscreenCanvas(f.w, f.h);
  c.getContext('2d').fillRect(0, 0, f.w, f.h);
  return c.convertToBlob({ type: 'image/png' });
};
// and the other way: a chat file from Rocketlane, an upload to Zendesk
window.__rlFile = async (id) => ({ blob: new Blob(['file ' + id], { type: 'application/pdf' }), fileName: 'f' + id, mimeType: 'application/pdf' });
window.__zdUpload = async (blob, name) => { W.zdUploads.push({ name, size: blob.size, type: blob.type }); return 'zd-tok-' + W.zdUploads.length; };
window.__rlUpload = async (projectId, blob, name) => {
  W.uploads.push({ p: String(projectId), name, type: blob.type, size: blob.size });
  return { attachmentId: 7000 + W.uploads.length, name, sizeInBytes: blob.size, publicVisibility: false, projectId: Number(projectId) };
};
window.GM_xmlhttpRequest = (o) => {
  const u = new URL(o.url), p = u.pathname, body = o.data ? JSON.parse(o.data) : null;
  const ok = (j) => setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify(j) }), 30);
  if (u.host === 'kiona.api.rocketlane.com') {
    if (o.headers['api-key'] !== 'rl-key') return setTimeout(() => o.onload({ status: 401, responseText: '' }), 10);
    if (p === '/api/v1/projects/1481787') return ok({ projectId: 1481787, projectName: '10263 - Extra Laksvollen: New store' });
    if (p.endsWith('/project-conversations/12896932/conversations')) return ok({ comments: W.chat });
    if (p.endsWith('/project-conversations/12896932/comments') && o.method === 'POST') {
      const c = Object.assign({ commentId: W.nextRl++, createdAt: Date.now() }, body.comment);
      W.chat.push(c); W.posts.push(body.comment);
      // the open chat shows it, as Rocketlane's push event would - unless a test says it does not
      if (W.renderPosts !== false) { const d = document.createElement('div'); d.className = 'msg'; d.innerHTML = body.comment.content; document.body.appendChild(d); }
      return ok({ comment: c });
    }
  }
  if (u.host === 'iwmac.zendesk.com') {
    if (o.method !== 'GET' && o.headers['X-CSRF-Token'] !== 'csrf-1') return setTimeout(() => o.onload({ status: 403, responseText: '' }), 10);
    if (p === '/api/v2/views.json') return ok({ views: [{ id: 9, title: 'Annen kø' }, { id: 77, title: 'IWMAC Leveranse - Kulde' }], next_page: null });
    // the view: new and open tickets only, as "IWMAC Leveranse - Kulde" (status less than pending, two groups)
    if (p === '/api/v2/views/77/tickets.json') return ok({ tickets: W.queue.filter((t) => t.status === 'new' || t.status === 'open'), next_page: null });
    if (p === '/api/v2/views/77.json') return ok({ view: { id: 77, conditions: {
      all: [{ field: 'status', operator: 'less_than', value: 'pending' }, { field: 'current_tags', operator: 'not_includes', value: 'ny_kulde' }],
      any: [{ field: 'group_id', operator: 'is', value: '360002360679' }, { field: 'group_id', operator: 'is', value: '28952105' }] } } });
    if (p === '/api/v2/search.json') { W.queries.push(u.searchParams.get('query')); return ok({ results: W.queue.filter((t) => t.status !== 'solved').map((t) => Object.assign({ result_type: 'ticket' }, t)), next_page: null }); }
    if (p === '/api/v2/ticket_fields.json') return ok({ ticket_fields: [{ id: 1, title: 'Subject' }, { id: 27741611, title: 'Plant ID' }], next_page: null });
    if (p === '/api/v2/tickets/show_many.json') { const ids = u.searchParams.get('ids').split(','); return ok({ tickets: W.queue.filter((t) => ids.includes(String(t.id))) }); }
    if (p === '/api/v2/tickets/53123/comments.json') return ok({ comments: W.zd.slice().reverse(), users: [{ id: 700, name: 'Kari Kunde', role: 'end-user' }, { id: 900, name: 'Thomas', role: 'agent' }], next_page: null });
    if (p === '/api/v2/tickets/53123.json' && o.method === 'GET') return ok({ ticket: { id: 53123, requester_id: 700, email_cc_ids: [901, 902] }, users: [{ id: 700, name: 'Kari Kunde' }] });
    if (p === '/api/v2/tickets/53123.json' && o.method === 'PUT') {
      const c = { id: W.nextZd++, author_id: 900, public: body.ticket.comment.public, plain_body: body.ticket.comment.body, created_at: new Date().toISOString(), attachments: [] };
      W.addZd(c); W.puts.push(body.ticket.comment); return ok({ ticket: { id: 53123 }, audit: { events: [{ type: 'Comment', id: c.id }] } });
    }
  }
  setTimeout(() => o.onload({ status: 404, responseText: '{}' }), 10);
};
// what the script's transports do with an answer: its JSON, or an error that starts with the HTTP status
window.__send = (method, url, headers, body) => new Promise((resolve, reject) => GM_xmlhttpRequest({
  method, url, headers: Object.assign({ accept: 'application/json' }, headers), data: body == null ? undefined : JSON.stringify(body),
  onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.responseText ? JSON.parse(r.responseText) : null)
    : reject(new Error('HTTP ' + r.status + ': ' + String(r.responseText || '').slice(0, 300)))),
}));
GM_setValue('zdCsrfToken', 'csrf-1'); GM_setValue('zdsync_enabled_v1', false);
`;

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>General chat</title></head>' +
  '<body style="margin:0;font:14px Arial;background:#fafafa"><div style="padding:20px">General chat : 10263 - Extra Laksvollen: New store</div></body></html>';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.addInitScript(SHIM);
    await page.goto(base + '/projects/1481787/chat/12896932');
    // an older Chat Bridge's button in the page (up to 1.18.0 it ran the sync itself): this one keeps away
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'zendesk-chat-sync'; document.body.appendChild(d); });
    await page.addScriptTag({ content: START });
    const pill = page.locator('#rl-zendesk-chat-sync >> .pill');
    const pillText = () => page.evaluate(() => document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent.trim());
    await page.waitForTimeout(1500);
    assert.strictEqual(await pill.isVisible(), false, 'no second button while the Chat Bridge shows its own');
    // the Chat Bridge updated (its button gone): this one shows
    await page.evaluate(() => document.getElementById('zendesk-chat-sync').remove());
    await pill.waitFor();
    // off in this browser: the button says so, and its panel turns it on
    assert.strictEqual(await pillText(), 'Zendesk ⇄ off');
    await pill.click();
    await page.locator('#rl-zendesk-chat-sync >> text=The Zendesk sync is off').waitFor();
    await page.screenshot({ path: path.join(OUT, '0-off.png') });
    await page.locator('#rl-zendesk-chat-sync >> text=Turn on in this browser').click();

    // turned on: the ticket whose Plant ID is the project's number is found, and the user is asked whether to link it
    await page.locator('#rl-zendesk-chat-sync >> text=Found a ticket for this project').waitFor();
    assert.strictEqual(await page.locator('#rl-zendesk-chat-sync >> .row .s').first().textContent(), '#53123 SV: 41584 Extra Laksvollen - alarm');
    assert.match(await page.locator('#rl-zendesk-chat-sync >> .row .muted').first().textContent(), /^open · Plant ID 10263 · /);
    await page.screenshot({ path: path.join(OUT, '1-asked.png') });

    // "Not now": the question goes, the button still names the ticket, and this chat is not asked about it again
    await page.locator('#rl-zendesk-chat-sync >> text=Not now').click();
    await page.waitForFunction(() => /found/.test(document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    assert.strictEqual(await pillText(), 'Zendesk #53123 found · Link');
    await page.waitForTimeout(1500);
    assert.strictEqual(await page.locator('#rl-zendesk-chat-sync >> .panel').isVisible(), false, 'not asked again');
    assert.deepStrictEqual(await page.evaluate(() => GM_getValue('zdsync_not_now_v1', {})), { '1481787:12896932': '53123' });
    await page.screenshot({ path: path.join(OUT, '1b-found.png') });

    // the button asks again; "Choose another ticket" lists the queue, best match first
    await pill.click();
    await page.locator('#rl-zendesk-chat-sync >> text=Choose another ticket').click();
    await page.locator('#rl-zendesk-chat-sync >> text=Link the chat to a ticket in the queue').waitFor();
    await page.locator('#rl-zendesk-chat-sync >> .row').first().waitFor();
    const rows = await page.locator('#rl-zendesk-chat-sync >> .row .s').allTextContents();
    assert.deepStrictEqual(rows, ['#53123 SV: 41584 Extra Laksvollen - alarmPlant ID 10263', '#53125 Laksvollen ny bruker', '#53130 Annen butikk', '#53131 Service på vent'],
      'every active status - waiting for the customer and on hold too, never solved - best match first');
    assert.deepStrictEqual([...new Set((await page.evaluate(() => window.__world)).queries)],
      ['type:ticket status<solved group:360002360679 group:28952105 -tags:ny_kulde'], 'the view\'s groups and exclusions, at every active status');
    await page.screenshot({ path: path.join(OUT, '1c-queue.png') });

    // "Link" in the list asks once more: "Cancel" takes it back, "Yes, link" links
    await page.locator('#rl-zendesk-chat-sync >> .row').first().locator('button').click();
    await page.locator('#rl-zendesk-chat-sync >> text=Cancel').click();
    assert.strictEqual(await page.locator('#rl-zendesk-chat-sync >> .row').first().locator('button').textContent(), 'Link');
    assert.strictEqual((await page.evaluate(() => window.__world)).posts.length, 0, 'nothing linked yet');
    await page.locator('#rl-zendesk-chat-sync >> .row').first().locator('button').click();
    await page.locator('#rl-zendesk-chat-sync >> text=Yes, link #53123').click();
    // linked: the button turns from "found" to the link's state
    await page.waitForFunction(() => /#53123 ⇄/.test(document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    let w = await page.evaluate(() => window.__world);
    assert.strictEqual(w.posts.length, 2, 'the notice, then the ticket\'s earlier messages');
    assert.strictEqual(w.posts[0].content, '<p><a href="https://iwmac.zendesk.com/agent/tickets/53123" target="_blank" rel="noopener noreferrer">Zendesk #53123</a>' +
      ' is linked to this chat · SV: 41584 Extra Laksvollen - alarm</p><p>Messages here go to the ticket as internal notes. Start with /reply to answer the customer.</p>');
    assert.match(w.posts[1].content, /^<p><b>Zendesk #53123<\/b> · earlier messages \(1 in all\)<\/p><p><br><\/p><p><b>Kari Kunde<\/b> \(customer\) · .*<p>Gammel kundemelding<\/p>$/);
    assert.deepStrictEqual(w.posts.map((p) => p.private), [true, true]);

    // a customer's reply in Zendesk, a /reply message and an internal one in the chat; then "Sync now"
    await page.evaluate(() => {
      const W = window.__world;
      W.addZd({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Alarmen kom tilbake i natt.', created_at: new Date().toISOString(), attachments: [] });
      W.chat.push({ commentId: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>/reply Hei Kari, vi sender en tekniker.</p>', createdAt: Date.now() + 1000, user: { userId: 1, firstName: 'Thomas' } });
      W.chat.push({ commentId: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>Sjekk kompressor 2.</p>', createdAt: Date.now() + 2000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } });
    });
    await pill.click();
    await page.locator('#rl-zendesk-chat-sync >> text=Sync now').click();
    await page.waitForFunction(() => window.__world.puts.length === 2, null, { timeout: 15000 });
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual(w.posts.slice(2).map((p) => [p.content, p.private]), [['<p><b>Zendesk #53123</b> · Kari Kunde (customer)</p><p>Alarmen kom tilbake i natt.</p>', true]]);
    assert.deepStrictEqual(w.puts, [
      { body: 'Hei Kari, vi sender en tekniker.', public: true },
      { body: 'Andreas Sandnes (Rocketlane):\nSjekk kompressor 2.', public: false },
    ]);
    await page.waitForFunction(() => /synced/.test(document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    await page.screenshot({ path: path.join(OUT, '2-linked.png') });

    // another round brings nothing back
    await page.locator('#rl-zendesk-chat-sync >> text=Sync now').click().catch(() => {});
    await page.waitForTimeout(1500);
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual([w.posts.length, w.puts.length], [3, 2], 'nothing twice, nothing echoed');
    assert.strictEqual(await page.locator('#rl-zendesk-chat-sync >> text="Post earlier messages"').count(), 0, 'a new link has its history already');
    assert.strictEqual(await page.locator('#rl-zendesk-chat-sync >> text="Post earlier messages again"').count(), 1, 'it can be posted again, after the old copies are deleted');

    // a message the open chat does not show: the chat view is reloaded in place, its route left and entered again
    await page.evaluate(() => {
      window.__pops = [];
      addEventListener('popstate', () => window.__pops.push(location.pathname));
      const W = window.__world;
      W.renderPosts = false;
      W.addZd({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Enda en melding.', created_at: new Date().toISOString(), attachments: [] });
    });
    await page.locator('#rl-zendesk-chat-sync >> text=Sync now').click();
    await page.waitForFunction(() => window.__pops.length >= 2, null, { timeout: 15000 });
    assert.deepStrictEqual(await page.evaluate(() => window.__pops), ['/projects/1481787/chat', '/projects/1481787/chat/12896932']);
    assert.strictEqual(await page.evaluate(() => location.pathname), '/projects/1481787/chat/12896932', 'back on the chat');
    // never while something is typed in the message box
    await page.evaluate(() => {
      window.__pops = [];
      const ed = document.createElement('div');
      ed.setAttribute('contenteditable', 'true');
      ed.id = 'draft';
      ed.textContent = 'Halvskrevet svar';
      document.body.appendChild(ed);
      const W = window.__world;
      W.addZd({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Og en til.', created_at: new Date().toISOString(), attachments: [] });
    });
    // the route change closed the panel (or is about to): open it again for Sync now
    await page.waitForTimeout(1300);
    if (!(await page.locator('#rl-zendesk-chat-sync >> .panel').isVisible())) await pill.click();
    await page.locator('#rl-zendesk-chat-sync >> text=Sync now').click();
    await page.waitForFunction(() => window.__world.posts.some((p) => /Og en til/.test(p.content)), null, { timeout: 15000 });
    await page.waitForTimeout(3500);
    assert.deepStrictEqual(await page.evaluate(() => window.__pops), [], 'not reloaded under a draft');
    await page.evaluate(() => { document.getElementById('draft').remove(); window.__world.renderPosts = true; });

    // a Zendesk email with a screenshot in its text, an icon, a signature's logo and an attached drawing: the screenshot and
    // the drawing go with its chat message as Rocketlane attachments - not the icon (too small), not the logo (signature)
    await page.evaluate(() => {
      const W = window.__world, T = (t, n) => 'https://iwmac.zendesk.com/attachments/token/' + t + '/?name=' + n;
      W.addZd({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Som vist i klipp under.\n\nMvh\nKari', created_at: new Date().toISOString(),
        html_body: '<p>Som vist i klipp under.</p><p><img src="' + T('shot', 'image001.png') + '"></p><p><img src="' + T('icon', 'image002.png') + '"></p>' +
          '<p>Mvh</p><p>Kari</p><p><img src="' + T('logo', 'image003.png') + '"></p>',
        attachments: [{ file_name: 'tegning.pdf', content_url: T('pdf', 'tegning.pdf'), content_type: 'application/pdf', size: 20 }] });
    });
    await page.waitForTimeout(1300);
    if (!(await page.locator('#rl-zendesk-chat-sync >> .panel').isVisible())) await pill.click();
    assert.strictEqual(await page.locator('#rl-zendesk-chat-sync >> text=Post earlier images and files').count(), 0, 'a link made now has its files already');
    await page.locator('#rl-zendesk-chat-sync >> text=Sync now').click();
    await page.waitForFunction(() => window.__world.posts.some((p) => /Som vist i klipp under/.test(p.content)), null, { timeout: 15000 });
    w = await page.evaluate(() => window.__world);
    const filed = w.posts.find((p) => /Som vist i klipp under/.test(p.content));
    assert.deepStrictEqual(w.uploads.map((u) => [u.p, u.name, u.type]), [['1481787', 'image001.png', 'image/png'], ['1481787', 'tegning.pdf', 'application/pdf']],
      'the screenshot and the drawing uploaded to the project, not the icon or the logo');
    assert.deepStrictEqual(filed.commentMeta.linkedAttachments.map((a) => [a.name, a.publicVisibility]), [['image001.png', false], ['tegning.pdf', false]], 'linked by the message');
    assert.strictEqual(filed.private, true);
    assert.ok(!/Attachments:/.test(filed.content), 'not linked to Zendesk as well');
    await page.screenshot({ path: path.join(OUT, '2b-files.png') });

    // the other way: a file attached in the chat goes to the ticket with its message, an internal note
    await page.evaluate(() => {
      const W = window.__world;
      W.chat.push({ commentId: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>Oppdatert tegning vedlagt.</p>', createdAt: Date.now() + 5000,
        user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' }, commentMeta: { linkedAttachments: [{ attachmentId: 555, name: 'tegning-v2.pdf', sizeInBytes: 9 }] } });
    });
    await page.locator('#rl-zendesk-chat-sync >> text=Sync now').click();
    await page.waitForFunction(() => window.__world.puts.some((p) => /Oppdatert tegning/.test(p.body)), null, { timeout: 15000 });
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual(w.zdUploads, [{ name: 'tegning-v2.pdf', size: 8, type: 'application/pdf' }], 'fetched from Rocketlane, uploaded to Zendesk');
    assert.deepStrictEqual(w.puts[w.puts.length - 1], { body: 'Andreas Sandnes (Rocketlane):\nOppdatert tegning vedlagt.', public: false, uploads: ['zd-tok-1'] });

    // the message box says what the message will be on the ticket: a quiet label for a note, an orange frame and bar for
    // /reply with who gets the email, a warning for a near miss
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'composer';
      box.style.cssText = 'position:fixed;left:40px;right:40px;bottom:20px;height:110px;border:1px solid #e0e0e0;border-radius:8px;background:#fff';
      box.innerHTML = '<span data-cy="messages-comment-rte"><div class="ck-editor__editable" contenteditable="true" style="min-height:50px;padding:10px;outline:none"><p></p></div></span>';
      document.body.appendChild(box);
    });
    const mode = () => page.evaluate(() => {
      const r = document.querySelector('#rl-zendesk-chat-sync').shadowRoot, b = r.querySelector('.mode'), f = r.querySelector('.frame');
      return { bar: b.hidden ? null : b.className.replace('mode ', '') + ': ' + b.textContent, frame: !f.hidden };
    });
    const barIs = (re) => page.waitForFunction((src) => {
      const b = document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.mode');
      return !b.hidden && new RegExp(src).test(b.className.replace('mode ', '') + ': ' + b.textContent);
    }, re.source, { timeout: 5000 });
    await page.locator('#composer .ck-editor__editable').click();
    await barIs(/^note: /);
    assert.deepStrictEqual(await mode(), { bar: 'note: Internal note to Zendesk #53123 · start with /reply to answer the customer', frame: false });
    await page.keyboard.type('/repl');
    await page.waitForTimeout(200);
    assert.strictEqual((await mode()).bar.slice(0, 5), 'note:', 'not yet, while it is typed');
    await page.keyboard.type('y Hei Kari');
    await barIs(/Kari Kunde/);
    assert.deepStrictEqual(await mode(), { bar: 'reply: ↩ Reply to the customer · Zendesk #53123 · emailed to Kari Kunde and 2 in copy', frame: true });
    const [fr, bx] = await page.evaluate(() => [document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.frame').getBoundingClientRect().toJSON(),
      document.getElementById('composer').getBoundingClientRect().toJSON()]);
    assert.ok(fr.left < bx.left && fr.right > bx.right && fr.top < bx.top && fr.bottom > bx.bottom, 'the frame goes round the box');
    await page.screenshot({ path: path.join(OUT, '5-reply-mode.png') });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('/replay Hei');
    await barIs(/^typo: /);
    assert.deepStrictEqual(await mode(), { bar: 'typo: “/replay” is not /reply: this goes to Zendesk #53123 as an internal note', frame: false });
    await page.screenshot({ path: path.join(OUT, '5b-near-miss.png') });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('/kunde hei');
    await barIs(/“\/kunde”/);
    // emptied, as after sending: quiet again; out of the box: nothing
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await barIs(/^note: /);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await mode(), { bar: null, frame: false });
    await page.evaluate(() => document.getElementById('composer').remove());

    // off in the menu: the button stays on the chat page, greyed
    const menu = await page.evaluate(() => window.__menu.map((m) => m.name));
    assert.deepStrictEqual(menu, ['❌ Zendesk ⇄ General Chat sync', 'Zendesk queue for the sync: IWMAC Leveranse - Kulde…'], 'registered while it was off');
    await page.evaluate(() => window.__menu[0].fn());
    await page.waitForTimeout(1200);
    assert.strictEqual(await pillText(), 'Zendesk ⇄ off', 'turned off: the button stays, greyed');
    assert.strictEqual(await pill.isVisible(), true);

    // away from the chat (Rocketlane changes page without loading one): no button, not even an empty one; back: there
    await page.evaluate(() => history.pushState({}, '', '/projects/1481787/tasks'));
    await page.waitForTimeout(1300);
    assert.strictEqual(await pill.isVisible(), false, 'hidden off chat pages (its own display:flex once beat [hidden])');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.pill')).display), 'none');
    await page.screenshot({ path: path.join(OUT, '3-away.png') });
    await page.evaluate(() => history.pushState({}, '', '/projects/1481787/chat/12896932'));
    await page.waitForTimeout(1300);
    assert.strictEqual(await pill.isVisible(), true, 'shown again on the chat page');

    // ---- the Chat Bridge's links come over: its 1.19.0 hands them over, this sync takes them, nothing is posted again ----
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page2.on('pageerror', (e) => errors.push(String(e)));
    page2.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page2.addInitScript(SHIM);
    await page2.goto(base + '/projects/1481787/chat/12896932');
    await page2.evaluate((hand) => {
      const W = window.__world;
      // the Chat Bridge's own storage as 1.18.0 left it: on, this chat linked to #53123, its history posted, all crossed
      const store = {};
      const get = (k, d) => (k in store ? store[k] : d), set = (k, v) => { store[k] = v; };
      set('zdsync_enabled_v1', true);
      set('zdsync_state_v1', JSON.stringify({ links: { '1481787:12896932': {
        projectId: '1481787', conversationId: '12896932', ticketId: '53123', subject: 'SV: 41584 Extra Laksvollen - alarm',
        linkedAt: Date.now() - 86400000, zdMax: 4001, rlSince: Math.max(...W.chat.map((c) => c.createdAt)),
        rlSeen: W.chat.map((c) => String(c.commentId)), ownRl: [], ownZd: [], status: 'active', note: '', lastRun: Date.now() - 60000,
        historyPosted: true, zdUpdatedAt: '2026-10-28T09:00:00Z' } } }));
      set('zdsync_not_now_v1', { '1481787:99': '53125' });
      // the ticket's first message had a drawing attached, which the chat got as a link only
      W.zd[0].attachments = [{ file_name: 'A0.pdf', content_url: 'https://iwmac.zendesk.com/attachments/token/pdf/?name=A0.pdf', content_type: 'application/pdf', size: 20 }];
      new Function('GM_getValue', 'GM_setValue', hand + '\nreturn handOverZendeskChatSync;')(get, set)();
      window.__bridgeStore = store;
      localStorage.removeItem('gm:zdsync_enabled_v1');   // this script: never turned on or off
    }, HANDOVER);
    assert.ok(await page2.evaluate(() => !!localStorage.getItem('rlimp_zdsync_handover_v1')), 'handed over through the page\'s localStorage');
    await page2.addScriptTag({ content: START });
    await page2.waitForFunction(() => /^Zendesk #53123 ⇄ /.test(document.querySelector('#rl-zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    assert.deepStrictEqual(await page2.evaluate(() => ({
      posts: window.__world.posts.length, puts: window.__world.puts.length, left: localStorage.getItem('rlimp_zdsync_handover_v1'),
      on: GM_getValue('zdsync_enabled_v1', null), notNow: GM_getValue('zdsync_not_now_v1', {}), adopted: GM_getValue('zdsync_adopted_v1', 0) > 0,
      bridgeOn: window.__bridgeStore.zdsync_enabled_v1, bridgeDone: window.__bridgeStore.zdsync_handed_over_v1 > 0 })),
    { posts: 0, puts: 0, left: null, on: true, notNow: { '1481787:99': '53125' }, adopted: true, bridgeOn: false, bridgeDone: true },
    'linked here as it was there, on, nothing posted; the Chat Bridge\'s sync off');
    // a new message on the ticket: only that one comes in - no notice, no earlier messages again, nothing sent twice
    await page2.evaluate(() => { const W = window.__world; W.addZd({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Etter flyttingen.', created_at: new Date().toISOString(), attachments: [] }); });
    await page2.locator('#rl-zendesk-chat-sync >> .pill').click();
    await page2.locator('#rl-zendesk-chat-sync >> text=Sync now').click();
    await page2.waitForFunction(() => window.__world.posts.length >= 1, null, { timeout: 15000 });
    await page2.waitForTimeout(1500);
    w = await page2.evaluate(() => window.__world);
    assert.deepStrictEqual(w.posts.map((p) => p.content), ['<p><b>Zendesk #53123</b> · Kari Kunde (customer)</p><p>Etter flyttingen.</p>']);
    assert.strictEqual(w.puts.length, 0, 'the chat\'s old messages stay where they are');
    // linked before files came along: the panel offers the earlier ones, once
    await page2.locator('#rl-zendesk-chat-sync >> text=Post earlier images and files').click();
    await page2.locator('#rl-zendesk-chat-sync >> text=1 file posted').waitFor({ timeout: 15000 });
    w = await page2.evaluate(() => window.__world);
    assert.match(w.posts[1].content, /^<p><b>Zendesk #53123<\/b> · Kari Kunde \(customer\) · .* · images and files<\/p>$/);
    assert.deepStrictEqual(w.posts[1].commentMeta.linkedAttachments.map((a) => a.name), ['A0.pdf']);
    assert.strictEqual(await page2.evaluate(() => JSON.parse(GM_getValue('zdsync_state_v1', '{}')).links['1481787:12896932'].filesPosted), true);
    await page2.screenshot({ path: path.join(OUT, '4-handed-over.png') });

    assert.deepStrictEqual(errors, [], 'no errors or warnings in the page');
    console.log('chat sync e2e passed; screenshots in ' + path.relative(process.cwd(), OUT));
  } catch (e) {
    console.error('E2E FAILED:', (e && e.stack) || e, '\npage errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
