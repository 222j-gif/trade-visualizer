import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { INSTRUMENTS, TIMEZONES } from './utils/instruments';
import { parseLogs } from './utils/parser';
import { detectBreaches, findNewsNearTrades, computeStats } from './utils/analysis';
import { fmtUsd, fmtPrice, fmtDateTime, fmtDuration, fmtTime } from './utils/formatters';
import { toYahooTicker, resolveInterval, fetchYahooBars } from './utils/marketData';
import TVChart from './components/TVChart';
import TVEquity from './components/TVEquity';

export default function App() {
  const [tab, setTab] = useState('upload');
  const [fills, setFills] = useState([]);
  const [trades, setTrades] = useState([]);
  const [format, setFormat] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [tz, setTz] = useState('India (IST)');
  const [dragOver, setDragOver] = useState(false);
  const [rules, setRules] = useState({ maxLoss: 2500, trailingDrawdown: 2500, dailyLossLimit: 1250 });
  const [newsAlerts, setNewsAlerts] = useState([]);
  const [selSym, setSelSym] = useState('ALL');
  const fileRef = useRef();

  // ── Real market data ────────────────────────────────────────────
  // realBarsCache: { [symbol]: { bars: [], interval: number, error?: string } }
  const [realBarsCache, setRealBarsCache]   = useState({});
  const [loadingBars,   setLoadingBars]     = useState(false);
  const [barsError,     setBarsError]       = useState('');
  const [intervalMin,   setIntervalMin]     = useState(1);

  // ── File Handling ───────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const tzMin = TIMEZONES[tz] ?? 330;
      const { trades: t, fills: f, format: fmt, error: err } = parseLogs(e.target.result, tzMin);
      if (err) { setError(err); return; }
      setFills(f);
      setFormat(fmt);
      setError('');
      setTrades(t);
      setNewsAlerts(findNewsNearTrades(t));
      setSelSym('ALL');
      setTab('chart');
    };
    reader.readAsText(file);
  }, [tz]);

  // ── Fetch real bars from Yahoo Finance ─────────────────────────
  const fetchAllBars = useCallback(async (tradeList, ivMin) => {
    if (!tradeList.length) return;
    setLoadingBars(true);
    setBarsError('');

    const syms = [...new Set(tradeList.map(t => t.symbol))];
    const cache = {};

    for (const sym of syms) {
      const yahoo = toYahooTicker(sym);
      if (!yahoo) {
        cache[sym] = { bars: [], interval: ivMin, error: `No Yahoo ticker for ${sym}` };
        continue;
      }

      const symTrades = tradeList.filter(t => t.symbol === sym);
      const times = symTrades.flatMap(t => [t.entryTime, t.exitTime].filter(Boolean));
      if (!times.length) continue;
      const fromSec = Math.min(...times);
      const toSec   = Math.max(...times);

      const actualIv = resolveInterval(fromSec, ivMin);
      try {
        const bars = await fetchYahooBars(yahoo, actualIv, fromSec, toSec);
        cache[sym] = { bars, interval: actualIv };
      } catch (e) {
        cache[sym] = { bars: [], interval: actualIv, error: e.message };
      }
    }

    setRealBarsCache(cache);
    setLoadingBars(false);

    const allFailed = Object.values(cache).every(v => v.error);
    if (allFailed && Object.keys(cache).length > 0) {
      const firstErr = Object.values(cache)[0].error;
      setBarsError(firstErr);
    }
  }, []);

  // Auto-fetch whenever trades or desired interval changes
  useEffect(() => {
    if (trades.length) fetchAllBars(trades, intervalMin);
  }, [trades, intervalMin, fetchAllBars]);

  // ── Derived State ──────────────────────────────
  const symbols = useMemo(() => ['ALL', ...new Set(trades.map(t => t.symbol))], [trades]);
  const filtered = useMemo(() => selSym === 'ALL' ? trades : trades.filter(t => t.symbol === selSym), [trades, selSym]);
  const filteredFills = useMemo(() => selSym === 'ALL' ? fills : fills.filter(f => f.symbol === selSym), [fills, selSym]);
  const breach = useMemo(() => detectBreaches(filtered, rules), [filtered, rules]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);

  // Determine which symbol's real bars to show on the chart.
  // If ALL is selected, use the first actual symbol's bars.
  const chartSym   = selSym === 'ALL' ? (symbols[1] ?? null) : selSym;
  const chartEntry = chartSym ? realBarsCache[chartSym] : null;
  const chartBars  = chartEntry?.bars?.length > 0 ? chartEntry.bars : null;
  const chartIv    = chartEntry?.interval ?? intervalMin;

  // ── Render ─────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="header-logo">T</div>
          <div>
            <h1>Trade Analyzer</h1>
            <p className="sub">PARSE · VISUALIZE · AUDIT</p>
          </div>
        </div>
        {trades.length > 0 && (
          <span className="meta">{fills.length} fills → {trades.length} trades · {format.replace(/_/g, ' ').toUpperCase()}</span>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[
          { id: 'upload', label: 'Import' },
          { id: 'chart', label: 'Chart' },
          { id: 'trades', label: 'Trades' },
          { id: 'equity', label: 'Equity' },
          { id: 'breach', label: 'Breach', badge: breach.breaches.length, badgeClass: 'red' },
          { id: 'news', label: 'News', badge: newsAlerts.length, badgeClass: 'amber' },
        ].map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge > 0 && <span className={`badge ${t.badgeClass}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="content">
        {/* Symbol filter bar */}
        {trades.length > 0 && tab !== 'upload' && (
          <div className="sym-bar">
            {symbols.map(s => (
              <button
                key={s}
                className={`sym-btn ${selSym === s ? 'active' : ''}`}
                onClick={() => setSelSym(s)}
              >{s}</button>
            ))}
          </div>
        )}

        {/* ═══ UPLOAD TAB ═══ */}
        {tab === 'upload' && (
          <div>
            <div
              className={`drop-zone ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />
              <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
              <h2>Drop your trade log here</h2>
              <p>Tradovate Performance · Orders · Fills · Position History · WealthCharts Orders/Trades</p>
            </div>

            <div className="tz-box">
              <label>LOG TIMEZONE</label>
              <select className="form-select" value={tz} onChange={(e) => setTz(e.target.value)}>
                {Object.entries(TIMEZONES).map(([name, min]) => {
                  const h = Math.floor(Math.abs(min) / 60);
                  const m = Math.abs(min) % 60;
                  return <option key={name} value={name}>{name} (UTC{min >= 0 ? '+' : '-'}{h}{m ? `:${m.toString().padStart(2, '0')}` : ''})</option>;
                })}
              </select>
              <p style={{ fontSize: 10, color: 'var(--dim)', marginTop: 6 }}>Tradovate exports timestamps in your local time. All times are converted to UTC for chart display.</p>
            </div>

            <div className="info-box">
              <h4>Supported Formats</h4>
              <p>
                <strong style={{ color: 'var(--text)' }}>Tradovate:</strong> Performance (buyPrice/sellPrice/pnl), Orders (B/S fills), Fills, Position History<br />
                <strong style={{ color: 'var(--text)' }}>WealthCharts:</strong> Orders (with prices + pnl), Trades (P&L summary)
              </p>
            </div>

            {error && <div className="msg err">{error}</div>}
            {fileName && !error && trades.length > 0 && (
              <div className="msg ok">
                ✓ <strong style={{ fontFamily: 'var(--mono)' }}>{fileName}</strong> — {trades.length} trades loaded ({format.replace(/_/g, ' ')})
              </div>
            )}
          </div>
        )}

        {/* ═══ CHART TAB ═══ */}
        {tab === 'chart' && (
          filtered.length > 0 ? (
            <div>
              <div className="card">
                <div className="card-head">
                  <div>
                    <h3>{selSym !== 'ALL' ? (INSTRUMENTS[selSym]?.name || selSym) : 'All Instruments'} — Price Chart</h3>
                    <p className="sub">
                      {chartBars
                        ? `Yahoo Finance · ${chartIv < 60 ? chartIv + 'm' : '1h'} bars · ${chartBars.length} candles`
                        : 'Synthetic candles from fill data'
                      } · Scroll to zoom · {filtered.length} trades
                    </p>
                  </div>
                  <span className={`tag ${chartBars ? 'green' : 'amber'}`}>
                    {chartBars ? 'LIVE DATA' : 'SYNTHETIC'}
                  </span>
                </div>

                {/* Interval picker */}
                <div className="interval-bar">
                  {[1, 5, 15, 30, 60].map(m => (
                    <button
                      key={m}
                      className={`iv-btn ${intervalMin === m ? 'active' : ''}`}
                      onClick={() => setIntervalMin(m)}
                      disabled={loadingBars}
                    >
                      {m < 60 ? `${m}m` : '1h'}
                    </button>
                  ))}
                  {loadingBars && <span className="bars-status loading">⟳ fetching market data…</span>}
                  {barsError && !loadingBars && (
                    <span className="bars-status error" title={barsError}>⚠ data unavailable — using synthetic candles</span>
                  )}
                  {chartBars && !loadingBars && (
                    <span className="bars-status ok">✓ {chartSym} · {chartBars.length} bars</span>
                  )}
                </div>

                <TVChart
                  trades={filtered}
                  fills={filteredFills}
                  breachData={breach}
                  newsAlerts={newsAlerts}
                  bars={chartBars}
                  intervalMin={chartIv}
                />
              </div>

              <div className="legend">
                {[['#00e676', '▲ Long Entry'], ['#ff1744', '▼ Short Entry'], ['#00e676', '● Win Exit'], ['#ff1744', '● Loss Exit'], ['#ff1744', '┊ Breach'], ['#ffab00', '■ News']].map(([color, label], i) => (
                  <div key={i} className="legend-item">
                    <div className="legend-dot" style={{ background: color }} />
                    {label}
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-head"><h3>Equity Curve</h3></div>
                <TVEquity trades={filtered} />
              </div>
            </div>
          ) : <Empty onGo={() => setTab('upload')} />
        )}

        {/* ═══ TRADES TAB ═══ */}
        {tab === 'trades' && (
          <div>
            {stats && (
              <div className="stats-grid">
                {[
                  { l: 'Total P&L', v: fmtUsd(stats.totalPnl), c: stats.totalPnl >= 0 ? 'var(--green)' : 'var(--red)' },
                  { l: 'Win Rate', v: `${stats.winRate.toFixed(1)}%`, c: stats.winRate >= 50 ? 'var(--green)' : 'var(--red)' },
                  { l: 'Profit Factor', v: stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2), c: stats.profitFactor >= 1 ? 'var(--green)' : 'var(--red)' },
                  { l: 'Avg Win', v: fmtUsd(stats.avgWin), c: 'var(--green)' },
                  { l: 'Avg Loss', v: fmtUsd(stats.avgLoss), c: 'var(--red)' },
                  { l: 'Max DD', v: '$' + stats.maxDrawdown.toFixed(2), c: 'var(--red)' },
                  { l: 'Trades', v: `${stats.wins}W/${stats.losses}L`, c: 'var(--text)' },
                  { l: 'Avg P&L', v: fmtUsd(stats.avgPnl), c: stats.avgPnl >= 0 ? 'var(--green)' : 'var(--red)' },
                ].map((s, i) => (
                  <div key={i} className="stat">
                    <div className="label">{s.l}</div>
                    <div className="val" style={{ color: s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="card">
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {['#', 'Sym', 'Side', 'Qty', 'Entry', 'Exit', 'Entry Time', 'Exit Time', 'Dur', 'P&L'].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, i) => {
                      const isBreach = breach.breaches.some(b => b.trade.id === t.id);
                      const isAfter = breach.tradesAfterBreach.some(a => a.id === t.id);
                      return (
                        <tr key={i} style={{ background: isBreach ? '#ff174410' : isAfter ? '#ffab0008' : undefined }}>
                          <td style={{ color: 'var(--dim)' }}>{t.id}</td>
                          <td style={{ fontWeight: 600, color: '#fff' }}>{t.symbol}</td>
                          <td><span className={`side-tag ${t.side.toLowerCase()}`}>{t.side}</span></td>
                          <td>{t.qty}</td>
                          <td style={{ color: '#fff' }}>{t.entryPrice ? fmtPrice(t.entryPrice, t.symbol) : '—'}</td>
                          <td style={{ color: '#fff' }}>{t.exitPrice ? fmtPrice(t.exitPrice, t.symbol) : '—'}</td>
                          <td style={{ color: 'var(--dim)', fontSize: 10 }}>{fmtDateTime(t.entryTime)}</td>
                          <td style={{ color: 'var(--dim)', fontSize: 10 }}>{fmtDateTime(t.exitTime)}</td>
                          <td style={{ color: 'var(--dim)' }}>{fmtDuration(t.duration)}</td>
                          <td style={{ fontWeight: 700, color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {fmtUsd(t.pnl)}
                            {isBreach && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--red)' }}>⚠BREACH</span>}
                            {isAfter && !isBreach && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--amber)' }}>POST</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ EQUITY TAB ═══ */}
        {tab === 'equity' && (
          filtered.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h3>Equity Curve</h3>
                <p className="sub">{filtered.length} trades</p>
              </div>
              <TVEquity trades={filtered} height={350} />
            </div>
          ) : <Empty onGo={() => setTab('upload')} />
        )}

        {/* ═══ BREACH TAB ═══ */}
        {tab === 'breach' && (
          <div>
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Account Rules</h3>
              <div className="rules-grid">
                {[
                  { key: 'maxLoss', label: 'Max Loss ($)' },
                  { key: 'trailingDrawdown', label: 'Trailing Drawdown ($)' },
                  { key: 'dailyLossLimit', label: 'Daily Loss ($)' },
                ].map(r => (
                  <div key={r.key}>
                    <label className="rule-label">{r.label}</label>
                    <input
                      className="rule-input"
                      type="number"
                      value={rules[r.key]}
                      onChange={(e) => setRules(prev => ({ ...prev, [r.key]: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {breach.breaches.length === 0 ? (
              <div className="card" style={{ padding: '36px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--green)' }}>No breaches detected</p>
              </div>
            ) : (
              <div>
                <div className="breach-card">
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
                    ⚠ {breach.breaches.length} Breach{breach.breaches.length > 1 ? 'es' : ''}
                  </h3>
                  {breach.tradesAfterBreach.length > 0 && (
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--amber)', fontWeight: 600 }}>
                      ⚡ {breach.tradesAfterBreach.length} trade{breach.tradesAfterBreach.length > 1 ? 's' : ''} after breach — account NOT locked
                    </p>
                  )}
                </div>

                {breach.breaches.map((b, i) => (
                  <div key={i} className="breach-item">
                    <div>
                      <span className="breach-type">{b.type}</span>
                      <span style={{ fontSize: 11 }}>Trade #{b.trade.id} — {b.trade.side} {b.trade.symbol}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>{fmtUsd(b.value)}</div>
                      <div style={{ fontSize: 9, color: 'var(--dim)' }}>{fmtDateTime(b.time)}</div>
                    </div>
                  </div>
                ))}

                {breach.tradesAfterBreach.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <h4 style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)', marginBottom: 8 }}>Post-Breach Trades</h4>
                    {breach.tradesAfterBreach.map((t, i) => (
                      <div key={i} className="post-breach">
                        <span>#{t.id} {t.side} {t.symbol} ×{t.qty}</span>
                        <span style={{ color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{fmtUsd(t.pnl)}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,171,0,0.05)', borderRadius: 6, fontSize: 11, color: 'var(--dim)' }}>
                      <strong style={{ color: 'var(--amber)' }}>Post-breach total: </strong>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: breach.tradesAfterBreach.reduce((s, t) => s + t.pnl, 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmtUsd(breach.tradesAfterBreach.reduce((s, t) => s + t.pnl, 0))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ NEWS TAB ═══ */}
        {tab === 'news' && (
          <div>
            <div className="card" style={{ padding: 16, marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2 }}>News Detection</h3>
              <p style={{ fontSize: 10, color: 'var(--dim)' }}>Trades within 15min of major economic releases (CT)</p>
            </div>

            {newsAlerts.length === 0 ? (
              <div className="card" style={{ padding: '36px 20px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text)' }}>No trades near known high-impact events</p>
              </div>
            ) : (
              newsAlerts.map((n, i) => (
                <div key={i} className="news-item" style={{ border: `1px solid ${n.impact === 'extreme' ? '#ff174430' : '#ffab0030'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <div>
                      <span className={`news-tag ${n.impact}`}>{n.impact.toUpperCase()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{n.event}</span>
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>@ {fmtTime(n.newsTime)}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--dim)' }}>
                    Trade #{n.trade.id}: {n.trade.side} {n.trade.symbol} entered{' '}
                    {n.minutesBefore > 0 ? `${n.minutesBefore}m before` : n.minutesBefore < 0 ? `${Math.abs(n.minutesBefore)}m after` : 'at'} release
                    <span style={{ marginLeft: 8, fontWeight: 700, color: n.trade.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUsd(n.trade.pnl)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Empty state for tabs with no data */}
        {trades.length === 0 && tab !== 'upload' && <Empty onGo={() => setTab('upload')} />}
      </div>
    </div>
  );
}

function Empty({ onGo }) {
  return (
    <div className="empty">
      No trades loaded. <a onClick={onGo}>Import a log</a>
    </div>
  );
}
