import { useState, useEffect } from 'react';

export function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return now;
}

export function formatHHMM(date: Date): string {
  return date.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDateHebrew(date: Date): string {
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** Returns minutes-since-midnight, but treats hours 0–7 as 24–31 so night
 *  blocks (23:00 → 00:00 → 07:00) sort correctly within one shift. Hour 7 is
 *  included because the night template's last row is the 07:00 handover
 *  marker — leaving it unwrapped made it sort *before* 23:00 instead of
 *  after 06:30, which made getCurrentBlock/getNextBlock latch onto it as
 *  "current" for any time before 07:00. */
export function toShiftMinutes(timeStr: string, isNight: boolean): number {
  const [h, m] = timeStr.split(':').map(Number);
  const mins = h * 60 + m;
  // Night shift: 0–7 h wraps to 24–31 h
  if (isNight && h <= 7) return mins + 24 * 60;
  return mins;
}
