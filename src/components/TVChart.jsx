import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { buildCandles } from '../utils/analysis';
import { fmtUsd, fmtPrice, fmtDateTime, fmtDuration } from '../utils/formatters';

/**
 * TradingView Lightweight Charts component.
 *
 * Props:
 *   trades      – parsed trade objects
 *   fills       – raw fill objects (used for synthetic candles when bars=null)
 *   breachData  – { breaches, tradesAfterBreach }
 *   newsAlerts  – news event objects
 *   bars        – real OHLCV bars from marketData.js (optional; falls back to synthetic)
 *   intervalMin – bar interval in minutes (for tooltip proximity matching)
 */
export default function TVChart({ trades, fills, breachData, newsAlerts, bars: externalBars, intervalMin = 1 }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // ── Candle data: real bars preferred, synthetic fallback ──────
    const candles = externalBars?.length
      ? externalBars
      : buildCandles(fills, 60);

    if (!candles.length) return;

    // ── Tear down previous chart ──────────────────────────────────
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (_) {}
      chartRef.current = null;
    }
    // Remove any stale tooltip from a previous render
    containerRef.current.querySelectorAll('.tv-tooltip').forEach(el => el.remove());
    containerRef.current.style.position = 'relative';

    // ── Floating tooltip element ──────────────────────────────────
    const tooltip = document.createElement('div');
    tooltip.className = 'tv-tooltip';
    containerRef.current.appendChild(tooltip);

    // ── Create chart ──────────────────────────────────────────────
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 520,
      layout: {
        background:  { color: '#0a0a18' },
        textColor:   '#6b6b80',
        fontFamily:  "'Fira Code', monospace",
        fontSize:    11,
      },
      grid: {
        vertLines: { color: '#12122e' },
        horzLines: { color: '#12122e' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#ffffff22', width: 1, style: 3, labelBackgroundColor: '#2a2a50' },
        horzLine: { color: '#ffffff22', width: 1, style: 3, labelBackgroundColor: '#2a2a50' },
      },
      rightPriceScale: {
        borderColor:  '#1a1a38',
        scaleMargins: { top: 0.05, bottom: 0.22 },
      },
      timeScale: {
        borderColor:    '#1a1a38',
        timeVisible:    true,
        secondsVisible: intervalMin < 5,
        rightOffset:    5,
        barSpacing:     Math.max(3, Math.min(12, containerRef.current.clientWidth / candles.length * 0.8)),
      },
      handleScroll: { vertTouchDrag: false },
    });

    // ── Candlestick series ────────────────────────────────────────
    const candleSeries = chart.addCandlestickSeries({
      upColor:         '#00c853',
      downColor:       '#d50000',
      borderUpColor:   '#00e676',
      borderDownColor: '#ff1744',
      wickUpColor:     '#00e676',
      wickDownColor:   '#ff1744',
    });
    candleSeries.setData(candles);

    // ── Volume series (shown when volume data is present) ─────────
    const hasVolume = candles.some(c => c.volume > 0);
    if (hasVolume) {
      const volSeries = chart.addHistogramSeries({ priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({
        scaleMargins:  { top: 0.80, bottom: 0.06 },
        drawTicks:     false,
        borderVisible: false,
      });
      volSeries.setData(candles.map(c => ({
        time:  c.time,
        value: c.volume,
        color: c.close >= c.open ? '#00c85330' : '#d5000030',
      })));
    }

    // ── Helper: snap a UTC timestamp to the nearest candle time ───
    // Candles are sorted ascending; we early-exit once past the target + 2h
    function snapTime(t) {
      if (t == null) return null;
      let best = candles[0].time;
      let bestDiff = Math.abs(candles[0].time - t);
      for (let i = 1; i < candles.length; i++) {
        const diff = Math.abs(candles[i].time - t);
        if (diff < bestDiff) { bestDiff = diff; best = candles[i].time; }
        if (candles[i].time > t + 7200) break;
      }
      return best;
    }

    // ── Trade markers ─────────────────────────────────────────────
    const markers = [];
    for (const t of trades) {
      const isBreach = breachData.breaches.some(b => b.trade.id === t.id);
      const isPost   = breachData.tradesAfterBreach.some(a => a.id === t.id);
      const forceColor = isBreach ? '#ff1744' : isPost ? '#ffab00' : null;

      // Entry arrow
      if (t.entryTime != null) {
        const mt = snapTime(t.entryTime);
        if (mt != null) {
          markers.push({
            time:     mt,
            position: t.side === 'LONG' ? 'belowBar' : 'aboveBar',
            color:    forceColor ?? (t.side === 'LONG' ? '#00e676' : '#ff4444'),
            shape:    t.side === 'LONG' ? 'arrowUp' : 'arrowDown',
            text:     `${t.side === 'LONG' ? 'L' : 'S'} ${t.qty}@${t.entryPrice != null ? fmtPrice(t.entryPrice, t.symbol) : '?'}`,
            size:     1,
          });
        }
      }

      // Exit circle
      if (t.exitTime != null && t.exitPrice != null) {
        const mt = snapTime(t.exitTime);
        if (mt != null) {
          markers.push({
            time:     mt,
            position: t.side === 'LONG' ? 'aboveBar' : 'belowBar',
            color:    t.pnl >= 0 ? '#00e676' : '#ff1744',
            shape:    'circle',
            text:     `${fmtUsd(t.pnl)}${isBreach ? ' ⚠' : ''}`,
            size:     1,
          });
        }
      }
    }

    // News markers
    for (const na of newsAlerts) {
      const mt = snapTime(na.newsTime);
      if (mt != null) {
        markers.push({
          time:     mt,
          position: 'aboveBar',
          color:    na.impact === 'extreme' ? '#ff1744' : na.impact === 'high' ? '#ffab00' : '#40c4ff',
          shape:    'square',
          text:     na.event,
          size:     1,
        });
      }
    }

    // Sort: ascending time; entries before exits at the same bar
    markers.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      const isArrow = s => s === 'arrowUp' || s === 'arrowDown';
      return isArrow(a.shape) ? -1 : isArrow(b.shape) ? 1 : 0;
    });
    if (markers.length) {
      try { candleSeries.setMarkers(markers); } catch (_) {}
    }

    // ── Price level lines ─────────────────────────────────────────
    for (const t of trades) {
      if (t.entryPrice != null) {
        candleSeries.createPriceLine({
          price: t.entryPrice, lineWidth: 1, lineStyle: 2, axisLabelVisible: false,
          color: t.side === 'LONG' ? '#00e67635' : '#ff174435',
        });
      }
      if (t.exitPrice != null) {
        candleSeries.createPriceLine({
          price: t.exitPrice, lineWidth: 1, lineStyle: 1, axisLabelVisible: false,
          color: t.pnl >= 0 ? '#00e67625' : '#ff174425',
        });
      }
    }

    // ── P&L histogram (one bar per exit) ─────────────────────────
    const pnlSeries = chart.addHistogramSeries({
      priceFormat:  { type: 'custom', formatter: v => fmtUsd(v) },
      priceScaleId: 'pnl',
    });
    chart.priceScale('pnl').applyOptions({
      scaleMargins:  { top: 0.90, bottom: 0 },
      drawTicks:     false,
      borderVisible: false,
    });
    const pnlMap = {};
    for (const t of trades) {
      if (t.exitTime != null) {
        pnlMap[t.exitTime] = {
          time:  t.exitTime,
          value: t.pnl,
          color: t.pnl >= 0 ? '#00e67660' : '#ff174460',
        };
      }
    }
    const pnlArr = Object.values(pnlMap).sort((a, b) => a.time - b.time);
    if (pnlArr.length) pnlSeries.setData(pnlArr);

    chart.timeScale().fitContent();
    chartRef.current = chart;

    // ── Tooltip via crosshair move ────────────────────────────────
    // Match trades within ±(intervalMin * 60) seconds of the hovered bar
    const WIN = intervalMin * 60;

    chart.subscribeCrosshairMove(param => {
      if (!param.point || param.point.x < 0 || param.point.y < 0 || !param.time) {
        tooltip.style.display = 'none';
        return;
      }
      const bar = param.seriesData.get(candleSeries);
      if (!bar || bar.open == null) { tooltip.style.display = 'none'; return; }

      const t = param.time;

      // Find the trade whose entry OR exit is closest to this bar
      let closestTrade = null;
      let closestDist  = Infinity;
      let closestIsEntry = false;
      for (const tr of trades) {
        const de = tr.entryTime != null ? Math.abs(tr.entryTime - t) : Infinity;
        const dx = tr.exitTime  != null ? Math.abs(tr.exitTime  - t) : Infinity;
        const d  = Math.min(de, dx);
        if (d <= WIN && d < closestDist) {
          closestDist  = d;
          closestTrade = tr;
          closestIsEntry = de <= dx;
        }
      }

      const sym  = closestTrade?.symbol ?? trades[0]?.symbol ?? '';
      const bull = bar.close >= bar.open;
      const chg  = bar.close - bar.open;
      const pct  = bar.open ? ((chg / bar.open) * 100).toFixed(2) : '0.00';

      tooltip.innerHTML = `
        <div class="tt-time">${fmtDateTime(t)}</div>
        <div class="tt-ohlc">
          <div class="tt-row"><span class="tt-lbl">O</span><span>${fmtPrice(bar.open,  sym)}</span></div>
          <div class="tt-row"><span class="tt-lbl">H</span><span style="color:#00e676">${fmtPrice(bar.high,  sym)}</span></div>
          <div class="tt-row"><span class="tt-lbl">L</span><span style="color:#ff1744">${fmtPrice(bar.low,   sym)}</span></div>
          <div class="tt-row">
            <span class="tt-lbl">C</span>
            <span style="color:${bull ? '#00e676' : '#ff1744'}">${fmtPrice(bar.close, sym)}</span>
            <span class="tt-chg" style="color:${bull ? '#00e676' : '#ff1744'}">${bull ? '+' : ''}${chg.toFixed(2)} (${pct}%)</span>
          </div>
          ${bar.volume > 0 ? `<div class="tt-row"><span class="tt-lbl">Vol</span><span>${bar.volume.toLocaleString()}</span></div>` : ''}
        </div>
        ${closestTrade ? `
        <div class="tt-divider"></div>
        <div class="tt-trade">
          <div class="tt-trade-head">
            <span class="tt-side-badge ${closestTrade.side.toLowerCase()}">${closestTrade.side}</span>
            <span>${closestIsEntry ? '▲ ENTRY' : '● EXIT'} · ${closestTrade.qty}×${closestTrade.symbol}</span>
          </div>
          <div class="tt-row"><span class="tt-lbl">Entry</span><span>${closestTrade.entryPrice != null ? fmtPrice(closestTrade.entryPrice, closestTrade.symbol) : '—'}</span></div>
          <div class="tt-row"><span class="tt-lbl">Exit</span><span>${closestTrade.exitPrice  != null ? fmtPrice(closestTrade.exitPrice,  closestTrade.symbol) : '—'}</span></div>
          <div class="tt-row">
            <span class="tt-lbl">P&L</span>
            <span style="color:${closestTrade.pnl >= 0 ? '#00e676' : '#ff1744'};font-weight:700">${fmtUsd(closestTrade.pnl)}</span>
          </div>
          <div class="tt-row"><span class="tt-lbl">Dur</span><span>${fmtDuration(closestTrade.duration)}</span></div>
        </div>` : ''}
      `;

      // Smart positioning: keep tooltip inside the container
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight || 520;
      const tw = 215;
      const th = tooltip.offsetHeight || 140;
      let lx = param.point.x + 18;
      let ly = param.point.y - 20;
      if (lx + tw > cw) lx = param.point.x - tw - 18;
      if (ly + th > ch) ly = ch - th - 8;
      if (ly < 0) ly = 8;
      tooltip.style.left    = `${lx}px`;
      tooltip.style.top     = `${ly}px`;
      tooltip.style.display = 'block';
    });

    // ── Resize observer ───────────────────────────────────────────
    const ro = new ResizeObserver(entries => {
      if (chartRef.current) {
        chartRef.current.applyOptions({ width: entries[0].contentRect.width });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      try { containerRef.current?.removeChild(tooltip); } catch (_) {}
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
      }
    };
  }, [trades, fills, breachData, newsAlerts, externalBars, intervalMin]);

  // Show a message only when there is truly no data at all
  if (!externalBars?.length && !fills.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
        No chart data available.<br />
        Import a fills-based CSV, or wait for real bars to load.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
