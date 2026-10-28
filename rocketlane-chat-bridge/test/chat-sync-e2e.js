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
  chat: [{ id: 12, messageType: 'USER_MESSAGE', content: '<p>Gammel melding</p>', createdAt: Date.now() - 60000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } }],
  zd: [{ id: 4001, author_id: 700, public: true, plain_body: 'Gammel kundemelding', created_at: '2026-10-27T08:00:00Z', attachments: [] }],
  queue: [
    { id: 53125, subject: 'Laksvollen ny bruker', status: 'new', updated_at: '2026-10-27T08:00:00Z', custom_fields: [{ id: 27741611, value: 0 }] },
    { id: 53123, subject: 'SV: 41584 Extra Laksvollen - alarm', status: 'open', updated_at: '2026-10-28T09:00:00Z', custom_fields: [{ id: 27741611, value: 10263 }] },
    { id: 53130, subject: 'Annen butikk', status: 'pending', updated_at: '2026-10-28T09:30:00Z', custom_fields: [{ id: 27741611, value: 4836 }] },
    { id: 53126, subject: '10263 gammel sak', status: 'solved', updated_at: '2026-10-20T08:00:00Z' },
  ],
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
      const c = Object.assign({ id: W.nextRl++, createdAt: Date.now() }, body.comment);
      W.chat.push(c); W.posts.push(body.comment); return ok({ comment: c });
    }
  }
  if (u.host === 'iwmac.zendesk.com') {
    if (o.method !== 'GET' && o.headers['X-CSRF-Token'] !== 'csrf-1') return setTimeout(() => o.onload({ status: 403, responseText: '' }), 10);
    if (p === '/api/v2/views.json') return ok({ views: [{ id: 9, title: 'Annen kø' }, { id: 77, title: 'IWMAC Leveranse - Kulde' }], next_page: null });
    if (p === '/api/v2/views/77/tickets.json') return ok({ tickets: W.queue, next_page: null });
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
    assert.strictEqual(await pillText(), 'Zendesk ⇄ av');
    await pill.click();
    await page.locator('#zendesk-chat-sync >> text=Zendesk-synken er av').waitFor();
    await page.screenshot({ path: path.join(OUT, '0-off.png') });
    await page.locator('#zendesk-chat-sync >> text=Slå på i denne nettleseren').click();

    // the panel: the queue's active tickets, the one whose Plant ID is the project's number first
    await page.locator('#zendesk-chat-sync >> .row').first().waitFor();
    const rows = await page.locator('#zendesk-chat-sync >> .row .s').allTextContents();
    assert.deepStrictEqual(rows, ['#53123 SV: 41584 Extra Laksvollen - alarmPlant ID 10263', '#53125 Laksvollen ny bruker', '#53130 Annen butikk'], 'active only, best match first');
    await page.screenshot({ path: path.join(OUT, '1-queue.png') });
    // closed, the button names the ticket it found
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /funnet/.test(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    assert.strictEqual(await pillText(), 'Zendesk #53123 funnet · Koble');
    await page.screenshot({ path: path.join(OUT, '1b-found.png') });
    await pill.click();
    await page.locator('#zendesk-chat-sync >> .row').first().waitFor();
    await page.locator('#zendesk-chat-sync >> .row').first().locator('button').click();
    // linked: the button turns from "funnet" to the link's state
    await page.waitForFunction(() => /#53123 ⇄/.test(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    let w = await page.evaluate(() => window.__world);
    assert.strictEqual(w.posts.length, 1);
    assert.match(w.posts[0].content, /^<p>Zendesk #53123 «SV: 41584 Extra Laksvollen - alarm» er koblet til denne chatten\./);
    assert.strictEqual(w.posts[0].private, true);

    // a customer's reply in Zendesk, a /kunde message and an internal one in the chat; then "Synk nå"
    await page.evaluate(() => {
      const W = window.__world;
      W.zd.push({ id: W.nextZd++, author_id: 700, public: true, plain_body: 'Alarmen kom tilbake i natt.', created_at: new Date().toISOString(), attachments: [] });
      W.chat.push({ id: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>/kunde Hei Kari, vi sender en tekniker.</p>', createdAt: Date.now() + 1000, user: { userId: 1, firstName: 'Thomas' } });
      W.chat.push({ id: W.nextRl++, messageType: 'USER_MESSAGE', content: '<p>Sjekk kompressor 2.</p>', createdAt: Date.now() + 2000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } });
    });
    await pill.click();
    await page.locator('#zendesk-chat-sync >> text=Synk nå').click();
    await page.waitForFunction(() => window.__world.puts.length === 2, null, { timeout: 15000 });
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual(w.posts.slice(1).map((p) => [p.content, p.private]), [['<p><b>Zendesk #53123</b> · Kari Kunde (kunde)</p><p>Alarmen kom tilbake i natt.</p>', true]]);
    assert.deepStrictEqual(w.puts, [
      { body: 'Hei Kari, vi sender en tekniker.', public: true },
      { body: 'Andreas Sandnes (Rocketlane):\nSjekk kompressor 2.', public: false },
    ]);
    await page.waitForFunction(() => /synket/.test(document.querySelector('#zendesk-chat-sync').shadowRoot.querySelector('.pill').textContent));
    await page.screenshot({ path: path.join(OUT, '2-linked.png') });

    // another round brings nothing back
    await page.locator('#zendesk-chat-sync >> text=Synk nå').click().catch(() => {});
    await page.waitForTimeout(1500);
    w = await page.evaluate(() => window.__world);
    assert.deepStrictEqual([w.posts.length, w.puts.length], [2, 2], 'nothing twice, nothing echoed');

    // off in the menu: the button goes
    const menu = await page.evaluate(() => window.__menu.map((m) => m.name));
    assert.deepStrictEqual(menu, ['❌ Zendesk ⇄ General Chat-synk', 'Zendesk-kø for synken: IWMAC Leveranse - Kulde…'], 'registered while it was off');
    await page.evaluate(() => window.__menu[0].fn());
    await page.waitForTimeout(1200);
    assert.strictEqual(await pillText(), 'Zendesk ⇄ av', 'turned off: the button stays, greyed');

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
