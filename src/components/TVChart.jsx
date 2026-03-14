import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { buildCandles } from '../utils/analysis';
import { fmtUsd, fmtPrice } from '../utils/formatters';

/**
 * TradingView Lightweight Charts component.
 * Renders candlestick chart with trade markers, price lines, P&L histogram.
 */
export default function TVChart({ trades, fills, breachData, newsAlerts }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !fills.length) return;

    // Destroy previous chart
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (e) {}
      chartRef.current = null;
    }

    const candles = buildCandles(fills, 60);
    if (!candles.length) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 520,
      layout: {
        background: { type: 'solid', color: '#0a0a18' },
        textColor: '#6b6b80',
        fontFamily: "'Fira Code', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#12122e' },
        horzLines: { color: '#12122e' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#ffffff25', width: 1, style: 3, labelBackgroundColor: '#2a2a50' },
        horzLine: { color: '#ffffff25', width: 1, style: 3, labelBackgroundColor: '#2a2a50' },
      },
      rightPriceScale: {
        borderColor: '#1a1a38',
        scaleMargins: { top: 0.06, bottom: 0.15 },
      },
      timeScale: {
        borderColor: '#1a1a38',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
        barSpacing: Math.max(3, Math.min(12, containerRef.current.clientWidth / candles.length * 0.8)),
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00c853',
      downColor: '#d50000',
      borderUpColor: '#00e676',
      borderDownColor: '#ff1744',
      wickUpColor: '#00e676',
      wickDownColor: '#ff1744',
    });
    candleSeries.setData(candles);

    // ── Trade Markers ──────────────────────────
    const markers = [];

    for (const t of trades) {
      const isBreach = breachData.breaches.some(b => b.trade.id === t.id);
      const isPostBreach = breachData.tradesAfterBreach.some(a => a.id === t.id);

      // Entry marker
      if (t.entryTime && t.entryPrice) {
        markers.push({
          time: t.entryTime,
          position: t.side === 'LONG' ? 'belowBar' : 'aboveBar',
          color: isBreach ? '#ff1744' : isPostBreach ? '#ffab00' : (t.side === 'LONG' ? '#00e676' : '#ff1744'),
          shape: t.side === 'LONG' ? 'arrowUp' : 'arrowDown',
          text: `${t.side === 'LONG' ? 'BUY' : 'SELL'} ${t.qty}@${fmtPrice(t.entryPrice, t.symbol)}`,
        });
      }

      // Exit marker
      if (t.exitTime && t.exitPrice) {
        markers.push({
          time: t.exitTime,
          position: t.side === 'LONG' ? 'aboveBar' : 'belowBar',
          color: t.pnl >= 0 ? '#00e676' : '#ff1744',
          shape: 'circle',
          text: `EXIT ${fmtUsd(t.pnl)}${isBreach ? ' ⚠BREACH' : ''}`,
        });
      }
    }

    // News markers
    for (const na of newsAlerts) {
      markers.push({
        time: na.newsTime,
        position: 'aboveBar',
        color: na.impact === 'extreme' ? '#ff1744' : na.impact === 'high' ? '#ffab00' : '#40c4ff',
        shape: 'square',
        text: `📰 ${na.event}`,
      });
    }

    markers.sort((a, b) => a.time - b.time);
    if (markers.length) candleSeries.setMarkers(markers);

    // ── Price Lines ────────────────────────────
    for (const t of trades) {
      if (t.entryPrice) {
        candleSeries.createPriceLine({
          price: t.entryPrice,
          color: t.side === 'LONG' ? '#00e67640' : '#ff174440',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: false,
        });
      }
      if (t.exitPrice) {
        candleSeries.createPriceLine({
          price: t.exitPrice,
          color: t.pnl >= 0 ? '#00e67630' : '#ff174430',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: false,
        });
      }
    }

    // ── P&L Histogram ──────────────────────────
    const pnlSeries = chart.addHistogramSeries({
      priceFormat: { type: 'custom', formatter: (v) => fmtUsd(v) },
      priceScaleId: 'pnl',
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    chart.priceScale('pnl').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      drawTicks: false,
      borderVisible: false,
    });

    const pnlMap = {};
    for (const t of trades) {
      if (t.exitTime) {
        pnlMap[t.exitTime] = {
          time: t.exitTime,
          value: t.pnl,
          color: t.pnl >= 0 ? '#00e67660' : '#ff174460',
        };
      }
    }
    const pnlData = Object.values(pnlMap).sort((a, b) => a.time - b.time);
    if (pnlData.length) pnlSeries.setData(pnlData);

    // Fit content
    chart.timeScale().fitContent();
    chartRef.current = chart;

    // Resize observer
    const ro = new ResizeObserver(entries => {
      if (chartRef.current) {
        chartRef.current.applyOptions({ width: entries[0].contentRect.width });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (e) {}
        chartRef.current = null;
      }
    };
  }, [trades, fills, breachData, newsAlerts]);

  if (!fills.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>
        This format has pre-paired trades without individual fill prices — chart shows equity only.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
