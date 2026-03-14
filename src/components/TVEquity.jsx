import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import { fmtUsd } from '../utils/formatters';

export default function TVEquity({ trades, height = 280 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !trades.length) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (e) {}
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
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
        vertLine: { labelBackgroundColor: '#2a2a50' },
        horzLine: { labelBackgroundColor: '#2a2a50' },
      },
      rightPriceScale: { borderColor: '#1a1a38' },
      timeScale: { borderColor: '#1a1a38', timeVisible: true },
    });

    let cumPnl = 0;
    const data = [];
    for (const t of trades) {
      if (!t.exitTime) continue;
      cumPnl += t.pnl;
      // Ensure unique timestamps (add small offset if duplicate)
      let ts = t.exitTime;
      while (data.some(d => d.time === ts)) ts++;
      data.push({ time: ts, value: Math.round(cumPnl * 100) / 100 });
    }

    if (!data.length) {
      chart.remove();
      return;
    }

    const finalPnl = data[data.length - 1].value;
    const color = finalPnl >= 0 ? '#00e676' : '#ff1744';

    const areaSeries = chart.addAreaSeries({
      lineColor: color,
      topColor: color + '30',
      bottomColor: '#00000000',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v) => fmtUsd(v) },
    });
    areaSeries.setData(data);
    areaSeries.createPriceLine({
      price: 0,
      color: '#ffffff18',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
    });

    chart.timeScale().fitContent();
    chartRef.current = chart;

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
  }, [trades, height]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
