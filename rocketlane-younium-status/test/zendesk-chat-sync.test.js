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
      async postComment(projectId, conversationId, html, isPrivate) {
        if (fail.rlPost > 0) { fail.rlPost--; throw new Error('Rocketlane svarte HTTP 502'); }
        const c = { commentId: nextRl++, messageType: 'USER_MESSAGE', content: html, private: isPrivate, createdAt: tick(), user: { userId: RUNNER, firstName: 'Thomas' } };
        chat.push(c);
        posted.rl.push({ projectId, conversationId, html, isPrivate });
        return opts.noRlIds ? null : { id: c.commentId };
      },
    },
    zd: {
      async queueTickets() { return JSON.parse(JSON.stringify(queue)); },
      async statuses(ids) {
        const out = {};
        for (const id of ids) { const t = queue.find((x) => String(x.id) === String(id)) || elsewhere.get(String(id)); if (t) out[String(id)] = t.status; }
        return out;
      },
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

test('linking: only an active ticket of the queue; the chat is told, then gets the ticket\'s earlier messages; nothing old goes to Zendesk', async () => {
  const w = world();
  await assert.rejects(w.sync.link(1481787, 12896932, 53126), /not an active ticket/);
  await assert.rejects(w.sync.link(1481787, 12896932, 99999), /not an active ticket/);
  const e = await w.sync.link(1481787, 12896932, 53123);
  assert.strictEqual(e.ticketId, '53123');
  assert.strictEqual(e.historyPosted, true);
  assert.strictEqual(w.posted.rl.length, 2, 'the notice, then the history');
  assert.match(w.posted.rl[0].html, /^<p>Zendesk #53123 “10263 Extra Laksvollen - alarm” is now linked to this chat\. Its earlier messages follow/);
  assert.match(w.posted.rl[1].html, /^<p><b>Zendesk #53123<\/b> · earlier messages \(1 in all\)<\/p><p><br><\/p><p><b>Kari Kunde<\/b> \(customer\) · 27 Oct 2026 \d\d:\d\d<\/p><p>Gammel kundemelding<\/p>$/);
  assert.deepStrictEqual(w.posted.rl.map((p) => p.isPrivate), [true, true]);
  const r = await w.sync.runOnce();
  assert.deepStrictEqual(counts(r), { mirrored: 0, forwarded: 0, paused: 0, errors: 0 }, 'the history is not posted twice, and nothing the sync posted, nor the chat\'s old message, goes to Zendesk');
  assert.strictEqual(await w.sync.postHistory(1481787, 12896932), 0, 'once');
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
  assert.deepStrictEqual(w.posted.rl.slice(2).map((p) => [p.html, p.isPrivate]), [
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
  assert.deepStrictEqual(w.posted.rl.slice(2).map((p) => /<p>(En|To)<\/p>/.exec(p.html)[1]), ['En', 'To']);
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

test('a chat linked before 1.17.4 gets the ticket\'s messages from before its link, once', async () => {
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
