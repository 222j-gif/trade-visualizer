/**
 * Real market data fetchers.
 *
 * Primary  : Yahoo Finance via CORS proxy  (free, 1-min resolution)
 * Secondary: Tradovate REST API            (account required, 1-sec resolution)
 *
 * Yahoo Finance data windows:
 *   1m  → last 7 days only
 *   5m  → last 60 days
 *   15m → last 60 days
 *   30m → last 60 days
 *   1h  → last 730 days
 *   1d  → several years
 */

// ── Symbol mapping ────────────────────────────────────────────────────────────
// Tradovate base symbol → Yahoo Finance continuous-contract ticker
export const YAHOO_MAP = {
  NQ: 'NQ=F',  MNQ: 'MNQ=F',
  ES: 'ES=F',  MES: 'MES=F',
  YM: 'YM=F',  MYM: 'MYM=F',
  RTY: 'RTY=F', M2K: 'M2K=F',
  CL: 'CL=F',  MCL: 'MCL=F',
  GC: 'GC=F',  MGC: 'MGC=F',
  SI: 'SI=F',  HG: 'HG=F',
  NG: 'NG=F',  NKD: 'NKD=F',
  ZN: 'ZN=F',  ZB: 'ZB=F',  ZF: 'ZF=F',  ZT: 'ZT=F',
  ZC: 'ZC=F',  ZW: 'ZW=F',  ZS: 'ZS=F',
  '6E': 'EURUSD=X', '6J': 'JPYUSD=X',
  '6B': 'GBPUSD=X', '6A': 'AUDUSD=X',
  BTC: 'BTC-USD', ETH: 'ETH-USD',
};

/** Strip contract month/year (MNQH6 → MNQ) and look up Yahoo ticker. */
export function toYahooTicker(tradovateSymbol) {
  if (!tradovateSymbol) return null;
  const base = tradovateSymbol
    .replace(/[FGHJKMNQUVXZ]\d{1,2}$/i, '')
    .toUpperCase();
  return YAHOO_MAP[base] ?? null;
}

/** Auto-degrade interval based on data age (Yahoo Finance limits). */
export function resolveInterval(fromUtcSec, wantedMin) {
  const ageDays = (Date.now() / 1000 - fromUtcSec) / 86400;
  if (ageDays <= 7)   return wantedMin;
  if (ageDays <= 60)  return Math.max(wantedMin, 5);
  if (ageDays <= 730) return Math.max(wantedMin, 60);
  return 1440; // daily only
}

// ── Yahoo Finance ─────────────────────────────────────────────────────────────
const CORS_PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

const YF_IV = { 1: '1m', 2: '2m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 1440: '1d' };

/**
 * Fetch OHLCV bars from Yahoo Finance via CORS proxy.
 * Returns array of { time (UTC sec), open, high, low, close, volume }.
 */
export async function fetchYahooBars(ticker, intervalMin, fromUtcSec, toUtcSec) {
  const iv  = YF_IV[intervalMin] ?? '1m';
  // Add 1 h buffer either side so trades at the edge have candle context
  const p1  = fromUtcSec - 3600;
  const p2  = toUtcSec   + 3600;
  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=${iv}&period1=${p1}&period2=${p2}&includePrePost=true`;

  let lastErr;
  for (const makeUrl of CORS_PROXIES) {
    try {
      const res = await fetch(makeUrl(target), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json   = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) {
        throw new Error(json?.chart?.error?.description ?? 'No chart data returned');
      }

      const ts = result.timestamp ?? [];
      const q  = result.indicators.quote[0];

      return ts
        .map((t, i) => ({
          time:   t,
          open:   q.open[i],
          high:   q.high[i],
          low:    q.low[i],
          close:  q.close[i],
          volume: q.volume[i] ?? 0,
        }))
        .filter(c =>
          c.open  != null && c.high != null &&
          c.low   != null && c.close != null &&
          !isNaN(c.open)  && c.high >= c.low
        );
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All CORS proxies failed');
}

// ── Tradovate API ─────────────────────────────────────────────────────────────
/**
 * Authenticate with Tradovate and return an access token.
 * Requires a Tradovate app to be registered at https://trader.tradovate.com
 * (Settings → API → My Apps).
 *
 * @param {object} creds
 * @param {string} creds.username
 * @param {string} creds.password
 * @param {string} creds.deviceId   - any stable UUID for this browser/device
 * @param {string} [creds.appId]    - registered app ID (default: 'Sample App')
 * @param {boolean} [creds.demo]    - use demo environment
 */
export async function tradovateLogin({ username, password, deviceId, appId = 'Sample App', demo = false }) {
  const base = demo
    ? 'https://demo.tradovateapi.com/v1'
    : 'https://live.tradovateapi.com/v1';

  const res = await fetch(`${base}/auth/accesstokenrequest`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: username, password,
      appId, appVersion: '1.0',
      cid: 0, sec: '', deviceId,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.errorText) throw new Error(data.errorText ?? `HTTP ${res.status}`);
  return { token: data.accessToken, userId: data.userId, demo };
}

/**
 * Fetch historical OHLCV bars via Tradovate Market Data REST API.
 * intervalMin: 1 = 1-minute bars, 60 = 1-hour bars.
 * For 1-second bars pass intervalMin = 1/60 (≈ 0.01667).
 */
export async function tradovateFetchBars({ token, symbol, fromUtcSec, toUtcSec, intervalMin = 1, demo = false }) {
  // Tradovate MD base (same for live & demo)
  const mdBase = 'https://md.tradovateapi.com/v1';

  // Sub-minute → second bars; otherwise minute bars
  const useSeconds  = intervalMin < 1;
  const elementSize = useSeconds
    ? Math.max(1, Math.round(intervalMin * 60))
    : Math.max(1, Math.round(intervalMin));

  const res = await fetch(`${mdBase}/getChart`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      symbol,
      chartDescription: {
        underlyingType:    useSeconds ? 'Second' : 'MinuteBar',
        elementSize,
        elementSizeUnit:   'UnderlyingUnits',
        withHistogram:     false,
      },
      timeRange: {
        asFarBackAsTimestamp: fromUtcSec * 1000, // Tradovate uses ms
        asMuchAsElements:     5000,
      },
    }),
  });

  if (!res.ok) throw new Error(`Tradovate HTTP ${res.status}`);
  const data = await res.json();

  // Handle different response shapes
  const bars = data.bars ?? data.d?.bars ?? [];
  return bars
    .map(b => ({
      time:   Math.floor((b.timestamp ?? b.t) / 1000), // ms → s
      open:   b.open  ?? b.o,
      high:   b.high  ?? b.h,
      low:    b.low   ?? b.l,
      close:  b.close ?? b.c,
      volume: (b.upVolume ?? 0) + (b.downVolume ?? 0),
    }))
    .filter(c => c.open != null && c.close != null && c.high >= c.low);
}
