// ============================================
// Lightweight Canvas Line Chart — chart.js
// No external dependencies. Draws responsive line charts.
// ============================================

class MiniChart {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = opts.data || [];
    this.label = opts.label || '';
    this.unit = opts.unit || '';
    this.lineColor = opts.lineColor || '#2979ff';
    this.fillColor = opts.fillColor || 'rgba(41,121,255,0.08)';
    this.gridColor = opts.gridColor || 'rgba(150,150,150,0.15)';
    this.textColor = opts.textColor || '#888';
    this.dotColor = opts.dotColor || '#2979ff';
    this.warnThreshold = opts.warnThreshold || null;
    this.warnColor = opts.warnColor || '#ff1744';
    this.minY = opts.minY !== undefined ? opts.minY : null;
    this.maxY = opts.maxY !== undefined ? opts.maxY : null;
  }

  setData(data) {
    this.data = data;
    this.draw();
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    // Hidden tabs have no drawable area; redraw when the tab becomes visible.
    if (rect.width <= 0 || rect.height <= 0) return;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    const pad = { top: 24, right: 12, bottom: 30, left: 44 };
    const gW = W - pad.left - pad.right;
    const gH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    if (!this.data.length) {
      ctx.fillStyle = this.textColor;
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }

    const vals = this.data.map(d => d.value);
    let minV = this.minY !== null ? this.minY : Math.min(...vals);
    let maxV = this.maxY !== null ? this.maxY : Math.max(...vals);
    if (minV === maxV) { minV -= 5; maxV += 5; }
    if (this.minY === null && this.maxY === null) {
      const rangeV = maxV - minV;
      const margin = rangeV * 0.1;
      minV -= margin; maxV += margin;
    }

    // Label
    ctx.fillStyle = this.textColor;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.label} (${this.unit})`, pad.left, 14);

    // Horizontal grid lines
    const gridLines = 4;
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (gH * i / gridLines);
      const val = maxV - ((maxV - minV) * i / gridLines);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = this.textColor;
      ctx.fillText(val.toFixed(0), pad.left - 4, y + 3);
    }

    // Warn threshold line
    if (this.warnThreshold != null) {
      const wy = pad.top + gH * (1 - (this.warnThreshold - minV) / (maxV - minV));
      ctx.strokeStyle = this.warnColor;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, wy);
      ctx.lineTo(W - pad.right, wy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Data line
    const xStep = gW / Math.max(this.data.length - 1, 1);
    ctx.beginPath();
    this.data.forEach((d, i) => {
      const x = pad.left + i * xStep;
      const y = pad.top + gH * (1 - (d.value - minV) / (maxV - minV));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = this.lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill
    const lastX = pad.left + (this.data.length - 1) * xStep;
    ctx.lineTo(lastX, pad.top + gH);
    ctx.lineTo(pad.left, pad.top + gH);
    ctx.closePath();
    ctx.fillStyle = this.fillColor;
    ctx.fill();

    // Dots on last 3 pts
    const startDot = Math.max(0, this.data.length - 3);
    for (let i = startDot; i < this.data.length; i++) {
      const x = pad.left + i * xStep;
      const y = pad.top + gH * (1 - (this.data[i].value - minV) / (maxV - minV));
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = this.dotColor;
      ctx.fill();
    }

    // Time labels
    ctx.fillStyle = this.textColor;
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    const labelCount = Math.min(5, this.data.length);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor(i * (this.data.length - 1) / Math.max(labelCount - 1, 1));
      const d = this.data[idx];
      if (d && d.time) {
        const x = pad.left + idx * xStep;
        const date = new Date(d.time);
        let lbl = '';
        if ((this.data[this.data.length - 1].time - this.data[0].time) > 24 * 60 * 60 * 1000) {
            // More than 24h: show Day Month
            lbl = date.getDate() + '/' + (date.getMonth() + 1);
        } else {
            lbl = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
        }
        ctx.fillText(lbl, x, H - 6);
      }
    }
  }
}
