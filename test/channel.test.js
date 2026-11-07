import test from 'node:test';
import assert from 'node:assert/strict';
import { TeamChannel } from '../src/channel.js';

function make(state = { history: [], seen: [], knowledge: [] }) {
  const sent = [], learned = [];
  const channel = new TeamChannel({ state, send: text => sent.push(text), save() {}, learn: event => learned.push(event) });
  return { channel, state, sent, learned };
}

test('an isolated agent cannot learn teammate observations, but retains its own discoveries', () => {
  const a = make();
  a.channel.setOnline(false);
  a.channel.publish('Danger', { x: 10, y: 64, z: 20 });
  a.channel.tick();
  assert.equal(a.sent.length, 0);
  assert.equal(a.channel.receive('Flint', '[TEAM 0123abcd] Wood at 1 64 2'), false);
  assert.equal(a.learned.length, 0);
  assert.equal(a.state.seen.length, 0);
  assert.equal(a.state.history.length, 1);
  a.channel.setOnline(true);
  a.channel.tick();
  assert.match(a.sent[0], /TEAM SYNC/);
  assert.match(a.sent[1], /Danger at 10 64 20/);
});

test('reconnection recovers missed facts and replay does not duplicate knowledge', () => {
  const a = make(), b = make();
  b.channel.setOnline(false);
  a.channel.publish('Wood', { x: 5, y: 70, z: -4 });
  a.channel.tick();
  b.channel.receive('Ember', a.sent.shift());
  assert.equal(b.state.knowledge.length, 0);
  b.channel.setOnline(true);
  a.channel.receive('Flint', b.sent.shift());
  a.channel.tick();
  const replay = a.sent.shift();
  assert.equal(b.channel.receive('Ember', replay), true);
  assert.equal(b.channel.receive('Ember', replay), false);
  assert.equal(b.state.knowledge.length, 1);
  assert.deepEqual(b.state.knowledge[0].position, [5, 70, -4]);
});

test('observations survive restart and malformed chat cannot become knowledge', () => {
  const a = make();
  a.channel.publish('Danger', { x: -1.2, y: 65.9, z: 12 });
  const restarted = make(JSON.parse(JSON.stringify(a.state)));
  restarted.channel.tick();
  assert.match(restarted.sent[0], /Danger at -2 65 12/);
  for (const message of ['hello', '[TEAM bad] Danger at 1 2 3', '[TEAM 0123abcd] Wood at 999999999999999999 2 3']) {
    assert.equal(restarted.channel.receive('Moss', message), false);
  }
  assert.equal(restarted.state.knowledge.length, 0);
});

test('restarting an isolated agent does not silently restore communication', () => {
  const a = make();
  a.channel.setOnline(false);
  a.channel.publish('Wood', { x: 3, y: 64, z: 4 });
  const restarted = make(JSON.parse(JSON.stringify(a.state)));
  restarted.channel.tick();
  assert.equal(restarted.sent.length, 0);
  assert.equal(restarted.channel.receive('Flint', '[TEAM 0123abcd] Wood at 1 64 2'), false);
  restarted.channel.setOnline(true);
  restarted.channel.tick();
  assert.match(restarted.sent[1], /Wood at 3 64 4/);
});

test('resource kinds reported by the scout are understood by teammates', () => {
  const a = make();
  for (const [i, kind] of ['Stone', 'Sand', 'Coal', 'Iron', 'Water'].entries()) {
    assert.equal(a.channel.receive('Wren', `[TEAM 0123456${i}] ${kind} at 1 2 3`), true);
  }
  assert.equal(a.channel.receive('Wren', '[TEAM 01234567] Diamonds at 1 2 3'), false);
});
