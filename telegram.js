const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN || !CHAT_ID) {
            console.warn('[TELEGRAM] Bot token or chat ID not configured — skipping.');
            return resolve();
        }
        const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
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

module.exports = { sendTelegram, notifyKycApproved };
