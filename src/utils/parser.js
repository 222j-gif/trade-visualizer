/**
 * Multi-format trade log parser.
 *
 * Supported formats (detected automatically from headers/content):
 *
 * 1. Tradovate Performance CSV (pre-paired trades)
 *    Headers: symbol, buyPrice, sellPrice, pnl, boughtTimestamp, soldTimestamp, qty
 *    PnL format: $(10.00) = -$10, $21.00 = +$21
 *
 * 2. Tradovate Position History CSV (pre-paired)
 *    Headers: Contract, Buy Price, Sell Price, P/L, Bought Timestamp, Sold Timestamp, Paired Qty
 *
 * 3. Tradovate Fills CSV (raw individual fills)
 *    Headers: B/S, Contract, Price, Timestamp, etc.
 *    Note: B/S column may have leading spaces like " Sell"
 *
 * 4. Tradovate Orders CSV (raw orders with fill info)
 *    Headers: B/S, Contract, avgPrice, filledQty, Fill Time, etc.
 *
 * 5. WealthCharts Orders CSV
 *    Headers: account_id, order_id, symbol (CM.MNQH6), price_done, qty_done, pnl
 *    Timestamps: Unix epoch seconds (e.g. 1773411035.779)
 *    Negative qty = sell side
 *
 * 6. WealthCharts Trades CSV (headerless, pre-paired P&L summary)
 *    No headers. Columns detected by pattern:
 *    trade_id, uuid, ?, account_id, CM.MNQH6, points_pnl, dollar_pnl, start_iso, end_iso
 *
 * All timestamps are converted to UTC seconds for TradingView lightweight-charts.
 * When logs are in a user's local timezone, we convert: local → UTC by applying offset.
 */

import Papa from 'papaparse';
import { INSTRUMENTS } from './instruments';

// ── Symbol extraction ─────────────────────────────────────────
export function extractSymbol(contractStr) {
  if (!contractStr) return null;
  let cleaned = contractStr.toString().trim().toUpperCase();
  // Strip WealthCharts prefix like "CM."
  cleaned = cleaned.replace(/^[A-Z]{1,3}\./, '');

  // Exact match
  for (const sym of Object.keys(INSTRUMENTS)) {
    if (cleaned === sym.toUpperCase()) return sym;
  }
  // Contract code match: "MNQH6" → "MNQ", "ESH25" → "ES"
  const sorted = Object.keys(INSTRUMENTS).sort((a, b) => b.length - a.length);
  for (const sym of sorted) {
    if (new RegExp(`^${sym.toUpperCase()}[FGHJKMNQUVXZ]\\d{1,2}$`, 'i').test(cleaned)) return sym;
  }
  for (const sym of sorted) {
    if (cleaned.startsWith(sym.toUpperCase())) return sym;
  }
  return cleaned.replace(/[FGHJKMNQUVXZ]\d{1,2}$/i, '') || cleaned;
}

// ── Timestamp parsing ─────────────────────────────────────────
/**
 * Parse a date/time string and convert to UTC seconds.
 * @param {string} dateStr - The date string
 * @param {string|null} timeStr - Optional separate time string
 * @param {number} tzOffsetMin - Source timezone offset in minutes from UTC
 * @returns {number|null} UTC timestamp in seconds
 */
export function parseTimestamp(dateStr, timeStr, tzOffsetMin = 0) {
  if (!dateStr) return null;
  const combined = timeStr ? `${dateStr} ${timeStr}` : dateStr;

  // ISO format (already UTC): "2026-03-13T14:10:35.000Z"
  if (/^\d{4}-\d{2}-\d{2}T/.test(combined)) {
    const d = new Date(combined);
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000);
    }
  }

  // MM/DD/YYYY HH:MM:SS (local time)
  const m1 = combined.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?/);
  if (m1) {
    const d = new Date(Date.UTC(+m1[3], +m1[1] - 1, +m1[2], +m1[4], +m1[5], +(m1[6] || 0)));
    if (!isNaN(d.getTime())) {
      // d is constructed as if the values are UTC, but they're actually in the source timezone.
      // So subtract the source offset to get real UTC.
      return Math.floor(d.getTime() / 1000) - tzOffsetMin * 60;
    }
  }

  // YYYY-MM-DD HH:MM:SS (local time)
  const m2 = combined.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):?(\d{2})?/);
  if (m2) {
    const d = new Date(Date.UTC(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +(m2[6] || 0)));
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000) - tzOffsetMin * 60;
    }
  }

  // Fallback
  const d = new Date(combined);
  if (!isNaN(d.getTime())) {
    return Math.floor(d.getTime() / 1000) - tzOffsetMin * 60;
  }

  return null;
}

// ── PnL parsing ───────────────────────────────────────────────
/**
 * Parse Tradovate PnL format: $(10.00) = -10, $21.00 = +21
 */
export function parsePnl(v) {
  if (v == null) return NaN;
  const s = v.toString().trim();
  const m = s.match(/\$\(?([0-9,]+\.?\d*)\)?/);
  if (m) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    return s.includes('(') ? -num : num;
  }
  return parseFloat(s.replace(/[$,]/g, ''));
}

// ── Column finder ─────────────────────────────────────────────
function findCol(headers, ...names) {
  const hl = headers.map(x => (x || '').toLowerCase().trim());
  for (const n of names) {
    const idx = hl.indexOf(n.toLowerCase());
    if (idx !== -1) return idx;
  }
  for (const n of names) {
    const idx = hl.findIndex(x => x.includes(n.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

// ── FIFO Trade Reconstruction ─────────────────────────────────
export function reconstructTrades(rawFills) {
  const trades = [];
  const bySymbol = {};

  for (const fill of rawFills) {
    const key = fill.symbol || '?';
    if (!bySymbol[key]) bySymbol[key] = [];
    bySymbol[key].push({ ...fill });
  }

  for (const [sym, symFills] of Object.entries(bySymbol)) {
    const openPositions = [];
    const pv = INSTRUMENTS[sym]?.pointValue || 1;

    for (const fill of symFills) {
      const isClosing = openPositions.length > 0 && openPositions[0].side !== fill.side;

      if (isClosing) {
        let remaining = fill.qty;
        while (remaining > 0 && openPositions.length > 0) {
          const pos = openPositions[0];
          const closeQty = Math.min(remaining, pos.qty);
          const direction = pos.side === 'BUY' ? 1 : -1;
          const pnl = (!isNaN(fill.pnl) && closeQty === fill.qty)
            ? fill.pnl
            : (fill.price - pos.price) * direction * pv * closeQty;

          trades.push({
            id: trades.length + 1,
            symbol: sym,
            side: pos.side === 'BUY' ? 'LONG' : 'SHORT',
            qty: closeQty,
            entryPrice: pos.price,
            exitPrice: fill.price,
            entryTime: pos.timestamp,
            exitTime: fill.timestamp,
            pnl: Math.round(pnl * 100) / 100,
            duration: (fill.timestamp && pos.timestamp) ? Math.abs(fill.timestamp - pos.timestamp) : 0,
            account: fill.account || pos.account || '',
          });

          remaining -= closeQty;
          pos.qty -= closeQty;
          if (pos.qty <= 0) openPositions.shift();
        }
        if (remaining > 0) {
          openPositions.push({ ...fill, qty: remaining });
        }
      } else {
        openPositions.push({ ...fill });
      }
    }
  }

  trades.sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));
  return trades;
}

// ═══════════════════════════════════════════════════════════════
// MAIN PARSER
// ═══════════════════════════════════════════════════════════════
/**
 * Parse a CSV string and return { trades, fills, format, error }
 * @param {string} csvText - Raw CSV content
 * @param {number} tzOffsetMin - Source timezone offset in minutes from UTC
 */
export function parseLogs(csvText, tzOffsetMin) {
  const result = Papa.parse(csvText, { header: false, skipEmptyLines: true });
  if (!result.data || result.data.length < 2) {
    return { trades: [], fills: [], format: 'unknown', error: 'No data found in file' };
  }

  // Find header row (skip leading blank rows)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, result.data.length); i++) {
    if (result.data[i].filter(x => x && x.trim()).length >= 3) {
      headerIdx = i;
      break;
    }
  }

  const headers = result.data[headerIdx];
  const rows = result.data.slice(headerIdx + 1).filter(r => r && r.filter(x => x && x.trim()).length >= 2);
  const hl = headers.map(x => (x || '').toLowerCase().trim());

  // ────────────────────────────────────────────────────────────
  // FORMAT 1: Tradovate Performance (pre-paired trades)
  // Headers: symbol, buyPrice, sellPrice, pnl, boughtTimestamp, soldTimestamp
  // ────────────────────────────────────────────────────────────
  if (hl.includes('buyprice') && hl.includes('sellprice') && hl.includes('boughttimestamp')) {
    const c = {
      sym: findCol(headers, 'symbol'),
      bp: findCol(headers, 'buyprice', 'buyPrice'),
      sp: findCol(headers, 'sellprice', 'sellPrice'),
      pnl: findCol(headers, 'pnl'),
      bt: findCol(headers, 'boughttimestamp', 'boughtTimestamp'),
      st: findCol(headers, 'soldtimestamp', 'soldTimestamp'),
      qty: findCol(headers, 'qty'),
    };

    const trades = [];
    const fills = [];

    for (const row of rows) {
      const sym = extractSymbol(row[c.sym]);
      const bp = parseFloat(row[c.bp]);
      const sp = parseFloat(row[c.sp]);
      if (isNaN(bp) || isNaN(sp)) continue;

      const pnl = parsePnl(row[c.pnl]);
      const bt = parseTimestamp(row[c.bt], null, tzOffsetMin);
      const st = parseTimestamp(row[c.st], null, tzOffsetMin);
      const qty = Math.abs(parseFloat(row[c.qty]) || 1);

      // If bought timestamp < sold timestamp → LONG, else SHORT
      const isLong = bt && st ? bt < st : true;

      trades.push({
        id: trades.length + 1,
        symbol: sym,
        side: isLong ? 'LONG' : 'SHORT',
        qty,
        entryPrice: isLong ? bp : sp,
        exitPrice: isLong ? sp : bp,
        entryTime: isLong ? bt : st,
        exitTime: isLong ? st : bt,
        pnl: isNaN(pnl) ? 0 : pnl,
        duration: bt && st ? Math.abs(st - bt) : 0,
        account: '',
      });

      // Create synthetic fills for the chart
      if (bt) fills.push({ timestamp: bt, price: bp, side: 'BUY', symbol: sym, qty });
      if (st) fills.push({ timestamp: st, price: sp, side: 'SELL', symbol: sym, qty });
    }

    trades.sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));
    fills.sort((a, b) => a.timestamp - b.timestamp);
    return { trades, fills, format: 'tradovate_performance', error: null };
  }

  // ────────────────────────────────────────────────────────────
  // FORMAT 2: Tradovate Position History (pre-paired)
  // Headers: Contract, Buy Price, Sell Price, P/L, Bought Timestamp, Sold Timestamp
  // ────────────────────────────────────────────────────────────
  if (hl.includes('buy price') && hl.includes('sell price') && hl.includes('bought timestamp')) {
    const c = {
      sym: findCol(headers, 'contract', 'symbol'),
      bp: findCol(headers, 'buy price'),
      sp: findCol(headers, 'sell price'),
      pnl: findCol(headers, 'p/l'),
      bt: findCol(headers, 'bought timestamp'),
      st: findCol(headers, 'sold timestamp'),
      qty: findCol(headers, 'paired qty', 'qty'),
    };

    const trades = [];
    const fills = [];

    for (const row of rows) {
      const sym = extractSymbol(row[c.sym]);
      const bp = parseFloat(row[c.bp]);
      const sp = parseFloat(row[c.sp]);
      if (isNaN(bp) || isNaN(sp)) continue;

      const pnl = parseFloat((row[c.pnl] || '0').replace(/[^0-9.\-]/g, ''));
      const bt = parseTimestamp(row[c.bt], null, tzOffsetMin);
      const st = parseTimestamp(row[c.st], null, tzOffsetMin);
      const qty = Math.abs(parseFloat(row[c.qty]) || 1);
      const isLong = bt && st ? bt < st : true;

      trades.push({
        id: trades.length + 1, symbol: sym, side: isLong ? 'LONG' : 'SHORT', qty,
        entryPrice: isLong ? bp : sp, exitPrice: isLong ? sp : bp,
        entryTime: isLong ? bt : st, exitTime: isLong ? st : bt,
        pnl, duration: bt && st ? Math.abs(st - bt) : 0, account: '',
      });
      if (bt) fills.push({ timestamp: bt, price: bp, side: 'BUY', symbol: sym, qty });
      if (st) fills.push({ timestamp: st, price: sp, side: 'SELL', symbol: sym, qty });
    }

    trades.sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));
    fills.sort((a, b) => a.timestamp - b.timestamp);
    return { trades, fills, format: 'tradovate_position_history', error: null };
  }

  // ────────────────────────────────────────────────────────────
  // FORMAT 3/4: Tradovate Fills / Orders (raw fills for FIFO)
  // Headers include B/S and Contract/Product
  // ────────────────────────────────────────────────────────────
  if ((hl.includes('b/s') || hl.some(h => h === '_action' || h === 'action')) &&
      (hl.includes('contract') || hl.includes('product'))) {
    const c = {
      action: findCol(headers, 'b/s', '_action', 'action'),
      contract: findCol(headers, 'contract', 'symbol'),
      price: findCol(headers, 'price', 'avgprice', 'avg fill price', 'avg price'),
      qty: findCol(headers, 'qty', 'quantity', 'filledqty', 'filled qty'),
      time: findCol(headers, 'fill time', 'timestamp', '_timestamp'),
      pnl: findCol(headers, 'p/l', 'pnl'),
      account: findCol(headers, 'account'),
    };

    const rawFills = [];
    for (const row of rows) {
      const raw = (row[c.action] || '').toString().trim().toUpperCase();
      let side = null;
      if (raw.includes('BUY') || raw === 'B' || raw === 'BOUGHT') side = 'BUY';
      else if (raw.includes('SELL') || raw === 'S' || raw === 'SOLD') side = 'SELL';
      if (!side) continue;

      const price = parseFloat(row[c.price]);
      if (isNaN(price)) continue;

      rawFills.push({
        timestamp: parseTimestamp(row[c.time]?.trim(), null, tzOffsetMin),
        side,
        symbol: extractSymbol(row[c.contract]?.trim()),
        qty: Math.abs(parseFloat(row[c.qty]) || 1),
        price,
        pnl: c.pnl >= 0 ? parsePnl(row[c.pnl]) : NaN,
        account: row[c.account]?.trim() || '',
      });
    }

    rawFills.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const trades = reconstructTrades(rawFills);
    return { trades, fills: rawFills, format: 'tradovate_fills', error: null };
  }

  // ────────────────────────────────────────────────────────────
  // FORMAT 5: WealthCharts Orders
  // Headers: account_id, order_id, symbol (CM.MNQH6), price_done, qty_done, pnl
  // Timestamps: Unix epoch seconds
  // ────────────────────────────────────────────────────────────
  if (hl.includes('account_id') && hl.includes('order_id') && hl.includes('price_done')) {
    const c = {
      sym: findCol(headers, 'symbol'),
      qty: findCol(headers, 'qty_done', 'qty_sent'),
      price: findCol(headers, 'price_done'),
      pnl: findCol(headers, 'pnl'),
      time: findCol(headers, 'last_time', 'order_date'),
      status: findCol(headers, 'status'),
    };

    const rawFills = [];
    for (const row of rows) {
      const status = (row[c.status] || '').toLowerCase().trim();
      if (status && status !== 'completed' && status !== 'filled') continue;

      const qty = parseFloat(row[c.qty]);
      if (!qty || isNaN(qty)) continue;
      const price = parseFloat(row[c.price]);
      if (isNaN(price)) continue;

      let ts = null;
      const rawTime = row[c.time]?.trim();
      if (rawTime && /^\d{10}/.test(rawTime)) {
        // Unix epoch seconds → UTC seconds directly
        ts = Math.floor(parseFloat(rawTime));
      } else {
        ts = parseTimestamp(rawTime, null, tzOffsetMin);
      }

      rawFills.push({
        timestamp: ts,
        side: qty < 0 ? 'SELL' : 'BUY',
        symbol: extractSymbol(row[c.sym]?.trim()),
        qty: Math.abs(qty),
        price,
        pnl: parsePnl(row[c.pnl]),
        account: '',
      });
    }

    rawFills.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const trades = reconstructTrades(rawFills);
    return { trades, fills: rawFills, format: 'wealthcharts_orders', error: null };
  }

  // ────────────────────────────────────────────────────────────
  // FORMAT 6: WealthCharts Trades (headerless CSV)
  // Pattern: id, uuid, ?, account, CM.MNQH6, points_pnl, dollar_pnl, iso_start, iso_end
  // ────────────────────────────────────────────────────────────
  const firstRow = rows[0] || [];
  const hasISO = firstRow.some(v => /^\d{4}-\d{2}-\d{2}T/.test((v || '').trim()));
  const hasCM = firstRow.some(v => /^CM\./i.test((v || '').trim()));

  if (hasISO || hasCM) {
    let symCol = -1, startCol = -1, endCol = -1;
    for (let i = 0; i < firstRow.length; i++) {
      const v = (firstRow[i] || '').trim();
      if (/^CM\./i.test(v) || Object.keys(INSTRUMENTS).some(s => v.toUpperCase().startsWith(s))) symCol = i;
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
        if (startCol === -1) startCol = i;
        else endCol = i;
      }
    }

    // Dollar PnL is typically the column right before start time
    const pnlCol = startCol > 1 ? startCol - 1 : -1;

    if (symCol >= 0 && startCol >= 0) {
      const trades = [];
      for (const row of rows) {
        const sym = extractSymbol(row[symCol]?.trim());
        const pnl = pnlCol >= 0 ? parseFloat(row[pnlCol]) : 0;
        const st = parseTimestamp(row[startCol]?.trim(), null, 0); // ISO = UTC
        const et = endCol >= 0 ? parseTimestamp(row[endCol]?.trim(), null, 0) : null;
        if (!st) continue;

        trades.push({
          id: trades.length + 1,
          symbol: sym,
          side: pnl >= 0 ? 'LONG' : 'SHORT', // best guess without price data
          qty: 1,
          entryPrice: 0,
          exitPrice: 0,
          entryTime: st,
          exitTime: et,
          pnl: isNaN(pnl) ? 0 : pnl,
          duration: st && et ? Math.abs(et - st) : 0,
          account: '',
        });
      }

      trades.sort((a, b) => (a.entryTime || 0) - (b.entryTime || 0));
      return { trades, fills: [], format: 'wealthcharts_trades', error: null };
    }
  }

  return {
    trades: [], fills: [], format: 'unknown',
    error: `Could not detect log format. Headers found: ${headers.slice(0, 8).join(', ')}`,
  };
}
