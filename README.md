# Trade Analyzer — Tradeify

A standalone trade analysis tool that imports broker trade logs (Tradovate, WealthCharts), visualizes entries/exits on TradingView charts, detects account breaches, and overlays high-volatility news events.

## Quick Start

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`.

## Architecture

```
src/
├── main.jsx                  # React entry point
├── App.jsx                   # Main app component (tabs, state, file handling)
├── styles.css                # Global styles (dark trading terminal theme)
├── components/
│   ├── TVChart.jsx           # TradingView candlestick chart with trade markers
│   └── TVEquity.jsx          # TradingView equity curve chart
└── utils/
    ├── instruments.js        # CME futures config (tick sizes, point values, news events, timezones)
    ├── parser.js             # Multi-format CSV parser (Tradovate + WealthCharts)
    ├── analysis.js           # Breach detection, news detection, stats, candle building
    └── formatters.js         # Price, time, currency formatting helpers
```

## Supported Log Formats

### Tradovate
1. **Performance CSV** — Pre-paired trades with `buyPrice`, `sellPrice`, `pnl` (format: `$(10.00)` = -$10)
2. **Position History CSV** — Pre-paired with `Buy Price`, `Sell Price`, `P/L`, `Bought Timestamp`, `Sold Timestamp`
3. **Orders CSV** — Raw fills with `B/S`, `Contract`, `avgPrice`, `Fill Time` (FIFO reconstructed)
4. **Fills CSV** — Individual fills with `B/S` (note: may have leading spaces like ` Sell`), `Contract`, `Price`, `Timestamp`

### WealthCharts
5. **Orders CSV** — Headers: `account_id`, `order_id`, `symbol` (CM.MNQH6 format), `price_done`, `qty_done` (negative = sell), `pnl`. Timestamps are Unix epoch seconds.
6. **Trades CSV** — Headerless CSV. Columns: `trade_id, uuid, ?, account_id, CM.MNQH6, points_pnl, dollar_pnl, iso_start, iso_end`. Auto-detected by ISO date pattern.

## Sample Data

The `sample-data/` folder contains real CSV exports for testing:
- `Performance__tradovate_.csv` — Tradovate performance log (NQ trades)
- `Performance__tvt_.csv` — Tradovate performance log (MNQ trades)  
- `Orders__tradovate_.csv` — Tradovate orders
- `Fills.csv` — Tradovate fills
- `Position_History.csv` — Tradovate position history
- `orders__wealthcharts_.csv` — WealthCharts orders
- `trades-_wealthcharts.csv` — WealthCharts trades (headerless)

## Key Features

### Chart Visualization (TVChart.jsx)
- TradingView lightweight-charts candlestick chart
- Entry markers: ▲ (long) / ▼ (short) arrows with price labels
- Exit markers: ● circles with P&L labels
- News event markers: ■ squares color-coded by impact
- P&L histogram at bottom
- Price level lines at entry/exit prices
- Breach trade highlighting

### Candle Generation (analysis.js → buildCandles)
- Builds 1-minute OHLC candles from real broker fill prices
- Fills time gaps between fills with micro-movement continuation candles
- Uses instrument tick size for realistic gap-fill noise

### Trade Reconstruction (parser.js → reconstructTrades)
- FIFO matching of buy/sell fills per instrument
- Handles partial fills and position flips
- P&L calculated using instrument point values

### Breach Detection (analysis.js → detectBreaches)
- Max loss, trailing drawdown, daily loss limit rules
- Identifies exact breach trade
- Flags all trades placed AFTER breach (when Tradovate didn't lock the account)

### News Overlay (analysis.js → findNewsNearTrades)
- Detects trades entered within 15 minutes of major economic events
- Covers FOMC, NFP, CPI, PCE, GDP, ISM, etc.
- Events are in CT (exchange time)

### Timezone Handling
- All timestamps normalized to UTC seconds for TradingView
- Supports IST (UTC+5:30), all US timezones, European, Asian, Australian
- Tradovate exports in user's local time; WealthCharts orders use epoch seconds

## Known Issues / TODO

- [ ] TradingView chart candles are built from fill data only — gaps between fills show synthetic continuation. Ideally would fetch real market data from a data provider for accurate between-trade price action.
- [ ] WealthCharts Trades format (headerless) has no individual entry/exit prices — only shows P&L and equity curve, no candlestick chart.
- [ ] News events are matched by time-of-day only, not by actual calendar date (doesn't know if CPI actually happened on a given date).
- [ ] No zoom sync between main chart and equity curve.
- [ ] Could add: trade replay/playback mode, multi-file import, session-based grouping, export report as PDF.

## Tech Stack

- **React 18** — UI framework
- **Vite 5** — Build tool
- **lightweight-charts 4.1** — TradingView charting (npm package, not CDN)
- **PapaParse 5.4** — CSV parsing
