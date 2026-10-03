import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendarDay, normalizeFollowers, summarizeFollowers, loadFollowers } from './data-core.mjs';

test('calendar days reject impossible dates and preserve leap days', () => {
  assert.equal(parseCalendarDay('2025-02-29'), null);
  assert.equal(parseCalendarDay('2024-02-30'), null);
  assert.equal(parseCalendarDay('2024-2-29'), null);
  assert.equal(parseCalendarDay(' 2024-02-29 ').date, '2024-02-29');
});
test('invalid counts are discarded while zero is a valid observation', () => {
  const rows = ['0', '', '-3', '12cats', '3.5', '9007199254740992'].map(follower => ({ date: '2026-01-01', follower }));
  assert.equal(normalizeFollowers(rows).length, 1);
  assert.equal(normalizeFollowers(rows)[0].follower, 0);
});
test('duplicates keep newest CSV row and gap averages use elapsed calendar days', () => {
  const data = normalizeFollowers([
    { date: '2026-03-10', follower: '130' }, { date: '2026-03-10', follower: '125' },
    { date: '2026-03-07', follower: '100' }, { date: 'bogus', follower: '90' }
  ]);
  assert.deepEqual(data.map(p => p.follower), [100, 130]);
  assert.equal(data[0].avgChange, null);
  assert.equal(data[1].intervalDays, 3);
  assert.equal(data[1].avgChange, 10);
  assert.equal(summarizeFollowers(data).daysTracked, 3);
  assert.equal(summarizeFollowers(data, 1, 1).daysTracked, 0);
  assert.equal(summarizeFollowers(data, 1, 1).avgDailyGrowth, 0);
});
test('a DST boundary is still two calendar days in any visitor timezone', () => {
  const data = normalizeFollowers([{ date: '2026-03-07', follower: '0' }, { date: '2026-03-09', follower: '20' }]);
  assert.equal(data[1].intervalDays, 2);
});
test('loader forwards abort signal and refuses non-CSV/failed responses', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(loadFollowers('/data', {}, signal, async (_, options) => {
    assert.equal(options.signal, signal);
    assert.equal(options.credentials, 'omit');
    return { ok: false, status: 404 };
  }), /404/);
  await assert.rejects(loadFollowers('/data', { parse: () => ({ meta: { fields: ['html'] }, data: [] }) }, signal,
    async () => ({ ok: true, text: async () => '<html>' })), /CSV/);
});
