import {
  formatTimer,
  initialRun,
  runReducer,
  stepElapsedMs,
  stepRemainingMs,
  summarizeRun,
  totalElapsedMs,
  type RunEvent,
  type RunState,
} from '../routineRun';

const steps = [
  { id: 'a', title: 'Water', durationMin: 1 },
  { id: 'b', title: 'Stretch', durationMin: null },
  { id: 'c', title: 'Plan', durationMin: 2 },
];
const play = (events: RunEvent[], from: RunState = initialRun(steps)) => events.reduce(runReducer, from);
const S = 1000;

describe('routineRun', () => {
  it('starts and counts time from timestamps', () => {
    const s = play([{ type: 'start', now: 0 }]);
    expect(s.status).toBe('running');
    expect(stepElapsedMs(s, 30 * S)).toBe(30 * S);
    expect(stepRemainingMs(s, 30 * S)).toBe(30 * S);
    expect(stepRemainingMs(s, 90 * S)).toBe(-30 * S);
  });

  it('pause stops the clock and resume continues it', () => {
    const s = play([
      { type: 'start', now: 0 },
      { type: 'pause', now: 10 * S },
      { type: 'resume', now: 100 * S },
    ]);
    expect(stepElapsedMs(s, 105 * S)).toBe(15 * S);
    const paused = play([
      { type: 'start', now: 0 },
      { type: 'pause', now: 10 * S },
    ]);
    expect(paused.runningSince).toBeNull();
    expect(stepElapsedMs(paused, 500 * S)).toBe(10 * S);
  });

  it('done and skip move on and the last one finishes the run', () => {
    const s = play([
      { type: 'start', now: 0 },
      { type: 'done', now: 20 * S },
      { type: 'skip', now: 30 * S },
      { type: 'done', now: 50 * S },
    ]);
    expect(s.status).toBe('finished');
    expect(s.index).toBe(3);
    expect(s.results).toEqual(['done', 'skipped', 'done']);
    const sum = summarizeRun(s);
    expect(sum).toMatchObject({ done: 2, skipped: 1, open: 0, total: 3, complete: false, elapsedMs: 50 * S });
    expect(sum.completedStepIds).toEqual(['a', 'c']);
    expect(totalElapsedMs(s, 999 * S)).toBe(50 * S);
  });

  it('a paused run stays paused on the next step', () => {
    const s = play([
      { type: 'start', now: 0 },
      { type: 'pause', now: 5 * S },
      { type: 'done', now: 6 * S },
    ]);
    expect(s.status).toBe('paused');
    expect(s.index).toBe(1);
    expect(s.runningSince).toBeNull();
  });

  it('back reopens the previous step; at the first step it does nothing', () => {
    const first = play([{ type: 'start', now: 0 }]);
    expect(runReducer(first, { type: 'back', now: 1 })).toBe(first);
    const s = play([
      { type: 'start', now: 0 },
      { type: 'done', now: 5 * S },
      { type: 'back', now: 6 * S },
    ]);
    expect(s.index).toBe(0);
    expect(s.results[0]).toBeNull();
    expect(s.status).toBe('running');
  });

  it('finish ends early and leaves unreached steps open', () => {
    const s = play([
      { type: 'start', now: 0 },
      { type: 'done', now: 5 * S },
      { type: 'finish', now: 8 * S },
    ]);
    expect(s.status).toBe('finished');
    expect(summarizeRun(s)).toMatchObject({ done: 1, skipped: 0, open: 2, elapsedMs: 8 * S });
  });

  it('ignores events that do not apply and handles a routine without steps', () => {
    const idle = initialRun(steps);
    expect(runReducer(idle, { type: 'done', now: 1 })).toBe(idle);
    expect(runReducer(idle, { type: 'pause', now: 1 })).toBe(idle);
    const running = play([{ type: 'start', now: 0 }]);
    expect(runReducer(running, { type: 'start', now: 5 })).toBe(running);
    expect(runReducer(running, { type: 'resume', now: 5 })).toBe(running);
    expect(runReducer(initialRun([]), { type: 'start', now: 0 }).status).toBe('finished');
    expect(summarizeRun(initialRun([])).complete).toBe(false);
  });

  it('formats timers', () => {
    expect(formatTimer(65_000)).toBe('01:05');
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(3_725_000)).toBe('1:02:05');
    expect(formatTimer(-5_000)).toBe('+00:05');
    expect(formatTimer(64_200)).toBe('01:05');
  });
});
