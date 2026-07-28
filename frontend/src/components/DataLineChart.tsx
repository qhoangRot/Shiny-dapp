import { useEffect, useRef, useState } from 'react';

export interface ChartDatum {
  label: string;
  values: number[];
}

export interface ChartSeries {
  label: string;
  color: string;
  dashed?: boolean;
  fill?: boolean;
}

export function DataLineChart({
  data,
  series,
  valueFormatter,
  ariaLabel,
  yMin,
  yMax,
}: {
  data: ChartDatum[];
  series: ChartSeries[];
  valueFormatter: (value: number) => string;
  ariaLabel: string;
  yMin?: number;
  yMax?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const height = 248;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const padding = { top: 18, right: 16, bottom: 34, left: 54 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const allValues = data.flatMap((datum) => datum.values);
    const maxValue = yMax ?? Math.max(1, ...allValues);
    const minValue = yMin ?? Math.min(0, ...allValues);
    const span = Math.max(1, maxValue - minValue);
    const x = (index: number) =>
      padding.left + (data.length <= 1 ? chartWidth / 2 : (index / (data.length - 1)) * chartWidth);
    const y = (value: number) =>
      padding.top + chartHeight - ((value - minValue) / span) * chartHeight;

    context.font = '11px "JetBrains Mono", monospace';
    context.textBaseline = 'middle';
    for (let line = 0; line <= 4; line += 1) {
      const lineY = padding.top + (chartHeight / 4) * line;
      const lineValue = maxValue - (span / 4) * line;
      context.strokeStyle = 'rgba(167, 157, 181, 0.13)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, lineY);
      context.lineTo(width - padding.right, lineY);
      context.stroke();
      context.fillStyle = '#8f859d';
      context.textAlign = 'right';
      context.fillText(valueFormatter(lineValue), padding.left - 9, lineY);
    }

    if (data.length > 0) {
      [0, Math.floor((data.length - 1) / 2), data.length - 1].forEach((index) => {
        context.fillStyle = '#8f859d';
        context.textAlign = index === 0 ? 'left' : index === data.length - 1 ? 'right' : 'center';
        context.fillText(data[index].label, x(index), height - 12);
      });
    }

    series.forEach((item, seriesIndex) => {
      if (data.length === 0) return;
      const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
      gradient.addColorStop(0, `${item.color}35`);
      gradient.addColorStop(1, `${item.color}00`);

      if (item.fill) {
        context.beginPath();
        context.moveTo(x(0), padding.top + chartHeight);
        data.forEach((datum, index) => context.lineTo(x(index), y(datum.values[seriesIndex] ?? 0)));
        context.lineTo(x(data.length - 1), padding.top + chartHeight);
        context.closePath();
        context.fillStyle = gradient;
        context.fill();
      }

      context.beginPath();
      context.setLineDash(item.dashed ? [7, 6] : []);
      context.strokeStyle = item.color;
      context.lineWidth = 2;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      data.forEach((datum, index) => {
        const pointY = y(datum.values[seriesIndex] ?? 0);
        if (index === 0) context.moveTo(x(index), pointY);
        else context.lineTo(x(index), pointY);
      });
      context.stroke();
      context.setLineDash([]);
    });

    if (hoverIndex !== null && data[hoverIndex]) {
      const hoverX = x(hoverIndex);
      context.strokeStyle = 'rgba(244, 242, 247, 0.3)';
      context.beginPath();
      context.moveTo(hoverX, padding.top);
      context.lineTo(hoverX, padding.top + chartHeight);
      context.stroke();
      series.forEach((item, seriesIndex) => {
        context.beginPath();
        context.fillStyle = item.color;
        context.arc(hoverX, y(data[hoverIndex].values[seriesIndex] ?? 0), 4, 0, Math.PI * 2);
        context.fill();
      });
    }
  }, [data, hoverIndex, series, valueFormatter, width, yMax, yMin]);

  const selected = hoverIndex === null ? null : data[hoverIndex];

  return (
    <div className="data-chart" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        aria-label={ariaLabel}
        role="img"
        onMouseMove={(event) => {
          if (data.length === 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const usable = Math.max(1, bounds.width - 70);
          const relative = Math.max(0, Math.min(usable, event.clientX - bounds.left - 54));
          setHoverIndex(Math.round((relative / usable) * (data.length - 1)));
        }}
        onMouseLeave={() => setHoverIndex(null)}
      />
      {selected && (
        <div className="data-chart__tooltip" aria-live="polite">
          <strong>{selected.label}</strong>
          {series.map((item, index) => (
            <span key={item.label}>
              <i style={{ background: item.color }} />
              {item.label}: {valueFormatter(selected.values[index] ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
