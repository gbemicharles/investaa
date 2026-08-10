const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text, replyMarkup = null) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN || !CHAT_ID) {
            console.warn('[TELEGRAM] Bot token or chat ID not configured — skipping.');
            return resolve();
        }
        const bodyObj = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
        if (replyMarkup) {
            bodyObj.reply_markup = replyMarkup;
        }
        const body = JSON.stringify(bodyObj);
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => { console.error('[TELEGRAM] Send error:', e.message); resolve(); });
        req.write(body);
        req.end();
    }).then(raw => {
        try {
            const parsed = JSON.parse(raw);
            if (!parsed.ok) console.error('[TELEGRAM] API error:', parsed.description, '| chat_id:', CHAT_ID);
        } catch (_) {}
        return raw;
    });
}

function sendPhoto(photoBase64, caption) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !CHAT_ID) return resolve();

        const boundary = '----TGBoundary' + Date.now();
        const mimeMatch = photoBase64.match(/^data:(image\/\w+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext  = mime.split('/')[1] || 'jpg';
        const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const captionPart =
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption || ''}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="doc.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`;

        const closing = `\r\n--${boundary}--\r\n`;
        const body = Buffer.concat([
            Buffer.from(captionPart, 'utf8'),
            imageBuffer,
            Buffer.from(closing, 'utf8')
        ]);

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => { console.error('[TELEGRAM] Photo error:', e.message); resolve(); });
        req.write(body);
        req.end();
    });
}

async function notifyKycApproved(sub, user) {
    try {
        const lines = [
            `✅ <b>KYC APPROVED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            user.phone ? `📞 <b>Phone:</b> ${user.phone}` : null,
            ``,
            `🌍 <b>Country:</b> ${sub.country}`,
            `🪪 <b>ID Type:</b> ${sub.id_type}`,
            `🔢 <b>ID Number:</b> <code>${sub.id_number}</code>`,
            sub.extra_field_name ? `📋 <b>${sub.extra_field_name}:</b> <code>${sub.extra_field_value}</code>` : null,
            ``,
            `📅 <b>Submitted:</b> ${new Date(sub.submitted_at).toLocaleString()}`,
            `✔️ <b>Approved:</b> ${new Date().toLocaleString()}`,
        ].filter(l => l !== null).join('\n');

        await sendTelegram(lines);

        if (sub.id_document) {
            await sendPhoto(sub.id_document, `🪪 ID Front — ${user.username}`);
        }
        if (sub.id_document_back) {
            await sendPhoto(sub.id_document_back, `🪪 ID Back — ${user.username}`);
        }
        if (sub.selfie) {
            await sendPhoto(sub.selfie, `🤳 Selfie — ${user.username}`);
        }
        if (sub.extra_document) {
            const label = sub.extra_field_name ? `${sub.extra_field_name} Document` : 'Supporting Document';
            await sendPhoto(sub.extra_document, `📄 ${label} — ${user.username}`);
        }
    } catch(e) {
        console.error('[TELEGRAM] notifyKycApproved error:', e.message);
    }
}

async function notifyDepositSubmitted(user, amount, network, txid, depositId) {
    try {
        const text = [
            `💰 <b>NEW DEPOSIT</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            ``,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `🌐 <b>Network:</b> ${network}`,
            txid ? `🔗 <b>TxID:</b> <code>${txid}</code>` : null,
            ``,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `dep_approve:${depositId}` },
                    { text: 'Reject ❌', callback_data: `dep_reject:${depositId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch(e) { console.error('[TELEGRAM] notifyDepositSubmitted error:', e.message); }
}

async function notifyDepositApproved(user, amount) {
    try {
        await sendTelegram([
            `✅ <b>DEPOSIT APPROVED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyDepositApproved error:', e.message); }
}

async function notifyDepositRejected(user, amount) {
    try {
        await sendTelegram([
            `❌ <b>DEPOSIT REJECTED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyDepositRejected error:', e.message); }
}

async function notifyWithdrawalRequested(user, amount, details, withdrawalId) {
    try {
        const text = [
            `🏧 <b>WITHDRAWAL REQUEST</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            ``,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            details ? `📋 <b>Details:</b> ${details}` : null,
            ``,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `with_approve:${withdrawalId}` },
                    { text: 'Reject ❌', callback_data: `with_reject:${withdrawalId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch(e) { console.error('[TELEGRAM] notifyWithdrawalRequested error:', e.message); }
}

async function notifyWithdrawalApproved(user, amount) {
    try {
        await sendTelegram([
            `✅ <b>WITHDRAWAL APPROVED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyWithdrawalApproved error:', e.message); }
}

async function notifyWithdrawalRejected(user, amount) {
    try {
        await sendTelegram([
            `❌ <b>WITHDRAWAL REJECTED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Refunded:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyWithdrawalRejected error:', e.message); }
}

async function notifyKycSubmitted(user, country, idType, kycId) {
    try {
        const text = [
            `🪪 <b>NEW KYC SUBMISSION</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            user.phone ? `📞 <b>Phone:</b> ${user.phone}` : null,
            ``,
            `🌍 <b>Country:</b> ${country}`,
            `🪪 <b>ID Type:</b> ${idType}`,
            ``,
            `📅 <b>Submitted:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `kyc_approve:${kycId}` },
                    { text: 'Reject ❌', callback_data: `kyc_reject:${kycId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch(e) { console.error('[TELEGRAM] notifyKycSubmitted error:', e.message); }
}

module.exports = {
    sendTelegram,
    notifyKycApproved,
    notifyDepositSubmitted,
    notifyDepositApproved,
    notifyDepositRejected,
    notifyWithdrawalRequested,
    notifyWithdrawalApproved,
    notifyWithdrawalRejected,
    notifyKycSubmitted,
};
