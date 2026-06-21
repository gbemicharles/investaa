import { useEffect, useState, useRef } from "react";

const DATA_POINTS = [
  1000, 1010, 1020.1, 1030.3, 1040.6, 1051, 1061.6, 1072.2, 1082.9, 1093.7,
  1104.7, 1115.7, 1126.9, 1138.1, 1149.5, 1161, 1172.6, 1184.3, 1196.1, 1208,
  1220, 1232.2, 1244.4, 1256.9, 1269.4, 1282, 1294.8, 1307.7, 1320.8, 1334,
];
const LABELS = ["Jun 1","","","","Jun 5","","","","","Jun 10","","","","","Jun 15","","","","","Jun 20","","","","","Jun 25","","","","","Jun 30"];

function toPath(data: number[], w: number, h: number, pad = 40): string {
  const minV = Math.min(...data) * 0.998;
  const maxV = Math.max(...data) * 1.002;
  const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (w - pad * 2));
  const ys = data.map(v => h - pad - ((v - minV) / (maxV - minV)) * (h - pad * 2));
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
}

function toArea(data: number[], w: number, h: number, pad = 40): string {
  const path = toPath(data, w, h, pad);
  const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (w - pad * 2));
  return path + ` L${xs[xs.length - 1].toFixed(1)},${h - pad} L${xs[0].toFixed(1)},${h - pad} Z`;
}

export function GrowthChart() {
  const [progress, setProgress] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; val: number; label: string } | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 820, H = 300, PAD = 40;

  useEffect(() => {
    let p = 0;
    const t = setInterval(() => {
      p += 0.03;
      if (p >= 1) { p = 1; clearInterval(t); }
      setProgress(p);
    }, 16);
    return () => clearInterval(t);
  }, []);

  const visibleData = DATA_POINTS.slice(0, Math.max(2, Math.round(progress * DATA_POINTS.length)));
  const linePath = toPath(visibleData, W, H, PAD);
  const areaPath = toArea(visibleData, W, H, PAD);

  const totalGain = DATA_POINTS[DATA_POINTS.length - 1] - DATA_POINTS[0];
  const pct = ((totalGain / DATA_POINTS[0]) * 100).toFixed(2);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((svgX - PAD) / (W - PAD * 2)) * (DATA_POINTS.length - 1));
    if (idx < 0 || idx >= DATA_POINTS.length) { setTooltip(null); setHoverLine(null); return; }
    const x = PAD + (idx / (DATA_POINTS.length - 1)) * (W - PAD * 2);
    const minV = Math.min(...DATA_POINTS) * 0.998;
    const maxV = Math.max(...DATA_POINTS) * 1.002;
    const y = H - PAD - ((DATA_POINTS[idx] - minV) / (maxV - minV)) * (H - PAD * 2);
    setTooltip({ x, y, val: DATA_POINTS[idx], label: LABELS[idx] || `Day ${idx + 1}` });
    setHoverLine(x);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#070810 0%,#0d0f1c 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 32, fontFamily: "Inter, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 900 }}>
        {/* card */}
        <div style={{
          background: "linear-gradient(145deg,rgba(18,20,29,0.98),rgba(12,14,22,0.98))",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24,
          padding: "28px 32px", position: "relative", overflow: "hidden",
        }}>
          {/* top glow */}
          <div style={{
            position: "absolute", top: 0, left: "15%", right: "15%", height: 1,
            background: "linear-gradient(90deg,transparent,rgba(59,130,246,0.5),transparent)",
          }} />

          {/* header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
                Portfolio Balance — Last 30 Days
              </div>
              <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 38, fontWeight: 900, color: "#f8fafc", lineHeight: 1 }}>
                $1,334.00
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span style={{
                  background: "rgba(16,185,129,0.12)", color: "#10b981",
                  border: "1px solid rgba(16,185,129,0.25)",
                  padding: "3px 10px", borderRadius: 20, fontSize: 13, fontWeight: 700,
                }}>
                  ▲ +{pct}%
                </span>
                <span style={{ color: "#64748b", fontSize: 13 }}>+${totalGain.toFixed(2)} USDT this month</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {["7D", "30D", "90D", "1Y"].map((t, i) => (
                <button key={t} style={{
                  padding: "6px 14px", borderRadius: 10, border: "1px solid",
                  borderColor: i === 1 ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.08)",
                  background: i === 1 ? "rgba(59,130,246,0.15)" : "transparent",
                  color: i === 1 ? "#60a5fa" : "#64748b",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}>{t}</button>
              ))}
            </div>
          </div>

          {/* chart */}
          <div style={{ position: "relative" }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              style={{ width: "100%", height: "auto", overflow: "visible", cursor: "crosshair" }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => { setTooltip(null); setHoverLine(null); }}
            >
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* horizontal grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map(r => {
                const y = PAD + r * (H - PAD * 2);
                const minV = Math.min(...DATA_POINTS) * 0.998;
                const maxV = Math.max(...DATA_POINTS) * 1.002;
                const val = maxV - r * (maxV - minV);
                return (
                  <g key={r}>
                    <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                    <text x={PAD - 8} y={y + 4} textAnchor="end" fill="#475569" fontSize="10">${val.toFixed(0)}</text>
                  </g>
                );
              })}

              {/* x labels */}
              {LABELS.filter(l => l !== "").map((label, i) => {
                const origIdx = LABELS.indexOf(label);
                const x = PAD + (origIdx / (DATA_POINTS.length - 1)) * (W - PAD * 2);
                return (
                  <text key={label} x={x} y={H - 6} textAnchor="middle" fill="#475569" fontSize="10">{label}</text>
                );
              })}

              {/* area fill */}
              <path d={areaPath} fill="url(#areaGrad)" />

              {/* line */}
              <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)" />

              {/* hover line */}
              {hoverLine !== null && (
                <line x1={hoverLine} y1={PAD} x2={hoverLine} y2={H - PAD} stroke="rgba(59,130,246,0.4)" strokeWidth="1" strokeDasharray="4 4" />
              )}

              {/* tooltip dot */}
              {tooltip && (
                <>
                  <circle cx={tooltip.x} cy={tooltip.y} r="5" fill="#3b82f6" stroke="#0d0f1c" strokeWidth="2" />
                  <circle cx={tooltip.x} cy={tooltip.y} r="9" fill="none" stroke="rgba(59,130,246,0.3)" strokeWidth="1.5" />
                  {/* tooltip box */}
                  <g transform={`translate(${Math.min(tooltip.x - 60, W - 140)}, ${tooltip.y - 52})`}>
                    <rect width="120" height="42" rx="8" fill="rgba(15,17,28,0.95)" stroke="rgba(59,130,246,0.4)" strokeWidth="1" />
                    <text x="10" y="16" fill="#94a3b8" fontSize="10">{tooltip.label}</text>
                    <text x="10" y="32" fill="#f8fafc" fontSize="14" fontWeight="700">${tooltip.val.toFixed(2)}</text>
                  </g>
                </>
              )}

              {/* end dot */}
              {progress >= 1 && (() => {
                const minV = Math.min(...DATA_POINTS) * 0.998;
                const maxV = Math.max(...DATA_POINTS) * 1.002;
                const lastX = W - PAD;
                const lastY = H - PAD - ((DATA_POINTS[DATA_POINTS.length-1] - minV) / (maxV - minV)) * (H - PAD * 2);
                return <circle cx={lastX} cy={lastY} r="4" fill="#10b981" stroke="#0d0f1c" strokeWidth="2" />;
              })()}
            </svg>
          </div>

          {/* bottom stats row */}
          <div style={{ display: "flex", gap: 0, borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 20, paddingTop: 20 }}>
            {[
              { label: "Starting Balance", val: "$1,000.00", color: "#94a3b8" },
              { label: "Total Earned", val: `+$${totalGain.toFixed(2)}`, color: "#10b981" },
              { label: "Daily Rate (GOLD)", val: "1.0% / day", color: "#f59e0b" },
              { label: "Days Active", val: "30", color: "#60a5fa" },
            ].map((s, i) => (
              <div key={s.label} style={{ flex: 1, textAlign: "center", borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", padding: "0 16px" }}>
                <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 18, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
