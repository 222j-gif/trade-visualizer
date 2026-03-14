# Trade Visualizer

A lightweight, browser-based trade journal and P&L visualizer. No backend required — all data is stored in `localStorage`.

## Features

- **Price chart** — simulated price series for AAPL, TSLA, BTC, ETH
- **Cumulative P&L chart** — track your running performance across all trades
- **Trade log** — add, view, and delete trades with full details
- **Stats dashboard** — total P&L, win rate, best/worst/average trade

## Usage

Open `index.html` in any modern browser. No build step needed.

### Adding a trade

1. Click **+ Add Trade**
2. Fill in symbol, side (LONG/SHORT), entry/exit prices, size, and date
3. Click **Save Trade**

Trades persist across page reloads via `localStorage`.

## Tech

- Vanilla HTML/CSS/JavaScript
- [Chart.js 4](https://www.chartjs.org/) (loaded from CDN)
