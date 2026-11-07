/**
 * Run: npx tsx --test apps/web/src/lib/trainer-motivation.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { journalWeekStreakFromDays } from './trainer-motivation';

describe('journalWeekStreakFromDays', () => {
  it('returns 0 for empty', () => {
    assert.equal(journalWeekStreakFromDays([]), 0);
  });

  it('counts consecutive ISO weeks ending at current week', () => {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day);
    monday.setHours(12, 0, 0, 0);
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const w0 = iso(monday);
    const prev = new Date(monday);
    prev.setDate(prev.getDate() - 7);
    const w1 = iso(prev);
    const gap = new Date(monday);
    gap.setDate(gap.getDate() - 21);
    const wGap = iso(gap);

    assert.equal(journalWeekStreakFromDays([w0, w1]), 2);
    assert.equal(journalWeekStreakFromDays([w0, wGap]), 1);
    assert.equal(journalWeekStreakFromDays([wGap]), 0);
  });
});
