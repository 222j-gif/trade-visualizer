import { INSTRUMENTS } from './instruments';

/**
 * Format a UTC timestamp (seconds) as a time string in CT.
 * TradingView lightweight-charts uses UTC timestamps, but we display as CT.
 */
export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'UTC',
  });
}

export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export function fmtDateTime(ts) {
  return ts ? `${fmtDate(ts)} ${fmtTime(ts)}` : '—';
}

export function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '-';
  return sign + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtPrice(v, sym) {
  if (v == null) return '—';
  const inst = INSTRUMENTS[sym];
  const dec = inst ? Math.max(2, -Math.floor(Math.log10(inst.tickSize))) : 2;
  return v.toFixed(dec);
}

export function fmtDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  return (seconds / 3600).toFixed(1) + 'h';
}
