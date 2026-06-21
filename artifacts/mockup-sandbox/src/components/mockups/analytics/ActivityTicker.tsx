import { useEffect, useState } from "react";

const FEED_ITEMS = [
  { icon: "💎", text: "A member just upgraded to", highlight: "Diamond VIP", time: "just now", color: "#b9f2ff" },
  { icon: "💰", text: "Daily earnings distributed:", highlight: "$1,247.80 paid out", time: "2 min ago", color: "#10b981" },
  { icon: "👥", text: "New investor joined from", highlight: "United Kingdom", time: "4 min ago", color: "#60a5fa" },
  { icon: "🥇", text: "A member upgraded to", highlight: "Gold VIP", time: "7 min ago", color: "#f59e0b" },
  { icon: "📈", text: "Portfolio milestone reached:", highlight: "$100K total deposits", time: "11 min ago", color: "#a78bfa" },
  { icon: "💰", text: "Daily earnings distributed:", highlight: "$983.44 paid out", time: "15 min ago", color: "#10b981" },
  { icon: "🥈", text: "A member upgraded to", highlight: "Silver VIP", time: "22 min ago", color: "#c0c0c0" },
  { icon: "👥", text: "New investor joined from", highlight: "United States", time: "28 min ago", color: "#60a5fa" },
  { icon: "💎", text: "A member joined the", highlight: "Platinum VIP tier", time: "34 min ago", color: "#e5e4e2" },
  { icon: "💰", text: "Daily earnings distributed:", highlight: "$1,104.60 paid out", time: "42 min ago", color: "#10b981" },
  { icon: "🥉", text: "New Bronze VIP member —", highlight: "earning from day 1", time: "51 min ago", color: "#cd7f32" },
  { icon: "👥", text: "New investor joined from", highlight: "Singapore", time: "1 hr ago", color: "#60a5fa" },
];

function FeedRow({ item, index, visible }: {
  item: typeof FEED_ITEMS[0]; index: number; visible: boolean;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setShow(true), index * 80);
    return () => clearTimeout(t);
  }, [visible, index]);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      opacity: show ? 1 : 0, transform: show ? "translateX(0)" : "translateX(-16px)",
      transition: "opacity 0.35s ease, transform 0.35s ease",
    }}>
      {/* icon bubble */}
      <div style={{
        width: 38, height: 38, borderRadius: 12, flexShrink: 0,
        background: `${item.color}15`, border: `1px solid ${item.color}25`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>
        {item.icon}
      </div>

      {/* text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>{item.text} </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.highlight}</span>
      </div>

      {/* time */}
      <div style={{
        fontSize: 11, color: "#475569", flexShrink: 0,
        background: "rgba(255,255,255,0.04)", padding: "3px 8px", borderRadius: 8,
      }}>
        {item.time}
      </div>
    </div>
  );
}

export function ActivityTicker() {
  const [visible, setVisible] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setLiveCount(c => c + Math.floor(Math.random() * 3));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setShowNew(true);
      setTimeout(() => setShowNew(false), 3000);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#070810 0%,#0d0f1c 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 32, fontFamily: "Inter, sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 10,
              background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: 20, padding: "4px 12px",
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: "#10b981",
                boxShadow: "0 0 8px #10b981", display: "inline-block",
                animation: "pulse 2s infinite",
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#10b981", letterSpacing: ".06em", textTransform: "uppercase" }}>
                Live Activity
              </span>
            </div>
            <h3 style={{ fontFamily: "'Outfit',sans-serif", fontSize: 22, fontWeight: 800, color: "#f8fafc", margin: 0 }}>
              Platform Activity Feed
            </h3>
            <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>
              Real-time anonymized activity from our investors
            </p>
          </div>

          {/* live counter */}
          <div style={{
            background: "linear-gradient(145deg,rgba(18,20,29,0.95),rgba(12,14,22,0.95))",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
            padding: "14px 20px", textAlign: "center", minWidth: 130,
          }}>
            <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 28, fontWeight: 900, color: "#10b981" }}>
              {(891 + liveCount).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Active Investors</div>
            <div style={{
              marginTop: 6, fontSize: 10, color: "#10b981",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
              Live
            </div>
          </div>
        </div>

        {/* card */}
        <div style={{
          background: "linear-gradient(145deg,rgba(18,20,29,0.98),rgba(12,14,22,0.98))",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20,
          padding: "8px 24px 4px", position: "relative", overflow: "hidden",
        }}>
          {/* top glow */}
          <div style={{
            position: "absolute", top: 0, left: "20%", right: "20%", height: 1,
            background: "linear-gradient(90deg,transparent,rgba(16,185,129,0.4),transparent)",
          }} />

          {/* new activity toast */}
          <div style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(59,130,246,0.9)", color: "white",
            padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            opacity: showNew ? 1 : 0, transform: showNew ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 0.3s ease, transform 0.3s ease",
            pointerEvents: "none",
          }}>
            ✦ New activity
          </div>

          {/* feed rows */}
          <div>
            {FEED_ITEMS.map((item, i) => (
              <FeedRow key={i} item={item} index={i} visible={visible} />
            ))}
          </div>

          {/* bottom fade */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 60,
            background: "linear-gradient(transparent, rgba(12,14,22,0.95))",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            paddingBottom: 12,
          }}>
            <button style={{
              background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)",
              color: "#60a5fa", padding: "6px 20px", borderRadius: 20,
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              View all activity →
            </button>
          </div>
        </div>

        {/* summary row */}
        <div style={{
          marginTop: 16, display: "flex", gap: 12,
        }}>
          {[
            { label: "Events today", val: "1,284", icon: "📊" },
            { label: "Upgrades this week", val: "47", icon: "🚀" },
            { label: "Total events", val: "92.4K", icon: "📈" },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <div>
                <div style={{ fontFamily: "'Outfit',sans-serif", fontSize: 18, fontWeight: 800, color: "#f8fafc" }}>{s.val}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}
