const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID ? parseInt(process.env.TELEGRAM_CHAT_ID, 10) : null;

let offset = 0;

function startTelegramPolling(dbGet, dbRun, sendUserEmail, Emails) {
    if (!BOT_TOKEN) {
        console.warn('[TELEGRAM-BOT] Token not configured — skipping interactive polling.');
        return;
    }

    console.log('[TELEGRAM-BOT] Starting Long Polling interactive bot listener...');

    async function processUpdate(update) {
        if (!update.callback_query) return;
        
        const cq = update.callback_query;
        const queryId = cq.id;
        const message = cq.message;
        const data = cq.data || '';
        const chatId = message.chat.id;
        const messageId = message.message_id;
        const originalText = message.text || '';

        // Security: only process callbacks from the designated admin chat
        if (ADMIN_CHAT_ID && chatId !== ADMIN_CHAT_ID) {
            await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: '⛔ Unauthorized.' });
            console.warn(`[TELEGRAM-BOT] Rejected callback from unauthorized chat ${chatId}`);
            return;
        }

        console.log(`[TELEGRAM-BOT] Callback Query received: "${data}"`);

        // Parse query command and ID
        const parts = data.split(':');
        const action = parts[0];
        const recordId = parseInt(parts[1]);

        if (isNaN(recordId)) {
            await apiCall('answerCallbackQuery', { callback_query_id: queryId, text: '⚠️ Invalid ID parameter.' });
            return;
        }

        let resultText = '';
        let popupText = '';

        try {
            // ──────────────── DEPOSITS ────────────────
            if (action === 'dep_approve') {
                const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [recordId]);
                if (!deposit) {
                    popupText = '❌ Deposit not found.';
                } else if (deposit.status !== 'PENDING') {
                    popupText = `⚠️ Already processed (Status: ${deposit.status})`;
                } else {
                    const amount = parseFloat(deposit.amount);
                    await dbRun("UPDATE deposits SET status = 'APPROVED' WHERE id = ?", [recordId]);

                    const userForBonus = await dbGet('SELECT bonus_balance FROM users WHERE id = ?', [deposit.user_id]);
                    const bonusToMerge = parseFloat(userForBonus?.bonus_balance || 0);
                    const totalBalanceCredit = amount + bonusToMerge;

                    await dbRun(
                        'UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ?, bonus_balance = 0 WHERE id = ?',
                        [totalBalanceCredit, amount, deposit.user_id]
                    );

                    await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'DEPOSIT', amount, `Via ${deposit.network} (Telegram bot approved)`, 'COMPLETED']);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'Deposit Approved', `Your deposit of $${amount.toFixed(2)} was approved!`, 'DEPOSIT', 'SUCCESS']);
                    
                    if (bonusToMerge > 0) {
                        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
                            [deposit.user_id, 'BONUS', bonusToMerge, 'Welcome bonus activated — now earning daily returns', 'COMPLETED']);
                        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
                            [deposit.user_id, '🎁 Welcome Bonus Activated!', `Your $${bonusToMerge.toFixed(2)} welcome bonus has been merged into your active balance and is now earning daily returns!`, 'SYSTEM', 'SUCCESS']);
                    }

                    const uDep = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]).catch(() => null);
                    if (uDep) {
                        await sendUserEmail(deposit.user_id, () => Emails.depositApproved(uDep.email, uDep.username, amount));
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
                    if (uDepR) {
                        await sendUserEmail(deposit.user_id, () => Emails.depositRejected(uDepR.email, uDepR.username));
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
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'Withdrawal Approved', `Your withdrawal of $${parseFloat(w.amount).toFixed(2)} has been processed successfully!`, 'WITHDRAW', 'SUCCESS']);
                    
                    const uWD = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]).catch(() => null);
                    if (uWD) {
                        await sendUserEmail(w.user_id, () => Emails.withdrawalApproved(uWD.email, uWD.username, parseFloat(w.amount)));
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
                    const refund = parseFloat(w.amount) + 1.0; // Refund amount + processing fee ($1)
                    await dbRun("UPDATE withdrawals SET status = 'REJECTED' WHERE id = ?", [recordId]);
                    await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [refund, w.user_id]);

                    await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'TRANSFER_IN', refund, 'Refund for rejected withdrawal (including fee)', 'COMPLETED']);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'Withdrawal Rejected', `Your withdrawal request was rejected and $${refund.toFixed(2)} USDT has been refunded to your balance.`, 'WITHDRAW', 'FAILED']);
                    
                    const uWDR = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]).catch(() => null);
                    if (uWDR) {
                        await sendUserEmail(w.user_id, () => Emails.withdrawalRejected(uWDR.email, uWDR.username, parseFloat(w.amount)));
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
                        await sendUserEmail(sub.user_id, () => Emails.kycApproved(uKyc.email, uKyc.username));
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
                    await dbRun("UPDATE kyc_submissions SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP, rejection_reason = ? WHERE id = ?", ['Rejected via Telegram Control Bot', recordId]);
                    await dbRun("UPDATE users SET kyc_status = 'REJECTED' WHERE id = ?", [sub.user_id]);
                    await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [sub.user_id, 'KYC Rejected', 'Your identity verification application was rejected. Please review details and submit again.', 'SYSTEM', 'FAILED']);
                    
                    const uKycR = await dbGet('SELECT email, username FROM users WHERE id = ?', [sub.user_id]).catch(() => null);
                    if (uKycR) {
                        await sendUserEmail(sub.user_id, () => Emails.kycRejected(uKycR.email, uKycR.username, 'Rejected via Telegram Control Bot'));
                    }

                    popupText = `❌ KYC submission rejected.`;
                    resultText = `Rejected ❌`;
                }
            }

            // If an action was executed successfully, edit the Telegram message to indicate completion
            if (resultText) {
                const cleanOriginal = originalText.replace(/⏳ Awaiting admin review/g, '').replace(/⏳ Awaiting approval/g, '').trim();
                const newText = `${cleanOriginal}\n\n🤖 <b>Status:</b> ${resultText}\n👤 <b>Auditor:</b> @${cq.from.username || cq.from.first_name}\n📅 <b>Processed:</b> ${new Date().toLocaleString()}`;
                
                // Remove inline keyboard by sending empty reply_markup
                await apiCall('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: newText,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [] }
                });
            }

            // Send feedback alert to user clicker
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
            }
        } catch (err) {
            console.error('[TELEGRAM-BOT] Polling exception:', err.message);
        }
        // Recurse immediately after completion
        setTimeout(poll, 1000);
    }

    poll();
}

module.exports = {
    startTelegramPolling
};
