/**
 * Routine runner state machine (pure). A run walks the routine's steps in order; each step is finished as done or
 * skipped. Time is never counted by a ticking counter: every event carries the current time (`now`, epoch ms) and
 * the elapsed time is derived from it, so a paused, backgrounded or slow screen cannot drift.
 *
 *   idle --start--> running <--pause / resume--> paused
 *   running | paused --done / skip on the last step, or finish--> finished
 */
export interface RunStep {
  id: string;
  title: string;
  /** Planned minutes; null = no timer target (the step just counts up). */
  durationMin: number | null;
}

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';
export type StepResult = 'done' | 'skipped';

export interface RunState {
  steps: readonly RunStep[];
  status: RunStatus;
  /** Current step; equals `steps.length` once finished. */
  index: number;
  /** Result per step, in step order (null = not reached, or left open by an early finish). */
  results: readonly (StepResult | null)[];
  /** Time spent on each step so far, without the stretch that is still running. */
  spentMs: readonly number[];
  /** When the current stretch of the current step began (null while paused, idle or finished). */
  runningSince: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export type RunEvent =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'done'; now: number }
  | { type: 'skip'; now: number }
  /** Goes back to the previous step and reopens it. */
  | { type: 'back'; now: number }
  /** Ends the run early; steps not reached stay open (not skipped, not done). */
  | { type: 'finish'; now: number };

export function initialRun(steps: readonly RunStep[]): RunState {
  return {
    steps,
    status: 'idle',
    index: 0,
    results: steps.map(() => null),
    spentMs: steps.map(() => 0),
    runningSince: null,
    startedAt: null,
    finishedAt: null,
  };
}

/** Adds the running stretch to the current step and stops the clock. */
function settle(state: RunState, now: number): RunState {
  if (state.runningSince === null || state.index >= state.steps.length) return { ...state, runningSince: null };
  const add = Math.max(0, now - state.runningSince);
  return {
    ...state,
    spentMs: state.spentMs.map((ms, i) => (i === state.index ? ms + add : ms)),
    runningSince: null,
  };
}

function advance(state: RunState, result: StepResult, now: number): RunState {
  const settled = settle(state, now);
  const results = settled.results.map((r, i) => (i === settled.index ? result : r));
  const index = settled.index + 1;
  if (index >= settled.steps.length) {
    return { ...settled, results, index: settled.steps.length, status: 'finished', finishedAt: now };
  }
  // A paused run stays paused on the next step; a running one keeps running.
  return { ...settled, results, index, runningSince: settled.status === 'running' ? now : null };
}

/** Events that do not apply in the current status leave the state unchanged (same object). */
export function runReducer(state: RunState, event: RunEvent): RunState {
  const { now } = event;
  switch (event.type) {
    case 'start':
      if (state.status !== 'idle') return state;
      if (state.steps.length === 0) return { ...state, status: 'finished', startedAt: now, finishedAt: now };
      return { ...state, status: 'running', startedAt: now, runningSince: now };
    case 'pause':
      return state.status === 'running' ? { ...settle(state, now), status: 'paused' } : state;
    case 'resume':
      return state.status === 'paused' ? { ...state, status: 'running', runningSince: now } : state;
    case 'done':
    case 'skip':
      if (state.status !== 'running' && state.status !== 'paused') return state;
      return advance(state, event.type === 'done' ? 'done' : 'skipped', now);
    case 'back': {
      if ((state.status !== 'running' && state.status !== 'paused') || state.index === 0) return state;
      const settled = settle(state, now);
      const index = settled.index - 1;
      return {
        ...settled,
        index,
        results: settled.results.map((r, i) => (i === index ? null : r)),
        runningSince: settled.status === 'running' ? now : null,
      };
    }
    case 'finish':
      if (state.status !== 'running' && state.status !== 'paused') return state;
      return { ...settle(state, now), status: 'finished', index: state.steps.length, finishedAt: now };
  }
}

/** Time spent on the step at `index`, including the stretch that is running at `now`. */
export function stepElapsedMs(state: RunState, now: number, index: number = state.index): number {
  const base = state.spentMs[index] ?? 0;
  return index === state.index && state.runningSince !== null ? base + Math.max(0, now - state.runningSince) : base;
}

/** Remaining time of the current step (negative = over time); null when the step has no planned duration. */
export function stepRemainingMs(state: RunState, now: number): number | null {
  const step = state.steps[state.index];
  if (!step || step.durationMin === null) return null;
  return step.durationMin * 60_000 - stepElapsedMs(state, now);
}

export function totalElapsedMs(state: RunState, now: number): number {
  return state.spentMs.reduce((sum, _ms, i) => sum + stepElapsedMs(state, now, i), 0);
}

export interface RunSummary {
  completedStepIds: string[];
  done: number;
  skipped: number;
  /** Steps never reached because the run was ended early. */
  open: number;
  total: number;
  elapsedMs: number;
  /** Every step was done (nothing skipped or left open). */
  complete: boolean;
}

export function summarizeRun(state: RunState): RunSummary {
  const completedStepIds = state.steps.filter((_s, i) => state.results[i] === 'done').map((s) => s.id);
  const skipped = state.results.filter((r) => r === 'skipped').length;
  const total = state.steps.length;
  return {
    completedStepIds,
    done: completedStepIds.length,
    skipped,
    open: total - completedStepIds.length - skipped,
    total,
    elapsedMs: state.spentMs.reduce((a, b) => a + b, 0),
    complete: total > 0 && completedStepIds.length === total,
  };
}

/** mm:ss (or h:mm:ss) for a timer; negative values show the overrun with a leading "+". */
export function formatTimer(ms: number): string {
  const over = ms < 0;
  const totalSec = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return over && totalSec > 0 ? `+${text}` : text;
}
