import { TickMarkType, type Time } from 'lightweight-charts';

export const EAT_TIMEZONE = 'Africa/Nairobi';

/**
 * Formats epoch seconds into East African Time (UTC+3)
 * Example: "15:06:12 22 Oct 2026 EAT"
 */
export function formatEATDateTime(time: Time | number): string {
  const epoch = typeof time === 'number' ? time : Number((time as any)?.timestamp ?? time);
  if (!Number.isFinite(epoch) || epoch <= 0) return '';
  const date = new Date(epoch * 1000);
  
  const timeStr = date.toLocaleTimeString('en-GB', {
    timeZone: EAT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const dateStr = date.toLocaleDateString('en-GB', {
    timeZone: EAT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return `${timeStr} ${dateStr} (EAT)`;
}

/**
 * Formatter for Lightweight Charts time scale tick marks in East African Time
 */
export function formatEATTickMark(time: Time, tickMarkType: TickMarkType): string {
  const epoch = typeof time === 'number' ? time : Number((time as any)?.timestamp ?? time);
  if (!Number.isFinite(epoch) || epoch <= 0) return '';
  const date = new Date(epoch * 1000);

  const opts: Intl.DateTimeFormatOptions = { timeZone: EAT_TIMEZONE };

  switch (tickMarkType) {
    case TickMarkType.Year:
      return date.toLocaleDateString('en-GB', { ...opts, year: 'numeric' });
    case TickMarkType.Month:
      return date.toLocaleDateString('en-GB', { ...opts, month: 'short' });
    case TickMarkType.DayOfMonth:
      return date.toLocaleDateString('en-GB', { ...opts, day: '2-digit', month: 'short' });
    case TickMarkType.Time:
      return date.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', hour12: false });
    case TickMarkType.TimeWithSeconds:
      return date.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    default:
      return date.toLocaleTimeString('en-GB', { ...opts, hour: '2-digit', minute: '2-digit', hour12: false });
  }
}

/**
 * Formats current live East African Time clock string
 * Example: "15:06:12 EAT (UTC+3)"
 */
export function getCurrentEATString(): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', {
    timeZone: EAT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${timeStr} EAT`;
}
