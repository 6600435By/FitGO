/**
 * Run: npx tsx --test apps/web/src/lib/training-timer/engine.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceClock,
  createIdleState,
  formatTimerMs,
  getSnapshot,
  pauseTimer,
  skipPhase,
  startTimer,
} from './engine';
import { buildPreset } from './presets';

describe('training-timer engine', () => {
  it('builds tabata 20/10 × 8 with prep', () => {
    const p = buildPreset({ id: 'tabata' });
    assert.equal(p.phases[0]?.kind, 'prep');
    const work = p.phases.filter((x) => x.kind === 'work');
    const rest = p.phases.filter((x) => x.kind === 'rest');
    assert.equal(work.length, 8);
    assert.equal(rest.length, 7);
    assert.equal(work[0]?.durationSec, 20);
    assert.equal(rest[0]?.durationSec, 10);
  });

  it('keeps time across pause using wall clock', () => {
    const preset = buildPreset({
      id: 'countdown',
      params: { durationSec: 60 },
    });
    let state = createIdleState(preset.phases, {
      presetId: preset.id,
      presetName: preset.name,
    });
    const t0 = 1_000_000;
    ({ state } = startTimer(state, t0));
    state = pauseTimer(state, t0 + 15_000);
    assert.equal(state.status, 'paused');
    assert.equal(state.phaseElapsedMs, 15_000);
    const snap = getSnapshot(state, t0 + 60_000);
    assert.equal(snap.remainingMs, 45_000);
  });

  it('advances phase when duration elapses', () => {
    const preset = buildPreset({
      id: 'rest',
      params: { durationSec: 10 },
    });
    let state = createIdleState(preset.phases, {
      presetId: preset.id,
      presetName: preset.name,
    });
    const t0 = 5_000_000;
    ({ state } = startTimer(state, t0));
    const prev = getSnapshot(state, t0);
    const advanced = advanceClock(state, t0 + 10_500, prev);
    assert.equal(advanced.state.status, 'complete');
    assert.ok(advanced.events.some((e) => e.kind === 'complete'));
  });

  it('emits countdown ticks near end', () => {
    const preset = buildPreset({
      id: 'countdown',
      params: { durationSec: 5 },
    });
    let state = createIdleState(preset.phases, {
      presetId: preset.id,
      presetName: preset.name,
    });
    const t0 = 9_000_000;
    ({ state } = startTimer(state, t0));
    const prev = getSnapshot(state, t0 + 1_500);
    const next = advanceClock(state, t0 + 2_200, prev);
    assert.ok(next.events.some((e) => e.kind === 'countdown_tick' && e.countdown === 3));
  });

  it('skip moves to next phase', () => {
    const preset = buildPreset({
      id: 'intervals',
      params: { workSec: 40, restSec: 20, rounds: 2, prepSec: 0 },
    });
    let state = createIdleState(preset.phases, {
      presetId: preset.id,
      presetName: preset.name,
    });
    ({ state } = startTimer(state, 1000));
    ({ state } = skipPhase(state, 1500));
    assert.equal(state.phaseIndex, 1);
    assert.equal(state.phases[1]?.kind, 'rest');
  });

  it('formats mm:ss', () => {
    assert.equal(formatTimerMs(65_000), '1:05');
    assert.equal(formatTimerMs(3_600_000, true), '1:00:00');
  });
});
