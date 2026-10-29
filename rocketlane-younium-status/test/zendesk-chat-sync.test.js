'use strict';
/* Zendesk ⇄ General Chat (Rocketlane improvements 1.73.0; Rocketlane Chat Bridge 1.16.0-1.18.0 before): the sync's
 * engine, taken from the userscript as it stands, run against an in-memory Rocketlane chat and an in-memory Zendesk.
 *   node --test rocketlane-younium-status/test/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'rocketlane-younium-status.user.js'), 'utf8');
const a = src.indexOf('// @@ZDSYNC-ENGINE-START'), b = src.indexOf('// @@ZDSYNC-ENGINE-END');
assert.ok(a > 0 && b > a, 'the engine markers are in the userscript');
const createZendeskChatSync = new Function(src.slice(a, b) + '\nreturn createZendeskChatSync;')();

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
      ticketUrl: (id) => 'https://iwmac.zendesk.com/agent/tickets/' + id,
      async statuses(ids) {
        const out = {};
        for (const id of ids) { const t = queue.find((x) => String(x.id) === String(id)) || elsewhere.get(String(id)); if (t) out[String(id)] = t.status; }
        return out;
      },
      async getComments(ticketId) { return { comments: JSON.parse(JSON.stringify(zdComments.get(Number(ticketId)) || [])), users: zdUsers }; },
      async addComment(ticketId, body, isPublic, uploads) {
        if (fail.zdAdd > 0) { fail.zdAdd--; throw new Error('Zendesk svarte HTTP 500'); }
        const c = { id: nextZd++, author_id: ZD_RUNNER, public: isPublic, plain_body: body, created_at: new Date(tick()).toISOString(), attachments: [] };
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
    [[53124, 25], [53123, 14], [53125, 2]], 'Plant ID, then the number in the subject, then in the text, then a word of the name');
  assert.deepStrictEqual(w.sync.rankTickets(q, '10263 - Extra Laksvollen: New store').map((r) => [r.ticket.id, r.score]),
    [[53123, 14], [53124, 5], [53125, 2]], 'without the field known, the text alone');
  assert.deepStrictEqual(q.map((t) => w.sync.plantOf(t, w.PLANT)), ['', '10263', ''], 'none, a number, or only zeros');
  // a project whose ticket says another number in its subject: the Plant ID decides (8222 - Obs Harstad, "SV: 41584 OBS Harstad")
  const harstad = [{ id: 207248, subject: 'SV: 41584 OBS Harstad - Plug In på Iwmac', status: 'open', custom_fields: [{ id: w.PLANT, value: 8222 }] },
    { id: 210175, subject: 'INC000002790331 : 209753 - Joker Bjordal - 10250 -', status: 'open', custom_fields: [{ id: w.PLANT, value: 10250 }] }];
  const best = w.sync.rankTickets(harstad, '8222 - Obs Harstad: Ombygging', w.PLANT)[0];
  assert.deepStrictEqual([best.ticket.id, best.score], [207248, 22]);
});

test('linking: only an active ticket of the queue; the chat is told, and gets new messages only - the earlier ones on request; nothing old goes to Zendesk', async () => {
  const w = world();
  await assert.rejects(w.sync.link(1481787, 12896932, 53126), /not an active ticket/);
  await assert.rejects(w.sync.link(1481787, 12896932, 99999), /not an active ticket/);
  const e = await w.sync.link(1481787, 12896932, 53123);
  assert.strictEqual(e.ticketId, '53123');
  assert.strictEqual(e.historyPosted, false);
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
  assert.deepStrictEqual(w.posted.rl.slice(1).map((p) => [p.html, p.isPrivate]), [
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
  // the mirrored message carries its "Zendesk #" header: not sent back. The internal note sent to Zendesk has no id:
  // it comes into the chat once, as Zendesk's (a harmless echo), and stops there.
  r = await w.sync.runOnce();
  assert.deepStrictEqual([r.mirrored, r.forwarded], [1, 0]);
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
  assert.match(html, /^<p><b>Zendesk #53123<\/b> · Kari &lt;Kunde&gt; \(customer\)<\/p>/);
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

test('an email reply tidied for the chat: no entities, no runs of blank lines, no quoted email, a short signature', () => {
  const w = world();
  const email = 'Hei,  \n \n&nbsp;\n \nFikk dere sett på dette?&nbsp;\n&nbsp;\n \n \nMed vennlig hilsen\n&nbsp;\nOla Kunde\nProsjektleder\n' +
    'Mobil: +47 900 00 000\nE-post: ola@example.no\n&nbsp;\nKunde AS\nGate 1, 0001 Oslo\n\nFra: Ola Kunde <ola@example.no>\nSendt: mandag 1. september 2026 10:00\n' +
    'Til: Support <support@example.com>\nEmne: Sak\n\nGammel tekst';
  assert.strictEqual(w.sync.tidyText(email), 'Hei,\n\nFikk dere sett på dette?\n\nMed vennlig hilsen\nOla Kunde');
  assert.strictEqual(w.sync.tidyText('Svar her.\n\nFra: Ola <ola@example.no>\nSendt: 1. sep\nTil: oss\n\nGammelt'), 'Svar her.', 'a quoted email without a sign-off');
  assert.strictEqual(w.sync.tidyText('Takk!\n\nOn Mon, 1 Sep 2026 at 10:00, Ola <ola@example.no> wrote:\n> gammelt'), 'Takk!');
  assert.strictEqual(w.sync.tidyText('Ok\n-----Original Message-----\nFrom: x'), 'Ok');
  assert.strictEqual(w.sync.tidyText('Hei\n\nBest regards,\nThomas Kvalvåg\nIWMAC'), 'Hei\n\nBest regards,\nThomas Kvalvåg');
  assert.strictEqual(w.sync.tidyText('Hei\nMvh\n+47 900 00 000'), 'Hei\nMvh', 'no phone number taken for a name');
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
  assert.deepStrictEqual(w.sync.links()['1481787:12896932'].zdUpdatedAt, '2026-10-28T10:30:00Z');
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
  assert.strictEqual(p.html, '<p><b>Zendesk #53123</b> · Kari Kunde (customer)</p><p>Se klipp under.</p><p>Attachments: <a href="' +
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
  assert.strictEqual(w.sync.linkOf(1481787, 12896932).filesPosted, true, 'nothing left for later');
});

test('a chat linked before files came along gets the earlier ones once, a message for each Zendesk message that has any', async () => {
  const w = world();
  await w.sync.link(1481787, 12896932, 53123);
  // as a link from before 1.74.0
  const st = JSON.parse(w.state.value);
  delete st.links['1481787:12896932'].filesPosted;
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
