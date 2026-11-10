import { format } from 'date-fns';

/** Floating local date `YYYY-MM-DD` (ARCHITECTURE.md section 3.1). */
export const localDate = (d: Date) => format(d, 'yyyy-MM-dd');

/** "2h 30m" in English, "2 h 30" in French. */
export function formatMinutes(total: number, language: string): string {
  const safe = Math.max(0, Math.round(total));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (language === 'fr') {
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
  }
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "09:30" stays 24 h in French; "9:30 AM" in English. */
export function formatClock(hhmm: string, language: string): string {
  const [hs, ms] = hhmm.split(':');
  const h = Number(hs);
  if (language === 'fr') return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${ms} ${suffix}`;
}
