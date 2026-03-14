import { INSTRUMENTS, NEWS_EVENTS } from './instruments';
import { fmtDate } from './formatters';

// ── Breach Detection ──────────────────────────────────────────
export function detectBreaches(trades, rules) {
  const { maxLoss, trailingDrawdown, dailyLossLimit } = rules;
  const breaches = [];
  let cumPnl = 0;
  let peakPnl = 0;
  const dailyPnl = {};

  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > peakPnl) peakPnl = cumPnl;
    const drawdown = peakPnl - cumPnl;
    const dateKey = fmtDate(t.exitTime);
    dailyPnl[dateKey] = (dailyPnl[dateKey] || 0) + t.pnl;

    if (maxLoss > 0 && cumPnl <= -maxLoss) {
      breaches.push({ type: 'Max Loss', trade: t, value: cumPnl, time: t.exitTime });
    }
    if (trailingDrawdown > 0 && drawdown >= trailingDrawdown) {
      breaches.push({ type: 'Trailing DD', trade: t, value: drawdown, time: t.exitTime });
    }
    if (dailyLossLimit > 0 && dailyPnl[dateKey] <= -dailyLossLimit) {
      breaches.push({ type: 'Daily Loss', trade: t, value: dailyPnl[dateKey], time: t.exitTime });
    }
  }

  const firstBreachTime = breaches.length > 0 ? breaches[0].time : null;
  const tradesAfterBreach = firstBreachTime
    ? trades.filter(t => t.entryTime > firstBreachTime)
    : [];

  return { breaches, tradesAfterBreach, firstBreachTime };
}

// ── News Detection ────────────────────────────────────────────
export function findNewsNearTrades(trades) {
  const alerts = [];
  const windowSec = 15 * 60; // 15 minutes

  for (const t of trades) {
    if (!t.entryTime) continue;

    for (const event of NEWS_EVENTS) {
      for (const timeStr of event.times) {
        const [h, m] = timeStr.split(':').map(Number);
        // Create news time on same day as trade entry (UTC)
        const d = new Date(t.entryTime * 1000);
        d.setUTCHours(h, m, 0, 0);
        const newsTimeSec = Math.floor(d.getTime() / 1000);

        if (Math.abs(t.entryTime - newsTimeSec) <= windowSec) {
          alerts.push({
            trade: t,
            event: event.name,
            impact: event.impact,
            newsTime: newsTimeSec,
            minutesBefore: Math.round((newsTimeSec - t.entryTime) / 60),
          });
        }
      }
    }
  }

  return alerts;
}

// ── Statistics ────────────────────────────────────────────────
export function computeStats(trades) {
  if (!trades.length) return null;

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  const winSum = wins.reduce((s, t) => s + t.pnl, 0);
  const lossSum = losses.reduce((s, t) => s + t.pnl, 0);
  const profitFactor = losses.length && lossSum !== 0
    ? Math.abs(winSum / lossSum)
    : wins.length ? Infinity : 0;

  let peak = 0, maxDrawdown = 0, cumPnl = 0;
  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    if (peak - cumPnl > maxDrawdown) maxDrawdown = peak - cumPnl;
  }

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown,
    avgPnl: totalPnl / trades.length,
  };
}

// ── Build OHLC Candles from Fill Data ─────────────────────────
/**
 * Build 1-minute OHLC candles from raw fill data.
 * Fills gaps between candles with micro-movement candles.
 */
export function buildCandles(fills, intervalSec = 60) {
  if (!fills || fills.length === 0) return [];

  const buckets = {};
  for (const fill of fills) {
    if (!fill.timestamp || !fill.price) continue;
    const bucket = Math.floor(fill.timestamp / intervalSec) * intervalSec;

    if (!buckets[bucket]) {
      buckets[bucket] = {
        time: bucket,
        open: fill.price,
        high: fill.price,
        low: fill.price,
        close: fill.price,
      };
    } else {
      const c = buckets[bucket];
      c.high = Math.max(c.high, fill.price);
      c.low = Math.min(c.low, fill.price);
      c.close = fill.price;
    }
  }

  const arr = Object.values(buckets).sort((a, b) => a.time - b.time);

  // Fill gaps with micro-movement continuation candles
  if (arr.length > 1) {
    const filled = [arr[0]];
    const sym = fills[0]?.symbol;
    const tickSize = INSTRUMENTS[sym]?.tickSize || 0.25;

    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const cur = arr[i];
      const gapBars = (cur.time - prev.time) / intervalSec;

      if (gapBars > 1 && gapBars <= 120) {
        const steps = Math.min(gapBars - 1, 60);
        const drift = (cur.open - prev.close) / (steps + 1);

        for (let j = 1; j <= steps; j++) {
          const base = prev.close + drift * j;
          const n1 = (Math.random() - 0.5) * tickSize * 4;
          const n2 = (Math.random() - 0.5) * tickSize * 4;
          const o = base + n1;
          const c = base + n2;
          filled.push({
            time: prev.time + intervalSec * j,
            open: o,
            high: Math.max(o, c) + Math.random() * tickSize,
            low: Math.min(o, c) - Math.random() * tickSize,
            close: c,
          });
        }
      }
      filled.push(cur);
    }
    return filled;
  }

  return arr;
}
