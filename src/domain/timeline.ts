/**
 * Day timeline layout (Calendar day view): positions timed items on a 24-hour grid and puts overlapping items side
 * by side. Pure function, unit-tested; the screen only renders the blocks it returns.
 */

export interface TimelineInput {
  key: string;
  /** Minutes after midnight. */
  startMin: number;
  durationMin: number | null;
}

export interface TimelineBlock {
  key: string;
  top: number;
  height: number;
  /** Column inside its overlap group (0-based) and the number of columns of that group. */
  column: number;
  columns: number;
  startMin: number;
  /** End used for the layout (start + duration, or the default when the item has no duration). */
  endMin: number;
}

export interface TimelineOptions {
  hourHeight: number;
  /** Minimum block height in px (tap target). */
  minHeight: number;
  /** Duration assumed for items without one (minutes). */
  defaultDuration?: number;
}

const DAY = 24 * 60;

export function layoutTimeline(items: readonly TimelineInput[], options: TimelineOptions): TimelineBlock[] {
  const { hourHeight, minHeight, defaultDuration = 30 } = options;
  const pxPerMin = hourHeight / 60;
  const minSpan = minHeight / pxPerMin;

  const prepared = items
    .map((item) => {
      const startMin = Math.max(0, Math.min(DAY - 1, Math.round(item.startMin)));
      const duration = item.durationMin && item.durationMin > 0 ? item.durationMin : defaultDuration;
      const endMin = Math.min(DAY, startMin + duration);
      // Overlap is decided on what is drawn: a short item still occupies its minimum height.
      const visualEnd = Math.max(endMin, startMin + minSpan);
      return { key: item.key, startMin, endMin, visualEnd };
    })
    .sort((a, b) => a.startMin - b.startMin || b.visualEnd - a.visualEnd || (a.key < b.key ? -1 : 1));

  const out: TimelineBlock[] = [];
  let group: { item: (typeof prepared)[number]; column: number }[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;

  const flush = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const { item, column } of group) {
      const height = Math.max((item.endMin - item.startMin) * pxPerMin, minHeight);
      // A late short item keeps its minimum height and is nudged up so it stays on the grid.
      const top = Math.max(0, Math.min(item.startMin * pxPerMin, DAY * pxPerMin - height));
      out.push({
        key: item.key,
        top,
        height,
        column,
        columns,
        startMin: item.startMin,
        endMin: item.endMin,
      });
    }
    group = [];
    columnEnds = [];
    groupEnd = -1;
  };

  for (const item of prepared) {
    if (group.length && item.startMin >= groupEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column < 0) {
      column = columnEnds.length;
      columnEnds.push(item.visualEnd);
    } else {
      columnEnds[column] = item.visualEnd;
    }
    group.push({ item, column });
    groupEnd = Math.max(groupEnd, item.visualEnd);
  }
  flush();
  return out;
}

/** Y offset (px) of a time of day on the grid. */
export const timelineY = (minutes: number, hourHeight: number) => (minutes / 60) * hourHeight;
