'use strict';
/* Zendesk ⇄ General Chat (v1.16.0) in a real browser: the userscript's sync - engine, button and panel - on a page
 * at a Rocketlane chat path, its GM_* calls answered in the page by an in-memory Rocketlane and Zendesk. Link a ticket
 * from the queue, a customer's reply into the chat, a /kunde message out to the ticket.
 *   node rocketlane-chat-bridge/test/chat-sync-e2e.js   (screenshots in rocketlane-chat-bridge/test/out/) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

const PW = process.env.PLAYWRIGHT_CORE || 'C:/Users/Thomas/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(PW);
const OUT = path.join(__dirname, 'out');
const src = fs.readFileSync(path.join(__dirname, '..', 'rocketlane-chat-bridge.user.js'), 'utf8').replace(/\r\n/g, '\n');
const from = src.indexOf('  // @@ZDSYNC-ENGINE-START'), to = src.indexOf('  // Side A');
assert.ok(from > 0 && to > from, 'the sync is in the userscript, before Side A');
const SYNC = src.slice(from, src.lastIndexOf('\n  // ──', to));

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
  puts: [], posts: [], nextRl: 100, nextZd: 5000,
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
      W.chat.push(c); W.posts.push(body.comment); return ok({ comment: c });
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
    if (p === '/api/v2/tickets/53123.json' && o.method === 'PUT') {
      const c = { id: W.nextZd++, author_id: 900, public: body.ticket.comment.public, plain_body: body.ticket.comment.body, created_at: new Date().toISOString(), attachments: [] };
      W.zd.push(c); W.puts.push(body.ticket.comment); return ok({ ticket: { id: 53123 }, audit: { events: [{ type: 'Comment', id: c.id }] } });
    }
  }
  setTimeout(() => o.onload({ status: 404, responseText: '{}' }), 10);
};
GM_setValue('rlApiKey', 'rl-key'); GM_setValue('rlUserId', 1); GM_setValue('zdCsrfToken', 'csrf-1'); GM_setValue('zdsync_enabled_v1', false);
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
    await page.addScriptTag({ content: '(function(){' + SYNC + '\nstartZendeskChatSync();})();' });
    const pill = page.locator('#zendesk-chat-sync >> .pill');
    const pillText = () => page.evaluate(() => document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent.trim());
    await pill.waitFor();
    // off in this browser: the button says so, and its panel turns it on
    assert.strictEqual(await pillText(), 'Zendesk ⇄ off');
    await pill.click();
    await page.locator('#zendesk-chat-sync >> text=The Zendesk sync is off').waitFor();
    await page.screenshot({ path: path.join(OUT, '0-off.png') });
    await page.locator('#zendesk-chat-sync >> text=Turn on in this browser').click();

    // turned on: the ticket whose Plant ID is the project's number is found, and the user is asked whether to link it
    await page.locator('#zendesk-chat-sync >> text=Found a ticket for this project').waitFor();
    assert.strictEqual(await page.locator('#zendesk-chat-sync >> .row .s').first().textContent(), '#53123 SV: 41584 Extra Laksvollen - alarm');
    assert.match(await page.locator('#zendesk-chat-sync >> .row .muted').first().textContent(), /^open · Plant ID 10263 · /);
    await page.screenshot({ path: path.join(OUT, '1-asked.png') });

    // "Not now": the question goes, the button still names the ticket, and this chat is not asked about it again
    await page.locator('#zendesk-chat-sync >> text=Not now').click();
    await page.waitForFunction(() => /found/.test(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    assert.strictEqual(await pillText(), 'Zendesk #53123 found · Link');
    await page.waitForTimeout(1500);
    assert.strictEqual(await page.locator('#zendesk-chat-sync >> .panel').isVisible(), false, 'not asked again');
    assert.deepStrictEqual(await page.evaluate(() => GM_getValue('zdsync_not_now_v1', {})), { '1481787:12896932': '53123' });
    await page.screenshot({ path: path.join(OUT, '1b-found.png') });

    // the button asks again; "Choose another ticket" lists the queue, best match first
    await pill.click();
    await page.locator('#zendesk-chat-sync >> text=Choose another ticket').click();
    await page.locator('#zendesk-chat-sync >> text=Link the chat to a ticket in the queue').waitFor();
    await page.locator('#zendesk-chat-sync >> .row').first().waitFor();
    const rows = await page.locator('#zendesk-chat-sync >> .row .s').allTextContents();
    assert.deepStrictEqual(rows, ['#53123 SV: 41584 Extra Laksvollen - alarmPlant ID 10263', '#53125 Laksvollen ny bruker', '#53130 Annen butikk', '#53131 Service på vent'],
      'every active status - waiting for the customer and on hold too, never solved - best match first');
    assert.deepStrictEqual([...new Set((await page.evaluate(() => window.__world)).queries)],
      ['type:ticket status<solved group:360002360679 group:28952105 -tags:ny_kulde'], 'the view\'s groups and exclusions, at every active status');
    await page.screenshot({ path: path.join(OUT, '1c-queue.png') });

    // "Link" in the list asks once more: "Cancel" takes it back, "Yes, link" links
    await page.locator('#zendesk-chat-sync >> .row').first().locator('button').click();
    await page.locator('#zendesk-chat-sync >> text=Cancel').click();
    assert.strictEqual(await page.locator('#zendesk-chat-sync >> .row').first().locator('button').textContent(), 'Link');
    assert.strictEqual((await page.evaluate(() => window.__world)).posts.length, 0, 'nothing linked yet');
    await page.locator('#zendesk-chat-sync >> .row').first().locator('button').click();
    await page.locator('#zendesk-chat-sync >> text=Yes, link #53123').click();
    // linked: the button turns from "found" to the link's state
    await page.waitForFunction(() => /#53123 ⇄/.test(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    let w = await page.evaluate(() => window.__world);
    assert.strictEqual(w.posts.length, 2, 'the notice, then the ticket\'s earlier messages');
    assert.match(w.posts[0].content, /^<p>Zendesk #53123 “SV: 41584 Extra Laksvollen - alarm” is now linked to this chat\./);
    assert.match(w.posts[1].content, /^<p><b>Zendesk #53123<\/b> · earlier messages \(1 in all\)<\/p><p><b>Kari Kunde<\/b> \(customer\) · .*<p>Gammel kundemelding<\/p>$/);
    assert.deepStrictEqual(w.posts.map((p) => p.private), [true, true]);

    // a customer's reply in Zendesk, a /kunde message and an internal one in the chat; then "Sync now"
    await page.evaluate(() => {
      const W = window.__world;
      W.zd.push({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Alarmen kom tilbake i natt.', created_at: new Date().toISOString(), attachments: [] });
      W.chat.push({ commentId: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>/kunde Hei Kari, vi sender en tekniker.</p>', createdAt: Date.now() + 1000, user: { userId: 1, firstName: 'Thomas' } });
      W.chat.push({ commentId: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>Sjekk kompressor 2.</p>', createdAt: Date.now() + 2000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } });
    });
    await pill.click();
    await page.locator('#zendesk-chat-sync >> text=Sync now').click();
    await page.waitForFunction(() => window.__world.puts.length === 2, null, { timeout: 15000 });
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual(w.posts.slice(2).map((p) => [p.content, p.private]), [['<p><b>Zendesk #53123</b> · Kari Kunde (customer)</p><p>Alarmen kom tilbake i natt.</p>', true]]);
    assert.deepStrictEqual(w.puts, [
      { body: 'Hei Kari, vi sender en tekniker.', public: true },
      { body: 'Andreas Sandnes (Rocketlane):\nSjekk kompressor 2.', public: false },
    ]);
    await page.waitForFunction(() => /synced/.test(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    await page.screenshot({ path: path.join(OUT, '2-linked.png') });

    // another round brings nothing back
    await page.locator('#zendesk-chat-sync >> text=Sync now').click().catch(() => {});
    await page.waitForTimeout(1500);
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual([w.posts.length, w.puts.length], [3, 2], 'nothing twice, nothing echoed');
    assert.strictEqual(await page.locator('#zendesk-chat-sync >> text=Post earlier messages').count(), 0, 'a new link has its history already');

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
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill')).display), 'none');
    await page.screenshot({ path: path.join(OUT, '3-away.png') });
    await page.evaluate(() => history.pushState({}, '', '/projects/1481787/chat/12896932'));
    await page.waitForTimeout(1300);
    assert.strictEqual(await pill.isVisible(), true, 'shown again on the chat page');

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
