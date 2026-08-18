import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { addReport, isHidden, listHidden, _peek, _resetForTests } from '../lib/reports/store.js';
import { reporterIp } from '../lib/reports/ip.js';
import { hashReporterIp } from '../lib/reports/hash.js';

// The moderation rule, exercised against the fallback store (the Postgres
// RPC in supabase/migrations/001_initial_schema.sql implements the same
// semantics with a unique constraint + transactional distinct count).

const P = 'planet-under-test';

beforeEach(() => _resetForTests());

test('1. first IP reports -> planet remains visible', () => {
  const r = addReport(P, '1.1.1.1');
  assert.equal(r.added, true);
  assert.equal(r.hidden, false);
  assert.equal(isHidden(P), false);
});

test('2. same IP reports again -> no additional report', () => {
  addReport(P, '1.1.1.1');
  const again = addReport(P, '1.1.1.1');
  assert.equal(again.added, false);
  assert.equal(_peek(P).ips.size, 1);
});

test('3. second unique IP -> still visible', () => {
  addReport(P, '1.1.1.1');
  addReport(P, '2.2.2.2');
  assert.equal(isHidden(P), false);
});

test('4. third unique IP -> hidden', () => {
  addReport(P, '1.1.1.1');
  addReport(P, '2.2.2.2');
  const third = addReport(P, '3.3.3.3');
  assert.equal(third.hidden, true);
  assert.equal(isHidden(P), true);
});

test('5. same IP after removal -> no duplicate report', () => {
  addReport(P, '1.1.1.1');
  addReport(P, '2.2.2.2');
  addReport(P, '3.3.3.3');
  const after = addReport(P, '1.1.1.1');
  assert.equal(after.added, false);
  assert.equal(_peek(P).ips.size, 3);
});

test('6. two reports from one IP + one other IP -> still visible', () => {
  addReport(P, '1.1.1.1');
  addReport(P, '1.1.1.1');
  addReport(P, '2.2.2.2');
  assert.equal(isHidden(P), false);
  assert.equal(_peek(P).ips.size, 2);
});

test('7. three unique IPs -> hidden (distinct sources, not row count)', () => {
  addReport(P, 'a');
  addReport(P, 'a');
  addReport(P, 'a');
  assert.equal(isHidden(P), false); // three ROWS from one source is 1 source
  addReport(P, 'b');
  addReport(P, 'c');
  assert.equal(isHidden(P), true);
});

test('8. concurrent reports from three unique IPs -> reliably hidden', async () => {
  const results = await Promise.all([
    Promise.resolve().then(() => addReport(P, 'ip-a')),
    Promise.resolve().then(() => addReport(P, 'ip-b')),
    Promise.resolve().then(() => addReport(P, 'ip-c')),
  ]);
  assert.equal(isHidden(P), true);
  assert.equal(results.filter((r) => r.hidden).length >= 1, true);
  assert.equal(_peek(P).ips.size, 3); // exactly three, no double count
});

test('9. hidden planets appear in the hidden list (excluded from public rendering)', () => {
  addReport(P, 'a');
  addReport(P, 'b');
  addReport(P, 'c');
  addReport('other-planet', 'a');
  assert.deepEqual(listHidden(), [P]);
});

test('11. planet data is not deleted when hidden', () => {
  addReport(P, 'a');
  addReport(P, 'b');
  addReport(P, 'c');
  const record = _peek(P);
  assert.ok(record);
  assert.equal(record.reports.length, 3);
  assert.ok(record.hiddenAt);
});

// ---------------- reporter identity ----------------

test('10. client cannot spoof the reporter IP (body is never consulted)', () => {
  const req = {
    headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
    body: { ip: '1.2.3.4', planetId: 'x' },
  };
  assert.equal(reporterIp(req), '9.9.9.9'); // trusted proxy header, not body
});

test('x-real-ip takes precedence when the platform sets it', () => {
  const req = { headers: { 'x-real-ip': '8.8.4.4', 'x-forwarded-for': 'spoofed' } };
  assert.equal(reporterIp(req), '8.8.4.4');
});

test('missing headers degrade to a stable placeholder', () => {
  assert.equal(reporterIp({ headers: {} }), 'unknown');
});

test('IP hashes are stable, salted, and non-reversible-looking', () => {
  const a = hashReporterIp('203.0.113.5');
  const b = hashReporterIp('203.0.113.5');
  const c = hashReporterIp('203.0.113.6');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 32);
  assert.ok(!a.includes('203'));
});
