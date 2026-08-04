import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isoWeekId, isoWeekStart } from '../src/lib/dates.ts';

describe('ISO week identifiers', () => {
  it('computes ordinary weeks', () => {
    assert.equal(isoWeekId(new Date('2026-07-28T12:00:00Z')), '2026-W31');
  });

  it('assigns early January to the correct ISO week-year', () => {
    // Jan 1 2026 is a Thursday → its week is W01 of 2026.
    assert.equal(isoWeekId(new Date('2026-01-01T00:00:00Z')), '2026-W01');
    // Jan 1 2027 is a Friday → it belongs to 2026's final week, W53.
    assert.equal(isoWeekId(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  });

  it('finds the Monday of the containing week', () => {
    const start = isoWeekStart(new Date('2026-07-28T12:00:00Z')); // a Tuesday
    assert.equal(start.toISOString().slice(0, 10), '2026-07-27');
    assert.equal(start.getUTCDay(), 1);

    const mondayItself = isoWeekStart(new Date('2026-07-27T00:00:00Z'));
    assert.equal(mondayItself.toISOString().slice(0, 10), '2026-07-27');

    const sunday = isoWeekStart(new Date('2026-08-02T23:00:00Z'));
    assert.equal(sunday.toISOString().slice(0, 10), '2026-07-27');
  });
});
