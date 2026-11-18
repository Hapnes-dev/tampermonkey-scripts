'use strict';
/* Zendesk ⇄ General Chat (Rocketlane improvements 1.73.0; Rocketlane Chat Bridge 1.16.0-1.18.0 before): the sync's
 * engine, taken from the userscript as it stands, run against an in-memory Rocketlane chat and an in-memory Zendesk.
 *   node --test rocketlane-younium-status/test/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
// the sync writes Norwegian time whatever the computer's zone (v1.82.0): run these in another zone, so that shows
process.env.TZ = 'UTC';

const src = fs.readFileSync(path.join(__dirname, '..', 'rocketlane-younium-status.user.js'), 'utf8');
const a = src.indexOf('// @@ZDSYNC-ENGINE-START'), b = src.indexOf('// @@ZDSYNC-ENGINE-END');
assert.ok(a > 0 && b > a, 'the engine markers are in the userscript');
const createZendeskChatSync = new Function(src.slice(a, b) + '\nreturn createZendeskChatSync;')();

// a mirrored message's first line without its mark (the link to the Zendesk comment, since 1.80.0)
const unmark = (h) => String(h).replace(/<a href="[^"]*#zd-comment-\d+"[^>]*>(Zendesk #\d+)<\/a>/g, '$1');

// a round's four counts (its `posted` list aside)
const counts = (r) => ({ mirrored: r.mirrored, forwarded: r.forwarded, paused: r.paused, errors: r.errors });

const RUNNER = 1;        // the Rocketlane user whose browser runs the sync
const ZD_RUNNER = 900;   // the same person in Zendesk

function world(opts = {}) {
  let clock = Date.parse('2026-10-28T10:00:00Z');
  const tick = () => (clock += 1000);
  const chat = [
    { commentId: 11, messageType: 'CONTROL_MESSAGE', content: 'joined', createdAt: clock - 50000, user: { userId: 2 } },
    { commentId: 12, messageType: 'USER_MESSAGE', content: '<p>Gammel melding</p>', createdAt: clock - 40000, user: { userId: 2, firstName: 'Andreas', lastName: 'Sandnes' } },
  ];
  let nextRl = 100, nextZd = 5000;
  const PLANT = 27741611;   // the ticket field "Plant ID"
  const queue = [
    { id: 53123, subject: '10263 Extra Laksvollen - alarm', status: 'open', description: '', updated_at: '2026-10-28T09:00:00Z', custom_fields: [{ id: PLANT, value: null }] },
    { id: 53124, subject: 'Faktura', status: 'pending', description: 'Gjelder anlegg 10263', updated_at: '2026-10-28T08:00:00Z', custom_fields: [{ id: PLANT, value: '10263' }] },
    { id: 53125, subject: 'Laksvollen ny bruker', status: 'new', description: '', updated_at: '2026-10-27T08:00:00Z', custom_fields: [{ id: PLANT, value: '0000' }] },
    { id: 53126, subject: '10263 gammel sak', status: 'solved', description: '', updated_at: '2026-10-20T08:00:00Z' },
  ];
  // tickets that have left the queue's view keep their status here
  const elsewhere = new Map();
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
      async postComment(projectId, conversationId, html, isPrivate, attachments) {
        if (fail.rlPost > 0) { fail.rlPost--; throw new Error('Rocketlane svarte HTTP 502'); }
        const c = { commentId: nextRl++, messageType: 'USER_MESSAGE', content: html, private: isPrivate, createdAt: tick(), user: { userId: RUNNER, firstName: 'Thomas' } };
        chat.push(c);
        posted.rl.push({ projectId, conversationId, html, isPrivate, attachments: attachments || [] });
        return opts.noRlIds ? null : { id: c.commentId };
      },
    },
    zd: {
      async queueTickets() { return JSON.parse(JSON.stringify(queue)); },
      // one ticket as GET /tickets/{id}.json gives it (v1.88.0): the queue's, or one elsewhere in Zendesk; none, null
      async ticket(id) { const t = queue.find((x) => String(x.id) === String(id)) || elsewhere.get(String(id)); return t ? JSON.parse(JSON.stringify(t)) : null; },
      ticketUrl: (id) => 'https://iwmac.zendesk.com/agent/tickets/' + id,
      async statuses(ids) {
        const out = {};
        for (const id of ids) { const t = queue.find((x) => String(x.id) === String(id)) || elsewhere.get(String(id)); if (t) out[String(id)] = t.status; }
        return out;
      },
      async getComments(ticketId) { return { comments: JSON.parse(JSON.stringify(zdComments.get(Number(ticketId)) || [])), users: zdUsers }; },
      async addComment(ticketId, body, isPublic, uploads) {
        if (fail.zdAdd > 0) { fail.zdAdd--; throw new Error('Zendesk svarte HTTP 500'); }
        const c = { id: nextZd++, author_id: ZD_RUNNER, public: isPublic, plain_body: body, created_at: new Date(tick()).toISOString(), attachments: [], via: { channel: 'api' } };
        zdComments.get(Number(ticketId)).push(c);
        posted.zd.push(Object.assign({ ticketId, body, isPublic }, uploads && uploads.length ? { uploads } : {}));
        return { commentId: opts.noZdIds ? null : c.id };
      },
    },
  };
  const sync = createZendeskChatSync(deps);
  const say = (userId, html, first, last) => { const c = { commentId: nextRl++, messageType: 'USER_MESSAGE', content: html, private: false, createdAt: tick(), user: { userId, firstName: first, lastName: last } }; chat.push(c); return c; };
  const reply = (authorId, text, isPublic = true) => { const c = { id: nextZd++, author_id: authorId, public: isPublic, plain_body: text, created_at: new Date(tick()).toISOString(), attachments: [] }; zdComments.get(53123).push(c); return c; };
  return { sync, chat, queue, elsewhere, zdComments, posted, state, fail, say, reply, tick, deps, PLANT };
}

test('the queue: active tickets only, the project\'s best match first - its Plant ID before all', async () => {
  const w = world();
  const q = await w.sync.queue();
  assert.deepStrictEqual(q.map((t) => t.id), [53123, 53124, 53125], 'solved is not active');
  assert.deepStrictEqual(w.sync.rankTickets(q, '10263 - Extra Laksvollen: New store', w.PLANT).map((r) => [r.ticket.id, r.score]),
    [[53124, 25], [53123, 16], [53125, 6]], 'Plant ID, then the number in the subject, then the store\'s own name - not the chain or "New store" (v1.83.0)');
  assert.deepStrictEqual(w.sync.rankTickets(q, '10263 - Extra Laksvollen: New store').map((r) => [r.ticket.id, r.score]),
    [[53123, 16], [53125, 6], [53124, 5]], 'without the field known, the text alone: the store in the subject before the number somewhere in a mail');
  assert.deepStrictEqual(q.map((t) => w.sync.plantOf(t, w.PLANT)), ['', '10263', ''], 'none, a number, or only zeros');
  // a project whose ticket says another number in its subject: the Plant ID decides (8222 - Obs Harstad, "SV: 41584 OBS Harstad")
  const harstad = [{ id: 207248, subject: 'SV: 41584 OBS Harstad - Plug In på Iwmac', status: 'open', custom_fields: [{ id: w.PLANT, value: 8222 }] },
    { id: 210175, subject: 'INC000002790331 : 209753 - Joker Bjordal - 10250 -', status: 'open', custom_fields: [{ id: w.PLANT, value: 10250 }] }];
  const best = w.sync.rankTickets(harstad, '8222 - Obs Harstad: Ombygging', w.PLANT)[0];
  assert.deepStrictEqual([best.ticket.id, best.score, best.found, best.why], [207248, 26, true, ['Plant ID 8222', '“Harstad” in the subject']]);
});

test('linking: only an active ticket of the queue; the chat is told, and gets new messages only - the earlier ones on request; nothing old goes to Zendesk', async () => {
  const w = world();
  await assert.rejects(w.sync.link(1481787, 12896932, 53126), /not an active ticket/);
  await assert.rejects(w.sync.link(1481787, 12896932, 99999), /not an active ticket/);
  const e = await w.sync.link(1481787, 12896932, 53123);
  assert.deepStrictEqual([e.main, e.tickets.map((t) => t.ticketId)], ['53123', ['53123']]);
  assert.strictEqual(e.tickets[0].historyPosted, false);
  assert.strictEqual(w.posted.rl.length, 1, 'the notice only: no earlier messages by themselves');
  assert.strictEqual(w.posted.rl[0].html, '<p><a href="https://iwmac.zendesk.com/agent/tickets/53123" target="_blank" rel="noopener noreferrer">Zendesk #53123</a>' +
    ' is linked to this chat · 10263 Extra Laksvollen - alarm</p><p>Messages here go to the ticket as internal notes. Start with /reply to answer the customer.</p>',
    'two short lines, the ticket a link to it');
  const r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'the ticket\'s old message does not come in, and nothing the sync posted, nor the chat\'s old message, goes to Zendesk');
  // on request: the earlier messages, once
  assert.strictEqual(await w.sync.postHistory(1481787, 12896932), 1);
  assert.match(w.posted.rl[1].html, /^<p><b>Zendesk #53123<\/b> · earlier messages \(1 in all\)<\/p><p><br><\/p><p><b>Kari Kunde<\/b> \(customer\) · 27 Oct 2026 \d\d:\d\d<\/p><p>Gammel kundemelding<\/p>$/);
  assert.deepStrictEqual(w.posted.rl.map((p) => p.isPrivate), [true, true]);
  assert.strictEqual(await w.sync.postHistory(1481787, 12896932), 0, 'once');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'and none of it goes to Zendesk');
});

test('the ticket\'s new messages come into the chat as private messages, each kind labelled', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.reply(700, 'Anlegget går i alarm igjen.\nSe vedlegg.');
  w.reply(800, 'Sjekker fjernstyring.', false);
  w.reply(800, 'Hei Kari, vi ser på det.');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.mirrored, 3);
  assert.deepStrictEqual(r.posted, [{ projectId: '1481787', conversationId: '12896932', ticketId: '53123', count: 3 }], 'what went where');
  assert.match(w.posted.rl[1].html, /^<p><b><a href="https:\/\/iwmac\.zendesk\.com\/agent\/tickets\/53123#zd-comment-\d+" target="_blank" rel="noopener noreferrer">Zendesk #53123<\/a><\/b> · /,
    'the first line links the ticket and marks the comment');
  assert.deepStrictEqual(w.posted.rl.slice(1).map((p) => [unmark(p.html), p.isPrivate]), [
    // a line a paragraph, as Rocketlane writes a message
    ['<p><b>Zendesk #53123</b> · Kari Kunde (customer)</p><p>Anlegget går i alarm igjen.</p><p>Se vedlegg.</p>', true],
    ['<p><b>Zendesk #53123</b> · Ola Agent · internal note</p><p>Sjekker fjernstyring.</p>', true],
    ['<p><b>Zendesk #53123</b> · Ola Agent · reply to the customer</p><p>Hei Kari, vi ser på det.</p>', true],
  ]);
  assert.strictEqual((await w.sync.runOnce()).mirrored, 0, 'once each');
  assert.strictEqual(w.posted.zd.length, 0, 'what came from Zendesk does not go back');
});

test('the chat\'s new messages go to the ticket: an internal note, or a public reply after /reply', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.say(RUNNER, '<p>Ringer kunden i morgen.</p>', 'Thomas');
  w.say(2, '<p>Jeg tar <a class="rl__mention" data-rocketlane-mention-object-id="1">@Thomas</a> sin vakt.</p>', 'Andreas', 'Sandnes');
  w.say(RUNNER, '<p>/reply Hei Kari,</p><p>tekniker kommer &amp; ser på det i dag.</p>', 'Thomas');
  w.say(2, '<p>/REPLY: Vi beklager ventetiden.</p>', 'Andreas', 'Sandnes');
  w.say(2, '<p>/kunde dette er bare et notat nå</p>', 'Andreas', 'Sandnes');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.forwarded, 5);
  assert.deepStrictEqual(w.posted.zd, [
    { ticketId: '53123', body: 'Ringer kunden i morgen.', isPublic: false },
    { ticketId: '53123', body: 'Andreas Sandnes (Rocketlane):\nJeg tar @Thomas sin vakt.', isPublic: false },
    // Rocketlane writes each line of a message as a paragraph: one line each in Zendesk
    { ticketId: '53123', body: 'Hei Kari,\ntekniker kommer & ser på det i dag.', isPublic: true },
    { ticketId: '53123', body: 'Vi beklager ventetiden.\n\n— Andreas Sandnes', isPublic: true },
    { ticketId: '53123', body: 'Andreas Sandnes (Rocketlane):\n/kunde dette er bare et notat nå', isPublic: false },
  ]);
  const again = await w.sync.runOnce();
  assert.deepStrictEqual(counts(again), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'what went to Zendesk does not come back, and goes once');
});

test('without ids from the APIs the sync still knows its own messages', async () => {
  const w = world({ noRlIds: true, noZdIds: true });
  await w.sync.link(1481787, 12896932, 53123);
  w.reply(700, 'Kunde skriver.');
  w.say(RUNNER, '<p>Svar internt.</p>', 'Thomas');
  let r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [1, 1]);
  // the mirrored message carries its "Zendesk #" header: not sent back. The internal note sent to Zendesk has no id,
  // but it was made through the API with the chat message's text: it does not come back either (since 1.80.0 - before,
  // it came into the chat once as Zendesk's)
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [0, 0]);
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [0, 0]);
});

test('a solved ticket pauses the link; opened again, it catches up', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.queue[0].status = 'solved';
  w.reply(700, 'Takk, det virker.');
  w.say(2, '<p>Notat mens saken er løst.</p>', 'Andreas', 'Sandnes');
  let r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 0, forwarded: 0, paused: 1, errors: 0 });
  assert.match(w.sync.linkOf(1481787, 12896932).note, /The ticket is solved/);
  w.queue[0].status = 'open';
  r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 1, forwarded: 1, paused: 0, errors: 0 });
  assert.strictEqual(w.sync.linkOf(1481787, 12896932).status, 'active');
});

test('a linked ticket that waits for the customer has left the view, but keeps syncing', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const t = w.queue.shift();
  w.elsewhere.set('53123', Object.assign(t, { status: 'pending' }));
  w.say(2, '<p>Venter på kunden.</p>', 'Andreas', 'Sandnes');
  w.reply(700, 'Svar fra kunden.');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 1, forwarded: 1, paused: 0, errors: 0 });
  w.elsewhere.delete('53123');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.paused, 1);
  assert.match(w.sync.linkOf(1481787, 12896932).note, /was not found in Zendesk/);
});

test('a failure part way: the next round goes on from there, nothing twice', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.reply(700, 'En');
  w.reply(700, 'To');
  w.say(2, '<p>Tre</p>', 'Andreas', 'Sandnes');
  w.fail.rlPost = 1;
  let r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 0, forwarded: 0, paused: 0, errors: 1 });
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
  assert.match(unmark(html), /^<p><b>Zendesk #53123<\/b> · Kari &lt;Kunde&gt; \(customer\)<\/p>/);
  assert.match(html, /… \(shortened: read the rest in Zendesk\)/);
  assert.match(html, /<p>Attachments: <a href="https:\/\/iwmac\.zendesk\.com\/attachments\/token\/a\/\?name=logg\.txt">logg &lt;1&gt;\.txt<\/a><\/p>$/);
  assert.ok(!/javascript:/.test(html), 'only https links');
  w.sync.unlink(1481787, 12896932);
  assert.strictEqual(w.sync.linkOf(1481787, 12896932), null);
  w.reply(700, 'Etter frakobling');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 });
});

test('the text of a chat message', () => {
  const w = world();
  assert.strictEqual(w.sync.textOfHtml('<p>A &amp; B</p><p>C<br>D</p><ul><li>én</li><li>to</li></ul>'), 'A & B\nC\nD\n• én\n• to');
  assert.deepStrictEqual(w.sync.parseChatMessage('/reply hei'), { isPublic: true, body: 'hei' });
  assert.deepStrictEqual(w.sync.parseChatMessage('/Reply: hi'), { isPublic: true, body: 'hi' });
  assert.deepStrictEqual(w.sync.parseChatMessage('/kunde hei'), { isPublic: false, body: '/kunde hei' }, '/kunde is plain text since 1.18.0');
  assert.deepStrictEqual(w.sync.parseChatMessage('/customer hi'), { isPublic: false, body: '/customer hi' });
  assert.deepStrictEqual(w.sync.parseChatMessage('see /reply below'), { isPublic: false, body: 'see /reply below' });
  assert.deepStrictEqual(w.sync.parseChatMessage('/replyall x'), { isPublic: false, body: '/replyall x' });
});

test('the ticket\'s messages from before the link come only on request, once, and nothing from after it', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  // as an older link: no history posted, and messages have come and gone since the link
  const st = JSON.parse(w.state.value);
  st.links['1481787:12896932'].historyPosted = undefined;
  w.state.value = JSON.stringify(st);
  w.posted.rl.length = 0;
  w.reply(700, 'Etter koblingen');
  await w.sync.runOnce();
  assert.strictEqual(w.posted.rl.length, 1, 'the new one, mirrored');
  assert.strictEqual(await w.sync.postHistory(1481787, 12896932), 1, 'only what came before the link');
  assert.match(w.posted.rl[1].html, /earlier messages \(1 in all\).*Gammel kundemelding/);
  assert.ok(!/Etter koblingen/.test(w.posted.rl[1].html));
  assert.strictEqual(await w.sync.postHistory(1481787, 12896932), 0);
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'and none of it goes to Zendesk');
  await assert.rejects(w.sync.postHistory(1, 2), /not linked/);
});

test('a long history comes in parts, each message shortened past 3 000 characters', () => {
  const w = world();
  const users = new Map([[700, { id: 700, name: 'Kari Kunde', role: 'end-user' }], [800, { id: 800, name: 'Ola Agent', role: 'agent' }]]);
  const comments = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, author_id: i % 2 ? 800 : 700, public: i !== 3, plain_body: String(i).repeat(i === 8 ? 5000 : 2500), created_at: '2026-10-2' + (i % 9) + 'T08:00:00Z' }));
  const parts = w.sync.historyHtml(comments, users, '53123');
  assert.ok(parts.length >= 2, parts.length + ' parts');
  parts.forEach((p, i) => assert.ok(p.startsWith('<p><b>Zendesk #53123</b> · earlier messages, part ' + (i + 1) + ' of ' + parts.length + ' (9 in all)</p>')));
  const all = parts.join('');
  assert.deepStrictEqual((all.match(/<p><b>(Kari Kunde|Ola Agent)<\/b>[^<]*/g) || []).length, 9, 'every message, once');
  assert.ok(/<b>Ola Agent<\/b> · internal note · /.test(all), 'the kind of each');
  assert.ok(/… \(shortened: read the rest in Zendesk\)/.test(all));
  assert.ok(parts.every((p) => p.length < 12000 + 3200), 'about 12 000 characters a message at most');
  assert.deepStrictEqual(w.sync.historyHtml([], users, '1'), []);
});

test('an email reply tidied for the chat: no entities, no runs of blank lines, no quoted email, no signature', () => {
  const w = world();
  const email = 'Hei,  \n \n&nbsp;\n \nFikk dere sett på dette?&nbsp;\n&nbsp;\n \n \nMed vennlig hilsen\n&nbsp;\nOla Kunde\nProsjektleder\n' +
    'Mobil: +47 900 00 000\nE-post: ola@example.no\n&nbsp;\nKunde AS\nGate 1, 0001 Oslo\n\nFra: Ola Kunde <ola@example.no>\nSendt: mandag 1. september 2026 10:00\n' +
    'Til: Support <support@example.com>\nEmne: Sak\n\nGammel tekst';
  assert.strictEqual(w.sync.tidyText(email), 'Hei,\n\nFikk dere sett på dette?', 'the signature goes, its sign-off too (v1.82.0)');
  assert.strictEqual(w.sync.tidyText('Svar her.\n\nFra: Ola <ola@example.no>\nSendt: 1. sep\nTil: oss\n\nGammelt'), 'Svar her.', 'a quoted email without a sign-off');
  assert.strictEqual(w.sync.tidyText('Takk!\n\nOn Mon, 1 Sep 2026 at 10:00, Ola <ola@example.no> wrote:\n> gammelt'), 'Takk!');
  assert.strictEqual(w.sync.tidyText('Ok\n-----Original Message-----\nFrom: x'), 'Ok');
  assert.strictEqual(w.sync.tidyText('Hei\n\nBest regards,\nThomas Kvalvåg\nIWMAC'), 'Hei');
  assert.strictEqual(w.sync.tidyText('Hei\nMvh\n+47 900 00 000'), 'Hei');
  // Thomas's case (#210837): "Med vennlig hilsen / Markus Hassel" came into the chat under the message
  assert.strictEqual(w.sync.tidyText('Hei\n\nHar dere status?\n\nMed vennlig hilsen\nMarkus Hassel'), 'Hei\n\nHar dere status?');
  assert.strictEqual(w.sync.tidyText('Takk for svar.\n\nMvh. Markus Hassel\nFirma AS\nTlf 900 00 000'), 'Takk for svar.', 'a sign-off with the name after it');
  assert.strictEqual(w.sync.tidyText('Takk\nHilsen Kari'), 'Takk');
  assert.strictEqual(w.sync.tidyText('Hilsen fra oss alle.\nVi kommer i morgen.'), 'Hilsen fra oss alle.\nVi kommer i morgen.', 'a sentence that starts with a sign-off word stays');
  assert.strictEqual(w.sync.tidyText('Brage kommer i morgen.'), 'Brage kommer i morgen.');
  assert.strictEqual(w.sync.tidyText('A &amp; B &lt;3 &quot;x&quot;'), 'A & B <3 "x"');
  assert.strictEqual(w.sync.tidyText('Fra: lageret\nNoe annet'), 'Fra: lageret\nNoe annet', 'a line that only looks like a header');
  // in the chat: a paragraph per line, one empty paragraph for a blank line
  assert.strictEqual(w.sync.htmlOfText('a\n\n\n\nb\nc'), '<p>a</p><p><br></p><p>b</p><p>c</p>');
  assert.strictEqual(w.sync.textOfHtml(w.sync.htmlOfText('a\n\nb')), 'a\n\nb', 'and back the same, as the chat\'s text goes to Zendesk');
});

test('a ticket whose updated_at has not moved is not read again', async () => {
  const w = world();
  let fetched = 0, stamp = '2026-10-28T09:00:00Z';
  const getComments = w.deps.zd.getComments;
  w.deps.zd.getComments = async (...a) => { fetched++; return getComments(...a); };
  w.deps.zd.statuses = async (ids) => Object.fromEntries(ids.map((id) => [String(id), { status: 'open', updatedAt: stamp }]));
  await w.sync.link(1481787, 12896932, 53123);
  fetched = 0;
  await w.sync.runOnce();
  assert.strictEqual(fetched, 1, 'the first round reads it');
  await w.sync.runOnce();
  await w.sync.runOnce();
  assert.strictEqual(fetched, 1, 'unchanged since: not read');
  w.reply(700, 'Ny melding');
  stamp = '2026-10-28T10:30:00Z';
  const r = await w.sync.runOnce();
  assert.deepStrictEqual([fetched, r.mirrored], [2, 1], 'moved: read, and its new message comes in');
  assert.deepStrictEqual(w.sync.links()['1481787:12896932'].tickets[0].zdUpdatedAt, '2026-10-28T10:30:00Z');
});

// a file of a Zendesk message, as Zendesk gives its address
const ZF = (token, name) => 'https://iwmac.zendesk.com/attachments/token/' + token + '/?name=' + name;
// a file transport that carries every file but those named in `refuse`
const carrier = (refuse = []) => ({
  calls: [],
  async carry(projectId, files) {
    this.calls.push([projectId, files.map((f) => f.name)]);
    return { attached: files.filter((f) => !refuse.includes(f.name)).map((f) => ({ attachmentId: 'rl:' + f.name, name: f.name })),
      failed: files.filter((f) => refuse.includes(f.name)) };
  },
});

test('a Zendesk email\'s files for the chat: the screenshots in its text and its attachments, not its signature\'s or a quoted email\'s pictures', () => {
  const w = world();
  const html = '<div><p>Hei,</p><p>De skal inn under frysedisk GF24A-D som vist i klipp under.</p>' +
    '<p><img width="1010" height="842" style="x" src="' + ZF('aaa', 'image001.png') + '"></p><p>Pos K51 må flyttes.</p>' +
    '<p><img src="' + ZF('bbb', 'image002.png').replace(/&/g, '&amp;') + '"></p>' +
    '<p>Med vennlig hilsen</p><p>Ola Kunde</p><p><img width="226" height="88" src="' + ZF('logo', 'image004.png') + '"></p>' +
    '<p><img src="' + ZF('icon', 'image005.png') + '"></p>' +
    '<p><b>Fra:</b> Support<br><b>Sendt:</b> 1. september<br><b>Til:</b> Ola</p><p><img src="' + ZF('old', 'image009.png') + '"></p></div>';
  const files = w.sync.filesOf({ id: 1, html_body: html, attachments: [
    { file_name: 'A0.pdf', content_url: ZF('pdf', 'A0.pdf'), content_type: 'application/pdf', size: 3579097, inline: false },
    { file_name: 'image002.png', content_url: ZF('bbb', 'image002.png'), inline: true },
    { file_name: 'image004.png', content_url: ZF('logo', 'image004.png'), inline: true },
    { file_name: 'virus.exe', content_url: ZF('bad', 'virus.exe'), malware_scan_result: 'malware_found' },
    { file_name: 'gone.txt', content_url: ZF('gone', 'gone.txt'), deleted: true },
    { file_name: 'x', content_url: 'javascript:alert(1)' },
  ] });
  assert.deepStrictEqual(files.map((f) => [f.name, f.inline]), [['image001.png', true], ['image002.png', true], ['A0.pdf', false]],
    'in the order of the text, each once; not the signature\'s logo and icon, not the quoted email\'s picture, no malware, nothing deleted');
  assert.deepStrictEqual([files[0].url, files[2].size], [ZF('aaa', 'image001.png'), 3579097]);
  assert.deepStrictEqual(w.sync.filesOf({ html_body: '<p>Se bildet</p><img src="' + ZF('c', 'c.png') + '">' }).map((f) => f.name), ['c.png'], 'no sign-off: every picture');
  assert.deepStrictEqual(w.sync.filesOf({ html_body: '<img src="https://example.com/x.png"><img data-src="' + ZF('d', 'd.png') + '">' }), [], 'only Zendesk\'s own files');
  assert.deepStrictEqual(w.sync.filesOf({ plain_body: 'x', attachments: [] }), []);
});

test('a new Zendesk message brings its pictures and files into the chat with it; a file that cannot go stays a link', async () => {
  const w = world();
  w.deps.files = carrier(['stor.zip']);
  await w.sync.link(1481787, 12896932, 53123);
  const c = w.reply(700, 'Se klipp under.');
  c.html_body = '<p>Se klipp under.</p><p><img src="' + ZF('aaa', 'image001.png') + '"></p><p>Mvh</p><p>Kari</p><p><img src="' + ZF('logo', 'logo.png') + '"></p>';
  c.attachments = [{ file_name: 'tegning.pdf', content_url: ZF('pdf', 'tegning.pdf'), size: 1000 }, { file_name: 'stor.zip', content_url: ZF('zip', 'stor.zip'), size: 9e7 }];
  const r = await w.sync.runOnce();
  assert.strictEqual(r.mirrored, 1);
  assert.deepStrictEqual(w.deps.files.calls, [['1481787', ['image001.png', 'tegning.pdf', 'stor.zip']]], 'the signature\'s logo is not even asked for');
  const p = w.posted.rl[w.posted.rl.length - 1];
  assert.deepStrictEqual(p.attachments.map((a) => a.attachmentId), ['rl:image001.png', 'rl:tegning.pdf'], 'they go with the message');
  assert.strictEqual(unmark(p.html), '<p><b>Zendesk #53123</b> · Kari Kunde (customer)</p><p>Se klipp under.</p><p>Attachments: <a href="' +
    ZF('zip', 'stor.zip').replace(/&/g, '&amp;') + '">stor.zip</a></p>', 'what could not go stays a link; what went is not linked as well');
  // without a file transport, every file is a link, as before
  const w2 = world();
  await w2.sync.link(1481787, 12896932, 53123);
  const c2 = w2.reply(700, 'Bilde');
  c2.html_body = '<p>Bilde</p><img src="' + ZF('aaa', 'image001.png') + '">';
  await w2.sync.runOnce();
  assert.match(w2.posted.rl[w2.posted.rl.length - 1].html, /<p>Attachments: <a href="[^"]+">image001\.png<\/a><\/p>$/);
});

test('the ticket\'s earlier messages, posted on request, bring their pictures and files along', async () => {
  const w = world();
  w.deps.files = carrier();
  w.zdComments.get(53123)[0].attachments = [{ file_name: 'A0.pdf', content_url: ZF('pdf', 'A0.pdf'), size: 10 }];
  await w.sync.link(1481787, 12896932, 53123);
  assert.deepStrictEqual(w.deps.files.calls, [], 'linking alone carries nothing');
  await w.sync.postHistory(1481787, 12896932);
  assert.deepStrictEqual(w.posted.rl.map((p) => p.attachments.map((a) => a.attachmentId)), [[], ['rl:A0.pdf']], 'the notice bare, the history with its files');
  assert.ok(!/Attachments:/.test(w.posted.rl[1].html));
  assert.strictEqual(w.sync.linkOf(1481787, 12896932).tickets[0].filesPosted, true, 'nothing left for later');
});

test('a chat linked before files came along gets the earlier ones once, a message for each Zendesk message that has any', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  // as a link from before 1.74.0
  const st = JSON.parse(w.state.value);
  delete st.links['1481787:12896932'].tickets[0].filesPosted;
  w.state.value = JSON.stringify(st);
  w.zdComments.get(53123)[0].attachments = [{ file_name: 'A0.pdf', content_url: ZF('pdf', 'A0.pdf') }];
  const c = w.reply(700, 'Bilde');
  c.html_body = '<p>Bilde</p><img src="' + ZF('img', 'skjerm.png') + '">';
  w.reply(700, 'Uten filer');
  await w.sync.runOnce();
  w.deps.files = carrier();
  const before = w.posted.rl.length;
  assert.strictEqual(await w.sync.postFiles(1481787, 12896932), 2);
  const made = w.posted.rl.slice(before);
  assert.deepStrictEqual(made.map((p) => p.attachments.map((a) => a.attachmentId)), [['rl:A0.pdf'], ['rl:skjerm.png']]);
  assert.match(made[0].html, /^<p><b>Zendesk #53123<\/b> · Kari Kunde \(customer\) · 27 Oct 2026 \d\d:\d\d · images and files<\/p>$/);
  assert.strictEqual(await w.sync.postFiles(1481787, 12896932), 0, 'once');
  const zd = w.posted.zd.length;
  await w.sync.runOnce();
  assert.strictEqual(w.posted.zd.length, zd, 'none of it goes back to Zendesk');
});

test('the chat\'s files go to the ticket with their message; files alone say their names; one that cannot go is named', async () => {
  const w = world();
  const asked = [];
  w.deps.files = { async toZendesk(files) {
    asked.push(files.map((f) => [f.id, f.name, f.size]));
    return { uploads: files.filter((f) => f.name !== 'stor.zip').map((f) => 'tok-' + f.id),
      failed: files.filter((f) => f.name === 'stor.zip').map((f) => ({ name: f.name, why: 'too big' })) };
  } };
  await w.sync.link(1481787, 12896932, 53123);
  const att = (id, name, size = 100) => ({ attachmentId: id, name, sizeInBytes: size });
  w.say(2, '<p>Se vedlagt tegning.</p>', 'Andreas', 'Sandnes').commentMeta = { linkedAttachments: [att(71, 'tegning.pdf')] };
  w.say(RUNNER, '<p></p>', 'Thomas').commentMeta = { linkedAttachments: [att(72, 'image.png')] };
  w.say(2, '<p>/reply Her er loggen.</p>', 'Andreas', 'Sandnes').commentMeta = { linkedAttachments: [att(73, 'logg.txt'), att(74, 'stor.zip', 9e7)] };
  w.say(2, '<p>Notat</p><p>med fil</p>', 'Andreas', 'Sandnes').commentMeta = { linkedAttachments: [att(75, 'stor.zip', 9e7)] };
  const r = await w.sync.runOnce();
  assert.strictEqual(r.forwarded, 4);
  assert.deepStrictEqual(asked, [[['71', 'tegning.pdf', 100]], [['72', 'image.png', 100]], [['73', 'logg.txt', 100], ['74', 'stor.zip', 9e7]], [['75', 'stor.zip', 9e7]]]);
  assert.deepStrictEqual(w.posted.zd, [
    { ticketId: '53123', body: 'Andreas Sandnes (Rocketlane):\nSe vedlagt tegning.', isPublic: false, uploads: ['tok-71'] },
    { ticketId: '53123', body: 'image.png', isPublic: false, uploads: ['tok-72'] },
    { ticketId: '53123', body: 'Her er loggen.\n\n— Andreas Sandnes', isPublic: true, uploads: ['tok-73'] },
    { ticketId: '53123', body: 'Not attached to the reply above, see the Rocketlane chat: stor.zip (too big)', isPublic: false },
    { ticketId: '53123', body: 'Andreas Sandnes (Rocketlane):\nNotat\nmed fil\n\nNot attached, see the Rocketlane chat: stor.zip (too big)', isPublic: false },
  ], 'a note carries its files; a reply to the customer goes without the one that could not go, and the team is told apart');
  // none of it comes back into the chat, and nothing goes twice
  const rl = w.posted.rl.length, zd = w.posted.zd.length;
  await w.sync.runOnce();
  assert.deepStrictEqual([w.posted.rl.length, w.posted.zd.length], [rl, zd]);
});

test('a chat file goes again with its message when Zendesk refused the comment', async () => {
  const w = world();
  let calls = 0;
  w.deps.files = { async toZendesk(files) { calls++; return { uploads: files.map((f) => 'tok-' + f.id + '-' + calls), failed: [] }; } };
  await w.sync.link(1481787, 12896932, 53123);
  w.say(2, '<p>Bilde</p>', 'Andreas', 'Sandnes').commentMeta = { linkedAttachments: [{ attachmentId: 81, name: 'a.png', sizeInBytes: 5 }] };
  w.fail.zdAdd = 1;
  const r1 = await w.sync.runOnce();
  assert.deepStrictEqual([r1.forwarded, r1.errors, w.posted.zd.length], [0, 1, 0]);
  const r2 = await w.sync.runOnce();
  assert.strictEqual(r2.forwarded, 1);
  assert.deepStrictEqual(w.posted.zd.map((p) => p.uploads), [['tok-81-2']], 'uploaded again, sent once');
});

test('what a message being written will be: a reply to the customer, a near miss of /reply, or a note', () => {
  const w = world();
  const m = (t) => w.sync.composeModeOf(t);
  const NOTE = { mode: 'note', word: '' };
  assert.deepStrictEqual(m('/reply Hei Kari'), { mode: 'reply', word: '/reply' });
  assert.deepStrictEqual(m('\n  /REPLY: hei'), { mode: 'reply', word: '/reply' });
  assert.deepStrictEqual(m('\u200b/reply'), { mode: 'reply', word: '/reply' }, 'as soon as it is typed');
  assert.deepStrictEqual(m('/replay hei'), { mode: 'typo', word: '/replay' });
  assert.deepStrictEqual(m('/Repyl: hei'), { mode: 'typo', word: '/Repyl' });
  assert.deepStrictEqual(m('/rep hei'), { mode: 'typo', word: '/rep' });
  assert.deepStrictEqual(m('/kunde hei'), { mode: 'typo', word: '/kunde' }, 'the old command');
  assert.deepStrictEqual(m('/repl'), NOTE, 'a word still being typed');
  assert.deepStrictEqual(m('/re hei'), NOTE);
  assert.deepStrictEqual(m('/Request_Feedback'), NOTE);
  assert.deepStrictEqual(m('/replyall hei'), NOTE);
  assert.deepStrictEqual(m('hei /reply'), NOTE);
  assert.deepStrictEqual(m(''), NOTE);
  // the box says "reply" exactly when the message will go as one
  for (const t of ['/reply x', '/Reply', ' /reply: x', '/replyx', '/replay x', 'x /reply', '/kunde x', ''])
    assert.strictEqual(m(t).mode === 'reply', w.sync.parseChatMessage(t).isPublic, t);
});

test('two browsers running the sync for one chat post nothing twice, either way', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  // a second browser: the same chat and ticket, its own record of the link (a copy of it as it stood)
  const other = { value: w.state.value };
  const sync2 = createZendeskChatSync(Object.assign({}, w.deps, { store: { load: () => JSON.parse(other.value), save: (st) => { other.value = JSON.stringify(st); } } }));
  w.reply(700, 'Kunde skriver.');
  w.say(2, '<p>Notat fra Andreas</p>', 'Andreas', 'Sandnes');
  w.say(RUNNER, '<p>/reply Svar til kunden</p>', 'Thomas');
  for (const s of [w.sync, sync2, w.sync, sync2]) await s.runOnce();
  assert.strictEqual(w.chat.filter((c) => /Kunde skriver/.test(c.content)).length, 1, 'the customer\'s message in the chat once');
  assert.deepStrictEqual(w.posted.zd.map((p) => p.body), ['Andreas Sandnes (Rocketlane):\nNotat fra Andreas', 'Svar til kunden'], 'each chat message on the ticket once');
  assert.strictEqual(w.chat.filter((c) => /Zendesk #/.test(c.content) && /Notat fra Andreas|Svar til kunden/.test(c.content)).length, 0,
    'nothing the other browser sent comes back as a Zendesk message');
  // and the second browser, from now on, goes on as the first
  w.reply(800, 'Ny melding.', false);
  for (const s of [sync2, w.sync]) await s.runOnce();
  assert.strictEqual(w.chat.filter((c) => /Ny melding/.test(c.content)).length, 1);
});

test('a record of the link older than what happened since posts nothing again', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const old = w.state.value;
  w.reply(700, 'Ny kundemelding');
  w.say(2, '<p>Internt</p>', 'Andreas', 'Sandnes');
  let r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [1, 1]);
  // the record goes back, as if the page had closed before it was saved
  w.state.value = old;
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded, r.errors], [0, 0, 0], 'found on the other side, not posted again');
  // a message mirrored before 1.80.0 has no mark: its text finds it
  w.chat.forEach((c) => { c.content = unmark(c.content); });
  w.state.value = old;
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded, r.errors], [0, 0, 0]);
  assert.strictEqual(w.chat.filter((c) => /Ny kundemelding/.test(c.content)).length, 1);
  assert.strictEqual(w.posted.zd.length, 1);
});

test('a Zendesk note with the same words as an old chat message, written in Zendesk, still comes in', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.say(2, '<p>Takk</p>', 'Andreas', 'Sandnes');
  await w.sync.runOnce();
  w.reply(800, 'Takk', false);   // an agent writes the same in Zendesk itself: not made through the API
  const r = await w.sync.runOnce();
  assert.strictEqual(r.mirrored, 1);
});

test('the same words written twice in the chat go to the ticket twice', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  w.say(2, '<p>Ok</p>', 'Andreas', 'Sandnes');
  await w.sync.runOnce();
  w.say(2, '<p>Ok</p>', 'Andreas', 'Sandnes');
  await w.sync.runOnce();
  assert.deepStrictEqual(w.posted.zd.map((p) => p.body), ['Andreas Sandnes (Rocketlane):\nOk', 'Andreas Sandnes (Rocketlane):\nOk']);
  await w.sync.runOnce();
  assert.strictEqual(w.posted.zd.length, 2, 'and not a third time');
});

// ---- v1.81.0: a /reply shown with a mark in place of the word ----------------------------------------------------
// Thomas: "instead of the /reply be there after used the macro can you just show a better marking that message have
// been sent on zendesk?" The word is hidden as the chat shows the message (replyLead); the mark says what became of it,
// read from the ticket (sentAs), so it is the same whichever browser sent it. The message's own text never changes.

test('replyLead: the word as the chat shows a message\'s first paragraph', () => {
  const { sync } = world();
  assert.deepStrictEqual(sync.replyLead('/reply'), { whole: true, length: 6 });
  assert.deepStrictEqual(sync.replyLead('/reply\u00a0'), { whole: true, length: 7 }, 'the chat writes "/reply&nbsp;" as its own paragraph');
  assert.deepStrictEqual(sync.replyLead('/Reply: Hei Kari,'), { whole: false, length: 8 });
  assert.deepStrictEqual(sync.replyLead('\u200B/reply Hei'), { whole: false, length: 8 }, 'measured on the text as it stands');
  for (const t of ['/replay Hei', 'Hei /reply', '/replyx', '', null]) assert.strictEqual(sync.replyLead(t), null, String(t));
});

test('sentAs: what a chat message became on the ticket - a reply, or a note', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const ticket = () => w.zdComments.get(53123);
  const m = w.say(RUNNER, '<p>/reply&nbsp;</p><p>Hei</p><p>Når du har adressert plugin diskene kan du merke adressene på oversiktbildet?</p>', 'Thomas', 'Kvalvåg Håpnes');
  assert.strictEqual(w.sync.sentAs(m, ticket()), null, 'not on the ticket before the round');
  await w.sync.runOnce();
  const made = ticket()[ticket().length - 1];
  assert.deepStrictEqual(w.sync.sentAs(m, ticket()), { commentId: String(made.id), isPublic: true, at: Date.parse(made.created_at) });
  const n = w.say(2, '<p>Sjekker fjernstyring</p>', 'Andreas', 'Sandnes');
  await w.sync.runOnce();
  assert.strictEqual(w.sync.sentAs(n, ticket()).isPublic, false, 'a message without /reply is found as the note it became');
});

test('sentAs: a reply sent by another browser counts; the same words from the customer do not', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(2, '<p>/reply Vi kommer i morgen.</p>', 'Andreas', 'Sandnes');
  w.reply(700, 'Vi kommer i morgen.');   // the customer happens to write the same words: an email, not the API
  assert.strictEqual(w.sync.sentAs(m, w.zdComments.get(53123)), null);
  // another browser's sync sent it: through the API, signed as the sync signs a reply
  const z = { id: 9001, author_id: 800, public: true, plain_body: 'Vi kommer i morgen.\n\n— Andreas Sandnes', created_at: new Date(w.tick()).toISOString(), attachments: [], via: { channel: 'api' } };
  w.zdComments.get(53123).push(z);
  assert.deepStrictEqual(w.sync.sentAs(m, w.zdComments.get(53123)), { commentId: '9001', isPublic: true, at: Date.parse(z.created_at) });
  assert.strictEqual(w.sync.sentAs(m, null), null, 'no ticket read: nothing claimed');
});

// ---- v1.81.1: the mark trusts the sending browser's record before the ticket's text --------------------------------
// Thomas, of a reply the customer got: its mark said "Not sent". The ticket's text match had missed it. Now the browser
// that sent a message records what it became; the ticket is read only for what no record settles, and a missed match
// is "not confirmed", never "not sent".

test('wentAs: the sending browser\'s own record settles the mark, with no Zendesk read', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(RUNNER, '<p>/reply&nbsp;</p><p>Hei</p><p>Kan du merke adressene på oversiktbildet?</p>', 'Thomas', 'Kvalvåg Håpnes');
  await w.sync.runOnce();
  const e = w.sync.linkOf(1481787, 12896932);
  const made = w.zdComments.get(53123)[w.zdComments.get(53123).length - 1];
  const s = w.sync.wentAs(e, m, null);
  assert.strictEqual(s.commentId, String(made.id));
  assert.strictEqual(s.isPublic, true);
  assert.ok(s.at > 0, 'when it went');
  const n = w.say(2, '<p>Sjekker fjernstyring</p>', 'Andreas', 'Sandnes');
  await w.sync.runOnce();
  assert.strictEqual(w.sync.wentAs(w.sync.linkOf(1481787, 12896932), n, null).isPublic, false, 'a note is recorded as one');
});

test('wentAs: a reply this browser sent before records were kept still counts as sent', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(RUNNER, '<p>/reply Vi kommer i morgen.</p>', 'Thomas');
  await w.sync.runOnce();
  const e = JSON.parse(JSON.stringify(w.sync.linkOf(1481787, 12896932)));
  delete e.sent;   // as a 1.81.0 link stood
  assert.deepStrictEqual(w.sync.wentAs(e, m, null), { commentId: '', isPublic: true, at: 0, ticketId: '53123' }, 'taken on by this browser: on the ticket');
  // a message never taken on, and one from before the link, are not
  const later = { commentId: 999, messageType: 'USER_MESSAGE', content: '<p>/reply Til slutt.</p>', createdAt: Date.now() + 99999, user: { userId: 1 } };
  assert.strictEqual(w.sync.wentAs(e, later, null), null);
  const old = w.chat.find((c) => c.commentId === 12);
  assert.strictEqual(w.sync.beforeLink(e, old), true, 'written before the link: the sync never sends it');
  assert.strictEqual(w.sync.beforeLink(e, m), false);
  assert.strictEqual(w.sync.beforeLink(null, m), false, 'no link here: not known');
});

test('wentAs: the ticket\'s text settles it in another browser - through the session ("web") too, a signature after a reply', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(2, '<p>/reply Vi kommer i morgen.</p>', 'Andreas', 'Sandnes');
  const at = (d) => new Date(m.createdAt + d).toISOString();
  const web = { id: 9101, author_id: 800, public: true, plain_body: 'Vi kommer i morgen.\n\n— Andreas Sandnes', created_at: at(5000), via: { channel: 'web' } };
  assert.deepStrictEqual(w.sync.wentAs(null, m, [web]), { commentId: '9101', isPublic: true, at: Date.parse(web.created_at), ticketId: '' });
  const signed = { id: 9102, author_id: 800, public: true, plain_body: 'Vi kommer i morgen.\n\n— Andreas Sandnes\n\nBest regards,\nAndreas Sandnes\nKiona', created_at: at(5000), via: { channel: 'web' } };
  assert.strictEqual(w.sync.wentAs(null, m, [signed]).commentId, '9102', 'the agent\'s signature after a public reply');
  const note = { id: 9103, author_id: 800, public: false, plain_body: 'Andreas Sandnes (Rocketlane):\nOk\n\nmer tekst', created_at: at(5000), via: { channel: 'web' } };
  const ok = w.say(2, '<p>Ok</p>', 'Andreas', 'Sandnes');
  assert.strictEqual(w.sync.wentAs(null, ok, [note]), null, 'an internal note has no signature: more text is another comment');
  const mail = { id: 9104, author_id: 700, public: true, plain_body: 'Vi kommer i morgen.', created_at: at(5000), via: { channel: 'email' } };
  assert.strictEqual(w.sync.wentAs(null, m, [mail]), null, 'an email with the same words is the customer\'s');
  const early = Object.assign({}, web, { id: 9105, created_at: at(-600000) });
  assert.strictEqual(w.sync.wentAs(null, m, [early]), null, 'made before the message was written: not of it');
});

test('a message another browser sent is recorded when this one finds it on the ticket', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(2, '<p>/reply Vi kommer i morgen.</p>', 'Andreas', 'Sandnes');
  w.zdComments.get(53123).push({ id: 9201, author_id: 800, public: true, plain_body: 'Vi kommer i morgen.\n\n— Andreas Sandnes', created_at: new Date(w.tick()).toISOString(), attachments: [], via: { channel: 'api' } });
  const r = await w.sync.runOnce();
  assert.strictEqual(r.forwarded, 0, 'not sent twice');
  const s = w.sync.wentAs(w.sync.linkOf(1481787, 12896932), m, null);
  assert.strictEqual(s.commentId, '9201', 'recorded as the comment it is');
});

// v1.82.0 - Thomas: "It also displays /reply when I disable the Tampermonkey script, which it shouldn't." The message box
// writes the reply mark (U+2063, invisible) in place of the word, and the sync reads it as the word.
test('the reply mark: a message that starts with it is a reply, and the mark never goes to the ticket', () => {
  const { sync } = world();
  const M = '\u2063';
  assert.deepStrictEqual(sync.parseChatMessage(M + 'Hei Kari'), { isPublic: true, body: 'Hei Kari' });
  assert.deepStrictEqual(sync.parseChatMessage(M + '\nHei'), { isPublic: true, body: 'Hei' }, 'the mark alone on the first line');
  assert.deepStrictEqual(sync.parseChatMessage(' ' + M + '/reply Hei'), { isPublic: true, body: 'Hei' });
  assert.deepStrictEqual(sync.parseChatMessage('Hei ' + M + 'der'), { isPublic: false, body: 'Hei der' }, 'in the middle: a note, the mark taken out');
  assert.deepStrictEqual(sync.parseChatMessage('/reply Hei'), { isPublic: true, body: 'Hei' }, 'the word as before');
  assert.strictEqual(sync.replyMark, M);
  assert.strictEqual(sync.composeModeOf(M + 'Hei').mode, 'reply');
  assert.strictEqual(sync.composeModeOf(M).mode, 'reply');
  assert.deepStrictEqual(sync.replyLead(M + 'Hei'), { whole: false, length: 1 });
  assert.deepStrictEqual(sync.replyLead(M), { whole: true, length: 1 }, 'the mark alone in its paragraph: the paragraph hidden');
  assert.deepStrictEqual(sync.replyLead('\u200B' + M + ' Hei'), { whole: false, length: 3 });
  assert.strictEqual(sync.replyLead('Hei' + M), null);
});

test('a message with the reply mark goes to the ticket as a public reply, without the mark, and its own mark says so', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(RUNNER, '<p>\u2063Hei Kari,</p><p>tekniker kommer i dag.</p>', 'Thomas');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.forwarded, 1);
  assert.deepStrictEqual(w.posted.zd, [{ ticketId: '53123', body: 'Hei Kari,\ntekniker kommer i dag.', isPublic: true }]);
  const s = w.sync.wentAs(w.sync.linkOf(1481787, 12896932), m, null);
  assert.strictEqual(s.isPublic, true);
  assert.strictEqual(w.sync.sentAs(m, w.zdComments.get(53123)).isPublic, true, 'found on the ticket by its text');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'once, and nothing back');
});

test('a marked reply an older sync sent as a note still goes to the customer, once', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  const m = w.say(RUNNER, '<p>\u2063Svar til kunden</p>', 'Thomas');
  // a browser on 1.81 does not know the mark: it sent the message as an internal note, the mark in its text
  w.zdComments.get(53123).push({ id: 9301, author_id: ZD_RUNNER, public: false, plain_body: '\u2063Svar til kunden', created_at: new Date(w.tick()).toISOString(), attachments: [], via: { channel: 'api' } });
  const r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [0, 1], 'the note is no message for the chat; the reply goes');
  assert.deepStrictEqual(w.posted.zd, [{ ticketId: '53123', body: 'Svar til kunden', isPublic: true }]);
  assert.strictEqual(w.sync.sentAs(m, w.zdComments.get(53123)).isPublic, true, 'the mark tells of the reply, not the note');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 });
});

test('times are Norwegian, 24-hour, whatever the computer\'s own zone', () => {
  const { sync } = world();
  assert.strictEqual(process.env.TZ, 'UTC');
  assert.strictEqual(sync.when('2026-10-27T08:00:00Z'), '27 Oct 2026 09:00', 'winter time, UTC+1');
  assert.strictEqual(sync.when('2026-07-01T08:00:00Z'), '1 Jul 2026 10:00', 'summer time, UTC+2');
  assert.strictEqual(sync.clockOf('2026-11-12T23:30:00Z'), '00:30', 'past midnight in Norway');
  assert.strictEqual(sync.dayOf('2026-11-12T23:30:00Z'), '13 Nov 2026');
  assert.strictEqual(sync.clockOf(Date.parse('2026-11-13T12:21:00Z')), '13:21', 'no AM or PM');
  assert.strictEqual(sync.when(''), '');
});

test('a reply whose mark Rocketlane dropped still goes as a reply, from the browser that sent it, once', async () => {
  const w = world();
  const asked = [];
  let kept = ['Svar til kunden'];
  w.deps.intents = { take: (key, text) => { asked.push([key, text]); const i = kept.indexOf(text); if (i < 0) return false; kept.splice(i, 1); return true; } };
  await w.sync.link(1481787, 12896932, 53123);
  w.say(RUNNER, '<p>Svar til kunden</p>', 'Thomas');                  // stored without the mark
  w.say(2, '<p>Svar til kunden</p>', 'Andreas', 'Sandnes');            // the same words from a colleague: a note
  w.say(RUNNER, '<p>Bare et notat</p>', 'Thomas');                     // no reply kept for it: a note
  await w.sync.runOnce();
  assert.deepStrictEqual(w.posted.zd, [
    { ticketId: '53123', body: 'Svar til kunden', isPublic: true },
    { ticketId: '53123', body: 'Andreas Sandnes (Rocketlane):\nSvar til kunden', isPublic: false },
    { ticketId: '53123', body: 'Bare et notat', isPublic: false },
  ]);
  assert.deepStrictEqual(asked, [['1481787:12896932', 'Svar til kunden'], ['1481787:12896932', 'Bare et notat']], 'asked only for the runner\'s own notes');
});

// ---- v1.83.0: more than one ticket in a chat ------------------------------------------------------------------------
// Thomas: "can you also make it so i can link multiple zendesk cases to the chat?" Each ticket's new messages come in
// under its own number; a message written in the chat goes to one ticket - the one it names at its start, else the one
// whose message it answers (Rocketlane's Reply), else the chat's main ticket.

const P = 1481787, C = 12896932;
/** A Zendesk comment on any ticket of the world. */
function replyOn(w, ticketId, authorId, text, isPublic = true) {
  if (!w.zdComments.has(ticketId)) w.zdComments.set(ticketId, []);
  const c = { id: 6000 + w.zdComments.get(ticketId).length + ticketId % 1000 * 10, author_id: authorId, public: isPublic, plain_body: text, created_at: new Date(w.tick()).toISOString(), attachments: [] };
  w.zdComments.get(ticketId).push(c);
  w.queue.find((t) => t.id === ticketId).updated_at = c.created_at;
  return c;
}
async function twoTickets() {
  const w = world();
  w.zdComments.set(53125, []);
  await w.sync.link(P, C, 53123);
  await w.sync.link(P, C, 53125);
  return w;
}
const toTicket = (w, id) => w.posted.zd.filter((p) => String(p.ticketId) === String(id)).map((p) => [p.body, p.isPublic]);

test('a second ticket: linked too, the chat told where its messages go, the first one still the main', async () => {
  const w = await twoTickets();
  const e = w.sync.linkOf(P, C);
  assert.deepStrictEqual([e.main, e.tickets.map((t) => t.ticketId)], ['53123', ['53123', '53125']]);
  assert.strictEqual(unmark(w.posted.rl[1].html).replace(/<a [^>]*>(Zendesk #\d+)<\/a>/g, '$1'),
    '<p>Zendesk #53125 is linked to this chat too · Laksvollen ny bruker</p><p>Messages here still go to Zendesk #53123. ' +
    'To write to #53125, reply to one of its messages or start with #53125.</p>');
  await w.sync.link(P, C, 53125);
  assert.strictEqual(w.posted.rl.length, 2, 'linking it again does nothing');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'nothing old, either way');
});

test('each ticket\'s new messages come in under its own number', async () => {
  const w = await twoTickets();
  w.reply(700, 'Alarm i fryserommet.');
  replyOn(w, 53125, 700, 'Ny bruker til butikksjefen, takk.');
  const r = await w.sync.runOnce();
  assert.strictEqual(r.mirrored, 2);
  const shown = w.posted.rl.slice(2).map((p) => unmark(p.html).replace('</p><p>', ' | ').replace(/<[^>]+>/g, ''));
  assert.deepStrictEqual(shown.sort(), ['Zendesk #53123 · Kari Kunde (customer) | Alarm i fryserommet.', 'Zendesk #53125 · Kari Kunde (customer) | Ny bruker til butikksjefen, takk.']);
  assert.deepStrictEqual(r.posted.map((p) => [p.ticketId, p.count]).sort(), [['53123', 1], ['53125', 1]]);
});

test('a message goes to the main ticket, to the ticket it names, or to the one whose message it answers', async () => {
  const w = await twoTickets();
  w.say(2, '<p>Sjekker fryseren.</p>', 'Andreas', 'Sandnes');
  w.say(RUNNER, '<p>#53125 Brukeren er laget.</p>', 'Thomas');
  w.say(RUNNER, '<p>/reply #53125 Hei Kari, brukeren er klar.</p>', 'Thomas');
  // Rocketlane's Reply on one of the sync's messages from #53125
  const answered = replyOn(w, 53125, 700, 'Takk!');
  await w.sync.runOnce();
  const quoted = w.chat.find((c) => /Zendesk #53125/.test(c.content) && /Takk!/.test(c.content));
  const ans = w.say(2, '<p>Bare hyggelig.</p>', 'Andreas', 'Sandnes');
  ans.commentMeta = { repliedTo: { commentId: quoted.commentId, content: quoted.content, user: { userId: RUNNER } } };
  // a number that is no ticket of the chat is just text, and goes to the main ticket as written
  w.say(RUNNER, '<p>#99999 er en annen sak.</p>', 'Thomas');
  await w.sync.runOnce();
  assert.ok(answered);
  assert.deepStrictEqual(toTicket(w, 53123), [['Andreas Sandnes (Rocketlane):\nSjekker fryseren.', false], ['#99999 er en annen sak.', false]]);
  assert.deepStrictEqual(toTicket(w, 53125), [['Brukeren er laget.', false], ['Hei Kari, brukeren er klar.', true], ['Andreas Sandnes (Rocketlane):\nBare hyggelig.', false]],
    'the number that chose the ticket is not sent; the answer goes where the answered message came from');
  const e = w.sync.linkOf(P, C);
  const named = w.chat.find((c) => c.content === '<p>#53125 Brukeren er laget.</p>');
  assert.strictEqual(w.sync.wentAs(e, named, null).ticketId, '53125', 'and the record says where each went');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'nothing twice, nothing back');
});

test('routeOf and ticketNamedIn: the answered message must be one of the sync\'s, naming a ticket of the chat', () => {
  const w = world();
  const e = { main: '53123', tickets: [{ ticketId: '53123' }, { ticketId: '53125' }] };
  const sync = w.sync;
  assert.strictEqual(sync.ticketNamedIn('<p><b><a href="https://iwmac.zendesk.com/agent/tickets/53125#zd-comment-9">Zendesk #53125</a></b> · Kari</p>'), '53125');
  assert.strictEqual(sync.ticketNamedIn('<p>Se Zendesk #53125 for det</p>'), '', 'only at the start, as the sync writes it');
  assert.deepStrictEqual(sync.routeOf(e, sync.parseChatMessage('Hei', ['53123', '53125']), ''), { ticketId: '53123', why: 'main' });
  assert.deepStrictEqual(sync.routeOf(e, sync.parseChatMessage('#53125 Hei', ['53123', '53125']), ''), { ticketId: '53125', why: 'named' });
  assert.deepStrictEqual(sync.routeOf(e, sync.parseChatMessage('Hei', ['53123', '53125']), '<p>Zendesk #53125 · Kari</p>'), { ticketId: '53125', why: 'reply' });
  assert.deepStrictEqual(sync.routeOf(e, sync.parseChatMessage('#53123 Hei', ['53123', '53125']), '<p>Zendesk #53125 · Kari</p>'), { ticketId: '53123', why: 'named' }, 'a named ticket before an answered one');
  assert.deepStrictEqual(sync.routeOf(e, sync.parseChatMessage('Hei', ['53123', '53125']), '<p>Zendesk #77777 · Kari</p>'), { ticketId: '53123', why: 'main' }, 'a ticket no longer linked: the main one');
});

test('reading a message with the chat\'s tickets: the number after /reply, the mark, and a number that is no ticket', () => {
  const { sync } = world();
  const linked = ['53123', '53125'];
  assert.deepStrictEqual(sync.parseChatMessage('/reply #53125 Hei Kari', linked), { isPublic: true, body: 'Hei Kari', ticket: '53125' });
  assert.deepStrictEqual(sync.parseChatMessage('\u2063#53125: Hei', linked), { isPublic: true, body: 'Hei', ticket: '53125' }, 'the mark the "/" list writes');
  assert.deepStrictEqual(sync.parseChatMessage('#53125\nHei', linked), { isPublic: false, body: 'Hei', ticket: '53125' });
  assert.deepStrictEqual(sync.parseChatMessage('#4400 kunder', linked), { isPublic: false, body: '#4400 kunder' }, 'not a ticket of the chat');
  assert.deepStrictEqual(sync.parseChatMessage('/reply #53125 Hei'), { isPublic: true, body: '#53125 Hei' }, 'without the chat\'s tickets, as before');
  assert.deepStrictEqual(sync.parseChatMessage('#53125 /reply Hei', linked), { isPublic: false, body: '/reply Hei', ticket: '53125' }, '/reply after the number is no reply');
  assert.deepStrictEqual(sync.composeModeOf('#53125 /reply Hei'), { mode: 'typo', word: '#53125 /reply', order: true }, 'and the box says so');
  assert.deepStrictEqual(sync.replyLead('\u2063#53125 Hei', linked), { whole: false, length: 8 }, 'the mark and the number hidden, the mark names the ticket');
  assert.deepStrictEqual(sync.replyLead('\u2063#53125 Hei'), { whole: false, length: 1 }, 'without the chat\'s tickets, the mark only');
  assert.deepStrictEqual(sync.replyLead('/reply #53125', linked), { whole: true, length: 13 });
});

test('the main ticket can change; the chat is told, and messages go there from then on', async () => {
  const w = await twoTickets();
  await w.sync.setMain(P, C, 53125);
  assert.strictEqual(w.sync.linkOf(P, C).main, '53125');
  assert.match(unmark(w.posted.rl[2].html).replace(/<a [^>]*>(Zendesk #\d+)<\/a>/g, '$1'),
    /^<p>Zendesk #53125 is now the main ticket of this chat · Laksvollen ny bruker<\/p><p>Messages here go to it\. To write to #53123, reply to one of its messages or start with #53123\.<\/p>$/);
  w.say(RUNNER, '<p>Ok</p>', 'Thomas');
  await w.sync.runOnce();
  assert.deepStrictEqual([toTicket(w, 53123), toTicket(w, 53125)], [[], [['Ok', false]]]);
  await assert.rejects(w.sync.setMain(P, C, 99999), /not linked/);
});

test('a solved ticket waits on its own: the others go on, and its messages go when it is opened again', async () => {
  const w = await twoTickets();
  w.queue.find((t) => t.id === 53125).status = 'solved';
  w.say(RUNNER, '<p>#53125 Venter på kunden.</p>', 'Thomas');
  w.say(RUNNER, '<p>Fryseren er ok.</p>', 'Thomas');
  const r = await w.sync.runOnce();
  assert.deepStrictEqual([r.forwarded, r.paused, r.errors], [1, 1, 0]);
  assert.deepStrictEqual(toTicket(w, 53123), [['Fryseren er ok.', false]]);
  const e = w.sync.linkOf(P, C);
  assert.deepStrictEqual([e.status, e.tickets.map((t) => t.status)], ['active', ['active', 'paused']]);
  assert.match(e.note, /^#53125: The ticket is solved/);
  w.queue.find((t) => t.id === 53125).status = 'open';
  await w.sync.runOnce();
  assert.deepStrictEqual(toTicket(w, 53125), [['Venter på kunden.', false]], 'it waited, and went');
});

test('unlinking one ticket keeps the others; the main one\'s place goes to the next; the last unlinks the chat', async () => {
  const w = await twoTickets();
  await w.sync.unlink(P, C, 53123);
  const e = w.sync.linkOf(P, C);
  assert.deepStrictEqual([e.main, e.tickets.map((t) => t.ticketId)], ['53125', ['53125']]);
  assert.strictEqual(unmark(w.posted.rl[2].html).replace(/<a [^>]*>(Zendesk #\d+)<\/a>/g, '$1'),
    '<p>Zendesk #53123 is no longer linked to this chat</p><p>Messages here go to Zendesk #53125.</p>');
  w.reply(700, 'Etter unlinking.');
  await w.sync.runOnce();
  assert.ok(!w.posted.rl.some((p) => /Etter unlinking/.test(p.html)), 'an unlinked ticket no longer comes in');
  w.sync.unlink(P, C, 53125);
  assert.strictEqual(w.sync.linkOf(P, C), null, 'the last one: the chat is not linked any more');
  assert.strictEqual(w.posted.rl.length, 3, 'and that says nothing in the chat, as before');
});

test('a link as 1.82 kept it - one ticket on the link itself - is read as one of the new kind; nothing is posted again', async () => {
  const w = world();
  await w.sync.link(P, C, 53123);
  w.say(RUNNER, '<p>Gammel og sendt</p>', 'Thomas');
  await w.sync.runOnce();
  const e = w.sync.linkOf(P, C), t = e.tickets[0];
  const old = { projectId: e.projectId, conversationId: e.conversationId, ticketId: t.ticketId, subject: t.subject, linkedAt: t.linkedAt,
    zdMax: t.zdMax, rlSince: e.rlSince, rlSeen: e.rlSeen, ownRl: e.ownRl, ownZd: t.ownZd, status: 'active', note: '', lastRun: e.lastRun,
    historyPosted: false, filesPosted: true, zdUpdatedAt: t.zdUpdatedAt, sent: e.sent };
  w.state.value = JSON.stringify({ links: { [P + ':' + C]: old } });
  const up = w.sync.linkOf(P, C);
  assert.deepStrictEqual([up.main, up.tickets.length, up.tickets[0].zdMax, up.tickets[0].filesPosted, up.rlSince], ['53123', 1, t.zdMax, true, e.rlSince]);
  const before = [w.posted.rl.length, w.posted.zd.length];
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 });
  assert.deepStrictEqual([w.posted.rl.length, w.posted.zd.length], before);
  w.say(2, '<p>Ny etter oppgraderingen</p>', 'Andreas', 'Sandnes');
  await w.sync.runOnce();
  assert.deepStrictEqual(toTicket(w, 53123).slice(-1), [['Andreas Sandnes (Rocketlane):\nNy etter oppgraderingen', false]]);
});

test('a reply the sync sent is known on the ticket under the signature Zendesk puts there: never sent or brought back again', async () => {
  // seen 2026-11-16: a reply the sync sent stood on the ticket as "<text> Best regards, Thomas Kvalvåg …"; a second
  // browser running the sync - here: an older record of the link - knew it neither as sent nor as the chat's own
  const w = world();
  await w.sync.link(P, C, 53123);
  const older = w.state.value;
  w.say(RUNNER, '<p>/reply Hei</p><p>Når du har adressert plugin diskene kan du merke adressene på oversiktbildet?</p>', 'Thomas');
  await w.sync.runOnce();
  const sent = w.zdComments.get(53123).slice(-1)[0];
  assert.strictEqual(sent.public, true);
  sent.plain_body += ' \n Best regards,\n\nThomas Kvalvåg \n \n Technical System Engineer \n Office +47 982 50 007\n\n\n\nKiona';
  w.queue.find((t) => t.id === 53123).updated_at = '2026-10-28T11:00:00Z';
  w.state.value = older;
  const r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'not to the customer twice, not into the chat');
  assert.strictEqual(w.posted.zd.length, 1);
});

// ---- v1.83.0: which tickets suit a project ----------------------------------------------------------------------------
// The cases are today's queue (2026-11-16), cut to what decides: two tickets the plant number could not find.

const ccr = { name: '10257 - Bunnpris Vika: New store', company: 'CO2OLTEC Commercial Refrigeration Norway AS', domains: ['ccr.com'], emails: ['montor@ccr.com'] };
const vika = { id: 211004, subject: 'bunnpris VIKA', status: 'open', description: 'Hei, vi trenger tilgang.', updated_at: '2026-11-10T08:00:00Z',
  custom_fields: [{ id: 27741611, value: null }], _requester: { email: 'service@ccr.com' }, _org: { name: 'CCR - CO2OLtec (Teknisk Avdeling)' } };
const trofors = { id: 210837, subject: 'Sv: 207394 - Extra Trofors Laksvollen', status: 'open', description: 'Se vedlegg', updated_at: '2026-11-03T08:00:00Z',
  custom_fields: [{ id: 27741611, value: '0000' }], _requester: { email: 'pl@norddisk.no' }, _org: { name: 'Norddisk AS' } };
const maere = { id: 213531, subject: '10259, Extra Mære (ny) - Tilganger i IWMAC', status: 'new', description: 'Anlegg 10259', updated_at: '2026-11-15T08:00:00Z',
  custom_fields: [{ id: 27741611, value: '2191' }], _requester: { email: 'it@aneoretail.com' }, _org: { name: 'Ohmia Retail AS' } };

test('suggestions: the store\'s own name with the project\'s contractor finds a ticket the plant number does not', () => {
  const { sync } = world();
  const [a] = sync.rankTickets([vika, trofors, maere], ccr, 27741611);
  assert.deepStrictEqual([a.ticket.id, a.found, a.why], [211004, true, ['“Vika” in the subject', 'from CCR - CO2OLtec (Teknisk Avdeling)']]);
  const lv = sync.rankTickets([vika, trofors, maere], { name: '10263 - Extra Laksvollen: New store', company: 'Norddisk AS', domains: ['norddisk.no'] }, 27741611);
  assert.deepStrictEqual([lv[0].ticket.id, lv[0].found, lv[0].why], [210837, true, ['“Laksvollen” in the subject', 'from Norddisk AS']]);
  // the contractor alone: another of Norddisk's stores
  const betna = sync.rankTickets([trofors], { name: '10112 - Bunnpris Betna: Ny Butikk', company: 'Norddisk AS', domains: ['norddisk.no'] }, 27741611)[0];
  assert.deepStrictEqual([betna.found, betna.score], [false, 2]);
  // the store's name alone, written by someone else: listed first, but not asked about
  const alone = sync.rankTickets([vika], { name: '10257 - Bunnpris Vika: New store' }, 27741611)[0];
  assert.deepStrictEqual([alone.found, alone.score], [false, 6]);
});

test('suggestions: the number and the store in the subject, whatever its Plant ID says; a requester on the project', () => {
  const { sync } = world();
  const r = sync.rankTickets([maere], { name: '10259 - Extra Mære: Ombygging', company: 'Kelvin AS', domains: ['kelvinas.no'] }, 27741611)[0];
  assert.deepStrictEqual([r.found, r.score, r.why], [true, 17, ['10259 in the subject', '“Mære” in the subject', 'Plant ID 2191, another plant']],
    'asked about on its number in the subject, the old plant\'s Plant ID shown as the conflict it is');
  // the store's name and the contractor, but a Plant ID naming another plant: listed, not asked about (live, 2026-11-16)
  const kanda = { id: 212715, subject: '10270 Kanda As', status: 'open', updated_at: '2026-11-14T08:00:00Z', custom_fields: [{ id: 27741611, value: '10270' }],
    _requester: { email: 'kontor@iac.no' }, _org: { name: 'IAC Vestcold' } };
  const k = sync.rankTickets([kanda], { name: '3313 - Kanda: Utvidelse', company: 'Epta Norway AS', domains: ['epta-norway.com', 'iac.no'] }, 27741611)[0];
  assert.deepStrictEqual([k.found, k.score, k.why], [false, 4, ['“Kanda” in the subject', 'from IAC Vestcold', 'Plant ID 10270, another plant']]);
  const member = sync.rankTickets([Object.assign({}, vika, { _requester: { email: 'Montor@CCR.com' } })], ccr, 27741611)[0];
  assert.deepStrictEqual([member.score, member.why], [10, ['“Vika” in the subject', 'requester is on the project']]);
});

test('suggestions: Norwegian letters fold, words must be whole, chains and kinds of project count for nothing', () => {
  const { sync } = world();
  const t = (subject) => ({ id: 1, subject, status: 'open', custom_fields: [] });
  const score = (subject, name) => sync.rankTickets([t(subject)], name)[0].score;
  assert.strictEqual(score('Fosnavaag - ny bruker', '8682 - Meny Fosnavåg: Ombygging'), 6);
  assert.strictEqual(score('MAERE kjølerom', '10259 - Extra Mære: Ombygging'), 6);
  assert.strictEqual(score('Extra Laksvollen alarm', '10267 - Extra Voll - Ny butikk'), 0, 'Voll is not in Laksvollen');
  assert.strictEqual(score('Coop Extra - ny butikk', '10263 - Extra Laksvollen: New store'), 0, 'the chain and the kind of project say nothing');
  assert.deepStrictEqual(sync.nameWords('10264 Coop Prix Stjørdal').map((w) => w.label), ['Stjørdal']);
  assert.deepStrictEqual(sync.nameWords('3155 - Spar Sannerud - *AC Kampanje*').map((w) => w.label), ['Sannerud']);
  assert.deepStrictEqual(sync.nameWords('Team Kulde Oppgaver'), []);
});

test('suggestions: the chat\'s own tickets are left out; one linked to another chat is marked, and never asked about', () => {
  const { sync } = world();
  const ranked = sync.rankTickets([vika, trofors], ccr, 27741611, { linkedHere: [210837], linkedElsewhere: { 211004: '1:2' } });
  assert.deepStrictEqual(ranked.map((r) => [r.ticket.id, r.found, r.why.slice(-1)[0]]), [[211004, false, 'linked to another chat']]);
});

// ---- v1.88.0: a ticket added by hand ----
// Thomas: "when link zendesk case make so you can manually add zendesk ticket to chat on the project if you want". The
// handover to service is made in IWMAC Support, a group outside the queue's view: linked by its number, while active.
const HANDOVER = { id: 61000, subject: 'Overlevering til service - 10263 Extra Laksvollen', status: 'open', updated_at: '2026-10-28T09:10:00Z', custom_fields: [{ id: 27741611, value: '10263' }] };
function handWorld() {
  const w = world();
  w.elsewhere.set('61000', JSON.parse(JSON.stringify(HANDOVER)));
  w.elsewhere.set('61001', { id: 61001, subject: 'Gammel servicesak', status: 'solved' });
  w.elsewhere.set('61002', { id: 61002, subject: 'Lukket sak', status: 'closed' });
  w.zdComments.set(61000, [{ id: 4500, author_id: 800, public: false, plain_body: 'Overlevering opprettet fra Rocketlane.', created_at: '2026-10-28T09:10:00Z', attachments: [] }]);
  return w;
}

test('ticketIdIn: a number, with # or "Zendesk" before it, or a Zendesk link; anything else is none', () => {
  const { sync } = world();
  const read = (s) => sync.ticketIdIn(s);
  assert.deepStrictEqual(['61000', ' #61000 ', 'Zendesk #61000', 'https://iwmac.zendesk.com/agent/tickets/61000', 'https://iwmac.zendesk.com/agent/tickets/61000?x=1',
    'https://iwmac.zendesk.com/hc/no/requests/61000', 'https://iwmac.zendesk.com/api/v2/tickets/61000.json'].map(read), Array(7).fill('61000'));
  assert.deepStrictEqual(['', 'abc', '61000 og 61001', 'https://iwmac.zendesk.com/agent/tickets/', 'https://kiona.rocketlane.com/projects/61000', null, undefined].map(read), Array(7).fill(''));
});

test('by hand: a ticket outside the queue, by its number - the chat told, new messages only, both ways', async () => {
  const w = handWorld();
  await assert.rejects(w.sync.link(P, C, 61000), /not an active ticket in the queue/, 'from the queue\'s list: still the queue\'s only');
  const e = await w.sync.link(P, C, 'https://iwmac.zendesk.com/agent/tickets/61000', { manual: true });
  assert.deepStrictEqual([e.main, e.tickets.map((t) => [t.ticketId, t.subject, t.status, t.zdMax])], ['61000', [['61000', HANDOVER.subject, 'active', 4500]]]);
  assert.strictEqual(w.posted.rl.length, 1, 'the notice only, as from the queue');
  assert.strictEqual(w.posted.rl[0].html, '<p><a href="https://iwmac.zendesk.com/agent/tickets/61000" target="_blank" rel="noopener noreferrer">Zendesk #61000</a>' +
    ' is linked to this chat · ' + HANDOVER.subject + '</p><p>Messages here go to the ticket as internal notes. Start with /reply to answer the customer.</p>');
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'it syncs though the queue does not list it');
  // a new message on it comes in; one written in the chat goes to it
  const c = { id: 4501, author_id: 800, public: false, plain_body: 'Servicetekniker er varslet.', created_at: new Date(w.tick()).toISOString(), attachments: [] };
  w.zdComments.get(61000).push(c);
  w.elsewhere.get('61000').updated_at = c.created_at;
  w.say(2, '<p>Takk, vi følger opp.</p>', 'Andreas', 'Sandnes');
  const r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 1, forwarded: 1, paused: 0, errors: 0 });
  assert.match(unmark(w.posted.rl[1].html), /^<p><b>Zendesk #61000<\/b> · Ola Agent · internal note<\/p><p>Servicetekniker er varslet\.<\/p>$/);
  assert.deepStrictEqual(w.posted.zd.map((p) => [p.ticketId, p.body, p.isPublic]), [['61000', 'Andreas Sandnes (Rocketlane):\nTakk, vi følger opp.', false]]);
  // and it pauses when it is solved, as any linked ticket does
  w.elsewhere.get('61000').status = 'solved';
  assert.deepStrictEqual(counts(await w.sync.runOnce()), { mirrored: 0, forwarded: 0, paused: 1, errors: 0 });
});

test('by hand: only an active ticket - solved, closed, missing or no number at all is refused, and nothing is posted', async () => {
  const w = handWorld();
  await assert.rejects(w.sync.link(P, C, 61001, { manual: true }), /^Error: Ticket #61001 is solved: only a new, open, waiting or on-hold ticket can be linked\. Open it again in Zendesk first\.$/);
  await assert.rejects(w.sync.link(P, C, 61002, { manual: true }), /is closed: .* A closed ticket cannot be opened again; make a follow-up in Zendesk\.$/);
  await assert.rejects(w.sync.link(P, C, 53126, { manual: true }), /#53126 is solved/, 'the queue\'s solved one too');
  await assert.rejects(w.sync.link(P, C, 69999, { manual: true }), /^Error: Zendesk has no ticket #69999 that you can see\.$/);
  await assert.rejects(w.sync.link(P, C, 'butikken', { manual: true }), /“butikken” is not a ticket number/);
  assert.strictEqual(w.sync.linkOf(P, C), null);
  assert.strictEqual(w.posted.rl.length, 0);
  assert.strictEqual(w.sync.notLinkable({ id: 61003, status: 'hold' }, '61003'), '', 'on hold is active');
});

test('by hand: one more ticket in a linked chat, the queue\'s ticket still the main; linked twice, nothing happens', async () => {
  const w = handWorld();
  await w.sync.link(P, C, 53123);
  const e = await w.sync.link(P, C, '#61000', { manual: true });
  assert.deepStrictEqual([e.main, e.tickets.map((t) => t.ticketId)], ['53123', ['53123', '61000']]);
  assert.match(w.posted.rl[1].html, /Zendesk #61000<\/a> is linked to this chat too · Overlevering til service - 10263 Extra Laksvollen<\/p><p>Messages here still go to <a [^>]*>Zendesk #53123<\/a>\. To write to #61000, reply to one of its messages or start with #61000\.<\/p>$/);
  await w.sync.link(P, C, 61000, { manual: true });
  await w.sync.link(P, C, 53123, { manual: true });
  assert.strictEqual(w.posted.rl.length, 2, 'either one linked again: nothing');
  // a message that names it goes to it, the number not sent
  w.say(1, '<p>#61000 Overlevering sjekket.</p>', 'Thomas');
  await w.sync.runOnce();
  assert.deepStrictEqual(toTicket(w, 61000), [['Overlevering sjekket.', false]]);
});
