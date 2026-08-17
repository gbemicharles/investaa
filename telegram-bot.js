const https = require('https');
const bcrypt = require('bcryptjs');
const Telegram = require('./telegram');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID).trim() : null;

function apiCall(method, params = {}) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN) return resolve({ ok: false, error: 'Token not set' });
        const body = JSON.stringify(params);
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: 'Parse error' }); }
            });
        });
        req.on('error', (e) => {
            console.error(`[TELEGRAM-BOT] API ${method} error:`, e.message);
            resolve({ ok: false, error: e.message });
        });
        req.write(body);
        req.end();
    });
}

let offset = 0;

function startTelegramPolling(dbGet, dbRun, dbAll, sendUserEmail, Emails, applyDailyEarnings) {
    if (!BOT_TOKEN) {
        console.warn('[TELEGRAM-BOT] Token not configured — skipping interactive polling.');
        return;
    }
    if (process.env.BOT_POLLING_ENABLED === 'false' || process.env.TELEGRAM_POLLING_ENABLED === 'false') {
        console.log('[TELEGRAM-BOT] Polling explicitly disabled via environment configuration.');
        return;
    }

    // Helper: Verify if request comes from authorized Admin Chat
    function isAuthorized(chatId) {
        if (!ADMIN_CHAT_ID) return true;
        return String(chatId).trim() === ADMIN_CHAT_ID;
    }

    console.log('[TELEGRAM-BOT] Starting Long Polling interactive Admin Board listener...');

    // ════════════════════════════════════════════
    //  REGISTER NATIVE TELEGRAM MENU BUTTON COMMANDS
    // ════════════════════════════════════════════
    async function registerBotCommands() {
        try {
            const commands = [
                { command: 'admin', description: '🎛️ Open Admin Control Board' },
                { command: 'stats', description: '📊 System Financial Metrics' },
                { command: 'loans', description: '🏦 Review Pending Loan Applications' },
                { command: 'vips', description: '🏆 VIP Member Breakdown & List' },
                { command: 'triggerearnings', description: '⚡ Trigger Daily VIP Compound Return' },
                { command: 'deposits', description: '📥 Review Pending Deposits Queue' },
                { command: 'withdrawals', description: '📤 Review Pending Withdrawals Queue' },
                { command: 'kyc', description: '🪪 Review Pending Identity Submissions' },
                { command: 'users', description: '👥 Member Account Directory' },
                { command: 'user', description: '👤 Inspect User Account (/user username)' },
                { command: 'fund', description: '💵 Credit User Balance (/fund username amount)' },
                { command: 'ban', description: '🚫 Ban User Account (/ban username)' },
                { command: 'unban', description: '✅ Unban User Account (/unban username)' },
                { command: 'resetpw', description: '🔑 Reset Password (/resetpw username pass)' },
                { command: 'help', description: '🛠️ Admin Commands Cheatsheet' }
            ];

            const res = await apiCall('setMyCommands', { commands });
            if (res && res.ok) {
                console.log('[TELEGRAM-BOT] Native Telegram Bot Menu commands registered successfully!');
            } else {
                console.warn('[TELEGRAM-BOT] setMyCommands returned:', res);
            }
        } catch (e) {
            console.error('[TELEGRAM-BOT] Error registering bot menu commands:', e.message);
        }
    }

    // Execute menu registration on startup
    registerBotCommands();

    // ════════════════════════════════════════════
    //  VIP METRICS CALCULATOR HELPER
    // ════════════════════════════════════════════
    async function getVipMetrics() {
        const counts = { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0, DIAMOND: 0, REGULAR: 0 };
        const balances = { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0, DIAMOND: 0, REGULAR: 0 };

        try {
            const rows = await dbAll("SELECT vip_rank, COUNT(*) as count, COALESCE(SUM(balance), 0) as total_bal FROM users GROUP BY vip_rank");
            if (Array.isArray(rows)) {
                rows.forEach(r => {
                    const rank = (r.vip_rank || 'REGULAR').toUpperCase();
                    if (counts[rank] !== undefined) {
                        counts[rank] = parseInt(r.count || 0);
                        balances[rank] = parseFloat(r.total_bal || 0);
                    }
                });
            }
        } catch (e) {
            console.error('[TELEGRAM-BOT] getVipMetrics error:', e.message);
        }

        const totalVips = counts.BRONZE + counts.SILVER + counts.GOLD + counts.PLATINUM + counts.DIAMOND;
        const totalVipBalance = balances.BRONZE + balances.SILVER + balances.GOLD + balances.PLATINUM + balances.DIAMOND;

        return { counts, balances, totalVips, totalVipBalance };
    }

    // ════════════════════════════════════════════
    //  ADMIN BOARD UI GENERATORS
    // ════════════════════════════════════════════

    async function getAdminMenuKeyboard() {
        return {
            inline_keyboard: [
                [
                    { text: '📊 System Overview', callback_data: 'admin_overview' },
                    { text: '🏆 VIP Directory', callback_data: 'admin_vips' }
                ],
                [
                    { text: '👥 All Users', callback_data: 'admin_users' },
                    { text: '📥 Deposits Queue', callback_data: 'admin_pending_deposits' }
                ],
                [
                    { text: '📤 Withdrawals Queue', callback_data: 'admin_pending_withdrawals' },
                    { text: '🏦 Pending Loans', callback_data: 'admin_pending_loans' }
                ],
                [
                    { text: '🪪 Pending KYC', callback_data: 'admin_pending_kyc' },
                    { text: '⚡ Run Daily Earnings', callback_data: 'admin_run_earnings' }
                ],
                [
                    { text: '🔄 Refresh Board', callback_data: 'admin_menu' }
                ]
            ]
        };
    }

    async function generateAdminDashboardText() {
        try {
            const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
            const totalBal = await dbGet('SELECT COALESCE(SUM(balance), 0) as sum FROM users');
            const loanPending = await dbGet("SELECT COUNT(*) as count FROM loan_applications WHERE status = 'PENDING'").catch(() => ({ count: 0 }));

            return [
                `🎛️ <b>INVESTAA TELEGRAM ADMIN BOARD</b>`,
                `━━━━━━━━━━━━━━━━━━━━━━`,
                `Welcome, Admin! Select an option below to manage the platform in real time.`,
                ``,
                `📊 <b>System Financial Metrics:</b>`,
                `• 👥 <b>Total Members:</b> ${userCount?.count || 0}`,
                `• 💰 <b>Total Active Balances:</b> $${parseFloat(totalBal?.sum || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT`,
                ``,
                `🏆 <b>VIP Tier Breakdown (Bronze to Diamond):</b>`,
                `• 🥉 <b>Bronze VIP (0.5%/d):</b> ${vip.counts.BRONZE} member${vip.counts.BRONZE !== 1 ? 's' : ''}`,
                `• 🥈 <b>Silver VIP (0.75%/d):</b> ${vip.counts.SILVER} member${vip.counts.SILVER !== 1 ? 's' : ''}`,
                `• 🥇 <b>Gold VIP (1.0%/d):</b> ${vip.counts.GOLD} member${vip.counts.GOLD !== 1 ? 's' : ''}`,
                `• 💎 <b>Platinum VIP (1.5%/d):</b> ${vip.counts.PLATINUM} member${vip.counts.PLATINUM !== 1 ? 's' : ''}`,
                `• 👑 <b>Diamond VIP (2.0%/d):</b> ${vip.counts.DIAMOND} member${vip.counts.DIAMOND !== 1 ? 's' : ''}`,
                `• 🌟 <b>Total Active VIP Members:</b> ${vip.totalVips} ($${vip.totalVipBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT)`,
                `• ⚪ <b>Regular (Free Tier):</b> ${vip.counts.REGULAR} member${vip.counts.REGULAR !== 1 ? 's' : ''}`,
                ``,
                `⏳ <b>Action Queues:</b>`,
                `• 📥 <b>Pending Deposits:</b> ${depPending?.count || 0}`,
                `• 📤 <b>Pending Withdrawals:</b> ${withPending?.count || 0}`,
                `• 🏦 <b>Pending Loans:</b> ${loanPending?.count || 0}`,
                `• 🪪 <b>Pending KYC:</b> ${kycPending?.count || 0}`,
                ``,
                `🛠️ <i>Tap the [/] Menu button next to your input bar for instant commands.</i>`
            ].join('\n');
        } catch (err) {
            console.error('[TELEGRAM-BOT] Dashboard text error:', err.message);
            return '🎛️ <b>InvestAA Admin Control Board</b>\n\nTap buttons below to navigate:';
        }
    }

    async function sendAdminDashboard(chatId) {
        const text = await generateAdminDashboardText();
        const keyboard = await getAdminMenuKeyboard();
        await apiCall('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }

    async function handleTriggerEarnings(chatId) {
        try {
            if (typeof applyDailyEarnings === 'function') {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '⚡ <b>Triggering Daily Compound Earnings & Statement Dispatch...</b>',
                    parse_mode: 'HTML'
                });
                await applyDailyEarnings();
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '✅ <b>Daily Earnings Cycle Executed!</b>\n\nVIP returns have been calculated, credited to user balances, and daily statement emails dispatched.',
                    parse_mode: 'HTML'
                });
            } else {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '❌ Earnings scheduler function is not attached.',
                    parse_mode: 'HTML'
                });
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] handleTriggerEarnings error:', err.message);
            await apiCall('sendMessage', {
                chat_id: chatId,
                text: `❌ Error triggering earnings: ${err.message}`,
                parse_mode: 'HTML'
            });
        }
    }

    async function sendSystemOverview(chatId, messageId = null) {
        try {
            const users = await dbGet('SELECT COUNT(*) as count FROM users');
            const balanceSum = await dbGet('SELECT COALESCE(SUM(balance), 0) as sum FROM users');
            const depositSum = await dbGet("SELECT COALESCE(SUM(amount), 0) as sum FROM deposits WHERE status = 'APPROVED'");
            const withdrawSum = await dbGet("SELECT COALESCE(SUM(amount), 0) as sum FROM withdrawals WHERE status = 'APPROVED'");
            const kycApproved = await dbGet("SELECT COUNT(*) as count FROM users WHERE kyc_status = 'APPROVED'");
            
            const depPending = await dbGet("SELECT COUNT(*) as count FROM deposits WHERE status = 'PENDING'");
            const withPending = await dbGet("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'PENDING'");
            const kycPending = await dbGet("SELECT COUNT(*) as count FROM kyc_submissions WHERE status = 'PENDING'");

            const vip = await getVipMetrics();

            const text = [
                `📊 <b>DETAILED SYSTEM OVERVIEW</b>`,
                `━━━━━━━━━━━━━━━━━━━━━━`,
                `👥 <b>Total Accounts:</b> ${users?.count || 0}`,
                `🪪 <b>KYC Verified Users:</b> ${kycApproved?.count || 0}`,
                ``,
                `💵 <b>Total Member Balances:</b> $${parseFloat(balanceSum?.sum || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT`,
                `📥 <b>Total Approved Deposits:</b> $${parseFloat(depositSum?.sum || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT`,
                `📤 <b>Total Approved Withdrawals:</b> $${parseFloat(withdrawSum?.sum || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT`,
                ``,
                `🏆 <b>VIP Rank Breakdown:</b>`,
                `• 🥉 <b>Bronze VIP (0.5%/d):</b> ${vip.counts.BRONZE} ($${vip.balances.BRONZE.toFixed(2)})`,
                `• 🥈 <b>Silver VIP (0.75%/d):</b> ${vip.counts.SILVER} ($${vip.balances.SILVER.toFixed(2)})`,
                `• 🥇 <b>Gold VIP (1.0%/d):</b> ${vip.counts.GOLD} ($${vip.balances.GOLD.toFixed(2)})`,
                `• 💎 <b>Platinum VIP (1.5%/d):</b> ${vip.counts.PLATINUM} ($${vip.balances.PLATINUM.toFixed(2)})`,
                `• 👑 <b>Diamond VIP (2.0%/d):</b> ${vip.counts.DIAMOND} ($${vip.balances.DIAMOND.toFixed(2)})`,
                `• 🌟 <b>Total Active VIPs:</b> ${vip.totalVips} ($${vip.totalVipBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
                `• ⚪ <b>Regular (Free):</b> ${vip.counts.REGULAR} ($${vip.balances.REGULAR.toFixed(2)})`,
                ``,
                `⏳ <b>Current Pending Queues:</b>`,
                `• Deposits: ${depPending?.count || 0}`,
                `• Withdrawals: ${withPending?.count || 0}`,
                `• KYC Submissions: ${kycPending?.count || 0}`,
                `━━━━━━━━━━━━━━━━━━━━━━`,
                `📅 <i>Updated: ${new Date().toLocaleString()}</i>`
            ].join('\n');

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🏆 VIP Directory', callback_data: 'admin_vips' },
                        { text: '⚡ Run Earnings', callback_data: 'admin_run_earnings' }
                    ],
                    [
                        { text: '🔄 Refresh Stats', callback_data: 'admin_overview' },
                        { text: '🔙 Main Board', callback_data: 'admin_menu' }
                    ]
                ]
            };

            if (messageId) {
                await apiCall('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            } else {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendSystemOverview error:', err.message);
        }
    }

    async function sendVipDirectory(chatId) {
        try {
            const vips = await dbAll("SELECT id, username, email, balance, deposit_balance, vip_rank, last_earning_at FROM users WHERE vip_rank != 'REGULAR' ORDER BY balance DESC");
            if (!vips || vips.length === 0) {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '🏆 <b>VIP Member Directory</b>\n\nThere are currently no users upgraded to VIP rank.',
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Main Board', callback_data: 'admin_menu' }]] }
                });
                return;
            }

            const EMOJI = { BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💎', DIAMOND: '👑' };
            const lines = [`🏆 <b>ACTIVE VIP MEMBER DIRECTORY (${vips.length})</b>`, '━━━━━━━━━━━━━━━━━━━━━━'];

            vips.forEach(u => {
                const emoji = EMOJI[u.vip_rank] || '🏆';
                const bal = parseFloat(u.balance || 0).toFixed(2);
                const dep = parseFloat(u.deposit_balance || 0).toFixed(2);
                lines.push(`${emoji} <b>#${u.id}</b> | <code>${u.username}</code> | <b>${u.vip_rank}</b>\n   💵 Bal: $${bal} USDT | Dep: $${dep} USDT`);
            });

            lines.push('\n💡 <i>Send <code>/user &lt;username&gt;</code> to manage any VIP account.</i>');

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔙 Main Board', callback_data: 'admin_menu' }
                    ]
                ]
            };

            await apiCall('sendMessage', {
                chat_id: chatId,
                text: lines.join('\n'),
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendVipDirectory error:', err.message);
        }
    }

    async function sendPendingDeposits(chatId) {
        try {
            const deposits = await dbAll(`SELECT d.*, u.username, u.email FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = 'PENDING' ORDER BY d.created_at DESC LIMIT 10`);
            if (!deposits || deposits.length === 0) {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '📥 <b>Pending Deposits Queue</b>\n\n✅ There are currently no pending deposit requests.',
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Main Board', callback_data: 'admin_menu' }]] }
                });
                return;
            }

            await apiCall('sendMessage', {
                chat_id: chatId,
                text: `📥 <b>Found ${deposits.length} Pending Deposit(s):</b>`,
                parse_mode: 'HTML'
            });

            for (const d of deposits) {
                const amt = parseFloat(d.usdt_amount || d.amount);
                const text = [
                    `📥 <b>DEPOSIT #${d.id}</b>`,
                    `👤 <b>User:</b> ${d.username} (${d.email})`,
                    `💵 <b>Amount:</b> $${amt.toFixed(2)} USDT`,
                    `🌐 <b>Network:</b> ${d.network || 'USDT'}`,
                    d.txid ? `🔗 <b>TxID:</b> <code>${d.txid}</code>` : null,
                    `📅 <b>Date:</b> ${new Date(d.created_at).toLocaleString()}`
                ].filter(Boolean).join('\n');

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: 'Approve ✅', callback_data: `dep_approve:${d.id}` },
                            { text: 'Reject ❌', callback_data: `dep_reject:${d.id}` }
                        ]
                    ]
                };

                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendPendingDeposits error:', err.message);
        }
    }

    async function sendPendingWithdrawals(chatId) {
        try {
            const withdrawals = await dbAll(`SELECT w.*, u.username, u.email FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.status = 'PENDING' ORDER BY w.created_at DESC LIMIT 10`);
            if (!withdrawals || withdrawals.length === 0) {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '📤 <b>Pending Withdrawals Queue</b>\n\n✅ There are currently no pending withdrawal requests.',
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Main Board', callback_data: 'admin_menu' }]] }
                });
                return;
            }

            await apiCall('sendMessage', {
                chat_id: chatId,
                text: `📤 <b>Found ${withdrawals.length} Pending Withdrawal(s):</b>`,
                parse_mode: 'HTML'
            });

            for (const w of withdrawals) {
                const amt = parseFloat(w.amount);
                const text = [
                    `📤 <b>WITHDRAWAL #${w.id}</b>`,
                    `👤 <b>User:</b> ${w.username} (${w.email})`,
                    `💵 <b>Gross Amount:</b> $${amt.toFixed(2)} USDT`,
                    `💵 <b>Net (After $1 Fee):</b> $${(amt - 1).toFixed(2)} USDT`,
                    w.details ? `📋 <b>Destination Address:</b>\n<code>${w.details}</code>` : null,
                    `📅 <b>Date:</b> ${new Date(w.created_at).toLocaleString()}`
                ].filter(Boolean).join('\n');

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: 'Approve ✅', callback_data: `with_approve:${w.id}` },
                            { text: 'Reject ❌', callback_data: `with_reject:${w.id}` }
                        ]
                    ]
                };

                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendPendingWithdrawals error:', err.message);
        }
    }

    async function sendPendingKyc(chatId) {
        try {
            const kycList = await dbAll(`SELECT k.*, u.username, u.email FROM kyc_submissions k JOIN users u ON k.user_id = u.id WHERE k.status = 'PENDING' ORDER BY k.submitted_at DESC LIMIT 10`);
            if (!kycList || kycList.length === 0) {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '🪪 <b>Pending KYC Queue</b>\n\n✅ There are currently no pending identity verification requests.',
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Main Board', callback_data: 'admin_menu' }]] }
                });
                return;
            }

            await apiCall('sendMessage', {
                chat_id: chatId,
                text: `🪪 <b>Found ${kycList.length} Pending KYC Submission(s):</b>`,
                parse_mode: 'HTML'
            });

            for (const k of kycList) {
                const text = [
                    `🪪 <b>KYC SUBMISSION #${k.id}</b>`,
                    `👤 <b>User:</b> ${k.username} (${k.email})`,
                    `🌍 <b>Country:</b> ${k.country}`,
                    `🪪 <b>ID Type:</b> ${k.id_type}`,
                    `🔢 <b>ID Number:</b> <code>${k.id_number}</code>`,
                    `📅 <b>Date:</b> ${new Date(k.submitted_at).toLocaleString()}`
                ].join('\n');

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: 'Approve ✅', callback_data: `kyc_approve:${k.id}` },
                            { text: 'Reject ❌', callback_data: `kyc_reject:${k.id}` }
                        ]
                    ]
                };

                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendPendingKyc error:', err.message);
        }
    }

    async function sendPendingLoans(chatId) {
        try {
            const loans = await dbAll(`SELECT * FROM loan_applications WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 10`);
            if (!loans || loans.length === 0) {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '🏦 <b>Pending Loans Queue</b>\n\n✅ There are currently no pending credit/loan applications.',
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Main Board', callback_data: 'admin_menu' }]] }
                });
                return;
            }

            await apiCall('sendMessage', {
                chat_id: chatId,
                text: `🏦 <b>Found ${loans.length} Pending Loan Application(s):</b>`,
                parse_mode: 'HTML'
            });

            for (const l of loans) {
                const amt = parseFloat(l.loan_amount);
                const text = [
                    `🏦 <b>LOAN APPLICATION #${l.id} (${l.app_code})</b>`,
                    `👤 <b>Applicant:</b> ${l.full_name}`,
                    `📧 <b>Email:</b> ${l.email}`,
                    `📞 <b>Phone:</b> ${l.phone || 'N/A'}`,
                    `💵 <b>Requested:</b> <b>$${amt.toLocaleString()} USD</b>`,
                    `🎯 <b>Purpose:</b> ${l.loan_purpose} (${l.loan_term} mos)`,
                    `🏢 <b>Employment:</b> ${l.employment_status} ($${parseFloat(l.monthly_income || 0).toLocaleString()}/mo)`,
                    `🏦 <b>Bank:</b> ${l.bank_name} (${l.account_type})`,
                    `🔢 <b>Routing/Acct:</b> <code>${l.routing_number}</code> / <code>${l.account_number}</code>`,
                    l.business_txid ? `🔗 <b>Business TxID:</b> <code>${l.business_txid}</code>` : null,
                    `📅 <b>Date:</b> ${new Date(l.created_at).toLocaleString()}`
                ].filter(Boolean).join('\n');

                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: 'Approve Loan ✅', callback_data: `loan_approve:${l.id}` },
                            { text: 'Reject Loan ❌', callback_data: `loan_reject:${l.id}` }
                        ]
                    ]
                };

                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendPendingLoans error:', err.message);
        }
    }

    async function sendUserDirectory(chatId) {
        try {
            const users = await dbAll(`SELECT id, username, email, balance, vip_rank, is_banned FROM users ORDER BY created_at DESC LIMIT 8`);
            if (!users || users.length === 0) {
                await apiCall('sendMessage', { chat_id: chatId, text: 'No users found.', parse_mode: 'HTML' });
                return;
            }

            const lines = ['👥 <b>RECENT USER DIRECTORY</b>', '━━━━━━━━━━━━━━━━━━━━━━'];
            users.forEach(u => {
                const bal = parseFloat(u.balance || 0).toFixed(2);
                const status = u.is_banned ? '🚫 BANNED' : u.vip_rank;
                lines.push(`• <b>#${u.id}</b> | <code>${u.username}</code> | $${bal} | ${status}`);
            });
            lines.push('\n💡 <i>Send <code>/user &lt;username&gt;</code> to inspect or manage any user account.</i>');

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '🔙 Main Board', callback_data: 'admin_menu' }
                    ]
                ]
            };

            await apiCall('sendMessage', {
                chat_id: chatId,
                text: lines.join('\n'),
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } catch (err) {
            console.error('[TELEGRAM-BOT] sendUserDirectory error:', err.message);
        }
    }

    async function inspectUser(chatId, query) {
        try {
            const user = await dbGet(
                'SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?',
                [query, query, parseInt(query) || 0]
            );

            if (!user) {
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: `❌ User <code>${query}</code> not found in database.`,
                    parse_mode: 'HTML'
                });
                return;
            }

            const bal = parseFloat(user.balance || 0).toFixed(2);
            const depBal = parseFloat(user.deposit_balance || 0).toFixed(2);
            const bonusBal = parseFloat(user.bonus_balance || 0).toFixed(2);
            const statusStr = user.is_banned ? '🚫 BANNED' : '✅ Active';
            const kycStr = user.kyc_status || 'NONE';

            const text = [
                `👤 <b>USER PROFILE: #${user.id}</b>`,
                `━━━━━━━━━━━━━━━━━━━━━━`,
                `• <b>Username:</b> <code>${user.username}</code>`,
                `• <b>Email:</b> ${user.email}`,
                `• <b>Phone:</b> ${user.phone || 'N/A'}`,
                `• <b>Country:</b> ${user.country || 'N/A'}`,
                ``,
                `💰 <b>Balance Breakdown:</b>`,
                `• <b>Active Balance:</b> $${bal} USDT`,
                `• <b>Deposit Balance:</b> $${depBal} USDT`,
                `• <b>Bonus Balance:</b> $${bonusBal} USDT`,
                ``,
                `🏅 <b>VIP Rank:</b> ${user.vip_rank}`,
                `🪪 <b>KYC Status:</b> ${kycStr}`,
                `🛡️ <b>Account Status:</b> ${statusStr}`,
                `📅 <b>Joined:</b> ${new Date(user.created_at).toLocaleString()}`,
                `━━━━━━━━━━━━━━━━━━━━━━`
            ].join('\n');

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: `💵 Fund Account`, callback_data: `admin_fund_prompt:${user.id}` },
                        user.is_banned 
                            ? { text: `✅ Unban User`, callback_data: `admin_unban:${user.id}` }
                            : { text: `🚫 Ban User`, callback_data: `admin_ban:${user.id}` }
                    ],
                    [
                        { text: '🔙 Main Board', callback_data: 'admin_menu' }
                    ]
                ]
            };

            await apiCall('sendMessage', {
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } catch (err) {
            console.error('[TELEGRAM-BOT] inspectUser error:', err.message);
        }
    }

    // ════════════════════════════════════════════
    //  TELEGRAM UPDATE PROCESSOR
    // ════════════════════════════════════════════

    async function processUpdate(update) {
        // ──────────────── 1. TEXT COMMANDS ────────────────
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id;
            if (!isAuthorized(chatId)) {
                console.warn(`[TELEGRAM-BOT] Unauthorized text command attempt from chatId ${chatId}`);
                return;
            }

            const text = update.message.text.trim();
            const parts = text.split(/\s+/);
            const cmd = parts[0].toLowerCase();

            // /loans
            if (cmd === '/loans') {
                await sendPendingLoans(chatId);
                return;
            }

            // /vips, /vip
            if (cmd === '/vips' || cmd === '/vip') {
                await sendVipDirectory(chatId);
                return;
            }

            // /triggerearnings, /runearnings
            if (cmd === '/triggerearnings' || cmd === '/runearnings') {
                await handleTriggerEarnings(chatId);
                return;
            }

            // /setupmenu, /setmenu
            if (cmd === '/setupmenu' || cmd === '/setmenu') {
                await registerBotCommands();
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: '✅ <b>Telegram Bot Menu Button Registered!</b>\n\nTap the <code>[/]</code> Menu button next to your chat input field to see all admin commands.',
                    parse_mode: 'HTML'
                });
                return;
            }

            // /admin, /start, /menu, /dashboard, /board
            if (cmd === '/admin' || cmd === '/start' || cmd === '/menu' || cmd === '/dashboard' || cmd === '/board') {
                await sendAdminDashboard(chatId);
                return;
            }

            // /stats, /overview
            if (cmd === '/stats' || cmd === '/overview') {
                await sendSystemOverview(chatId);
                return;
            }

            // /deposits
            if (cmd === '/deposits') {
                await sendPendingDeposits(chatId);
                return;
            }

            // /withdrawals
            if (cmd === '/withdrawals') {
                await sendPendingWithdrawals(chatId);
                return;
            }

            // /kyc
            if (cmd === '/kyc') {
                await sendPendingKyc(chatId);
                return;
            }

            // /users
            if (cmd === '/users') {
                await sendUserDirectory(chatId);
                return;
            }

            // /user <username_or_email_or_id>
            if (cmd === '/user') {
                if (parts.length < 2) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '💡 Usage: <code>/user &lt;username_or_email_or_id&gt;</code>', parse_mode: 'HTML' });
                    return;
                }
                await inspectUser(chatId, parts[1]);
                return;
            }

            // /fund <user> <amount>
            if (cmd === '/fund') {
                if (parts.length < 3) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '💡 Usage: <code>/fund &lt;username_or_id&gt; &lt;amount&gt;</code>\nExample: <code>/fund john 500</code>', parse_mode: 'HTML' });
                    return;
                }
                const targetQuery = parts[1];
                const amt = parseFloat(parts[2]);
                if (!amt || amt <= 0) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '❌ Please specify a valid dollar amount to credit.', parse_mode: 'HTML' });
                    return;
                }

                try {
                    const user = await dbGet(
                        'SELECT id, username, email, balance FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?',
                        [targetQuery, targetQuery, parseInt(targetQuery) || 0]
                    );

                    if (!user) {
                        await apiCall('sendMessage', { chat_id: chatId, text: `❌ User <code>${targetQuery}</code> not found.`, parse_mode: 'HTML' });
                        return;
                    }

                    await dbRun('UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ? WHERE id = ?', [amt, amt, user.id]);
                    await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [user.id, 'DEPOSIT', amt, 'Admin Credit', 'COMPLETED']);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [user.id, 'Account Funded', `Your account has been credited with $${amt.toFixed(2)} USDT by admin.`, 'SYSTEM', 'SUCCESS']);

                    if (typeof sendUserEmail === 'function' && Emails) {
                        sendUserEmail(user.id, () => Emails.accountFunded(user.email, user.username, amt)).catch(() => {});
                    }

                    const newBal = parseFloat(user.balance || 0) + amt;
                    await apiCall('sendMessage', {
                        chat_id: chatId,
                        text: `✅ <b>ACCOUNT FUNDED SUCCESSFULLY</b>\n\n👤 <b>User:</b> ${user.username} (${user.email})\n💵 <b>Amount Credited:</b> $${amt.toFixed(2)} USDT\n📈 <b>New Active Balance:</b> $${newBal.toFixed(2)} USDT`,
                        parse_mode: 'HTML'
                    });
                } catch (fundErr) {
                    console.error('[TELEGRAM-BOT] Fund error:', fundErr.message);
                    await apiCall('sendMessage', { chat_id: chatId, text: `❌ Failed to fund account: ${fundErr.message}`, parse_mode: 'HTML' });
                }
                return;
            }

            // /ban <user>
            if (cmd === '/ban') {
                if (parts.length < 2) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '💡 Usage: <code>/ban &lt;username_or_id&gt;</code>', parse_mode: 'HTML' });
                    return;
                }
                const targetQuery = parts[1];
                try {
                    const user = await dbGet('SELECT id, username, is_admin FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?', [targetQuery, targetQuery, parseInt(targetQuery) || 0]);
                    if (!user) {
                        await apiCall('sendMessage', { chat_id: chatId, text: `❌ User <code>${targetQuery}</code> not found.`, parse_mode: 'HTML' });
                        return;
                    }
                    if (user.is_admin === 1) {
                        await apiCall('sendMessage', { chat_id: chatId, text: `⛔ Cannot ban an admin account.`, parse_mode: 'HTML' });
                        return;
                    }
                    await dbRun('UPDATE users SET is_banned = 1 WHERE id = ?', [user.id]);
                    await apiCall('sendMessage', { chat_id: chatId, text: `🚫 <b>User Banned:</b> <code>${user.username}</code> has been restricted from platform access.`, parse_mode: 'HTML' });
                } catch (e) {
                    await apiCall('sendMessage', { chat_id: chatId, text: `❌ Error banning user.`, parse_mode: 'HTML' });
                }
                return;
            }

            // /unban <user>
            if (cmd === '/unban') {
                if (parts.length < 2) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '💡 Usage: <code>/unban &lt;username_or_id&gt;</code>', parse_mode: 'HTML' });
                    return;
                }
                const targetQuery = parts[1];
                try {
                    const user = await dbGet('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?', [targetQuery, targetQuery, parseInt(targetQuery) || 0]);
                    if (!user) {
                        await apiCall('sendMessage', { chat_id: chatId, text: `❌ User <code>${targetQuery}</code> not found.`, parse_mode: 'HTML' });
                        return;
                    }
                    await dbRun('UPDATE users SET is_banned = 0 WHERE id = ?', [user.id]);
                    await apiCall('sendMessage', { chat_id: chatId, text: `✅ <b>User Unbanned:</b> <code>${user.username}</code> account status restored.`, parse_mode: 'HTML' });
                } catch (e) {
                    await apiCall('sendMessage', { chat_id: chatId, text: `❌ Error unbanning user.`, parse_mode: 'HTML' });
                }
                return;
            }

            // /resetpw <user> <newpassword>
            if (cmd === '/resetpw') {
                if (parts.length < 3) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '💡 Usage: <code>/resetpw &lt;username&gt; &lt;newpassword&gt;</code>', parse_mode: 'HTML' });
                    return;
                }
                const targetQuery = parts[1];
                const newPass = parts[2];
                if (newPass.length < 6) {
                    await apiCall('sendMessage', { chat_id: chatId, text: '❌ Password must be at least 6 characters.', parse_mode: 'HTML' });
                    return;
                }
                try {
                    const user = await dbGet('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?', [targetQuery, targetQuery, parseInt(targetQuery) || 0]);
                    if (!user) {
                        await apiCall('sendMessage', { chat_id: chatId, text: `❌ User <code>${targetQuery}</code> not found.`, parse_mode: 'HTML' });
                        return;
                    }
                    const hashed = await bcrypt.hash(newPass, 10);
                    await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
                    await apiCall('sendMessage', { chat_id: chatId, text: `🔑 <b>Password Reset:</b> Password for <code>${user.username}</code> has been updated.`, parse_mode: 'HTML' });
                } catch (e) {
                    await apiCall('sendMessage', { chat_id: chatId, text: `❌ Reset password error.`, parse_mode: 'HTML' });
                }
                return;
            }

            // /help
            if (cmd === '/help') {
                const cheatsheet = [
                    `🛠️ <b>INVESTAA TELEGRAM ADMIN CHEATSHEET</b>`,
                    `━━━━━━━━━━━━━━━━━━━━━━`,
                    `• <code>/admin</code> — Open main Control Board`,
                    `• <code>/stats</code> — System performance metrics`,
                    `• <code>/vips</code> — List all active VIP members`,
                    `• <code>/triggerearnings</code> — Run daily earnings cycle & statements`,
                    `• <code>/deposits</code> — Review pending deposits queue`,
                    `• <code>/withdrawals</code> — Review pending withdrawals queue`,
                    `• <code>/kyc</code> — Review pending identity verifications`,
                    `• <code>/users</code> — Recent registered member list`,
                    `• <code>/user &lt;username&gt;</code> — Inspect user profile`,
                    `• <code>/fund &lt;username&gt; &lt;amount&gt;</code> — Credit user balance`,
                    `• <code>/ban &lt;username&gt;</code> — Block user account`,
                    `• <code>/unban &lt;username&gt;</code> — Unblock user account`,
                    `• <code>/resetpw &lt;user&gt; &lt;newpass&gt;</code> — Reset password`,
                    `• <code>/setupmenu</code> — Refresh native Telegram Menu button`,
                    `━━━━━━━━━━━━━━━━━━━━━━`
                ].join('\n');
                await apiCall('sendMessage', { chat_id: chatId, text: cheatsheet, parse_mode: 'HTML' });
                return;
            }

            return;
        }

        // ──────────────── 2. INLINE CALLBACK BUTTONS ────────────────
        if (!update.callback_query) return;

        const cq = update.callback_query;
        const queryId = cq.id;

        try {
            const message = cq.message;
            if (!message) {
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: '⚠️ No message context.' });
                return;
            }

            const data = cq.data || '';
            const chatId = message.chat.id;
            const messageId = message.message_id;
            const originalText = message.text || '';

            if (!isAuthorized(chatId)) {
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: '⛔ Unauthorized.' });
                return;
            }

            console.log(`[TELEGRAM-BOT] Callback Query: "${data}" from chat ${chatId}`);

            // ── Menu Navigation Callbacks ──
            if (data === 'admin_menu') {
                const text = await generateAdminDashboardText();
                const keyboard = await getAdminMenuKeyboard();
                await apiCall('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: 'Board updated.' });
                return;
            }

            if (data === 'admin_vips') {
                await sendVipDirectory(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            if (data === 'admin_run_earnings') {
                await handleTriggerEarnings(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: 'Daily earnings executed.' });
                return;
            }

            if (data === 'admin_overview') {
                await sendSystemOverview(chatId, messageId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: 'Stats refreshed.' });
                return;
            }

            if (data === 'admin_pending_deposits') {
                await sendPendingDeposits(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            if (data === 'admin_pending_withdrawals') {
                await sendPendingWithdrawals(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            if (data === 'admin_pending_loans') {
                await sendPendingLoans(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            if (data === 'admin_pending_kyc') {
                await sendPendingKyc(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            if (data === 'admin_users') {
                await sendUserDirectory(chatId);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            // ── Admin Action Prompts & Direct Buttons ──
            if (data.startsWith('admin_fund_prompt:')) {
                const uid = data.split(':')[1];
                const u = await dbGet('SELECT username FROM users WHERE id = ?', [uid]);
                await apiCall('sendMessage', {
                    chat_id: chatId,
                    text: `💡 <b>To credit this user:</b>\nSend: <code>/fund ${u ? u.username : uid} &lt;amount&gt;</code>\nExample: <code>/fund ${u ? u.username : uid} 250</code>`,
                    parse_mode: 'HTML'
                });
                await apiCall('answerCallbackQuery', { callback_query_id: queryId });
                return;
            }

            if (data.startsWith('admin_ban:')) {
                const uid = parseInt(data.split(':')[1]);
                await dbRun('UPDATE users SET is_banned = 1 WHERE id = ?', [uid]);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: 'User banned successfully.' });
                await inspectUser(chatId, uid);
                return;
            }

            if (data.startsWith('admin_unban:')) {
                const uid = parseInt(data.split(':')[1]);
                await dbRun('UPDATE users SET is_banned = 0 WHERE id = ?', [uid]);
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: 'User unbanned successfully.' });
                await inspectUser(chatId, uid);
                return;
            }

            // Parse queue approval action and ID
            const parts = data.split(':');
            const action = parts[0];
            const recordId = parseInt(parts[1]);

            if (isNaN(recordId)) {
                await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: '⚠️ Invalid ID.' });
                return;
            }

            let resultText = '';
            let popupText = '';

            // ──────────────── DEPOSITS ────────────────
            if (action === 'dep_approve') {
                const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [recordId]);
                if (!deposit) {
                    popupText = '❌ Deposit not found.';
                } else if (deposit.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${deposit.status})`;
                } else {
                    const amount = parseFloat(deposit.usdt_amount || deposit.amount);
                    await dbRun("UPDATE deposits SET status = 'APPROVED' WHERE id = ?", [recordId]);

                    const userForBonus = await dbGet('SELECT bonus_balance FROM users WHERE id = ?', [deposit.user_id]);
                    const bonusToMerge = parseFloat(userForBonus?.bonus_balance || 0);
                    const totalBalanceCredit = amount + bonusToMerge;

                    await dbRun(
                        'UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ?, bonus_balance = 0 WHERE id = ?',
                        [totalBalanceCredit, amount, deposit.user_id]
                    );

                    const depDetails = deposit.network ? `Via ${deposit.network}` : 'Deposit Approved';
                    await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'DEPOSIT', amount, depDetails, 'COMPLETED']);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'Deposit Approved', `Your deposit of $${amount.toFixed(2)} was approved!`, 'DEPOSIT', 'SUCCESS']);
                    
                    if (bonusToMerge > 0) {
                        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
                            [deposit.user_id, 'BONUS', bonusToMerge, 'Welcome bonus activated — now earning daily returns', 'COMPLETED']);
                        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
                            [deposit.user_id, '🎁 Welcome Bonus Activated!', `Your $${bonusToMerge.toFixed(2)} welcome bonus has been merged into your active balance and is now earning daily returns!`, 'SYSTEM', 'SUCCESS']);
                    }

                    const uDep = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]).catch(() => null);
                    if (uDep && typeof sendUserEmail === 'function' && Emails) {
                        sendUserEmail(deposit.user_id, () => Emails.depositApproved(uDep.email, uDep.username, amount)).catch(() => {});
                    }

                    popupText = `✅ Deposit approved successfully!`;
                    resultText = `Approved ✅ ($${amount.toFixed(2)} USDT)`;
                }
            } else if (action === 'dep_reject') {
                const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [recordId]);
                if (!deposit) {
                    popupText = '❌ Deposit not found.';
                } else if (deposit.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${deposit.status})`;
                } else {
                    await dbRun("UPDATE deposits SET status = 'REJECTED' WHERE id = ?", [recordId]);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'Deposit Rejected', 'Your deposit attempt was rejected.', 'DEPOSIT', 'FAILED']);
                    
                    const uDepR = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]).catch(() => null);
                    if (uDepR && typeof sendUserEmail === 'function' && Emails) {
                        sendUserEmail(deposit.user_id, () => Emails.depositRejected(uDepR.email, uDepR.username)).catch(() => {});
                    }

                    popupText = `❌ Deposit rejected successfully.`;
                    resultText = `Rejected ❌`;
                }
            }

            // ──────────────── WITHDRAWALS ────────────────
            else if (action === 'with_approve') {
                const w = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [recordId]);
                if (!w) {
                    popupText = '❌ Withdrawal not found.';
                } else if (w.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${w.status})`;
                } else {
                    await dbRun("UPDATE withdrawals SET status = 'APPROVED' WHERE id = ?", [recordId]);
                    await dbRun('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?', ['COMPLETED', w.user_id, 'WITHDRAW', w.amount, 'PENDING']);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'Withdrawal Approved', `Your withdrawal of $${parseFloat(w.amount).toFixed(2)} has been processed successfully!`, 'WITHDRAW', 'SUCCESS']);
                    
                    const uWD = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]).catch(() => null);
                    if (uWD && typeof sendUserEmail === 'function' && Emails) {
                        sendUserEmail(w.user_id, () => Emails.withdrawalApproved(uWD.email, uWD.username, parseFloat(w.amount))).catch(() => {});
                    }

                    popupText = `✅ Withdrawal approved successfully!`;
                    resultText = `Approved ✅ ($${parseFloat(w.amount).toFixed(2)} USDT)`;
                }
            } else if (action === 'with_reject') {
                const w = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [recordId]);
                if (!w) {
                    popupText = '❌ Withdrawal not found.';
                } else if (w.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${w.status})`;
                } else {
                    const refund = parseFloat(w.amount) + 1.0;
                    await dbRun("UPDATE withdrawals SET status = 'REJECTED' WHERE id = ?", [recordId]);
                    await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [refund, w.user_id]);
                    await dbRun('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?', ['REJECTED', w.user_id, 'WITHDRAW', w.amount, 'PENDING']);
                    await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'TRANSFER_IN', refund, 'Refund for rejected withdrawal (including fee)', 'COMPLETED']);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'Withdrawal Rejected', `Your withdrawal request was rejected and $${refund.toFixed(2)} USDT has been refunded to your balance.`, 'WITHDRAW', 'FAILED']);
                    
                    const uWDR = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]).catch(() => null);
                    if (uWDR && typeof sendUserEmail === 'function' && Emails) {
                        sendUserEmail(w.user_id, () => Emails.withdrawalRejected(uWDR.email, uWDR.username, parseFloat(w.amount))).catch(() => {});
                    }

                    popupText = `❌ Withdrawal rejected & balance refunded.`;
                    resultText = `Rejected & Refunded ❌`;
                }
            }

            // ──────────────── KYC SUBMISSIONS ────────────────
            else if (action === 'kyc_approve') {
                const sub = await dbGet('SELECT * FROM kyc_submissions WHERE id = ?', [recordId]);
                if (!sub) {
                    popupText = '❌ KYC submission not found.';
                } else if (sub.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${sub.status})`;
                } else {
                    await dbRun("UPDATE kyc_submissions SET status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [recordId]);
                    await dbRun("UPDATE users SET kyc_status = 'APPROVED' WHERE id = ?", [sub.user_id]);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [sub.user_id, 'Identity Verified (KYC)', 'Your identity verification (KYC) application has been approved! Withdrawals are now enabled.', 'SYSTEM', 'SUCCESS']);
                    
                    const uKyc = await dbGet('SELECT email, username, phone FROM users WHERE id = ?', [sub.user_id]).catch(() => null);
                    if (uKyc) {
                        if (typeof sendUserEmail === 'function' && Emails) {
                            sendUserEmail(sub.user_id, () => Emails.kycApproved(uKyc.email, uKyc.username)).catch(() => {});
                        }
                        
                        const archiveId = process.env.TELEGRAM_ARCHIVE_CHAT_ID;
                        if (archiveId) {
                            const detailsText = [
                                `=======================================`,
                                `INVESTAA - APPROVED KYC RECORD`,
                                `=======================================`,
                                `Submission ID: ${sub.id}`,
                                `User ID:       ${sub.user_id}`,
                                `Username:      ${uKyc.username}`,
                                `Email:         ${uKyc.email}`,
                                `Phone:         ${uKyc.phone || 'N/A'}`,
                                `Country:       ${sub.country}`,
                                `ID Type:       ${sub.id_type}`,
                                `ID Number:     ${sub.id_number}`,
                                `Submitted At:  ${sub.submitted_at || 'N/A'}`,
                                `Approved At:   ${new Date().toLocaleString()}`,
                                `=======================================`
                            ].join('\n');
                            Telegram.archiveKyc(archiveId, sub, uKyc, detailsText).catch((err) => {
                                console.error('[KYC-ARCHIVE] Failed to archive KYC:', err.message);
                            });
                        }
                    }

                    popupText = `✅ KYC submission approved successfully!`;
                    resultText = `Approved ✅`;
                }
            } else if (action === 'kyc_reject') {
                const sub = await dbGet('SELECT * FROM kyc_submissions WHERE id = ?', [recordId]);
                if (!sub) {
                    popupText = '❌ KYC submission not found.';
                } else if (sub.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${sub.status})`;
                } else {
                    const kycReason = 'Verification requirements not met. Please review document clarity and resubmit.';
                    await dbRun("UPDATE kyc_submissions SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP, rejection_reason = ? WHERE id = ?", [kycReason, recordId]);
                    await dbRun("UPDATE users SET kyc_status = 'REJECTED' WHERE id = ?", [sub.user_id]);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [sub.user_id, 'KYC Rejected', 'Your identity verification application was rejected. Please review details and submit again.', 'SYSTEM', 'FAILED']);
                    
                    const uKycR = await dbGet('SELECT email, username FROM users WHERE id = ?', [sub.user_id]).catch(() => null);
                    if (uKycR && typeof sendUserEmail === 'function' && Emails) {
                        sendUserEmail(sub.user_id, () => Emails.kycRejected(uKycR.email, uKycR.username, kycReason)).catch(() => {});
                    }

                    popupText = `❌ KYC submission rejected.`;
                    resultText = `Rejected ❌`;
                }
            }

            // ──────────────── LOAN APPLICATIONS ────────────────
            else if (action === 'loan_approve') {
                const loan = await dbGet('SELECT * FROM loan_applications WHERE id = ?', [recordId]);
                if (!loan) {
                    popupText = '❌ Loan application not found.';
                } else if (loan.status !== 'PENDING') {
                    popupText = `⚠️ Loan #${loan.id} (${loan.app_code}) is already ${loan.status}!`;
                    resultText = `Already ${loan.status} ⚠️`;
                } else {
                    const amt = parseFloat(loan.loan_amount || 0);
                    await dbRun("UPDATE loan_applications SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP WHERE id = ?", [recordId]);

                    try {
                        let user = await dbGet('SELECT id, username, email FROM users WHERE id = ? OR LOWER(email) = LOWER(?)', [loan.user_id || 0, loan.email]);
                        if (user) {
                            await dbRun('UPDATE users SET pending_loan_amount = COALESCE(pending_loan_amount, 0) + ? WHERE id = ?', [amt, user.id]);
                            await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [
                                user.id,
                                '🎉 Loan Application Approved!',
                                `Your credit application (${loan.app_code}) for $${amt.toFixed(2)} USD has been APPROVED! Make a deposit or upgrade your VIP rank to activate instant disbursement to your wallet.`,
                                'SYSTEM',
                                'SUCCESS'
                            ]);
                        }

                        if (Emails) {
                            if (user && typeof sendUserEmail === 'function') {
                                sendUserEmail(user.id, () => Emails.loanApproved(loan.email, loan.full_name, amt, loan.app_code)).catch(() => {});
                            } else {
                                Emails.loanApproved(loan.email, loan.full_name, amt, loan.app_code).catch(() => {});
                            }
                        }

                        Telegram.notifyLoanApproved(loan, amt).catch(() => {});
                        Telegram.archiveLoan(loan).catch(() => {});
                    } catch (subErr) {
                        console.error('[TELEGRAM-BOT] loan_approve sub-tasks error:', subErr.message);
                    }

                    popupText = `✅ Loan #${loan.id} approved successfully!`;
                    resultText = `Approved ✅ ($${amt.toLocaleString()} USD)`;
                }
            } else if (action === 'loan_reject') {
                const loan = await dbGet('SELECT * FROM loan_applications WHERE id = ?', [recordId]);
                if (!loan) {
                    popupText = '❌ Loan application not found.';
                } else if (loan.status !== 'PENDING') {
                    popupText = `⚠️ Loan #${loan.id} (${loan.app_code}) is already ${loan.status}!`;
                    resultText = `Already ${loan.status} ⚠️`;
                } else {
                    const rejReason = 'Underwriting requirements not met.';
                    await dbRun("UPDATE loan_applications SET status = 'REJECTED', rejection_reason = ? WHERE id = ?", [rejReason, recordId]);

                    try {
                        let user = await dbGet('SELECT id FROM users WHERE id = ? OR LOWER(email) = LOWER(?)', [loan.user_id || 0, loan.email]);
                        if (user) {
                            await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [
                                user.id,
                                'Loan Application Update',
                                `Your credit application (${loan.app_code}) was not approved at this time.`,
                                'SYSTEM',
                                'FAILED'
                            ]);
                        }

                        if (Emails) {
                            if (user && typeof sendUserEmail === 'function') {
                                sendUserEmail(user.id, () => Emails.loanRejected(loan.email, loan.full_name, parseFloat(loan.loan_amount), loan.app_code, rejReason)).catch(() => {});
                            } else {
                                Emails.loanRejected(loan.email, loan.full_name, parseFloat(loan.loan_amount), loan.app_code, rejReason).catch(() => {});
                            }
                        }

                        Telegram.notifyLoanRejected(loan, rejReason).catch(() => {});
                    } catch (subErr) {
                        console.error('[TELEGRAM-BOT] loan_reject sub-tasks error:', subErr.message);
                    }

                    popupText = `❌ Loan #${loan.id} rejected.`;
                    resultText = `Rejected ❌`;
                }
            }

            if (resultText) {
                const cleanOriginal = originalText.replace(/⏳ Awaiting admin review/g, '').replace(/⏳ Awaiting approval/g, '').trim();
                const newText = `${cleanOriginal}\n\n🤖 <b>Status:</b> ${resultText}\n👤 <b>Auditor:</b> @${cq.from.username || cq.from.first_name}\n📅 <b>Processed:</b> ${new Date().toLocaleString()}`;
                
                await apiCall('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: newText,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [] }
                });
            }

            await apiCall('answerCallbackQuery', {
                callback_query_id: queryId,
                text: popupText || 'Done.'
            });

        } catch (err) {
            console.error('[TELEGRAM-BOT] Processing Error:', err.message);
            await apiCall('answerCallbackQuery', {
                callback_query_id: queryId,
                text: '❌ Processing error occurred.'
            });
        }
    }

    async function poll() {
        try {
            const updatesRes = await apiCall('getUpdates', { offset, timeout: 30 });
            if (updatesRes && updatesRes.ok) {
                const updates = updatesRes.result || [];
                for (const update of updates) {
                    offset = update.update_id + 1;
                    await processUpdate(update);
                }
            } else if (updatesRes && !updatesRes.ok) {
                console.error(`[TELEGRAM-BOT] getUpdates error: ${updatesRes.description || updatesRes.error} (code: ${updatesRes.error_code})`);
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] Polling exception:', err.message);
        }
        setTimeout(poll, 1000);
    }

    poll();
}

module.exports = {
    startTelegramPolling
};
