require('dotenv').config();
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}
const https = require('https');
const nodemailer = require('nodemailer');

const APP_NAME = 'InvestAA';
const APP_URL  = process.env.APP_URL || 'https://investaa.site';

// Primary: Hostinger custom domain email
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.hostinger.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// Fallback: Gmail (used automatically if Hostinger is unavailable)
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';

const FROM_NAME    = APP_NAME;
const FROM_EMAIL   = SMTP_USER || GMAIL_USER;
const SUPPORT_EMAIL = SMTP_USER || GMAIL_USER || 'support@investaa.site';

function makePrimaryTransporter() {
    if (!SMTP_USER || !SMTP_PASS) return null;
    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        family: 4
    });
}

function makeFallbackTransporter() {
    if (!GMAIL_USER || !GMAIL_PASS) return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_PASS.replace(/\s+/g, '') },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        family: 4
    });
}

// Lazy singletons
let _primary  = undefined;
let _fallback = undefined;
function getPrimary()  { if (_primary  === undefined) _primary  = makePrimaryTransporter();  return _primary;  }
function getFallback() { if (_fallback === undefined) _fallback = makeFallbackTransporter(); return _fallback; }

// Suppression checker — registered by server.js at startup
// Signature: async (email: string) => boolean  (true = suppressed, skip send)
let _suppressionChecker = null;
function setSuppressionChecker(fn) { _suppressionChecker = fn; }

// Mailer mode: 'auto' | 'resend' | 'hostinger' | 'gmail'
let _mailerMode = 'auto';
function setMailerMode(mode) {
    if (['auto','resend','hostinger','gmail'].includes(mode)) {
        _mailerMode = mode;
        console.log(`[MAILER] Mode set to "${mode}"`);
    }
}
function getMailerMode() { return _mailerMode; }
let _lastError = null;
function getLastError() { return _lastError; }
function getMailerStatus() {
    return {
        mode: _mailerMode,
        hostinger: !!(SMTP_USER && SMTP_PASS),
        gmail:     !!(GMAIL_USER && GMAIL_PASS),
        resend:    !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim())
    };
}

// Invisible padding to stop email clients pulling body text into the inbox preview after the preheader
const PREHEADER_PAD = ('&nbsp;&#8203;').repeat(90);

function wrap(preheader, bodyHtml, ctaText, ctaUrl) {
    const cta = ctaText && ctaUrl
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0 0;">
             <tr><td align="center">
               <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6 0%,#6366f1 100%);color:#ffffff;padding:15px 38px;border-radius:12px;font-weight:700;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:15px;letter-spacing:0.3px;">${ctaText} &rarr;</a>
             </td></tr>
           </table>`
        : '';
    const ph = preheader
        ? `<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}${PREHEADER_PAD}</span>`
        : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0d0e16;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#f8fafc;">
  ${ph}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0e16;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Logo -->
        <tr><td style="padding:0 0 22px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="center">
            <tr>
              <td style="background:linear-gradient(135deg,#3b82f6,#6366f1);width:40px;height:40px;border-radius:11px;text-align:center;vertical-align:middle;font-size:17px;font-weight:900;color:#ffffff;line-height:40px;">IA</td>
              <td style="padding-left:11px;vertical-align:middle;font-size:21px;font-weight:800;color:#f8fafc;letter-spacing:0.2px;">${APP_NAME}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Card -->
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#13151e;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);box-shadow:0 24px 64px rgba(0,0,0,0.5);">

            <!-- Gradient accent bar -->
            <tr><td style="height:4px;background:linear-gradient(90deg,#3b82f6 0%,#6366f1 60%,#8b5cf6 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

            <!-- Body -->
            <tr><td style="padding:38px 44px 34px;">
              <div style="font-size:15px;line-height:1.75;color:#cbd5e1;">${bodyHtml}</div>
              ${cta}
            </td></tr>

            <!-- Divider -->
            <tr><td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);font-size:0;line-height:0;">&nbsp;</td></tr>

            <!-- Footer -->
            <tr><td style="padding:22px 44px 26px;text-align:center;">
              <p style="margin:0 0 5px;font-size:12px;color:#475569;line-height:1.65;">
                You received this because you have an account with <strong style="color:#64748b;">${APP_NAME}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:#475569;">
                Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>
                &nbsp;&middot;&nbsp; &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
              </p>
            </td></tr>

          </table>
        </td></tr>

        <!-- Bottom spacing -->
        <tr><td style="height:32px;"></td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

function sendResend(from, to, subject, html, text) {
    return new Promise((resolve, reject) => {
        const apiKey = (process.env.RESEND_API_KEY || '').trim();
        if (!apiKey) {
            return reject(new Error('RESEND_API_KEY is not configured in environment.'));
        }

        const body = JSON.stringify({
            from: from,
            to: Array.isArray(to) ? to : [to],
            subject: subject,
            html: html,
            text: text
        });

        const options = {
            hostname: 'api.resend.com',
            path: '/emails',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve({ ok: true, raw: data });
                    }
                } else {
                    let detail = data;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.message) detail = parsed.message;
                    } catch (_) {}
                    if (res.statusCode === 403 && from.includes('onboarding@resend.dev')) {
                        detail += ' (Note: onboarding@resend.dev can only send to the email address used to create your Resend account. To send to any recipient, verify your domain in Resend and set RESEND_FROM_EMAIL)';
                    }
                    reject(new Error(`Resend API status ${res.statusCode}: ${detail}`));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(body);
        req.end();
    });
}

function formatResendFrom(fromEnv) {
    if (!fromEnv) return 'InvestAA <onboarding@resend.dev>';
    let str = fromEnv.trim().replace(/^["']|["']$/g, '');
    if (/^[^<>]+\s*<[^@\s]+@[^@\s]+\.[^@\s]+>$/.test(str)) {
        return str;
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
        return `${APP_NAME} <${str}>`;
    }
    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(str)) {
        return `${APP_NAME} <support@${str}>`;
    }
    return str;
}

async function sendMail(to, subject, html, opts = {}) {
    if (!to) return;

    // Check suppression list before sending
    if (_suppressionChecker) {
        try {
            const suppressed = await _suppressionChecker(to);
            if (suppressed) {
                console.log(`[MAILER] Skipped (suppressed): "${subject}" → ${to}`);
                return;
            }
        } catch (e) {
            console.warn(`[MAILER] Suppression check failed for ${to}: ${e.message}`);
        }
    }

    const mode = _mailerMode;
    const resendApiKey = (process.env.RESEND_API_KEY || '').trim();

    // If explicit mode is 'resend', or if mode is 'auto' and Resend key exists
    if (mode === 'resend' || (mode === 'auto' && resendApiKey)) {
        if (!resendApiKey) {
            const errStr = 'Resend mode selected but RESEND_API_KEY is not set in environment.';
            _lastError = { timestamp: new Date().toLocaleString(), recipient: to, error: errStr };
            if (mode === 'resend') throw new Error(errStr);
        } else {
            try {
                const fromEmail = formatResendFrom(process.env.RESEND_FROM_EMAIL);
                const plainText = opts.text || html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
                await sendResend(fromEmail, to, subject, html, plainText);
                console.log(`[MAILER] Sent via Resend HTTPS: "${subject}" → ${to}`);
                return;
            } catch (err) {
                _lastError = {
                    timestamp: new Date().toLocaleString(),
                    recipient: to,
                    error: err.message,
                    stack: err.stack
                };
                if (mode === 'resend') {
                    console.error(`[MAILER] Resend failed (mode=resend): ${err.message}`);
                    throw err;
                }
                console.error(`[MAILER] Resend failed (${err.message}) — attempting fallback SMTP…`);
            }
        }
    }

    const msg = {
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        html,
        text: opts.text || html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim(),
        ...(opts.headers ? { headers: opts.headers } : {}),
    };

    const primary  = (mode === 'gmail' || mode === 'resend') ? null : getPrimary();
    const fallback = (mode === 'hostinger' || mode === 'resend') ? null : getFallback();
    if (!primary && !fallback) {
        const warning = `No fallback SMTP transport available in mode "${mode}" — email skipped.`;
        console.warn(`[MAILER] ${warning}`);
        _lastError = { timestamp: new Date().toLocaleString(), recipient: to, error: warning };
        return;
    }
    if (primary) {
        try {
            await primary.sendMail(msg);
            console.log(`[MAILER] Sent via Hostinger: "${subject}" → ${to}`);
            return;
        } catch (err) {
            _lastError = { timestamp: new Date().toLocaleString(), recipient: to, error: err.message, stack: err.stack };
            if (mode === 'hostinger') {
                console.error(`[MAILER] Hostinger failed (mode=hostinger, no fallback): ${err.message}`);
                throw err;
            }
            console.warn(`[MAILER] Hostinger failed (${err.message}) — trying Gmail fallback…`);
        }
    }
    if (fallback) {
        try {
            await fallback.sendMail({ ...msg, from: `"${FROM_NAME}" <${GMAIL_USER}>` });
            console.log(`[MAILER] Sent via Gmail: "${subject}" → ${to}`);
        } catch (err) {
            _lastError = { timestamp: new Date().toLocaleString(), recipient: to, error: err.message, stack: err.stack };
            console.error(`[MAILER] Gmail failed for "${subject}" to ${to}: ${err.message}`);
            throw err;
        }
    }
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statRow(label, value, valueColor) {
    return `<tr>
      <td style="padding:10px 0;font-size:14px;color:#64748b;border-bottom:1px solid rgba(255,255,255,0.05);">${label}</td>
      <td style="padding:10px 0;font-size:14px;font-weight:600;color:${valueColor || '#f8fafc'};text-align:right;border-bottom:1px solid rgba(255,255,255,0.05);">${value}</td>
    </tr>`;
}

function highlight(text, color) {
    color = color || '#f59e0b';
    const bg = color === '#ef4444' ? 'rgba(239,68,68,0.08)' : color === '#22c55e' ? 'rgba(34,197,94,0.08)' : color === '#3b82f6' ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.08)';
    const border = color;
    return `<div style="background:${bg};border-left:3px solid ${border};padding:13px 18px;border-radius:0 10px 10px 0;margin:18px 0;color:#f8fafc;font-size:14px;line-height:1.65;">${text}</div>`;
}

function inlineStyleBroadcast(html) {
    return html
        .replace(/<h1(\s[^>]*)?>/gi, '<h1$1 style="font-size:22px;font-weight:800;color:#f8fafc;margin:20px 0 10px;line-height:1.3;">')
        .replace(/<h2(\s[^>]*)?>/gi, '<h2$1 style="font-size:18px;font-weight:700;color:#f8fafc;margin:18px 0 8px;line-height:1.35;">')
        .replace(/<h3(\s[^>]*)?>/gi, '<h3$1 style="font-size:15px;font-weight:700;color:#f8fafc;margin:14px 0 6px;line-height:1.4;">')
        .replace(/<p(\s[^>]*)?>/gi, '<p$1 style="margin:10px 0;font-size:15px;line-height:1.75;color:#cbd5e1;">')
        .replace(/<ul(\s[^>]*)?>/gi, '<ul$1 style="padding-left:22px;margin:10px 0;color:#cbd5e1;">')
        .replace(/<ol(\s[^>]*)?>/gi, '<ol$1 style="padding-left:22px;margin:10px 0;color:#cbd5e1;">')
        .replace(/<li(\s[^>]*)?>/gi, '<li$1 style="margin:5px 0;font-size:15px;line-height:1.7;color:#cbd5e1;">')
        .replace(/<blockquote(\s[^>]*)?>/gi, '<blockquote$1 style="border-left:3px solid #3b82f6;margin:14px 0;padding:12px 18px;background:rgba(59,130,246,0.07);border-radius:0 10px 10px 0;color:#93c5fd;font-style:italic;font-size:15px;">')
        .replace(/<hr(\s[^>]*)?>/gi, '<hr$1 style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:18px 0;">')
        .replace(/<a(\s[^>]*)?>/gi, '<a$1 style="color:#3b82f6;text-decoration:underline;">')
        .replace(/<div(\s[^>]*)?>/gi, '<div$1 style="margin:5px 0;font-size:15px;line-height:1.75;color:#cbd5e1;">');
}

const Emails = {

    verificationCode(to, username, code) {
        return sendMail(to, `Your ${APP_NAME} verification code: ${code}`,
            wrap(
                `Your 6-digit code is inside — it expires in 30 minutes.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Thanks for joining <strong>${APP_NAME}</strong>. Use the code below to verify your email address and activate your account.</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                   <tr><td align="center">
                     <div style="display:inline-block;background:linear-gradient(135deg,rgba(59,130,246,0.12),rgba(99,102,241,0.12));border:1px solid rgba(99,102,241,0.3);border-radius:16px;padding:24px 48px;text-align:center;">
                       <div style="font-size:11px;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">Verification Code</div>
                       <div style="font-size:44px;font-weight:900;color:#f8fafc;letter-spacing:12px;font-family:monospace;">${code}</div>
                     </div>
                   </td></tr>
                 </table>
                 <p style="font-size:13px;color:#64748b;">This code expires in <strong style="color:#94a3b8;">30 minutes</strong>. If you didn't sign up for ${APP_NAME}, you can safely ignore this email.</p>`,
                'Verify My Email', `${APP_URL}/verify.html?u=${encodeURIComponent(username)}`
            ));
    },

    welcome(to, username) {
        return sendMail(to, `Welcome to ${APP_NAME}, ${username}!`,
            wrap(
                `Your account is live — here's how to start earning from day one.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Welcome aboard, ${username}!</p>
                 <p>Your <strong>${APP_NAME}</strong> account is ready. Here's what to do first:</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;">
                   <tr>
                     <td style="padding:12px 16px;background:rgba(59,130,246,0.07);border-radius:10px 10px 0 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                       <span style="font-size:18px;">💰</span>
                       <strong style="color:#f8fafc;margin-left:10px;font-size:14px;">Make your first deposit</strong>
                       <p style="margin:4px 0 0 28px;font-size:13px;color:#94a3b8;">Unlock VIP earning tiers and start compounding daily.</p>
                     </td>
                   </tr>
                   <tr>
                     <td style="padding:12px 16px;background:rgba(59,130,246,0.05);border-bottom:1px solid rgba(255,255,255,0.05);">
                       <span style="font-size:18px;">🏆</span>
                       <strong style="color:#f8fafc;margin-left:10px;font-size:14px;">Choose your VIP tier</strong>
                       <p style="margin:4px 0 0 28px;font-size:13px;color:#94a3b8;">Bronze through Diamond — earn up to 2% daily on your balance.</p>
                     </td>
                   </tr>
                   <tr>
                     <td style="padding:12px 16px;background:rgba(59,130,246,0.03);border-radius:0 0 10px 10px;">
                       <span style="font-size:18px;">🔐</span>
                       <strong style="color:#f8fafc;margin-left:10px;font-size:14px;">Set your security PIN</strong>
                       <p style="margin:4px 0 0 28px;font-size:13px;color:#94a3b8;">Required for withdrawals — keep your account protected.</p>
                     </td>
                   </tr>
                 </table>
                 <p style="font-size:13px;color:#64748b;">If you ever need help, our team is one email away at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>.</p>`,
                'Open My Dashboard', `${APP_URL}/index.html`
            ));
    },

    depositSubmitted(to, username, amount, network) {
        return sendMail(to, `Deposit of $${fmt(amount)} received — under review`,
            wrap(
                `We've received your deposit and our team is verifying it now.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>We've received your deposit and it's now in our verification queue.</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
                   ${statRow('Amount', `$${fmt(amount)} USDT`, '#3b82f6')}
                   ${statRow('Network', network, '#f8fafc')}
                   ${statRow('Status', '<span style="color:#f59e0b;font-weight:700;">⏳ Under Review</span>', '')}
                 </table>
                 <p style="font-size:13px;color:#64748b;">Verification typically takes <strong style="color:#94a3b8;">10–30 minutes</strong>. We'll send you a confirmation email the moment it's approved.</p>`
            ));
    },

    depositApproved(to, username, amount) {
        return sendMail(to, `✓ Deposit of $${fmt(amount)} approved`,
            wrap(
                `Your funds are in your wallet and earning starts immediately.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:14px;">
                   <tr><td style="padding:24px;text-align:center;">
                     <div style="font-size:12px;color:#86efac;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Deposit Approved</div>
                     <div style="font-size:36px;font-weight:900;color:#22c55e;letter-spacing:-1px;">$${fmt(amount)} USDT</div>
                     <div style="font-size:13px;color:#64748b;margin-top:6px;">added to your wallet</div>
                   </td></tr>
                 </table>
                 <p>Your deposit has been verified and credited to your account. It now counts toward your VIP eligibility and your balance is actively compounding.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`
            ));
    },

    depositRejected(to, username) {
        return sendMail(to, 'Your deposit could not be verified',
            wrap(
                `We couldn't verify your deposit — here's what to do next.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Unfortunately, we were unable to verify your most recent deposit. It has been marked as rejected.</p>
                 ${highlight('<strong>Common reasons:</strong> The transaction ID couldn\'t be found on the blockchain, the amount didn\'t match, or the screenshot was unclear. Please double-check your records and try again.', '#ef4444')}
                 <p style="font-size:13px;color:#64748b;">If you believe this is in error, please contact our support team with your transaction details and we'll investigate right away.</p>`,
                'Contact Support', `mailto:${SUPPORT_EMAIL}`
            ));
    },

    withdrawalSubmitted(to, username, amount) {
        return sendMail(to, `Withdrawal request of $${fmt(amount)} received`,
            wrap(
                `Your withdrawal is in the queue — we'll confirm once it's processed.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Your withdrawal request has been submitted and is now in our processing queue.</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
                   ${statRow('Amount Requested', `$${fmt(amount)} USDT`, '#3b82f6')}
                   ${statRow('Processing Fee', '$1.00 USDT', '#94a3b8')}
                   ${statRow('Status', '<span style="color:#f59e0b;font-weight:700;">⏳ Processing</span>', '')}
                 </table>
                 <p style="font-size:13px;color:#64748b;">You'll receive a confirmation email once the funds have been sent to your wallet address.</p>`
            ));
    },

    withdrawalApproved(to, username, amount) {
        return sendMail(to, `✓ Withdrawal of $${fmt(amount)} sent`,
            wrap(
                `Your funds are on their way to your wallet address.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:14px;">
                   <tr><td style="padding:24px;text-align:center;">
                     <div style="font-size:12px;color:#86efac;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Withdrawal Approved</div>
                     <div style="font-size:36px;font-weight:900;color:#22c55e;letter-spacing:-1px;">$${fmt(amount)} USDT</div>
                     <div style="font-size:13px;color:#64748b;margin-top:6px;">sent to your wallet</div>
                   </td></tr>
                 </table>
                 <p>Your withdrawal has been approved and broadcast to the network. Depending on network congestion, it should arrive in your wallet within a few minutes.</p>`
            ));
    },

    withdrawalRejected(to, username, amount) {
        return sendMail(to, 'Your withdrawal request was rejected',
            wrap(
                `Your withdrawal was rejected — the full amount has been refunded.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Your withdrawal request for <strong>$${fmt(amount)} USDT</strong> was rejected. The full amount has been returned to your wallet balance immediately.</p>
                 ${highlight('No funds were lost — your balance has been fully restored.', '#f59e0b')}
                 <p style="font-size:13px;color:#64748b;">If you believe this was an error or need assistance, please contact our support team.</p>`,
                'Contact Support', `mailto:${SUPPORT_EMAIL}`
            ));
    },

    transferReceived(to, username, amount, fromUser) {
        return sendMail(to, `$${fmt(amount)} received from ${fromUser}`,
            wrap(
                `Funds just landed in your wallet — check your updated balance.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:14px;">
                   <tr><td style="padding:24px;text-align:center;">
                     <div style="font-size:12px;color:#86efac;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Transfer Received</div>
                     <div style="font-size:36px;font-weight:900;color:#22c55e;letter-spacing:-1px;">+$${fmt(amount)} USDT</div>
                     <div style="font-size:13px;color:#64748b;margin-top:6px;">from <strong style="color:#94a3b8;">${fromUser}</strong></div>
                   </td></tr>
                 </table>
                 <p>The funds are already available in your wallet and will compound with your existing balance.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`
            ));
    },

    transferSent(to, username, amount, toUser) {
        return sendMail(to, `Transfer of $${fmt(amount)} sent to ${toUser}`,
            wrap(
                `Your transfer was completed — funds delivered to ${toUser}.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
                   ${statRow('Amount Sent', `$${fmt(amount)} USDT`, '#3b82f6')}
                   ${statRow('Recipient', toUser, '#f8fafc')}
                   ${statRow('Transfer Fee', '$1.00 USDT', '#94a3b8')}
                   ${statRow('Status', '<span style="color:#22c55e;font-weight:700;">✓ Completed</span>', '')}
                 </table>
                 <p style="font-size:13px;color:#64748b;">The recipient has been notified and the funds are available in their wallet immediately.</p>`
            ));
    },

    vipUpgrade(to, username, rank) {
        const RATES = { BRONZE: '0.5', SILVER: '0.75', GOLD: '1', PLATINUM: '1.5', DIAMOND: '2' };
        const COLORS = { BRONZE: '#cd7f32', SILVER: '#94a3b8', GOLD: '#f59e0b', PLATINUM: '#a78bfa', DIAMOND: '#3b82f6' };
        const EMOJI  = { BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💎', DIAMOND: '👑' };
        const color = COLORS[rank] || '#3b82f6';
        const rate  = RATES[rank] || '?';
        return sendMail(to, `${EMOJI[rank] || '🏆'} Welcome to ${rank} VIP — you're now earning ${rate}% daily`,
            wrap(
                `Congratulations — your daily earning rate just went up.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Congratulations, ${username}!</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:14px;">
                   <tr><td style="padding:26px;text-align:center;">
                     <div style="font-size:32px;margin-bottom:8px;">${EMOJI[rank] || '🏆'}</div>
                     <div style="font-size:22px;font-weight:900;color:${color};margin-bottom:6px;">${rank} VIP</div>
                     <div style="font-size:14px;color:#94a3b8;">Daily compounding return: <strong style="color:#22c55e;font-size:18px;">${rate}%</strong></div>
                   </td></tr>
                 </table>
                 <p>Your first earning will land in your wallet within 24 hours and will compound automatically every day after that. The more your balance grows, the more you earn.</p>
                 <p style="font-size:13px;color:#64748b;">Tip: reinvesting your earnings keeps your balance growing faster through the power of compounding.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`
            ));
    },

    passwordReset(to, username) {
        return sendMail(to, 'Your account password was changed',
            wrap(
                `This is a security confirmation for a recent password change.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>This is a confirmation that your <strong>${APP_NAME}</strong> account password was just changed.</p>
                 ${highlight('<strong>If this was you</strong> — no further action is needed, you\'re all set.<br><br><strong>If this wasn\'t you</strong> — contact our support team immediately as your account may be compromised.', '#f59e0b')}`,
                'Contact Support', `mailto:${SUPPORT_EMAIL}`
            ));
    },

    passwordResetByAdmin(to, username) {
        return sendMail(to, 'Your password was reset by our support team',
            wrap(
                `Our support team has reset your password — please sign in with your new credentials.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Your <strong>${APP_NAME}</strong> account password has been reset by our support team at your request.</p>
                 <p>Please sign in with the new temporary password you were given. We strongly recommend changing it immediately from your wallet's Security Center once you're logged in.</p>
                 <p style="font-size:13px;color:#64748b;">If you did not request this reset, please contact support immediately.</p>`,
                'Sign In Now', `${APP_URL}/login.html`
            ));
    },

    accountFunded(to, username, amount) {
        return sendMail(to, `$${fmt(amount)} credited to your ${APP_NAME} account`,
            wrap(
                `Funds have been added to your wallet — available immediately.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:14px;">
                   <tr><td style="padding:24px;text-align:center;">
                     <div style="font-size:12px;color:#86efac;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Account Credited</div>
                     <div style="font-size:36px;font-weight:900;color:#22c55e;letter-spacing:-1px;">$${fmt(amount)} USDT</div>
                     <div style="font-size:13px;color:#64748b;margin-top:6px;">added by our team</div>
                   </td></tr>
                 </table>
                 <p>The funds are immediately available in your wallet. If you have any questions, our support team is here to help.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`
            ));
    },

    securityAlert(to, username, eventDescription) {
        return sendMail(to, `Security alert — activity on your ${APP_NAME} account`,
            wrap(
                `We noticed account activity that you should be aware of.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>We noticed the following activity on your account:</p>
                 ${highlight(eventDescription, '#f59e0b')}
                 <p>If this was <strong>you</strong>, no action is needed — you're all set.</p>
                 <p>If you <strong>don't recognize</strong> this activity, please change your password immediately and contact our support team.</p>`
            ));
    },

    kycApproved(to, username) {
        return sendMail(to, '✓ Identity verified — your account is fully unlocked',
            wrap(
                `Your KYC has been approved — all withdrawal restrictions have been removed.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Great news, ${username}!</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:14px;">
                   <tr><td style="padding:22px;text-align:center;">
                     <div style="font-size:36px;margin-bottom:8px;">✅</div>
                     <div style="font-size:18px;font-weight:800;color:#22c55e;">KYC Approved</div>
                     <div style="font-size:13px;color:#64748b;margin-top:6px;">Your identity has been successfully verified</div>
                   </td></tr>
                 </table>
                 <p>Your account is now fully verified. All withdrawal restrictions have been lifted and you have unrestricted access to all platform features.</p>`,
                'Go to My Wallet', `${APP_URL}/wallet.html`
            ));
    },

    kycRejected(to, username, reason) {
        return sendMail(to, 'Identity verification unsuccessful — action required',
            wrap(
                `Your KYC wasn't approved — here's the reason and how to fix it.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Unfortunately your KYC submission could not be approved.</p>
                 ${highlight(`<strong>Reason:</strong> ${reason}`, '#ef4444')}
                 <p>Please resubmit with corrected documents. Make sure:</p>
                 <ul style="padding-left:20px;margin:10px 0;color:#cbd5e1;line-height:2;">
                   <li>Your ID is valid and not expired</li>
                   <li>All details are clearly visible and not cropped</li>
                   <li>The information matches what's on your account</li>
                 </ul>
                 <p style="font-size:13px;color:#64748b;">If you need help with the process, contact support and we'll guide you through it.</p>`,
                'Resubmit KYC', `${APP_URL}/kyc.html`
            ));
    },

    dormantReminder(to, username) {
        return sendMail(to, `Your ${APP_NAME} account — next steps to start earning`,
            wrap(
                `Don't miss out — your account is ready to start generating daily returns.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Dear ${username},</p>
                 <p>We noticed there's been no activity on your <strong>${APP_NAME}</strong> account since registration. Your account is active and ready — you just haven't started earning yet.</p>
                 <p>Here's a quick look at what you're missing out on:</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
                   <tr style="background:rgba(205,127,50,0.07);">
                     <td style="padding:11px 16px;font-size:14px;color:#cd7f32;font-weight:600;">🥉 Bronze VIP</td>
                     <td style="padding:11px 16px;font-size:14px;color:#f8fafc;font-weight:700;text-align:right;">0.5% daily</td>
                   </tr>
                   <tr style="background:rgba(148,163,184,0.05);">
                     <td style="padding:11px 16px;font-size:14px;color:#94a3b8;font-weight:600;">🥈 Silver VIP</td>
                     <td style="padding:11px 16px;font-size:14px;color:#f8fafc;font-weight:700;text-align:right;">0.75% daily</td>
                   </tr>
                   <tr style="background:rgba(245,158,11,0.07);">
                     <td style="padding:11px 16px;font-size:14px;color:#f59e0b;font-weight:600;">🥇 Gold VIP</td>
                     <td style="padding:11px 16px;font-size:14px;color:#f8fafc;font-weight:700;text-align:right;">1% daily</td>
                   </tr>
                   <tr style="background:rgba(167,139,250,0.07);">
                     <td style="padding:11px 16px;font-size:14px;color:#a78bfa;font-weight:600;">💎 Platinum VIP</td>
                     <td style="padding:11px 16px;font-size:14px;color:#f8fafc;font-weight:700;text-align:right;">1.5% daily</td>
                   </tr>
                   <tr style="background:rgba(59,130,246,0.08);">
                     <td style="padding:11px 16px;font-size:14px;color:#3b82f6;font-weight:600;">👑 Diamond VIP</td>
                     <td style="padding:11px 16px;font-size:14px;color:#22c55e;font-weight:800;text-align:right;">2% daily</td>
                   </tr>
                 </table>
                 <p style="font-size:13px;color:#64748b;">Questions? We're happy to help — reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>.</p>`,
                'Start Earning Now', `${APP_URL}/deposit.html`
            ));
    },

    kycReminder(to, username) {
        return sendMail(to, `Action required: Complete your identity verification`,
            wrap(
                `One step left to unlock full access — verify your identity in minutes.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Dear ${username},</p>
                 <p>Your <strong>${APP_NAME}</strong> identity verification (KYC) is still pending. This is the final step to unlock full platform access, including unrestricted withdrawals.</p>
                 ${highlight('<strong>Please note:</strong> Unverified accounts may have withdrawal restrictions. Completing your KYC removes all limitations — it only takes a few minutes.', '#3b82f6')}
                 <p>What you'll need:</p>
                 <ul style="padding-left:20px;margin:10px 0;color:#cbd5e1;line-height:2;">
                   <li>A valid government-issued photo ID (front and back)</li>
                   <li>A recent selfie (optional but recommended)</li>
                   <li>Your basic personal information</li>
                 </ul>
                 <p style="font-size:13px;color:#64748b;">If you need assistance, contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a> and we'll guide you through it.</p>`,
                'Complete My KYC Now', `${APP_URL}/kyc.html`
            ));
    },

    dailyEarning(to, username, earning, balance, ratePercent, rank, newBalance) {
        const NEXT      = { BRONZE: 'SILVER', SILVER: 'GOLD', GOLD: 'PLATINUM', PLATINUM: 'DIAMOND', DIAMOND: null };
        const RATES     = { BRONZE: '0.5', SILVER: '0.75', GOLD: '1', PLATINUM: '1.5', DIAMOND: '2' };
        const TIER_EMOJI = { BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💎', DIAMOND: '👑' };
        const nextRank  = NEXT[rank];

        const upgradeSection = nextRank
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0;background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.2);border-radius:14px;">
                 <tr><td style="padding:22px 26px;text-align:center;">
                   <div style="font-size:13px;color:#818cf8;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">Want to earn more tomorrow?</div>
                   <p style="margin:0 0 14px;font-size:13px;color:#94a3b8;line-height:1.65;">Upgrading to <strong style="color:#a5b4fc;">${TIER_EMOJI[nextRank]} ${nextRank.charAt(0) + nextRank.slice(1).toLowerCase()} VIP</strong> raises your rate from <strong style="color:#f8fafc;">${RATES[rank]}%</strong> to <strong style="color:#22c55e;">${RATES[nextRank]}%</strong> — that's <strong style="color:#22c55e;">$${fmt(newBalance * parseFloat(RATES[nextRank]) / 100)}</strong> per day instead of <strong style="color:#f8fafc;">$${fmt(newBalance * parseFloat(RATES[rank]) / 100)}</strong>.</p>
                   <a href="${APP_URL}/vip.html" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;padding:12px 30px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px;">Upgrade to ${nextRank.charAt(0) + nextRank.slice(1).toLowerCase()} VIP &rarr;</a>
                 </td></tr>
               </table>`
            : `<div style="background:rgba(99,102,241,0.07);border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:16px 20px;text-align:center;margin:24px 0;font-size:13px;color:#a5b4fc;">
                 👑 You're on our highest <strong>Diamond VIP</strong> tier — earning the maximum <strong>2% daily return</strong>. Keep compounding!
               </div>`;

        return sendMail(to, `💰 +$${fmt(earning)} earned today — ${APP_NAME}`,
            wrap(
                `+$${fmt(earning)} just landed in your wallet — your ${ratePercent}% ${rank} return for today.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Hi ${username},</p>
                 <p>Your daily compounding return has been credited to your account.</p>

                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:14px;">
                   <tr><td style="padding:26px;text-align:center;">
                     <div style="font-size:12px;color:#86efac;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${TIER_EMOJI[rank]} ${rank.charAt(0) + rank.slice(1).toLowerCase()} VIP &middot; ${ratePercent}% Daily Return</div>
                     <div style="font-size:46px;font-weight:900;color:#22c55e;letter-spacing:-2px;line-height:1;">+$${fmt(earning)}</div>
                     <div style="font-size:13px;color:#64748b;margin-top:8px;">credited to your account</div>
                   </td></tr>
                 </table>

                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
                   ${statRow('Balance before earning', `$${fmt(balance)}`, '#f8fafc')}
                   ${statRow("Today's return", `+$${fmt(earning)}`, '#22c55e')}
                   <tr>
                     <td style="padding:12px 0 4px;font-size:15px;color:#f8fafc;font-weight:700;">New balance</td>
                     <td style="padding:12px 0 4px;font-size:16px;font-weight:900;color:#3b82f6;text-align:right;">$${fmt(newBalance)}</td>
                   </tr>
                 </table>

                 ${upgradeSection}

                 <p style="font-size:13px;color:#64748b;">Returns compound automatically every 24 hours. The larger your balance, the more you earn each day.</p>`,
                'View My Dashboard', `${APP_URL}/wallet.html`
            ));
    },

    broadcastEmail(to, username, subject, bodyHtml) {
        const personalised = bodyHtml.replace(/\{username\}/gi, username);
        const styled = inlineStyleBroadcast(personalised);
        return sendMail(to, subject, wrap(
            '',
            `<p style="margin:0 0 16px;font-size:15px;color:#f8fafc;">Dear ${username},</p>
             ${styled}
             <p style="color:#64748b;font-size:13px;margin-top:24px;">Kind regards,<br><strong style="color:#94a3b8;">The ${APP_NAME} Team</strong></p>`
        ));
    },

    outreachEmail(to, subject, bodyHtml, bonusAmount = 0) {
        const styled = inlineStyleBroadcast(bodyHtml);
        const registerUrl = bonusAmount > 0
            ? `${APP_URL}/register.html?bonus=${encodeURIComponent(bonusAmount)}`
            : `${APP_URL}/register.html`;

        const bonusSection = bonusAmount > 0
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25);border-radius:14px;">
                 <tr><td style="padding:22px 26px;text-align:center;">
                   <div style="font-size:12px;color:#fbbf24;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🎁 Exclusive Welcome Bonus</div>
                   <div style="font-size:38px;font-weight:900;color:#f59e0b;letter-spacing:-1px;">$${Number(bonusAmount).toLocaleString('en-US', {minimumFractionDigits:2})}</div>
                   <div style="font-size:13px;color:#64748b;margin-top:6px;">Pre-loaded into your account the moment you register — completely free.</div>
                 </td></tr>
               </table>`
            : '';

        const preheader = bonusAmount > 0
            ? `Claim your $${Number(bonusAmount).toLocaleString('en-US', {minimumFractionDigits:2})} welcome bonus — exclusive offer for new members.`
            : `Join ${APP_NAME} and start earning daily compounding returns on your investment.`;

        const ph = `<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preheader}${PREHEADER_PAD}</span>`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0d0e16;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#f8fafc;">
  ${ph}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d0e16;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <tr><td style="padding:0 0 22px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="center">
            <tr>
              <td style="background:linear-gradient(135deg,#3b82f6,#6366f1);width:40px;height:40px;border-radius:11px;text-align:center;vertical-align:middle;font-size:17px;font-weight:900;color:#ffffff;line-height:40px;">IA</td>
              <td style="padding-left:11px;vertical-align:middle;font-size:21px;font-weight:800;color:#f8fafc;letter-spacing:0.2px;">${APP_NAME}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#13151e;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);box-shadow:0 24px 64px rgba(0,0,0,0.5);">
            <tr><td style="height:4px;background:linear-gradient(90deg,#3b82f6 0%,#6366f1 60%,#8b5cf6 100%);font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:38px 44px 34px;">
              <div style="font-size:15px;line-height:1.75;color:#cbd5e1;">${styled}</div>
              ${bonusSection}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 0;">
                <tr><td align="center">
                  <a href="${registerUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6 0%,#6366f1 100%);color:#ffffff;padding:15px 40px;border-radius:12px;font-weight:700;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:15px;letter-spacing:0.3px;">Create Free Account &rarr;</a>
                </td></tr>
              </table>
            </td></tr>
            <tr><td style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td style="padding:20px 44px 26px;text-align:center;">
              <p style="margin:0 0 5px;font-size:12px;color:#475569;line-height:1.65;">
                You received this email as part of a promotional outreach from <strong style="color:#64748b;">${APP_NAME}</strong>.
              </p>
              <p style="margin:0;font-size:12px;color:#475569;">
                To opt out, reply with <em>Unsubscribe</em> in the subject &nbsp;&middot;&nbsp; <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a> &nbsp;&middot;&nbsp; &copy; ${new Date().getFullYear()} ${APP_NAME}
              </p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="height:32px;"></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

        const plainText = [
            subject, '',
            bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim(),
            bonusAmount > 0 ? `\n🎁 Welcome Bonus: $${Number(bonusAmount).toLocaleString('en-US', {minimumFractionDigits:2})} — pre-loaded when you register.` : '',
            '', `Create your free account: ${registerUrl}`,
            '', '---',
            `You received this email as part of a promotional outreach from ${APP_NAME}.`,
            `To opt out, reply with "Unsubscribe" in the subject line.`,
        ].join('\n');

        const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@investaa.site>`;
        return sendMail(to, subject, html, {
            text: plainText,
            headers: {
                'Message-ID': msgId,
                'List-Unsubscribe': `<mailto:${SUPPORT_EMAIL}?subject=Unsubscribe>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                'Precedence': 'bulk',
                'X-Mailer': `${APP_NAME} Mailer`,
            },
        });
    },

    penaltyWarning(to, username, daysInactive) {
        return sendMail(to, `⚠️ Action required: Inactivity penalty notice — ${APP_NAME}`,
            wrap(
                `Your account has been inactive for ${daysInactive} days. A 1% inactivity penalty will be applied soon.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Dear ${username},</p>
                 <p>We've noticed your <strong>${APP_NAME}</strong> account has had <strong style="color:#f8fafc;">no new deposit in the last ${daysInactive} days</strong>.</p>
                 ${highlight(`<strong>Inactivity Notice:</strong> To keep your account in good standing, a <strong>1% inactivity fee</strong> will be deducted from your balance in the coming days if no deposit activity is recorded.`, '#f59e0b')}
                 <p>To avoid the penalty, simply make a deposit before the deadline:</p>
                 <ul style="padding-left:20px;margin:10px 0;color:#cbd5e1;line-height:2;">
                   <li>Log in to your <strong>${APP_NAME}</strong> account</li>
                   <li>Navigate to the <strong>Deposit</strong> page</li>
                   <li>Make any deposit to reset your activity status</li>
                 </ul>
                 <p style="font-size:13px;color:#64748b;">Questions? Reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a> and we'll be happy to help.</p>`,
                'Make a Deposit Now', `${APP_URL}/deposit.html`
            ));
    },

    penaltyApplied(to, username, penaltyAmount, newBalance, daysInactive) {
        const fmt = n => parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return sendMail(to, `🔔 Inactivity fee applied to your ${APP_NAME} account`,
            wrap(
                `A 1% inactivity fee of $${fmt(penaltyAmount)} has been deducted from your balance.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Dear ${username},</p>
                 <p>Because no deposit was recorded on your <strong>${APP_NAME}</strong> account for the past <strong style="color:#f8fafc;">${daysInactive} days</strong>, an inactivity fee has been applied.</p>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:14px;">
                   <tr><td style="padding:26px;text-align:center;">
                     <div style="font-size:12px;color:#fca5a5;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Inactivity Fee Deducted</div>
                     <div style="font-size:46px;font-weight:900;color:#ef4444;letter-spacing:-2px;line-height:1;">-$${fmt(penaltyAmount)}</div>
                     <div style="font-size:13px;color:#64748b;margin-top:8px;">1% of your previous balance</div>
                   </td></tr>
                 </table>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                   ${statRow('Fee Applied', `-$${fmt(penaltyAmount)}`, '#ef4444')}
                   ${statRow('Updated Balance', `$${fmt(newBalance)}`, '#22c55e')}
                 </table>
                 ${highlight(`To prevent future fees, make sure to deposit regularly. Your account activity resets with every approved deposit.`, '#3b82f6')}
                 <p style="font-size:13px;color:#64748b;">Need help? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>.</p>`,
                'Deposit Now', `${APP_URL}/deposit.html`
            ));
    },

    reEngagementReminder(to, username, vipRank, daysSince) {
        const isVip    = vipRank && vipRank !== 'REGULAR';
        const nextTiers = { REGULAR: 'Bronze', BRONZE: 'Silver', SILVER: 'Gold', GOLD: 'Platinum', PLATINUM: 'Diamond', DIAMOND: null };
        const nextTier  = nextTiers[(vipRank || 'REGULAR').toUpperCase()];

        const statusSection = isVip
            ? highlight(`Your <strong>${vipRank} VIP</strong> account has continued accruing daily returns during your absence. Log in to see your updated balance.`, '#3b82f6')
            : highlight(`Your account is funded and ready. Upgrading to a VIP tier activates daily compounding returns on your balance automatically.`, '#f59e0b');

        return sendMail(to, `We miss you — your ${APP_NAME} account needs attention`,
            wrap(
                `Your balance has been growing while you were away — log in to check it.`,
                `<p style="margin:0 0 20px;font-size:16px;color:#f8fafc;font-weight:600;">Dear ${username},</p>
                 <p>We noticed there's been no activity on your <strong>${APP_NAME}</strong> account for <strong style="color:#f8fafc;">${daysSince} days</strong>.</p>
                 ${statusSection}
                 <p>To keep your account active and in good standing, we encourage you to:</p>
                 <ul style="padding-left:20px;margin:10px 0;color:#cbd5e1;line-height:2;">
                   <li>Log in and review your current balance</li>
                   <li>Make a deposit or initiate a withdrawal</li>
                   ${nextTier ? `<li>Upgrade to <strong>${nextTier} VIP</strong> to increase your daily rate</li>` : ''}
                 </ul>
                 <p style="font-size:13px;color:#64748b;">Need help? We're always here at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>.</p>`,
                'Log In to My Account', `${APP_URL}/index.html`
            ));
    },
};

Emails.setMailerMode       = setMailerMode;
Emails.getMailerMode       = getMailerMode;
Emails.getMailerStatus     = getMailerStatus;
Emails.getLastError        = getLastError;
Emails.setSuppressionChecker = setSuppressionChecker;

module.exports = Emails;
