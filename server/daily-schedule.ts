export interface DailySchedule {
  hour: number;
  minute: number;
  label: string;
}

export function parseDailySchedules(spec: string): DailySchedule[] {
  const seen = new Set<string>();
  const parsed: DailySchedule[] = [];

  for (const raw of spec.split(',')) {
    const value = raw.trim();
    if (!value) continue;
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid daily schedule: ${value}`);
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`Invalid daily schedule: ${value}`);
    }
    const label = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    if (seen.has(label)) continue;
    seen.add(label);
    parsed.push({ hour, minute, label });
  }

  parsed.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
  return parsed;
}

export function getNextOccurrence(
  from: Date,
  schedules: DailySchedule[]
): { when: Date; schedule: DailySchedule } {
  let best: { when: Date; schedule: DailySchedule } | null = null;

  for (const schedule of schedules) {
    const candidate = new Date(from);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    if (candidate.getTime() <= from.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    if (!best || candidate.getTime() < best.when.getTime()) {
      best = { when: candidate, schedule };
    }
  }

  if (!best) {
    throw new Error('No schedules configured');
  }
  return best;
}
