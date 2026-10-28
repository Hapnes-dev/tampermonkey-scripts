'use strict';
/* Zendesk ⇄ General Chat (v1.16.0): the sync's engine, taken from the userscript as it stands, run against an
 * in-memory Rocketlane chat and an in-memory Zendesk.   node --test rocketlane-chat-bridge/test/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'rocketlane-chat-bridge.user.js'), 'utf8');
const a = src.indexOf('// @@ZDSYNC-ENGINE-START'), b = src.indexOf('// @@ZDSYNC-ENGINE-END');
assert.ok(a > 0 && b > a, 'the engine markers are in the userscript');
const createZendeskChatSync = new Function(src.slice(a, b) + '\nreturn createZendeskChatSync;')();

const RUNNER = 1;        // the Rocketlane user whose browser runs the sync
const ZD_RUNNER = 900;   // the same person in Zendesk

function world(opts = {}) {
  let clock = Date.parse('2026-10-28T10:00:00Z');
  const tick = () => (clock += 1000);
  const chat = [
    { id: 11, messageType: 'CONTROL_MESSAGE', content: 'joined', createdAt: clock - 50000, user: { userId: 2 } },
    { id: 12, messageType: 'USER_MESSAGE', content: '<p>Gammel melding</p>', createdAt: clock - 40000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } },
  ];
  let nextRl = 100, nextZd = 5000;
  const queue = [
    { id: 53123, subject: '10263 Extra Laksvollen - alarm', status: 'open', description: '', updated_at: '2026-10-28T09:00:00Z' },
    { id: 53124, subject: 'Faktura', status: 'pending', description: 'Gjelder anlegg 10263', updated_at: '2026-10-28T08:00:00Z' },
    { id: 53125, subject: 'Laksvollen ny bruker', status: 'new', description: '', updated_at: '2026-10-27T08:00:00Z' },
    { id: 53126, subject: '10263 gammel sak', status: 'solved', description: '', updated_at: '2026-10-20T08:00:00Z' },
  ];
  const zdComments = new Map([[53123, [
    { id: 4001, author_id: 700, public: true, plain_body: 'Gammel kundemelding', created_at: '2026-10-27T08:00:00Z', attachments: [] },
  ]]]);
  const zdUsers = [{ id: 700, name: 'Kari Kunde', role: 'end-user' }, { id: 800, name: 'Ola Agent', role: 'agent' }, { id: ZD_RUNNER, name: 'Thomas', role: 'agent' }];
  const posted = { rl: [], zd: [] };
  const state = { value: '{}' };
  const fail = { rlPost: 0, zdAdd: 0 };
  const deps = {
    now: () => clock,
    store: { load: () => JSON.parse(state.value), save: (s) => { state.value = JSON.stringify(s); } },
    rl: {
      userId: () => RUNNER,
      async getComments() { return JSON.parse(JSON.stringify(chat)); },
      async postComment(projectId, conversationId, html, isPrivate) {
        if (fail.rlPost > 0) { fail.rlPost--; throw new Error('Rocketlane svarte HTTP 502'); }
        const c = { id: nextRl++, messageType: 'USER_MESSAGE', content: html, private: isPrivate, createdAt: tick(), user: { userId: RUNNER, firstName: 'Thomas' } };
        chat.push(c);
        posted.rl.push({ projectId, conversationId, html, isPrivate });
        return opts.noRlIds ? null : { id: c.id };
      },
    },
    zd: {
      async queueTickets() { return JSON.parse(JSON.stringify(queue)); },
      async getComments(ticketId) { return { comments: JSON.parse(JSON.stringify(zdComments.get(Number(ticketId)) || [])), users: zdUsers }; },
      async addComment(ticketId, body, isPublic) {
        if (fail.zdAdd > 0) { fail.zdAdd--; throw new Error('Zendesk svarte HTTP 500'); }
        const c = { id: nextZd++, author_id: ZD_RUNNER, public: isPublic, plain_body: body, created_at: new Date(tick()).toISOString(), attachments: [] };
        zdComments.get(Number(ticketId)).push(c);
        posted.zd.push({ ticketId, body, isPublic });
        return { commentId: opts.noZdIds ? null : c.id };
      },
    },
  };
  const sync = createZendeskChatSync(deps);
  const say = (userId, html, first, last) => { const c = { id: nextRl++, messageType: 'USER_MESSAGE', content: html, private: false, createdAt: tick(), user: { userId, firstName: first, lastName: last } }; chat.push(c); return c; };
  const reply = (authorId, text, isPublic = true) => { const c = { id: nextZd++, author_id: authorId, public: isPublic, plain_body: text, created_at: new Date(tick()).toISOString(), attachments: [] }; zdComments.get(53123).push(c); return c; };
  return { sync, chat, queue, zdComments, posted, state, fail, say, reply, tick, deps };
}

test('the queue: active tickets only, the project\'s best match first', async () => {
  const w = world();
  const q = await w.sync.queue();
  assert.deepStrictEqual(q.map((t) => t.id), [53123, 53124, 53125], 'solved is not active');
  const ranked = w.sync.rankTickets(q, '10263 - Extra Laksvollen: New store');
  assert.deepStrictEqual(ranked.map((r) => [r.ticket.id, r.score]), [[53123, 14], [53124, 5], [53125, 2]], 'number in the subject, then in the text, then a word of the name');
});

test('linking: only an active ticket of the queue; nothing old goes across; the chat is told', async () => {
  const w = world();
  await assert.rejects(w.sync.link(1481787, 12896932, 53126), /ikke en aktiv sak/);
  await assert.rejects(w.sync.link(1481787, 12896932, 99999), /ikke en aktiv sak/);
  const e = await w.sync.link(1481787, 12896932, 53123);
  assert.strictEqual(e.ticketId, '53123');
  assert.strictEqual(w.posted.rl.length, 1);
  assert.match(w.posted.rl[0].html, /^<p>Zendesk #53123 «10263 Extra Laksvollen - alarm» er koblet til denne chatten\./);
  assert.strictEqual(w.posted.rl[0].isPrivate, true);
  const r = await w.sync.runOnce();
  assert.deepStrictEqual(r, { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'the old message on either side, and the announcement, stay where they are');
});

test('the ticket\'s new messages come into the chat as private messages, each kind labelled', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.reply(700, 'Anlegget går i alarm igjen.\nSe vedlegg.');
  w.reply(800, 'Sjekker fjernstyring.', false);
  w.reply(800, 'Hei Kari, vi ser på det.');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.mirrored, 3);
  assert.deepStrictEqual(w.posted.rl.slice(1).map((p) => [p.html, p.isPrivate]), [
    ['<p><b>Zendesk #53123</b> · Kari Kunde (kunde)</p><p>Anlegget går i alarm igjen.<br>Se vedlegg.</p>', true],
    ['<p><b>Zendesk #53123</b> · Ola Agent · internt notat</p><p>Sjekker fjernstyring.</p>', true],
    ['<p><b>Zendesk #53123</b> · Ola Agent · svar til kunden</p><p>Hei Kari, vi ser på det.</p>', true],
  ]);
  assert.strictEqual((await w.sync.runOnce()).mirrored, 0, 'once each');
  assert.strictEqual(w.posted.zd.length, 0, 'what came from Zendesk does not go back');
});

test('the chat\'s new messages go to the ticket: an internal note, or a public reply after /kunde', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.say(RUNNER, '<p>Ringer kunden i morgen.</p>', 'Thomas');
  w.say(2, '<p>Jeg tar <a class="rl__mention" data-rocketlane-mention-object-id="1">@Thomas</a> sin vakt.</p>', 'Andreas', 'Sandnes');
  w.say(RUNNER, '<p>/kunde Hei Kari,</p><p>tekniker kommer &amp; ser på det i dag.</p>', 'Thomas');
  w.say(2, '<p>/KUNDE: Vi beklager ventetiden.</p>', 'Andreas', 'Sandnes');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.forwarded, 4);
  assert.deepStrictEqual(w.posted.zd, [
    { ticketId: '53123', body: 'Ringer kunden i morgen.', isPublic: false },
    { ticketId: '53123', body: 'Andreas Sandnes (Rocketlane):\nJeg tar @Thomas sin vakt.', isPublic: false },
    // Rocketlane writes each line of a message as a paragraph: one line each in Zendesk
    { ticketId: '53123', body: 'Hei Kari,\ntekniker kommer & ser på det i dag.', isPublic: true },
    { ticketId: '53123', body: 'Vi beklager ventetiden.\n\n— Andreas Sandnes', isPublic: true },
  ]);
  const again = await w.sync.runOnce();
  assert.deepStrictEqual(again, { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'what went to Zendesk does not come back, and goes once');
});

test('without ids from the APIs the sync still knows its own messages', async () => {
  const w = world({ noRlIds: true, noZdIds: true });
  await w.sync.link(1481787, 12896932, 53123);
  w.reply(700, 'Kunde skriver.');
  w.say(RUNNER, '<p>Svar internt.</p>', 'Thomas');
  let r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [1, 1]);
  // the mirrored message carries its "Zendesk #" header: not sent back. The internal note sent to Zendesk has no id:
  // it comes into the chat once, as Zendesk's (a harmless echo), and stops there.
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [1, 0]);
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [0, 0]);
});

test('a ticket solved or out of the queue pauses the link; back in the queue, it catches up', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.queue[0].status = 'solved';
  w.reply(700, 'Takk, det virker.');
  w.say(2, '<p>Notat mens saken er løst.</p>', 'Andreas', 'Sandnes');
  let r = await w.sync.runOnce();
  assert.deepStrictEqual(r, { mirrored: 0, forwarded: 0, paused: 1, errors: 0 });
  assert.match(w.sync.linkOf(1481787, 12896932).note, /ikke aktiv i køen/);
  w.queue[0].status = 'open';
  r = await w.sync.runOnce();
  assert.deepStrictEqual(r, { mirrored: 1, forwarded: 1, paused: 0, errors: 0 });
  assert.strictEqual(w.sync.linkOf(1481787, 12896932).status, 'active');
});

test('a failure part way: the next round goes on from there, nothing twice', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.reply(700, 'En');
  w.reply(700, 'To');
  w.say(2, '<p>Tre</p>', 'Andreas', 'Sandnes');
  w.fail.rlPost = 1;
  let r = await w.sync.runOnce();
  assert.deepStrictEqual(r, { mirrored: 0, forwarded: 0, paused: 0, errors: 1 });
  assert.match(w.sync.linkOf(1481787, 12896932).note, /HTTP 502/);
  w.fail.zdAdd = 1;
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded, r.errors], [2, 0, 1]);
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded, r.errors], [0, 1, 0]);
  assert.deepStrictEqual(w.posted.rl.slice(1).map((p) => /<p>(En|To)<\/p>/.exec(p.html)[1]), ['En', 'To']);
  assert.deepStrictEqual(w.posted.zd.map((p) => p.body), ['Andreas Sandnes (Rocketlane):\nTre']);
});

test('unlinking stops it; files and long texts', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const html = w.sync.chatHtmlOf({ id: 1, public: true, plain_body: 'x'.repeat(8100), attachments: [
    { file_name: 'logg <1>.txt', content_url: 'https://iwmac.zendesk.com/attachments/token/a/?name=logg.txt' },
    { file_name: 'skummel', content_url: 'javascript:alert(1)' }] }, { name: 'Kari <Kunde>', role: 'end-user' }, '53123');
  assert.match(html, /^<p><b>Zendesk #53123<\/b> · Kari &lt;Kunde&gt; \(kunde\)<\/p>/);
  assert.match(html, /… \(forkortet: les resten i Zendesk\)/);
  assert.match(html, /<p>Vedlegg: <a href="https:\/\/iwmac\.zendesk\.com\/attachments\/token\/a\/\?name=logg\.txt">logg &lt;1&gt;\.txt<\/a><\/p>$/);
  assert.ok(!/javascript:/.test(html), 'only https links');
  w.sync.unlink(1481787, 12896932);
  assert.strictEqual(w.sync.linkOf(1481787, 12896932), null);
  w.reply(700, 'Etter frakobling');
  assert.deepStrictEqual(await w.sync.runOnce(), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 });
});

test('the text of a chat message', () => {
  const w = world();
  assert.strictEqual(w.sync.textOfHtml('<p>A &amp; B</p><p>C<br>D</p><ul><li>én</li><li>to</li></ul>'), 'A & B\nC\nD\n• én\n• to');
  assert.deepStrictEqual(w.sync.parseChatMessage('/kunde hei'), { isPublic: true, body: 'hei' });
  assert.deepStrictEqual(w.sync.parseChatMessage('kunde /kunde hei'), { isPublic: false, body: 'kunde /kunde hei' });
  assert.deepStrictEqual(w.sync.parseChatMessage('/kundeservice'), { isPublic: false, body: '/kundeservice' });
});
