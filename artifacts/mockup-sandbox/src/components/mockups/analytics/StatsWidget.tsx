import { useEffect, useState } from "react";

function useCountUp(target: number, duration = 1800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setVal(target); clearInterval(timer); }
      else setVal(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return val;
}

function StatCard({
  icon, label, value, suffix = "", prefix = "", sub, color, delay
}: {
  icon: string; label: string; value: number; suffix?: string;
  prefix?: string; sub: string; color: string; delay: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), delay); return () => clearTimeout(t); }, [delay]);
  const count = useCountUp(visible ? value : 0, 1600);

  const fmt = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return n.toLocaleString();
    return n.toString();
  };

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(18px)",
      transition: "opacity 0.5s ease, transform 0.5s ease",
      background: "linear-gradient(145deg,rgba(18,20,29,0.95),rgba(12,14,22,0.95))",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 20,
      padding: "24px 28px",
      position: "relative",
      overflow: "hidden",
      flex: 1,
      minWidth: 0,
    }}>
      {/* top glow */}
      <div style={{
        position: "absolute", top: 0, left: "20%", right: "20%", height: 1,
        background: `linear-gradient(90deg, transparent, ${color}66, transparent)`,
      }} />
      {/* icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 14,
        background: `${color}18`,
        border: `1px solid ${color}33`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, marginBottom: 16,
      }}>
        {icon}
      </div>
      {/* value */}
      <div style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: 32, fontWeight: 800, color: "#f8fafc", lineHeight: 1,
        letterSpacing: "-0.5px", marginBottom: 4,
      }}>
        {prefix}{fmt(count)}{suffix}
      </div>
      <div style={{ fontSize: 13, color: "#64748b", fontWeight: 500, marginBottom: 6 }}>{label}</div>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: `${color}12`, color: color,
        padding: "2px 8px", borderRadius: 20,
        fontSize: 11, fontWeight: 700,
      }}>
        {sub}
      </div>
    </div>
  );
}

export function StatsWidget() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#070810 0%,#0d0f1c 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 32, fontFamily: "Inter, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 960 }}>
        {/* header */}
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)",
            borderRadius: 20, padding: "5px 14px", marginBottom: 14,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e", display: "inline-block" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", letterSpacing: ".06em", textTransform: "uppercase" }}>
              Live Platform Stats
            </span>
          </div>
          <h2 style={{ fontFamily: "'Outfit',sans-serif", fontSize: 28, fontWeight: 800, color: "#f8fafc", margin: 0 }}>
            Trusted by thousands of investors
          </h2>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 8 }}>
            Real-time numbers updated every 24 hours
          </p>
        </div>

        {/* cards row */}
        <div style={{ display: "flex", gap: 16 }}>
          <StatCard icon="👥" label="Total Members" value={4782} sub="↑ 142 this week" color="#3b82f6" delay={0} />
          <StatCard icon="💰" label="Total Paid Out" value={2_430_000} prefix="$" sub="↑ $84K this month" color="#10b981" delay={120} />
          <StatCard icon="📈" label="Active Investors" value={891} sub="↑ 23 today" color="#f59e0b" delay={240} />
          <StatCard icon="⚡" label="Platform Uptime" value={99} suffix="%" sub="✓ Zero downtime" color="#a78bfa" delay={360} />
        </div>

        {/* bottom bar */}
        <div style={{
          marginTop: 24, display: "flex", alignItems: "center", justifyContent: "center", gap: 32,
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14, padding: "14px 28px",
        }}>
          {[
            { label: "Avg. Daily Return", val: "0.85%", color: "#10b981" },
            { label: "Top Earner This Month", val: "$24,180", color: "#f59e0b" },
            { label: "Countries", val: "47", color: "#3b82f6" },
            { label: "Customer Rating", val: "4.9 ★", color: "#a78bfa" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 20, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
