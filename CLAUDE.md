# CLAUDE.md — Project Context for Claude Code

## What This Is
A trade analysis tool for Tradeify (prop trading firm). It imports broker trade logs, visualizes entries/exits on TradingView charts, detects account rule breaches, and overlays high-volatility news events.

## Who It's For
Akshaj at Tradeify (akshaj@tradeify.co) — uses this to audit trader accounts, particularly to:
- See exactly where and when a trader was trading
- Detect when account rules were breached (max loss, trailing drawdown, daily loss)
- Identify if Tradovate failed to lock an account after breach (trades continued post-breach)
- Check if trades occurred during extreme news events (FOMC, CPI, NFP, etc.)

## Critical Requirements
1. **TradingView chart MUST work** — uses `lightweight-charts` npm package (NOT CDN). Real candlestick rendering with zoom/pan/crosshair.
2. **All timestamp handling must be correct** — Tradovate exports in user's LOCAL timezone (typically IST UTC+5:30). WealthCharts orders use epoch seconds. Everything must be normalized to UTC seconds for TradingView.
3. **Parsers must handle the exact CSV formats** — Sample data is in `sample-data/`. Test against ALL files.
4. **Futures instruments** — All CME futures with correct tick sizes and point values in `src/utils/instruments.js`.

## File Structure
- `src/App.jsx` — Main component with tab navigation and state
- `src/components/TVChart.jsx` — TradingView candlestick chart
- `src/components/TVEquity.jsx` — TradingView equity curve
- `src/utils/parser.js` — **MOST CRITICAL FILE** — Multi-format CSV parser
- `src/utils/analysis.js` — Breach detection, news detection, stats, candle building
- `src/utils/instruments.js` — Instrument config, news events, timezones
- `src/utils/formatters.js` — Formatting helpers
- `sample-data/` — Real CSV exports for testing

## CSV Format Details (from actual files)

### Tradovate Performance CSV
Headers: `symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration`
- PnL: `$(10.00)` = negative $10, `$21.00` = positive $21
- Timestamps: `03/13/2026 19:41:25` (user's local time, IST)
- Pre-paired trades (each row = one trade with buy price, sell price, both timestamps)

### Tradovate Fills CSV
Headers: `_id,_orderId,...,B/S,Quantity,Price,...,Contract,Product,...`
- B/S column has LEADING SPACES: ` Sell`, ` Buy`
- Has both local timestamps and UTC ISO timestamps
- Raw fills need FIFO reconstruction

### Tradovate Orders CSV
Headers: `orderId,Account,Order ID,B/S,Contract,Product,...,avgPrice,filledQty,Fill Time,...`
- B/S also has leading spaces: ` Sell`, ` Buy`
- Fill Time is local time

### Tradovate Position History CSV
Headers: `Position ID,Timestamp,...,Buy Fill ID,Sell Fill ID,Paired Qty,Buy Price,Sell Price,P/L,...,Bought Timestamp,Sold Timestamp`
- Pre-paired with buy/sell prices and timestamps
- P/L is numeric with negative sign (not $ format)

### WealthCharts Orders CSV
Headers: `account_id,order_id,order_date,last_time,ord_type,qty_sent,qty_done,symbol,trigger_price,price_done,orders,pnl,status,ord_state`
- Symbol: `CM.MNQH6` (strip `CM.` prefix)
- Timestamps: Unix epoch SECONDS (e.g., `1773411035.779`)
- Negative qty = sell, positive = buy
- Status must be "Completed"

### WealthCharts Trades CSV (NO HEADERS)
Each row: `trade_id,uuid,?,account_id,CM.MNQH6,points_pnl,dollar_pnl,2026-03-13T14:10:35.000Z,2026-03-13T14:17:34.000Z`
- No headers at all — detect by ISO date pattern and CM. prefix
- Column 5 (0-indexed) = points P&L, column 6 = dollar P&L
- Columns 7,8 = ISO start/end times (UTC)
- No individual entry/exit prices (only P&L summary)

## Common Issues to Watch For
- Timestamp timezone conversion bugs (IST is UTC+5:30 = 330 minutes, not a whole hour)
- TradingView lightweight-charts needs timestamps in ascending UTC seconds
- Leading spaces in Tradovate B/S column: ` Sell` not `Sell`
- Tradovate PnL parentheses format: `$(X.XX)` = negative
- WealthCharts epoch timestamps are seconds, not milliseconds
- Multiple fills at same timestamp need unique time values for TradingView (increment by 1 second)

## Running Tests
```bash
npm run dev
# Then open browser and drop sample CSVs from sample-data/ folder
# Test each file format individually
```
