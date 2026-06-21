/* ============================================================
   Transaction Detail Modal
   Shared across index.html and wallet.html
   ============================================================ */

(function () {
    const MODAL_ID = 'txDetailModal';

    /* ── Inject modal HTML once ── */
    function injectModal() {
        if (document.getElementById(MODAL_ID)) return;
        const el = document.createElement('div');
        el.innerHTML = `
<div id="${MODAL_ID}" style="display:none;position:fixed;inset:0;z-index:9000;align-items:center;justify-content:center;padding:16px;">
  <div id="txModalBackdrop" style="position:absolute;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);"></div>
  <div id="txModalCard" style="
    position:relative;z-index:1;width:100%;max-width:480px;
    background:linear-gradient(145deg,rgba(18,20,29,0.98),rgba(12,14,22,0.98));
    border:1px solid rgba(255,255,255,0.1);border-radius:24px;
    box-shadow:0 30px 80px rgba(0,0,0,0.7);overflow:hidden;
    animation:txModalIn .25s cubic-bezier(0.34,1.56,0.64,1) both;
    max-height:90vh;overflow-y:auto;
  ">
    <!-- Close -->
    <button id="txModalClose" style="
      position:absolute;top:16px;right:16px;z-index:2;
      width:34px;height:34px;border-radius:50%;
      background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);
      color:#94a3b8;cursor:pointer;font-size:1rem;
      display:flex;align-items:center;justify-content:center;
      transition:all .2s;
    " aria-label="Close">&times;</button>

    <!-- Header band -->
    <div id="txModalHeader" style="padding:28px 28px 20px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div id="txModalIcon" style="width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;"></div>
        <div>
          <div id="txModalType" style="font-family:'Outfit',sans-serif;font-size:1.1rem;font-weight:700;color:#f8fafc;"></div>
          <div id="txModalStatus" style="margin-top:4px;"></div>
        </div>
      </div>
      <!-- Amount -->
      <div id="txModalAmount" style="font-family:'Outfit',sans-serif;font-size:2.4rem;font-weight:900;line-height:1;"></div>
      <div style="color:#64748b;font-size:0.8rem;margin-top:4px;">USDT</div>
    </div>

    <!-- Divider -->
    <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent);margin:0 28px;"></div>

    <!-- Body -->
    <div id="txModalBody" style="padding:20px 28px 28px;display:flex;flex-direction:column;gap:0;"></div>
  </div>
</div>
<style>
@keyframes txModalIn {
  from { opacity:0; transform:scale(0.92) translateY(12px); }
  to   { opacity:1; transform:scale(1)   translateY(0); }
}
#txDetailModal .tx-row {
  display:flex;justify-content:space-between;align-items:flex-start;
  gap:12px;padding:11px 0;
  border-bottom:1px solid rgba(255,255,255,0.05);
}
#txDetailModal .tx-row:last-child { border-bottom:none; }
#txDetailModal .tx-label {
  font-size:0.82rem;color:#64748b;font-weight:500;flex-shrink:0;min-width:130px;
}
#txDetailModal .tx-val {
  font-size:0.88rem;color:#e2e8f0;font-weight:600;text-align:right;word-break:break-all;
}
#txDetailModal .tx-section-title {
  font-size:0.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:#475569;padding:16px 0 6px;
}
#txDetailModal .tx-ref {
  font-family:monospace;color:#60a5fa;font-size:0.82rem;
}
#txModalCard::-webkit-scrollbar { width:4px; }
#txModalCard::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1);border-radius:4px; }
</style>`;
        document.body.appendChild(el.firstElementChild);
        document.body.appendChild(el.lastElementChild); /* style */

        const modal = document.getElementById(MODAL_ID);
        document.getElementById('txModalClose').addEventListener('click', closeModal);
        document.getElementById('txModalBackdrop').addEventListener('click', closeModal);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    }

    function closeModal() {
        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.style.display = 'none';
    }

    function openModal() {
        const modal = document.getElementById(MODAL_ID);
        if (modal) { modal.style.display = 'flex'; }
    }

    /* ── Helpers ── */
    function statusBadge(status) {
        const map = {
            COMPLETED: { color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: 'fa-check-circle', label: 'Completed' },
            PENDING:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: 'fa-clock',        label: 'Pending'   },
            REJECTED:  { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: 'fa-times-circle', label: 'Rejected'  },
        };
        const s = map[status] || map.COMPLETED;
        return `<span style="display:inline-flex;align-items:center;gap:5px;background:${s.bg};color:${s.color};
          padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;border:1px solid ${s.color}33;">
          <i class="fas ${s.icon}" style="font-size:0.7rem;"></i>${s.label}</span>`;
    }

    function typeConfig(type) {
        const map = {
            DEPOSIT:      { label: 'Deposit',           icon: 'fa-arrow-down',     iconBg: 'rgba(16,185,129,0.15)',  iconColor: '#10b981' },
            WITHDRAW:     { label: 'Withdrawal',         icon: 'fa-arrow-up',       iconBg: 'rgba(239,68,68,0.15)',   iconColor: '#ef4444' },
            TRANSFER_IN:  { label: 'Transfer Received',  icon: 'fa-arrow-down-left',iconBg: 'rgba(139,92,246,0.15)', iconColor: '#a78bfa' },
            TRANSFER_OUT: { label: 'Transfer Sent',      icon: 'fa-arrow-up-right', iconBg: 'rgba(99,102,241,0.15)', iconColor: '#818cf8' },
            EARNING:      { label: 'Daily Return',       icon: 'fa-chart-line',     iconBg: 'rgba(245,158,11,0.15)', iconColor: '#f59e0b' },
            VIP_UPGRADE:  { label: 'VIP Upgrade',        icon: 'fa-gem',            iconBg: 'rgba(59,130,246,0.15)', iconColor: '#60a5fa' },
            FEE:          { label: 'Processing Fee',     icon: 'fa-receipt',        iconBg: 'rgba(239,68,68,0.1)',   iconColor: '#f87171' },
        };
        return map[type] || { label: type.replace(/_/g, ' '), icon: 'fa-circle', iconBg: 'rgba(148,163,184,0.1)', iconColor: '#94a3b8' };
    }

    function row(label, value, extra) {
        return `<div class="tx-row">
          <span class="tx-label">${label}</span>
          <span class="tx-val"${extra ? ` style="${extra}"` : ''}>${value}</span>
        </div>`;
    }

    function sectionTitle(t) {
        return `<div class="tx-section-title">${t}</div>`;
    }

    function formatDate(ts) {
        const d = new Date(ts);
        return {
            date: d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }),
            time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
    }

    function parseEarningDetails(details) {
        // "Daily 1% GOLD investment return on $1000.00"
        const m = details && details.match(/Daily\s+(\S+)%\s+(\w+)\s+investment return on \$([0-9,.]+)/i);
        return m ? { rate: m[1], tier: m[2], base: m[3] } : null;
    }

    function parseWithdrawDetails(details) {
        // "To: 0xabc123 (USDT TRC-20)"
        const m = details && details.match(/^To:\s*(.+?)\s*\((.+?)\)$/);
        if (m) return { address: m[1], network: m[2] };
        // fallback: no parens
        const m2 = details && details.match(/^To:\s*(.+)$/);
        return m2 ? { address: m2[1], network: null } : null;
    }

    /* ── Main render function ── */
    function renderModal(tx) {
        const cfg = typeConfig(tx.type);
        const { date, time } = formatDate(tx.created_at);
        const isNeg = ['WITHDRAW', 'TRANSFER_OUT', 'VIP_UPGRADE', 'FEE'].includes(tx.type);
        const amountColor = isNeg ? '#ef4444' : '#10b981';
        const amountPrefix = isNeg ? '-' : '+';
        const amountFmt = parseFloat(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Header
        document.getElementById('txModalIcon').style.cssText += `;background:${cfg.iconBg};color:${cfg.iconColor};width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;`;
        document.getElementById('txModalIcon').innerHTML = `<i class="fas ${cfg.icon}"></i>`;
        document.getElementById('txModalType').textContent = cfg.label;
        document.getElementById('txModalStatus').innerHTML = statusBadge(tx.status || 'COMPLETED');
        document.getElementById('txModalAmount').innerHTML = `<span style="color:${amountColor}">${amountPrefix}$${amountFmt}</span>`;

        // Body
        let html = '';

        // ── Transaction Info ──
        html += sectionTitle('Transaction Info');
        html += row('Reference', `<span class="tx-ref">#TXN-${String(tx.id).padStart(6, '0')}</span>`);
        html += row('Date', date);
        html += row('Time', time);
        html += row('Status', statusBadge(tx.status || 'COMPLETED'));

        // ── Type-specific details ──
        if (tx.type === 'EARNING') {
            const parsed = parseEarningDetails(tx.details);
            html += sectionTitle('Earnings Breakdown');
            if (parsed) {
                const tierColors = { BRONZE: '#cd7f32', SILVER: '#c0c0c0', GOLD: '#f59e0b', PLATINUM: '#e5e4e2', DIAMOND: '#b9f2ff' };
                const tierColor = tierColors[parsed.tier] || '#94a3b8';
                html += row('VIP Tier', `<span style="color:${tierColor};font-weight:700;">${parsed.tier}</span>`);
                html += row('Daily Rate', `<span style="color:#f59e0b;font-weight:700;">${parsed.rate}% per day</span>`);
                html += row('Base Balance', `$${parsed.base} USDT`);
                html += row('Earned Today', `<span style="color:#10b981;font-weight:800;">+$${amountFmt} USDT</span>`);
            } else {
                html += row('Details', tx.details || '—');
            }
            html += row('Compounding', 'Yes — credited to balance');

        } else if (tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') {
            html += sectionTitle('Transfer Details');
            if (tx.counterparty_label && tx.counterparty) {
                const isAdmin = tx.counterparty === 'Administrator';
                const nameDisplay = isAdmin
                    ? `<span style="color:#60a5fa;font-weight:700;"><i class="fas fa-shield-alt" style="margin-right:5px;font-size:0.8em;"></i>Administrator</span>`
                    : `<span style="color:#e2e8f0;">@${tx.counterparty}</span>`;
                html += row(tx.counterparty_label, nameDisplay);
            } else {
                html += row('Details', tx.details || '—');
            }
            if (tx.type === 'TRANSFER_OUT') {
                html += row('Transfer Fee', '$1.00 USDT');
                html += row('Total Deducted', `<span style="color:#ef4444;">-$${(parseFloat(tx.amount) + 1).toLocaleString('en-US', {minimumFractionDigits:2})} USDT</span>`);
            }
            if (tx.type === 'TRANSFER_IN') {
                html += row('Credited To', 'Your wallet balance');
            }

        } else if (tx.type === 'DEPOSIT') {
            html += sectionTitle('Deposit Details');
            if (tx.credited_by === 'Administrator') {
                html += row('Credited By', `<span style="color:#60a5fa;font-weight:700;"><i class="fas fa-shield-alt" style="margin-right:5px;font-size:0.8em;"></i>Administrator</span>`);
                html += row('Method', 'Admin Manual Credit');
            } else if (tx.details && tx.details.startsWith('Via ')) {
                html += row('Network', tx.details.slice(4));
                html += row('Method', 'Crypto Deposit');
            } else {
                html += row('Details', tx.details || '—');
            }
            html += row('Credited To', 'Your wallet balance');

        } else if (tx.type === 'WITHDRAW') {
            const wd = parseWithdrawDetails(tx.details);
            html += sectionTitle('Withdrawal Details');
            if (wd) {
                html += row('Destination', `<span style="font-family:monospace;font-size:0.8rem;word-break:break-all;">${wd.address}</span>`);
                if (wd.network) html += row('Network', wd.network);
            } else if (tx.details) {
                html += row('Details', tx.details);
            }
            html += row('Processing Fee', '$1.00 USDT');
            const statusCopy = (tx.status === 'PENDING') ? 'Awaiting review' : (tx.status === 'COMPLETED' ? 'Sent to wallet' : 'Rejected');
            html += row('Processing', statusCopy);

        } else if (tx.type === 'VIP_UPGRADE') {
            html += sectionTitle('Upgrade Details');
            const tierMatch = tx.details && tx.details.match(/Upgraded to (\w+) VIP rank/i);
            if (tierMatch) {
                const tierColors = { BRONZE: '#cd7f32', SILVER: '#c0c0c0', GOLD: '#f59e0b', PLATINUM: '#e5e4e2', DIAMOND: '#b9f2ff' };
                const tc = tierColors[tierMatch[1]] || '#94a3b8';
                html += row('New Tier', `<span style="color:${tc};font-weight:800;"><i class="fas fa-gem" style="margin-right:5px;"></i>${tierMatch[1]}</span>`);
            } else {
                html += row('Details', tx.details || '—');
            }
            html += row('Cost', `-$${amountFmt} USDT`);

        } else if (tx.type === 'FEE') {
            html += sectionTitle('Fee Details');
            html += row('Description', tx.details || 'Processing fee');

        } else {
            if (tx.details) {
                html += sectionTitle('Details');
                html += row('Info', tx.details);
            }
        }

        document.getElementById('txModalBody').innerHTML = html;
    }

    /* ── Public API ── */
    window.showTxDetail = async function (id) {
        if (!id) return;
        injectModal();

        // Loading state
        document.getElementById('txModalIcon').innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
        document.getElementById('txModalIcon').style.cssText = 'width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;background:rgba(255,255,255,0.05);color:#64748b;';
        document.getElementById('txModalType').textContent = 'Loading…';
        document.getElementById('txModalStatus').innerHTML = '';
        document.getElementById('txModalAmount').innerHTML = '';
        document.getElementById('txModalBody').innerHTML = '';
        openModal();

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/transactions/${id}`, {
                headers: { 'x-auth-token': token || '' },
                credentials: 'include'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const tx = await res.json();
            renderModal(tx);
        } catch (err) {
            document.getElementById('txModalType').textContent = 'Error';
            document.getElementById('txModalBody').innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">Failed to load transaction details.</div>';
        }
    };

    window.closeTxModal = closeModal;

    // Auto-inject on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectModal);
    } else {
        injectModal();
    }
})();
