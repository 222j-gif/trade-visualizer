// ── State ────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'trade-visualizer-trades';

let trades = loadTrades();
let priceChartInstance = null;
let pnlChartInstance = null;

// ── Persistence ──────────────────────────────────────────────────────────────
function loadTrades() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || sampleTrades();
  } catch {
    return sampleTrades();
  }
}

function saveTrades() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
}

function sampleTrades() {
  const today = new Date();
  const day = (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    return d.toISOString().split('T')[0];
  };
  return [
    { id: 1, date: day(20), symbol: 'AAPL', side: 'LONG', entry: 170.50, exit: 178.20, size: 50 },
    { id: 2, date: day(17), symbol: 'TSLA', side: 'LONG', entry: 215.00, exit: 198.50, size: 30 },
    { id: 3, date: day(14), symbol: 'AAPL', side: 'SHORT', entry: 176.00, exit: 172.10, size: 40 },
    { id: 4, date: day(10), symbol: 'BTC',  side: 'LONG', entry: 62000, exit: 67500, size: 0.5 },
    { id: 5, date: day(7),  symbol: 'ETH',  side: 'LONG', entry: 3200,  exit: 3450,  size: 2 },
    { id: 6, date: day(4),  symbol: 'TSLA', side: 'SHORT', entry: 205.00, exit: 212.00, size: 20 },
    { id: 7, date: day(2),  symbol: 'AAPL', side: 'LONG', entry: 172.30, exit: 179.80, size: 60 },
  ];
}

// ── Calculations ─────────────────────────────────────────────────────────────
function calcPnl(trade) {
  const raw = trade.side === 'LONG'
    ? (trade.exit - trade.entry) * trade.size
    : (trade.entry - trade.exit) * trade.size;
  return Math.round(raw * 100) / 100;
}

function calcStats() {
  if (!trades.length) return { total: 0, winRate: 0, count: 0, best: 0, worst: 0, avg: 0 };
  const pnls = trades.map(calcPnl);
  const total = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter(p => p > 0).length;
  return {
    total: Math.round(total * 100) / 100,
    winRate: Math.round((wins / pnls.length) * 100),
    count: pnls.length,
    best: Math.max(...pnls),
    worst: Math.min(...pnls),
    avg: Math.round((total / pnls.length) * 100) / 100,
  };
}

// ── Price chart data (simulated OHLC → close line) ───────────────────────────
function generatePriceSeries(symbol, days = 30) {
  const seeds = { AAPL: 172, TSLA: 205, BTC: 63000, ETH: 3300 };
  const vol =   { AAPL: 3,   TSLA: 8,   BTC: 2000,  ETH: 150 };
  let price = seeds[symbol] ?? 100;
  const v = vol[symbol] ?? 5;
  const labels = [];
  const data = [];
  const d = new Date();
  for (let i = days; i >= 0; i--) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() - i);
    labels.push(dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    price += (Math.random() - 0.48) * v;
    data.push(Math.round(price * 100) / 100);
  }
  return { labels, data };
}

// ── Chart rendering ───────────────────────────────────────────────────────────
function renderPriceChart(symbol) {
  const { labels, data } = generatePriceSeries(symbol);
  const ctx = document.getElementById('priceChart').getContext('2d');

  if (priceChartInstance) priceChartInstance.destroy();

  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: symbol + ' Price',
        data,
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88,166,255,0.08)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161b22',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(48,54,61,0.6)' },
          ticks: { color: '#8b949e', maxTicksLimit: 8 },
        },
        y: {
          grid: { color: 'rgba(48,54,61,0.6)' },
          ticks: {
            color: '#8b949e',
            callback: v => symbol === 'BTC' || symbol === 'ETH'
              ? '$' + v.toLocaleString()
              : '$' + v.toFixed(2),
          },
        },
      },
    },
  });
}

function renderPnlChart() {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  let cumulative = 0;
  const labels = [];
  const data = [];

  sorted.forEach((t, i) => {
    cumulative += calcPnl(t);
    labels.push(`Trade ${i + 1}`);
    data.push(Math.round(cumulative * 100) / 100);
  });

  if (!labels.length) { labels.push('Start'); data.push(0); }

  const ctx = document.getElementById('pnlChart').getContext('2d');
  if (pnlChartInstance) pnlChartInstance.destroy();

  const lastVal = data[data.length - 1] ?? 0;
  const color = lastVal >= 0 ? '#3fb950' : '#f85149';

  pnlChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cumulative P&L',
        data,
        borderColor: color,
        backgroundColor: lastVal >= 0 ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: color,
        fill: true,
        tension: 0.2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161b22',
          borderColor: '#30363d',
          borderWidth: 1,
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          callbacks: { label: ctx => ' $' + ctx.parsed.y.toFixed(2) },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(48,54,61,0.6)' }, ticks: { color: '#8b949e' } },
        y: {
          grid: { color: 'rgba(48,54,61,0.6)' },
          ticks: { color: '#8b949e', callback: v => '$' + v.toFixed(0) },
        },
      },
    },
  });
}

// ── Stats rendering ───────────────────────────────────────────────────────────
function fmt(n) {
  const abs = Math.abs(n);
  return (n < 0 ? '-$' : '$') + abs.toFixed(2);
}

function renderStats() {
  const s = calcStats();
  const setVal = (id, val, isColor = true) => {
    const el = document.getElementById(id);
    el.textContent = typeof val === 'number' ? (id.includes('Rate') ? val + '%' : fmt(val)) : val;
    if (isColor) {
      el.classList.remove('positive', 'negative');
      if (typeof val === 'number' && val > 0) el.classList.add('positive');
      else if (typeof val === 'number' && val < 0) el.classList.add('negative');
    }
  };
  setVal('totalPnl', s.total);
  setVal('winRate', s.winRate);
  document.getElementById('totalTrades').textContent = s.count;
  setVal('bestTrade', s.best);
  setVal('worstTrade', s.worst);
  setVal('avgTrade', s.avg);
}

// ── Trade table ───────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('tradeBody');
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = sorted.map(t => {
    const pnl = calcPnl(t);
    const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    return `<tr>
      <td>${t.date}</td>
      <td><strong>${t.symbol}</strong></td>
      <td><span class="badge ${t.side.toLowerCase()}">${t.side}</span></td>
      <td>$${Number(t.entry).toFixed(2)}</td>
      <td>$${Number(t.exit).toFixed(2)}</td>
      <td>${t.size}</td>
      <td class="${pnlClass}">${fmt(pnl)}</td>
      <td><button class="btn-delete" data-id="${t.id}" title="Delete">×</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px">No trades yet. Add your first trade!</td></tr>';
}

// ── Full render ───────────────────────────────────────────────────────────────
function renderAll() {
  const symbol = document.getElementById('symbolSelect').value;
  renderPriceChart(symbol);
  renderPnlChart();
  renderStats();
  renderTable();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal() {
  document.getElementById('tradeDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('tradeSymbol').value = document.getElementById('symbolSelect').value;
  document.getElementById('tradeModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('tradeModal').classList.add('hidden');
  document.getElementById('tradeForm').reset();
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('addTradeBtn').addEventListener('click', openModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);

document.getElementById('tradeModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.getElementById('tradeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const trade = {
    id: Date.now(),
    date: document.getElementById('tradeDate').value,
    symbol: document.getElementById('tradeSymbol').value.toUpperCase(),
    side: document.getElementById('tradeSide').value,
    entry: parseFloat(document.getElementById('tradeEntry').value),
    exit: parseFloat(document.getElementById('tradeExit').value),
    size: parseFloat(document.getElementById('tradeSize').value),
  };
  trades.push(trade);
  saveTrades();
  closeModal();
  renderAll();
});

document.getElementById('tradeBody').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-delete');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  trades = trades.filter(t => t.id !== id);
  saveTrades();
  renderAll();
});

document.getElementById('symbolSelect').addEventListener('change', () => {
  renderPriceChart(document.getElementById('symbolSelect').value);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Load Chart.js from CDN then render
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
script.onload = renderAll;
document.head.appendChild(script);
