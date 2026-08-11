require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const Emails   = require('./mailer');
const Telegram = require('./telegram');
const TelegramBot = require('./telegram-bot');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_in_prod';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                pin TEXT NOT NULL,
                phone TEXT DEFAULT '',
                country TEXT DEFAULT 'United States',
                balance NUMERIC DEFAULT 0,
                deposit_balance NUMERIC DEFAULT 0,
                vip_rank TEXT DEFAULT 'REGULAR',
                is_admin INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                type TEXT NOT NULL,
                amount NUMERIC NOT NULL,
                details TEXT,
                status TEXT DEFAULT 'COMPLETED',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount NUMERIC NOT NULL,
                network TEXT,
                txid TEXT,
                proof_path TEXT,
                status TEXT DEFAULT 'PENDING',
                usdt_amount NUMERIC,
                crypto_amount NUMERIC,
                exchange_rate NUMERIC,
                screenshot TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount NUMERIC NOT NULL,
                details TEXT,
                status TEXT DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'SYSTEM',
                status TEXT DEFAULT 'SYSTEM',
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Ensure 'john' has admin panel access (Case-Insensitive)
        await pool.query("UPDATE users SET is_admin = 1 WHERE LOWER(username) = LOWER('john') AND is_admin = 0");

        // Add last_earning_at column if it doesn't exist (safe migration)
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_earning_at TIMESTAMP`);

        // Email verification columns
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP`);
        // Mark all existing accounts (pre-feature) as already verified to avoid locking them out
        await pool.query(`UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0`);

        // Profile fields
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT ''`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
        // Email-change flow
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_code TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_expires TIMESTAMP`);
        // Reminder emails
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMP`);
        // KYC
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'NONE'`);
        // Moderation
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned INTEGER DEFAULT 0`);
        // Email deliverability flag — set automatically on hard bounce
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_invalid INTEGER DEFAULT 0`);
        // Welcome bonus (for outreach campaigns — locked, non-withdrawable, non-upgradeable)
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC DEFAULT 0`);
        await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS extra_document TEXT`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS kyc_submissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                country TEXT NOT NULL,
                id_type TEXT NOT NULL,
                id_number TEXT NOT NULL,
                id_document TEXT,
                id_document_back TEXT,
                selfie TEXT,
                extra_field_name TEXT,
                extra_field_value TEXT,
                extra_document TEXT,
                status TEXT DEFAULT 'PENDING',
                rejection_reason TEXT,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP
            )
        `);

        // Outreach campaign tracking + suppression list
        await pool.query(`
            CREATE TABLE IF NOT EXISTS outreach_suppressions (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                reason TEXT DEFAULT 'unsubscribe',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS outreach_campaigns (
                id SERIAL PRIMARY KEY,
                subject TEXT NOT NULL,
                total INTEGER DEFAULT 0,
                sent INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0,
                suppressed INTEGER DEFAULT 0,
                status TEXT DEFAULT 'RUNNING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Add recipients column if not already there (safe migration)
        await pool.query(`ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS recipients TEXT`);
        await pool.query(`ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS daily_limit INTEGER DEFAULT 200`);
        await pool.query(`ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC(18,2) DEFAULT 0`);
        await pool.query(`ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS body TEXT`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        // Load persisted mailer mode
        const mailerModeSetting = await pool.query(`SELECT value FROM app_settings WHERE key='mailer_mode'`);
        if (mailerModeSetting.rows.length > 0) {
            Emails.setMailerMode(mailerModeSetting.rows[0].value);
        }

        // Register suppression checker — blocks ALL emails (transactional + campaigns) for suppressed addresses
        Emails.setSuppressionChecker(async (email) => {
            const e = email.toLowerCase().trim();
            const r = await pool.query(
                `SELECT 1 FROM outreach_suppressions WHERE email=$1
                 UNION ALL
                 SELECT 1 FROM users WHERE LOWER(email)=$1 AND email_invalid=1
                 LIMIT 1`, [e]
            );
            return r.rows.length > 0;
        });

        // Mark any campaigns that were RUNNING or QUEUED when the server last died as INTERRUPTED
        await pool.query(`UPDATE outreach_campaigns SET status='INTERRUPTED' WHERE status IN ('RUNNING','QUEUED')`);

        // Auto-resume any interrupted campaigns that have a stored recipient list
        const toResume = await pool.query(
            `SELECT * FROM outreach_campaigns WHERE status='INTERRUPTED' AND recipients IS NOT NULL AND recipients <> '' ORDER BY created_at ASC`
        );
        if (toResume.rows.length > 0) {
            console.log(`[CAMPAIGNS] Auto-resuming ${toResume.rows.length} interrupted campaign(s) after server restart...`);
            for (const c of toResume.rows) {
                try {
                    const allRecipients = JSON.parse(c.recipients);
                    const alreadySent   = c.sent || 0;
                    const remaining     = allRecipients.slice(alreadySent);
                    if (!remaining.length) {
                        await pool.query("UPDATE outreach_campaigns SET status='COMPLETED' WHERE id=$1", [c.id]);
                        console.log(`[CAMPAIGNS] Campaign #${c.id} already fully sent — marked COMPLETED.`);
                        continue;
                    }
                    // Re-filter suppressed addresses
                    const suppRows   = await pool.query('SELECT email FROM outreach_suppressions');
                    const suppSet    = new Set(suppRows.rows.map(r => r.email.toLowerCase()));
                    const toSend     = remaining.filter(e => !suppSet.has(e));
                    const dailyLimit = c.daily_limit || 200;
                    if (campaignIsRunning) {
                        await pool.query("UPDATE outreach_campaigns SET status='QUEUED' WHERE id=$1", [c.id]);
                        pendingCampaignQueue.push({ id: c.id, emails: toSend, subject: c.subject, body: c.body, bonus_amount: parseFloat(c.bonus_amount) || 0, daily_limit: dailyLimit, sent: alreadySent, failed: c.failed || 0 });
                        console.log(`[CAMPAIGNS] Campaign #${c.id} queued (${toSend.length} remaining, waiting for active campaign to finish).`);
                    } else {
                        await pool.query("UPDATE outreach_campaigns SET status='RUNNING' WHERE id=$1", [c.id]);
                        console.log(`[CAMPAIGNS] Auto-resuming campaign #${c.id} from recipient ${alreadySent + 1} of ${allRecipients.length} (${toSend.length} left to send).`);
                        runCampaignQueue(c.id, toSend, c.subject, c.body, parseFloat(c.bonus_amount) || 0, dailyLimit, alreadySent, c.failed || 0);
                    }
                } catch (resumeErr) {
                    console.error(`[CAMPAIGNS] Failed to auto-resume campaign #${c.id}:`, resumeErr.message);
                    await pool.query("UPDATE outreach_campaigns SET status='INTERRUPTED' WHERE id=$1", [c.id]);
                }
            }
        }

        console.log('PostgreSQL database initialized.');
    } catch (err) {
        console.error('CRITICAL: Database initialization failed!', err);
    }
}

const EARNING_RATES = {
    BRONZE:   0.005,
    SILVER:   0.0075,
    GOLD:     0.01,
    PLATINUM: 0.015,
    DIAMOND:  0.02
};

async function applyDailyEarnings() {
    try {
        const now = new Date();
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

        // Fetch all VIP users with a positive balance whose last earning was >24h ago (or never)
        const eligibleUsers = await dbAll(
            `SELECT * FROM users WHERE vip_rank != 'REGULAR' AND balance > 0 AND (last_earning_at IS NULL OR last_earning_at <= $1)`,
            [cutoff]
        );

        if (eligibleUsers.length === 0) {
            console.log('[EARNINGS] No eligible users at this time.');
            return;
        }

        console.log(`[EARNINGS] Processing ${eligibleUsers.length} eligible users...`);

        for (const user of eligibleUsers) {
            const rate = EARNING_RATES[user.vip_rank];
            if (!rate) continue;

            const balance = parseFloat(user.balance);
            const earning = parseFloat((balance * rate).toFixed(2));
            if (earning <= 0) continue;

            const ratePercent = (rate * 100).toFixed(1).replace(/\.0$/, '');

            // Credit balance and record timestamp
            await pool.query(
                `UPDATE users SET balance = balance + $1, last_earning_at = $2 WHERE id = $3`,
                [earning, now, user.id]
            );

            // Transaction record
            await pool.query(
                `INSERT INTO transactions (user_id, type, amount, details, status) VALUES ($1, 'EARNING', $2, $3, 'COMPLETED')`,
                [user.id, earning, `Daily ${ratePercent}% ${user.vip_rank} investment return on $${balance.toFixed(2)}`]
            );

            // Notification
            await pool.query(
                `INSERT INTO notifications (user_id, title, message, type, status) VALUES ($1, $2, $3, 'SYSTEM', 'SUCCESS')`,
                [
                    user.id,
                    '💰 Daily Investment Return',
                    `You earned $${earning.toFixed(2)} USDT today — your ${ratePercent}% daily ${user.vip_rank} return on a balance of $${balance.toFixed(2)} USDT. This earning has been added to your account and will compound in the next cycle. Keep growing!`
                ]
            );

            // Daily earning email
            const newBalance = parseFloat((balance + earning).toFixed(2));
            if (user.email) {
                await sendUserEmail(user.id, () => Emails.dailyEarning(user.email, user.username, earning, balance, ratePercent, user.vip_rank, newBalance));
            }

            console.log(`[EARNINGS] Credited ${user.username}: +$${earning} (${ratePercent}% of $${balance})`);
        }

        console.log('[EARNINGS] Daily earnings cycle complete.');
    } catch (err) {
        console.error('[EARNINGS] Error during daily earnings run:', err.message);
    }
}

async function startEarningsScheduler() {
    // Run once immediately after startup (catches any users past-due)
    await applyDailyEarnings();
    // Then check every hour — only users past the 24h mark will be credited
    setInterval(applyDailyEarnings, 60 * 60 * 1000);
}

async function runReminderEmails() {
    try {
        const now = new Date();
        const sevenDaysAgo   = new Date(now - 7  * 24 * 60 * 60 * 1000);
        const fiveDaysAgo    = new Date(now - 5  * 24 * 60 * 60 * 1000);
        const threeDaysAgo   = new Date(now - 3  * 24 * 60 * 60 * 1000);

        // --- 1. Dormant reminder: registered 3+ days ago, never deposited, still REGULAR, email verified ---
        // Throttle: only remind once per 7 days
        const dormant = await dbAll(
            `SELECT id, email, username, vip_rank FROM users
             WHERE email_verified = 1
               AND vip_rank = 'REGULAR'
               AND deposit_balance = 0
               AND created_at <= $1
               AND (last_reminder_sent IS NULL OR last_reminder_sent <= $2)`,
            [threeDaysAgo, sevenDaysAgo]
        );
        for (const u of dormant) {
            await sendUserEmail(u.id, () => Emails.dormantReminder(u.email, u.username));
            await dbRun('UPDATE users SET last_reminder_sent = NOW() WHERE id = ?', [u.id]);
            console.log(`[REMINDER] Dormant reminder sent → ${u.username}`);
        }

        // --- 2. Re-engagement: has deposits but hasn't logged in for 5+ days ---
        // Throttle: only remind once per 7 days
        const inactive = await dbAll(
            `SELECT id, email, username, vip_rank, last_login FROM users
             WHERE email_verified = 1
               AND deposit_balance > 0
               AND last_login IS NOT NULL
               AND last_login <= $1
               AND (last_reminder_sent IS NULL OR last_reminder_sent <= $2)`,
            [fiveDaysAgo, sevenDaysAgo]
        );
        for (const u of inactive) {
            const daysSince = Math.floor((now - new Date(u.last_login)) / (24 * 60 * 60 * 1000));
            await sendUserEmail(u.id, () => Emails.reEngagementReminder(u.email, u.username, u.vip_rank, daysSince));
            await dbRun('UPDATE users SET last_reminder_sent = NOW() WHERE id = ?', [u.id]);
            console.log(`[REMINDER] Re-engagement sent → ${u.username} (${daysSince}d inactive)`);
        }

        if (dormant.length === 0 && inactive.length === 0) {
            console.log('[REMINDER] No reminder emails needed at this time.');
        }
    } catch (err) {
        console.error('[REMINDER] Error during reminder job:', err.message);
    }
}

async function startSchedulers() {
    await applyDailyEarnings();
    setInterval(applyDailyEarnings, 60 * 60 * 1000);

    // Run reminder check once at startup then every 24 hours
    await runReminderEmails();
    setInterval(runReminderEmails, 24 * 60 * 60 * 1000);
}

initDb().then(() => {
    startSchedulers();
    // Only run the bot polling loop in production (dev sets BOT_POLLING_ENABLED=false
    // to avoid competing with the production instance for the same bot token updates).
    if (process.env.BOT_POLLING_ENABLED !== 'false') {
        TelegramBot.startTelegramPolling(dbGet, dbRun, sendUserEmail, Emails);
    } else {
        console.log('[TELEGRAM-BOT] Polling disabled in this environment (BOT_POLLING_ENABLED=false).');
    }
});

const dbGet = async (sql, params) => {
    try {
        let idx = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
        const result = await pool.query(pgSql, params || []);
        return result.rows[0] || null;
    } catch (err) {
        console.error('Database Error in dbGet:', err.message, '| SQL:', sql);
        throw err;
    }
};

const dbAll = async (sql, params) => {
    try {
        let idx = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
        const result = await pool.query(pgSql, params || []);
        return result.rows;
    } catch (err) {
        console.error('Database Error in dbAll:', err.message, '| SQL:', sql);
        throw err;
    }
};

const dbRun = async (sql, params) => {
    try {
        let idx = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
        const result = await pool.query(pgSql, params || []);
        return { lastID: result.rows[0] ? result.rows[0].id : null, changes: result.rowCount };
    } catch (err) {
        console.error('Database Error in dbRun:', err.message, '| SQL:', sql);
        throw err;
    }
};

const dbRunReturning = async (sql, params) => {
    try {
        let idx = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++idx}`) + ' RETURNING id';
        const result = await pool.query(pgSql, params || []);
        return { lastID: result.rows[0] ? result.rows[0].id : null, changes: result.rowCount };
    } catch (err) {
        console.error('Database Error in dbRunReturning:', err.message, '| SQL:', sql);
        throw err;
    }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const PROTECTED_HTML_PAGES = new Set([
    'index.html', 'wallet.html', 'deposit.html', 'withdraw.html',
    'transfer.html', 'notifications.html', 'vip.html', 'kyc.html',
    'admin.html', 'help.html', 'support.html'
]);

function htmlAuthGuard(req, res, next) {
    const reqPath = req.path;
    const filename = reqPath === '/' ? 'index.html' : path.basename(reqPath);
    if (!PROTECTED_HTML_PAGES.has(filename)) {
        return next();
    }
    const token = req.cookies && req.cookies['auth_token'];
    if (!token) {
        return res.redirect(302, '/login.html');
    }
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.clearCookie('auth_token');
        return res.redirect(302, '/login.html');
    }
}

app.get('/robots.txt', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
`User-agent: *
Allow: /login.html
Allow: /register.html
Allow: /forgot-password.html
Allow: /help.html
Allow: /support.html
Disallow: /admin.html
Disallow: /index.html
Disallow: /deposit.html
Disallow: /kyc.html
Disallow: /notifications.html
Disallow: /transfer.html
Disallow: /vip.html
Disallow: /wallet.html
Disallow: /withdraw.html
Disallow: /api/

Sitemap: ${base}/sitemap.xml`
    );
});

app.get('/sitemap.xml', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.type('application/xml').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/login.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${base}/register.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${base}/forgot-password.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
  <url>
    <loc>${base}/help.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${base}/support.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`
    );
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// Root route: serve login page directly (200) for unauthenticated visitors and
// deployment health-check probes; redirect authenticated users to the dashboard.
app.get('/', (req, res) => {
    const token = req.cookies?.auth_token;
    if (token) {
        return res.redirect('/index.html');
    }
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.use(htmlAuthGuard);
const staticCacheOptions = {
    maxAge: 86400000, // 1 day in milliseconds
    setHeaders(res, filePath) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
};

app.use('/css', express.static(path.join(__dirname, 'css'), staticCacheOptions));
app.use('/js', express.static(path.join(__dirname, 'js'), staticCacheOptions));
app.use('/assets', express.static(path.join(__dirname, 'assets'), staticCacheOptions));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticCacheOptions));

app.use(express.static(path.join(__dirname, '.'), {
    setHeaders(res, filePath) {
        const filename = path.basename(filePath);
        if (PROTECTED_HTML_PAGES.has(filename)) {
            res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        }
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
})); // Changed to '.' for Replit root static serving

function formatUser(user) {
    if (!user) return null;
    // Strict allowlist — never leak password/pin hashes, OTP codes, or pending-change secrets.
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone || '',
        country: user.country || '',
        full_name: user.full_name || '',
        address: user.address || '',
        gender: user.gender || '',
        date_of_birth: user.date_of_birth || null,
        balance: parseFloat(user.balance || 0),
        deposit_balance: parseFloat(user.deposit_balance || 0),
        bonus_balance: parseFloat(user.bonus_balance || 0),
        vip_rank: user.vip_rank || 'REGULAR',
        is_admin: user.is_admin || 0,
        role: user.is_admin === 1 ? 'ADMIN' : 'USER',
        email_verified: user.email_verified || 0,
        pending_email: user.pending_email || null,
        last_earning_at: user.last_earning_at || null,
        created_at: user.created_at
    };
}

// FIXED: Support BOTH x-auth-token AND standard Authorization header
function authenticate(req, res, next) {
    let token = req.headers['x-auth-token'];

    // Fallback to Bearer token in Authorization header
    if (!token && req.headers['authorization']) {
        const parts = req.headers['authorization'].split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            token = parts[1];
        }
    }

    if (!token) return res.status(401).json({ msg: 'No token provided' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        res.status(401).json({ msg: 'Session expired or invalid token' });
    }
}

function authenticateAdmin(req, res, next) {
    authenticate(req, res, () => {
        if (!req.user.is_admin) return res.status(403).json({ msg: 'Admin access required' });
        next();
    });
}

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
    try {
        let { username, email, password, pin, phone, country } = req.body;
        if (!username || !email || !password || !pin) return res.status(400).json({ msg: 'All fields are required' });

        username = String(username).trim().toLowerCase();
        email = String(email).trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ msg: 'Username must be 3-20 characters, letters/numbers/underscore only — no spaces.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            return res.status(400).json({ msg: 'Please enter a valid email address.' });
        }

        const existingUsername = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        if (existingUsername) return res.status(400).json({ msg: 'That username is already taken. Please choose a different one.' });

        const existingEmail = await dbGet('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
        if (existingEmail) return res.status(400).json({ msg: 'An account with that email already exists. Please use a different email or log in.' });

        const hashed = await bcrypt.hash(password, 10);
        const hashedPin = await bcrypt.hash(pin, 10);
        const is_admin = username === 'john' ? 1 : 0;

        const result = await dbRunReturning(
            'INSERT INTO users (username, email, password, pin, phone, country, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, hashed, hashedPin, phone || '', country || 'United States', is_admin]
        );

        // Credit welcome bonus if user came via outreach link
        const bonusAmount = parseFloat(req.body.bonus_amount) || 0;
        if (bonusAmount > 0 && bonusAmount <= 100000) {
            await dbRun('UPDATE users SET bonus_balance = ? WHERE id = ?', [bonusAmount, result.lastID]);
        }

        // Generate verification code (6 digits, expires in 30 minutes)
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        // Admin accounts skip verification. Also skip if verification is disabled.
        const requiresVerification = process.env.EMAIL_VERIFICATION_REQUIRED !== 'false';
        const verifiedFlag = (!requiresVerification || is_admin) ? 1 : 0;
        await dbRun('UPDATE users SET verification_code = ?, verification_expires = ?, email_verified = ? WHERE id = ?',
            [code, expiresAt, verifiedFlag, result.lastID]);

        // Notify all admin users about new registration
        try {
            const admins = await dbAll('SELECT id FROM users WHERE is_admin = 1');
            for (const admin of admins) {
                await dbRun(
                    'INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
                    [admin.id, 'New User Registered', `${username} (${email}) just created an account.`, 'SYSTEM', 'SUCCESS']
                );
            }
        } catch (notifErr) {
            console.error('Failed to notify admins of new registration:', notifErr.message);
        }

        if (verifiedFlag === 1) {
            const userToken = jwt.sign({ id: result.lastID, username, is_admin }, JWT_SECRET, { expiresIn: '7d' });
            res.cookie('auth_token', userToken, { httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
            Emails.welcome(email, username);
            return res.json({ token: userToken, msg: 'Registration successful' });
        }

        Emails.verificationCode(email, username, code);
        res.json({ requiresVerification: true, username, email, msg: 'Verification code sent to your email' });
    } catch (e) {
        console.error('Registration failed:', e.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// Reset password using transaction PIN as verification
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        let { login, pin, newPassword } = req.body;
        if (!login || !pin || !newPassword) {
            return res.status(400).json({ msg: 'All fields are required' });
        }
        if (String(newPassword).length < 6) {
            return res.status(400).json({ msg: 'New password must be at least 6 characters' });
        }
        login = String(login).trim();
        const user = await dbGet(
            'SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)',
            [login, login]
        );
        if (!user) {
            return res.status(400).json({ msg: 'Account not found or PIN is incorrect' });
        }
        const pinOk = await bcrypt.compare(String(pin), user.pin);
        if (!pinOk) {
            return res.status(400).json({ msg: 'Account not found or PIN is incorrect' });
        }
        const hashed = await bcrypt.hash(String(newPassword), 10);
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);

        try {
            await dbRun(
                'INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
                [user.id, 'Password Changed', 'Your account password was reset successfully. If this was not you, please contact support immediately.', 'SYSTEM', 'WARNING']
            );
        } catch (_) { /* notifications table may differ; ignore */ }

        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [user.id]);
            if (u) Emails.passwordReset(u.email, u.username);
        } catch (e) {}
        res.json({ msg: 'Password reset successful. You can now sign in with your new password.' });
    } catch (e) {
        console.error('Reset password failed:', e.message);
        res.status(500).json({ msg: 'Server error during password reset' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [login, login]);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ msg: 'Invalid credentials' });
        }
        if (user.is_banned === 1) {
            return res.status(403).json({ msg: 'Your account has been suspended. Please contact support.' });
        }
        if (!user.email_verified) {
            return res.status(403).json({ msg: 'Please verify your email before logging in.', requiresVerification: true, username: user.username, email: user.email });
        }
        await dbRun('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ token, user: formatUser(user) });
    } catch (e) {
        console.error('Login failed:', e.message);
        res.status(500).json({ msg: 'Server error during login' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ msg: 'Logged out' });
});

// Email verification endpoints
app.post('/api/auth/verify-email', async (req, res) => {
    try {
        const { username, code } = req.body;
        if (!username || !code) return res.status(400).json({ msg: 'Username and code are required' });
        const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [username, username]);
        if (!user) return res.status(404).json({ msg: 'Account not found' });
        if (user.email_verified) {
            const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
            res.cookie('auth_token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
            return res.json({ token, user: formatUser(user), msg: 'Already verified' });
        }
        if (!user.verification_code || String(user.verification_code) !== String(code).trim()) {
            return res.status(400).json({ msg: 'Invalid verification code' });
        }
        if (user.verification_expires && new Date(user.verification_expires) < new Date()) {
            return res.status(400).json({ msg: 'Verification code has expired. Please request a new one.' });
        }
        await dbRun('UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?', [user.id]);
        Emails.welcome(user.email, user.username);
        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('auth_token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ token, user: formatUser({ ...user, email_verified: 1 }), msg: 'Email verified successfully' });
    } catch (e) {
        console.error('Verify email failed:', e.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.post('/api/auth/resend-code', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ msg: 'Username is required' });
        const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [username, username]);
        if (!user) return res.status(404).json({ msg: 'Account not found' });
        if (user.email_verified) return res.status(400).json({ msg: 'This email is already verified.' });
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        await dbRun('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?', [code, expiresAt, user.id]);
        Emails.verificationCode(user.email, user.username, code);
        res.json({ msg: 'A new verification code has been sent to your email.' });
    } catch (e) {
        console.error('Resend code failed:', e.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.get('/api/user/profile', authenticate, async (req, res) => {
    try {
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        const earningsRow = await dbGet('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = ?', [req.user.id, 'EARNING']);
        const formatted = formatUser(user);
        formatted.total_earnings = parseFloat(earningsRow ? earningsRow.total : 0);
        res.json(formatted);
    } catch (e) {
        res.status(500).json({ msg: 'Server error' });
    }
});

// Update profile (everything except email & username)
app.put('/api/user/profile', authenticate, async (req, res) => {
    try {
        let { full_name, address, gender, phone, country, date_of_birth } = req.body;
        full_name = (full_name || '').toString().trim().slice(0, 120);
        address   = (address   || '').toString().trim().slice(0, 250);
        gender    = (gender    || '').toString().trim().slice(0, 20);
        phone     = (phone     || '').toString().trim().slice(0, 30);
        country   = (country   || '').toString().trim().slice(0, 80);
        date_of_birth = (date_of_birth || '').toString().trim() || null;

        const allowedGenders = ['', 'Male', 'Female', 'Other', 'Prefer not to say'];
        if (!allowedGenders.includes(gender)) gender = '';

        if (date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
            return res.status(400).json({ msg: 'Date of birth must be in YYYY-MM-DD format.' });
        }

        await dbRun(
            `UPDATE users SET full_name = ?, address = ?, gender = ?, phone = ?, country = ?, date_of_birth = ? WHERE id = ?`,
            [full_name, address, gender, phone, country, date_of_birth, req.user.id]
        );

        const updated = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
        res.json({ msg: 'Profile updated successfully.', user: formatUser(updated) });
    } catch (e) {
        console.error('Update profile failed:', e.message);
        res.status(500).json({ msg: 'Failed to update profile.' });
    }
});

// Request email change — sends a 6-digit code to the NEW email
app.post('/api/user/email/request-change', authenticate, async (req, res) => {
    try {
        let { new_email } = req.body;
        new_email = (new_email || '').toString().trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
            return res.status(400).json({ msg: 'Please enter a valid email address.' });
        }
        const me = await dbGet('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
        if (!me) return res.status(404).json({ msg: 'User not found' });
        if (me.email.toLowerCase() === new_email) {
            return res.status(400).json({ msg: 'This is already your current email address.' });
        }
        const taken = await dbGet('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?', [new_email, req.user.id]);
        if (taken) return res.status(400).json({ msg: 'This email is already in use by another account.' });

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expires = new Date(Date.now() + 30 * 60 * 1000);
        await dbRun(
            'UPDATE users SET pending_email = ?, pending_email_code = ?, pending_email_expires = ? WHERE id = ?',
            [new_email, code, expires, req.user.id]
        );
        try { Emails.verificationCode(new_email, me.username, code); } catch (e) { console.error('Email send failed:', e.message); }
        res.json({ msg: `A 6-digit verification code has been sent to ${new_email}. It expires in 30 minutes.` });
    } catch (e) {
        console.error('Request email change failed:', e.message);
        res.status(500).json({ msg: 'Failed to request email change.' });
    }
});

// Confirm email change with the code sent to the new email
app.post('/api/user/email/confirm-change', authenticate, async (req, res) => {
    try {
        const code = (req.body.code || '').toString().trim();
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ msg: 'Please enter the 6-digit code.' });

        // Validate state (server-side only — code never leaves server via API)
        const me = await dbGet('SELECT id, username, pending_email, pending_email_code, pending_email_expires FROM users WHERE id = ?', [req.user.id]);
        if (!me) return res.status(404).json({ msg: 'User not found' });
        if (!me.pending_email || !me.pending_email_code) {
            return res.status(400).json({ msg: 'No email change request is pending. Please start over.' });
        }
        if (new Date(me.pending_email_expires) < new Date()) {
            return res.status(400).json({ msg: 'Verification code expired. Please request a new one.' });
        }
        if (String(me.pending_email_code) !== code) {
            return res.status(400).json({ msg: 'Incorrect verification code.' });
        }

        // Atomic conditional update — guards against TOCTOU. Catch unique-constraint race.
        const newEmail = me.pending_email;
        try {
            const result = await pool.query(
                `UPDATE users
                    SET email = $1,
                        email_verified = 1,
                        pending_email = NULL,
                        pending_email_code = NULL,
                        pending_email_expires = NULL
                  WHERE id = $2
                    AND pending_email_code = $3
                    AND pending_email_expires > NOW()`,
                [newEmail, req.user.id, code]
            );
            if (result.rowCount === 0) {
                return res.status(400).json({ msg: 'Verification could not be completed. Please request a new code.' });
            }
        } catch (dbErr) {
            if (dbErr && (dbErr.code === '23505' || /duplicate key/i.test(dbErr.message || ''))) {
                // Email got claimed by another account between request and confirm
                await dbRun('UPDATE users SET pending_email = NULL, pending_email_code = NULL, pending_email_expires = NULL WHERE id = ?', [req.user.id]);
                return res.status(400).json({ msg: 'That email was just claimed by another account. Please try a different one.' });
            }
            throw dbErr;
        }

        try { Emails.securityAlert && Emails.securityAlert(newEmail, me.username, 'Your account email has been changed successfully.'); } catch (_) {}

        const updated = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
        res.json({ msg: 'Email updated successfully.', user: formatUser(updated) });
    } catch (e) {
        console.error('Confirm email change failed:', e.message);
        res.status(500).json({ msg: 'Failed to confirm email change.' });
    }
});

// --- Admin Actions ---
// --- Admin Financial Exports & Reports ---
app.get('/api/admin/reports/users/export', authenticateAdmin, async (req, res) => {
    try {
        const users = await dbAll('SELECT id, username, email, phone, country, balance, deposit_balance, bonus_balance, vip_rank, kyc_status, created_at FROM users ORDER BY id ASC');
        let csv = 'ID,Username,Email,Phone,Country,Balance,Deposit Balance,Bonus Balance,VIP Rank,KYC Status,Created At\n';
        for (const u of users) {
            csv += `${u.id},"${u.username || ''}","${u.email || ''}","${u.phone || ''}","${u.country || ''}",${u.balance || 0},${u.deposit_balance || 0},${u.bonus_balance || 0},"${u.vip_rank || ''}","${u.kyc_status || ''}","${u.created_at || ''}"\n`;
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=users_report.csv');
        res.status(200).send(csv);
    } catch (e) {
        console.error('[REPORT-USERS] error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.get('/api/admin/reports/transactions/export', authenticateAdmin, async (req, res) => {
    try {
        const txs = await dbAll('SELECT t.id, u.username, u.email, t.type, t.amount, t.details, t.status, t.created_at FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC');
        let csv = 'TxID,Username,Email,Type,Amount,Details,Status,Created At\n';
        for (const t of txs) {
            csv += `${t.id},"${t.username || ''}","${t.email || ''}","${t.type || ''}",${t.amount || 0},"${(t.details || '').replace(/"/g, '""')}",format_status,"${t.created_at || ''}"\n`
               .replace('format_status', `"${t.status || ''}"`);
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=transactions_report.csv');
        res.status(200).send(csv);
    } catch (e) {
        console.error('[REPORT-TXS] error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.get('/api/admin/reports/kyc/export', authenticateAdmin, async (req, res) => {
    try {
        const kyc = await dbAll('SELECT k.id, u.username, u.email, k.country, k.id_type, k.id_number, k.status, k.submitted_at FROM kyc_submissions k JOIN users u ON k.user_id = u.id ORDER BY k.submitted_at DESC');
        let csv = 'KYC_ID,Username,Email,Country,ID_Type,ID_Number,Status,Submitted At\n';
        for (const k of kyc) {
            csv += `${k.id},"${k.username || ''}","${k.email || ''}","${k.country || ''}","${k.id_type || ''}","${k.id_number || ''}","${k.status || ''}","${k.submitted_at || ''}"\n`;
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=kyc_report.csv');
        res.status(200).send(csv);
    } catch (e) {
        console.error('[REPORT-KYC] error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.get('/api/admin/deposits/pending', authenticateAdmin, async (req, res) => {
    try {
        const deposits = await dbAll(`SELECT d.*, u.username, u.email FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = 'PENDING' ORDER BY d.created_at DESC`);
        res.json(deposits);
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/deposits/approve', authenticateAdmin, async (req, res) => {
    try {
        const { deposit_id, usdt_amount } = req.body;
        const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [deposit_id]);
        if (!deposit) return res.status(404).json({ msg: 'Deposit not found' });
        const amount = parseFloat(usdt_amount || deposit.amount);
        await dbRun('UPDATE deposits SET status = ? WHERE id = ?', ['APPROVED', deposit_id]);

        // Merge welcome bonus into active balance (earns daily returns) but NOT deposit_balance (so it can't be used for VIP upgrades)
        const userForBonus = await dbGet('SELECT bonus_balance FROM users WHERE id = ?', [deposit.user_id]);
        const bonusToMerge = parseFloat(userForBonus?.bonus_balance || 0);
        const totalBalanceCredit = amount + bonusToMerge;
        await dbRun(
            'UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ?, bonus_balance = 0 WHERE id = ?',
            [totalBalanceCredit, amount, deposit.user_id]
        );

        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'DEPOSIT', amount, `Via ${deposit.network}`, 'COMPLETED']);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'Deposit Approved', `Your deposit of $${amount.toFixed(2)} was approved!`, 'DEPOSIT', 'SUCCESS']);
        if (bonusToMerge > 0) {
            await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
                [deposit.user_id, 'BONUS', bonusToMerge, 'Welcome bonus activated — now earning daily returns', 'COMPLETED']);
            await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
                [deposit.user_id, '🎁 Welcome Bonus Activated!', `Your $${bonusToMerge.toFixed(2)} welcome bonus has been merged into your active balance and is now earning daily returns!`, 'SYSTEM', 'SUCCESS']);
        }
        const uDep = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]).catch(() => null);
        if (uDep) {
            sendUserEmail(deposit.user_id, () => Emails.depositApproved(uDep.email, uDep.username, amount)).catch(() => {});
            Telegram.notifyDepositApproved(uDep, amount).catch(() => {});
        }
        res.json({ msg: 'Deposit approved' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/deposits/reject', authenticateAdmin, async (req, res) => {
    try {
        const { deposit_id } = req.body;
        const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [deposit_id]);
        if (!deposit) return res.status(404).json({ msg: 'Deposit not found' });
        await dbRun('UPDATE deposits SET status = ? WHERE id = ?', ['REJECTED', deposit_id]);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'Deposit Rejected', 'Your deposit attempt was rejected.', 'DEPOSIT', 'FAILED']);
        const uDepR = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]).catch(() => null);
        if (uDepR) {
            sendUserEmail(deposit.user_id, () => Emails.depositRejected(uDepR.email, uDepR.username)).catch(() => {});
            Telegram.notifyDepositRejected(uDepR, deposit.amount).catch(() => {});
        }
        res.json({ msg: 'Deposit rejected' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/pending-withdrawals', authenticateAdmin, async (req, res) => {
    try {
        const withdrawals = await dbAll(`SELECT w.*, u.username, u.email FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.status = 'PENDING' ORDER BY w.created_at DESC`);
        res.json(withdrawals);
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/approve-withdrawal/:id', authenticateAdmin, async (req, res) => {
    try {
        const w = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
        if (!w) return res.status(404).json({ msg: 'Withdrawal not found' });
        await dbRun('UPDATE withdrawals SET status = ? WHERE id = ?', ['APPROVED', req.params.id]);
        await dbRun('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?', ['COMPLETED', w.user_id, 'WITHDRAW', w.amount, 'PENDING']);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'Withdrawal Approved', `Your withdrawal of $${parseFloat(w.amount).toFixed(2)} was processed.`, 'WITHDRAWAL', 'SUCCESS']);
        const uWA = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]).catch(() => null);
        if (uWA) {
            sendUserEmail(w.user_id, () => Emails.withdrawalApproved(uWA.email, uWA.username, w.amount)).catch(() => {});
            Telegram.notifyWithdrawalApproved(uWA, w.amount).catch(() => {});
        }
        res.json({ msg: 'Withdrawal approved' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/reject-withdrawal/:id', authenticateAdmin, async (req, res) => {
    try {
        const w = await dbGet('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
        if (!w) return res.status(404).json({ msg: 'Withdrawal not found' });
        await dbRun('UPDATE withdrawals SET status = ? WHERE id = ?', ['REJECTED', req.params.id]);
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [w.amount, w.user_id]);
        await dbRun('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?', ['REJECTED', w.user_id, 'WITHDRAW', w.amount, 'PENDING']);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [w.user_id, 'Withdrawal Rejected', `Your withdrawal was rejected and refunded.`, 'WITHDRAWAL', 'FAILED']);
        const uWR = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]).catch(() => null);
        if (uWR) {
            sendUserEmail(w.user_id, () => Emails.withdrawalRejected(uWR.email, uWR.username, w.amount)).catch(() => {});
            Telegram.notifyWithdrawalRejected(uWR, w.amount).catch(() => {});
        }
        res.json({ msg: 'Withdrawal rejected' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await dbAll(
            'SELECT id, username, email, phone, country, balance, deposit_balance, bonus_balance, vip_rank, is_admin, is_banned, email_invalid, created_at FROM users ORDER BY created_at DESC'
        );
        res.json(users.map(u => ({ ...u, balance: parseFloat(u.balance || 0), deposit_balance: parseFloat(u.deposit_balance || 0) })));
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/users/:id/clear-email-flag', authenticateAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE users SET email_invalid = 0 WHERE id = $1', [req.params.id]);
        res.json({ msg: 'Email flag cleared.' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/ban-user', authenticateAdmin, async (req, res) => {
    try {
        const { user_id } = req.body;
        const target = await dbGet('SELECT id, username, is_admin FROM users WHERE id = ?', [user_id]);
        if (!target) return res.status(404).json({ msg: 'User not found' });
        if (target.is_admin === 1) return res.status(400).json({ msg: 'Cannot ban an admin account.' });
        await dbRun('UPDATE users SET is_banned = 1 WHERE id = ?', [user_id]);
        res.json({ msg: `${target.username} has been banned.` });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/unban-user', authenticateAdmin, async (req, res) => {
    try {
        const { user_id } = req.body;
        const target = await dbGet('SELECT id, username FROM users WHERE id = ?', [user_id]);
        if (!target) return res.status(404).json({ msg: 'User not found' });
        await dbRun('UPDATE users SET is_banned = 0 WHERE id = ?', [user_id]);
        res.json({ msg: `${target.username} has been unbanned.` });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/delete-user', authenticateAdmin, async (req, res) => {
    try {
        const { user_id } = req.body;
        const target = await dbGet('SELECT id, username, is_admin FROM users WHERE id = ?', [user_id]);
        if (!target) return res.status(404).json({ msg: 'User not found' });
        if (target.is_admin === 1) return res.status(400).json({ msg: 'Cannot delete an admin account.' });
        await dbRun('DELETE FROM transactions WHERE user_id = ?', [user_id]);
        await dbRun('DELETE FROM notifications WHERE user_id = ?', [user_id]);
        await dbRun('DELETE FROM kyc_submissions WHERE user_id = ?', [user_id]);
        await dbRun('DELETE FROM deposits WHERE user_id = ?', [user_id]);
        await dbRun('DELETE FROM withdrawals WHERE user_id = ?', [user_id]);
        await dbRun('DELETE FROM users WHERE id = ?', [user_id]);
        res.json({ msg: `${target.username} has been permanently deleted.` });
    } catch (e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/set-admin', authenticateAdmin, async (req, res) => {
    try {
        const { user_id, make_admin } = req.body;
        const target = await dbGet('SELECT id, username FROM users WHERE id = ?', [user_id]);
        if (!target) return res.status(404).json({ msg: 'User not found' });
        await dbRun('UPDATE users SET is_admin = ? WHERE id = ?', [make_admin ? 1 : 0, user_id]);
        res.json({ msg: make_admin ? `${target.username} is now an admin.` : `${target.username} admin privileges removed.` });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/fund-user', authenticateAdmin, async (req, res) => {
    try {
        const { identifier, amount } = req.body;
        const user = await dbGet('SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?', [identifier, identifier, parseInt(identifier) || 0]);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        await dbRun('UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ? WHERE id = ?', [parseFloat(amount), parseFloat(amount), user.id]);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [user.id, 'DEPOSIT', parseFloat(amount), 'Admin credit', 'COMPLETED']);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [user.id, 'Account Funded', `Your account has been credited with $${amount}.`, 'SYSTEM', 'SUCCESS']);
        const uAF = await dbGet('SELECT email FROM users WHERE id = ?', [user.id]).catch(() => null);
        if (uAF) sendUserEmail(user.id, () => Emails.accountFunded(uAF.email, user.username, amount)).catch(() => {});
        res.json({ msg: `Successfully funded ${user.username} with $${amount}` });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

// Admin: reset a user's password (support flow)
app.post('/api/admin/reset-user-password', authenticateAdmin, async (req, res) => {
    try {
        const { identifier, newPassword } = req.body;
        if (!identifier || !newPassword) return res.status(400).json({ msg: 'Identifier and new password are required' });
        if (String(newPassword).length < 6) return res.status(400).json({ msg: 'New password must be at least 6 characters' });

        const user = await dbGet(
            'SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?',
            [identifier, identifier, parseInt(identifier) || 0]
        );
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const hashed = await bcrypt.hash(String(newPassword), 10);
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
        await dbRun(
            'INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
            [user.id, 'Password Reset by Admin', 'Your account password was reset by support. Please sign in with the new password and change it from your wallet if needed.', 'SYSTEM', 'WARNING']
        );
        const uPR = await dbGet('SELECT email FROM users WHERE id = ?', [user.id]).catch(() => null);
        if (uPR) sendUserEmail(user.id, () => Emails.passwordResetByAdmin(uPR.email, user.username)).catch(() => {});
        res.json({ msg: `Password reset successfully for ${user.username}` });
    } catch (e) {
        console.error('Admin reset password failed:', e.message);
        res.status(500).json({ msg: 'Server error' });
    }
});

// --- Transaction History ---
app.get('/api/transactions', authenticate, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const total = await dbGet('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?', [req.user.id]);
        const transactions = await dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [req.user.id, limit, (page-1)*limit]);
        res.json({ transactions, pagination: { currentPage: page, totalPages: Math.ceil(parseInt(total.count) / limit), total: parseInt(total.count) } });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/transactions/limits', authenticate, async (req, res) => {
    try {
        const user = await dbGet('SELECT vip_rank FROM users WHERE id = ?', [req.user.id]);
        const vipLimits = { REGULAR: { daily: 0, monthly: 0 }, BRONZE: { daily: 10, monthly: 30 }, SILVER: { daily: 100, monthly: 3000 }, GOLD: { daily: 30000, monthly: 200000 }, PLATINUM: { daily: 200000, monthly: 6000000 }, DIAMOND: { daily: 1000000, monthly: 30000000 } };
        const limits = vipLimits[user.vip_rank] || vipLimits['REGULAR'];
        const daily = await dbGet("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE user_id = ? AND status != 'REJECTED' AND created_at >= DATE_TRUNC('day', NOW())", [req.user.id]);
        const monthly = await dbGet("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE user_id = ? AND status != 'REJECTED' AND created_at >= DATE_TRUNC('month', NOW())", [req.user.id]);
        res.json({ limits, usage: { daily: parseFloat(daily.total), monthly: parseFloat(monthly.total) } });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

// --- Single Transaction Detail ---
app.get('/api/transactions/:id', authenticate, async (req, res) => {
    try {
        const tx = await dbGet('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!tx) return res.status(404).json({ msg: 'Transaction not found' });

        const result = { ...tx };

        // Resolve transfer counterparty and mask admin usernames
        if (tx.type === 'TRANSFER_OUT' && tx.details && tx.details.startsWith('To: ')) {
            const username = tx.details.slice(4).trim();
            const counterparty = await dbGet('SELECT username, is_admin FROM users WHERE LOWER(username) = LOWER(?)', [username]);
            result.counterparty_label = 'Sent To';
            result.counterparty = (counterparty && parseInt(counterparty.is_admin) === 1) ? 'Administrator' : (username || 'Unknown');
        } else if (tx.type === 'TRANSFER_IN' && tx.details && tx.details.startsWith('From: ')) {
            const username = tx.details.slice(6).trim();
            const counterparty = await dbGet('SELECT username, is_admin FROM users WHERE LOWER(username) = LOWER(?)', [username]);
            result.counterparty_label = 'Received From';
            result.counterparty = (counterparty && parseInt(counterparty.is_admin) === 1) ? 'Administrator' : (username || 'Unknown');
        }

        // Flag admin-credited deposits
        if (tx.type === 'DEPOSIT' && tx.details === 'Admin credit') {
            result.credited_by = 'Administrator';
        }

        res.json(result);
    } catch (e) {
        console.error('Transaction detail error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

// --- Actions ---
// Verification helper function for automated on-chain deposit validation
async function verifyCryptoDeposit(network, txid, expectedAmountUsdt) {
    const cleanTxid = String(txid || '').trim();
    // Reject missing, placeholder, or obviously fake TxIDs
    if (!cleanTxid || /^n\/a/i.test(cleanTxid) || cleanTxid.length < 10) {
        return { verified: false, message: 'Invalid TxID format' };
    }

    // Check if this TxID has already been approved
    const duplicate = await dbGet("SELECT id FROM deposits WHERE LOWER(txid) = LOWER(?) AND status = 'APPROVED'", [cleanTxid]);
    if (duplicate) {
        return { verified: false, message: 'Transaction hash has already been used and credited.' };
    }

    const net = String(network).toLowerCase();
    
    // 1. USDT (TRC-20) Verification
    if (net.includes('trc-20') || net.includes('usdt')) {
        try {
            const url = `https://apilist.tronscanapi.com/api/transaction-info?hash=${cleanTxid}`;
            const res = await fetch(url);
            if (!res.ok) return { verified: false, message: `Explorer API responded with status ${res.status}` };
            const data = await res.json();
            
            if (data.contractRet !== 'SUCCESS' || !data.confirmed) {
                return { verified: false, message: 'Transaction is not successful or not confirmed on-chain' };
            }
            
            // Look for a TRC-20 transfer
            const transfers = data.trc20TransferInfo || [];
            const matchingTransfer = transfers.find(t => 
                t.to_address === 'TKGiMTQcvQSgFUv6ZhRHfPTVKz7H4CP9Mo' && 
                t.symbol.toUpperCase() === 'USDT'
            );
            
            if (!matchingTransfer) {
                return { verified: false, message: 'No matching USDT transfer found to our deposit address' };
            }
            
            const actualAmount = parseFloat(matchingTransfer.amount_str) / 1000000; // 6 decimals for USDT
            if (actualAmount <= 0) {
                return { verified: false, message: 'Invalid transaction transfer amount' };
            }
            
            return { verified: true, finalAmountUsdt: actualAmount, message: `USDT TRC-20 transaction verified. Credited $${actualAmount.toFixed(2)} USDT.` };
        } catch (err) {
            console.error('[AUTO-VERIFY] USDT TRC20 Error:', err.message);
            return { verified: false, message: 'Failed to verify transaction due to network/explorer error' };
        }
    }
    
    // 2. Bitcoin Verification
    if (net.includes('bitcoin') || net.includes('lightning')) {
        if (net.includes('lightning')) {
            return { verified: false, message: 'Lightning network payments must be verified manually.' };
        }
        try {
            const url = `https://blockstream.info/api/tx/${cleanTxid}`;
            const res = await fetch(url);
            if (!res.ok) return { verified: false, message: `Blockstream API responded with status ${res.status}` };
            const data = await res.json();
            
            if (!data.status || !data.status.confirmed) {
                return { verified: false, message: 'Bitcoin transaction is not confirmed' };
            }
            
            // Find output sending to our address
            const matchingOutput = (data.vout || []).find(o => 
                o.scriptpubkey_address === 'bc1qn0xn6576hzhf7reqee3dqglvcm0305xn9l5eja'
            );
            
            if (!matchingOutput) {
                return { verified: false, message: 'No output sending to the designated BTC address' };
            }
            
            const btcAmt = matchingOutput.value / 100000000; // satoshis to BTC
            
            // Get current BTC price in USD
            let btcPrice = 65000; // Fallback
            try {
                const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
                if (priceRes.ok) {
                    const priceData = await priceRes.json();
                    if (priceData.bitcoin) btcPrice = priceData.bitcoin.usd;
                }
            } catch (pErr) {
                console.error('[AUTO-VERIFY] BTC Price Fetch Error:', pErr.message);
            }
            
            const creditedUsd = btcAmt * btcPrice;
            return { verified: true, finalAmountUsdt: creditedUsd, message: `BTC transaction verified. Credited $${creditedUsd.toFixed(2)} USD (${btcAmt.toFixed(8)} BTC at $${btcPrice.toLocaleString()}/BTC).` };
        } catch (err) {
            console.error('[AUTO-VERIFY] BTC Error:', err.message);
            return { verified: false, message: 'Failed to verify transaction due to explorer error' };
        }
    }

    // 3. ETH (ERC-20) Verification
    if (net.includes('eth') || net.includes('ethereum') || net.includes('erc-20')) {
        try {
            const url = `https://eth.blockscout.com/api/v2/transactions/${cleanTxid}`;
            const res = await fetch(url);
            if (!res.ok) return { verified: false, message: `Blockscout API responded with status ${res.status}` };
            const data = await res.json();
            
            if (data.status !== 'ok') {
                return { verified: false, message: 'Ethereum transaction failed on-chain' };
            }
            
            const isToOurAddress = data.to && data.to.hash.toLowerCase() === '0xB596C691f35b55ee095879Ecf52da180017464D7'.toLowerCase();
            if (!isToOurAddress) {
                return { verified: false, message: 'Ethereum transaction does not match our designated deposit address' };
            }
            
            const ethAmt = parseFloat(data.value) / 1e18; // in wei
            
            // Get current ETH price
            let ethPrice = 3500; // Fallback
            try {
                const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
                if (priceRes.ok) {
                    const priceData = await priceRes.json();
                    if (priceData.ethereum) ethPrice = priceData.ethereum.usd;
                }
            } catch (pErr) {
                console.error('[AUTO-VERIFY] ETH Price Fetch Error:', pErr.message);
            }
            
            const creditedUsd = ethAmt * ethPrice;
            return { verified: true, finalAmountUsdt: creditedUsd, message: `ETH transaction verified. Credited $${creditedUsd.toFixed(2)} USD (${ethAmt.toFixed(6)} ETH at $${ethPrice.toLocaleString()}/ETH).` };
        } catch (err) {
            console.error('[AUTO-VERIFY] ETH Error:', err.message);
            return { verified: false, message: 'Failed to verify transaction due to explorer error' };
        }
    }

    return { verified: false, message: `Automated on-chain verification not supported for ${network}.` };
}

app.post('/api/transactions/submit-deposit', authenticate, upload.single('proof'), async (req, res) => {
    try {
        const { amount, network, txid, usdt_amount, crypto_amount, exchange_rate } = req.body;
        const usdtAmt = parseFloat(usdt_amount || amount);
        let screenshotData = null;
        if (req.file) {
            const mime = req.file.mimetype || 'image/png';
            screenshotData = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
        }

        // Try on-chain auto-verification if TxID is provided and is not mock/empty
        let isAutoApproved = false;
        let finalCreditedAmount = usdtAmt;
        let autoVerifyMsg = '';

        if (txid && !/^n\/a/i.test(String(txid).trim()) && String(txid).trim().length >= 10) {
            const verifyResult = await verifyCryptoDeposit(network, txid, usdtAmt);
            if (verifyResult.verified) {
                isAutoApproved = true;
                finalCreditedAmount = verifyResult.finalAmountUsdt;
                autoVerifyMsg = verifyResult.message;
            } else {
                console.log(`[AUTO-VERIFY] Verification failed for TxID ${txid}: ${verifyResult.message}`);
            }
        }

        if (isAutoApproved) {
            // Auto approve the deposit immediately!
            // 1. Insert deposit as APPROVED
            await dbRunReturning(
                'INSERT INTO deposits (user_id, amount, network, txid, proof_path, screenshot, usdt_amount, crypto_amount, exchange_rate, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [req.user.id, finalCreditedAmount, network, txid, null, screenshotData, finalCreditedAmount, parseFloat(crypto_amount || amount), parseFloat(exchange_rate || 1), 'APPROVED']
            );

            // 2. Load user and welcome bonus to merge, then credit user balances
            const userForBonus = await dbGet('SELECT bonus_balance FROM users WHERE id = ?', [req.user.id]);
            const bonusToMerge = parseFloat(userForBonus?.bonus_balance || 0);
            const totalBalanceCredit = finalCreditedAmount + bonusToMerge;

            await dbRun(
                'UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ?, bonus_balance = 0 WHERE id = ?',
                [totalBalanceCredit, finalCreditedAmount, req.user.id]
            );

            // 3. Record transactions
            await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'DEPOSIT', finalCreditedAmount, `Via ${network} (Auto-Approved)`, 'COMPLETED']);
            await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, '💰 Deposit Auto-Approved', `Your deposit of $${finalCreditedAmount.toFixed(2)} USDT via ${network} was verified on-chain and credited automatically! ${autoVerifyMsg}`, 'DEPOSIT', 'SUCCESS']);

            if (bonusToMerge > 0) {
                await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
                    [req.user.id, 'BONUS', bonusToMerge, 'Welcome bonus activated — now earning daily returns', 'COMPLETED']);
                await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)',
                    [req.user.id, '🎁 Welcome Bonus Activated!', `Your $${bonusToMerge.toFixed(2)} welcome bonus has been merged into your active balance and is now earning daily returns!`, 'SYSTEM', 'SUCCESS']);
            }

            // 4. Send email & telegram
            const uDS = await dbGet('SELECT email, username FROM users WHERE id = ?', [req.user.id]).catch(() => null);
            if (uDS) {
                sendUserEmail(req.user.id, () => Emails.depositApproved(uDS.email, uDS.username, finalCreditedAmount)).catch(() => {});
                Telegram.sendTelegram(`🤖 <b>AUTO-DEPOSIT APPROVED</b>\n\n👤 <b>User:</b> ${uDS.username}\n📧 <b>Email:</b> ${uDS.email}\n💵 <b>Amount:</b> $${finalCreditedAmount.toFixed(2)} USDT\n🌐 <b>Network:</b> ${network}\n🔗 <b>TxID:</b> <code>${txid}</code>\n✔️ <i>Auto-verified on-chain</i>`).catch(() => {});
            }

            return res.json({ msg: 'Deposit verified and credited automatically', amount: finalCreditedAmount, autoApproved: true });
        }

        // If not auto-approved, fall back to standard PENDING manual review flow
        const depResult = await dbRunReturning('INSERT INTO deposits (user_id, amount, network, txid, proof_path, screenshot, usdt_amount, crypto_amount, exchange_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.user.id, parseFloat(amount), network, txid || '', null, screenshotData, usdtAmt, parseFloat(crypto_amount || amount), parseFloat(exchange_rate || 1)]);
        const depositId = depResult.lastID;
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'Deposit Submitted', `Your deposit of $${usdtAmt.toFixed(2)} USDT via ${network} has been received and is currently under review. Our team will verify your transaction and credit your account within 10–30 minutes. You will be notified once it is approved.`, 'DEPOSIT', 'PENDING']);
        const uDS = await dbGet('SELECT email, username FROM users WHERE id = ?', [req.user.id]).catch(() => null);
        if (uDS) {
            sendUserEmail(req.user.id, () => Emails.depositSubmitted(uDS.email, uDS.username, usdtAmt, network)).catch(() => {});
            Telegram.notifyDepositSubmitted(uDS, usdtAmt, network, txid, depositId).catch(() => {});
        }
        res.json({ msg: 'Deposit submitted for review', amount: usdtAmt, autoApproved: false });
    } catch (e) { 
        console.error('[DEPOSIT-SUBMIT] error:', e);
        res.status(500).json({ msg: 'Server error' }); 
    }
});


app.post('/api/transactions/withdraw', authenticate, async (req, res) => {
    try {
        const { amount, details, pin } = req.body;
        const amt = parseFloat(amount);
        const FEE = 1;
        const totalDeducted = amt + FEE;

        const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);

        // ✅ PIN check
        if (!(await bcrypt.compare(String(pin), user.pin))) {
            sendUserEmail(user.id, () => Emails.securityAlert(user.email, user.username, `An incorrect transaction PIN was entered while attempting to withdraw $${parseFloat(amount || 0).toFixed(2)} USDT from your account.`));
            return res.status(401).json({ msg: 'Invalid transaction PIN' });
        }

        // ✅ Minimum
        if (amt < 10) {
            return res.status(400).json({ msg: 'Minimum withdrawal amount is $10.00' });
        }

        // ✅ VIP LIMITS
        const vipLimits = {
            REGULAR: { daily: 0, monthly: 0 },
            BRONZE: { daily: 10, monthly: 30 },
            SILVER: { daily: 100, monthly: 3000 },
            GOLD: { daily: 30000, monthly: 200000 },
            PLATINUM: { daily: 200000, monthly: 6000000 },
            DIAMOND: { daily: 1000000, monthly: 30000000 }
        };

        const limits = vipLimits[user.vip_rank] || vipLimits['REGULAR'];

        // ❌ Block REGULAR users completely
        if (user.vip_rank === 'REGULAR') {
            return res.status(403).json({
                msg: 'Upgrade to VIP to enable withdrawals'
            });
        }

        // ❌ Block if KYC not approved
        if (user.kyc_status !== 'APPROVED') {
            return res.status(403).json({
                msg: user.kyc_status === 'PENDING'
                    ? 'Your KYC verification is under review. Withdrawals will be enabled once approved.'
                    : 'Identity verification (KYC) is required before you can withdraw. Please complete it in your wallet.',
                kyc_required: true
            });
        }

        // ✅ Get usage
        const daily = await dbGet(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM withdrawals 
             WHERE user_id = ? 
             AND status != 'REJECTED' 
             AND created_at >= DATE_TRUNC('day', NOW())`,
            [user.id]
        );

        const monthly = await dbGet(
            `SELECT COALESCE(SUM(amount), 0) as total 
             FROM withdrawals 
             WHERE user_id = ? 
             AND status != 'REJECTED' 
             AND created_at >= DATE_TRUNC('month', NOW())`,
            [user.id]
        );

        const dailyUsed = parseFloat(daily.total);
        const monthlyUsed = parseFloat(monthly.total);

        // ❌ Check daily limit
        if (dailyUsed + amt > limits.daily) {
            return res.status(400).json({
                msg: `Daily withdrawal limit exceeded. Limit: $${limits.daily}`
            });
        }

        // ❌ Check monthly limit
        if (monthlyUsed + amt > limits.monthly) {
            return res.status(400).json({
                msg: `Monthly withdrawal limit exceeded. Limit: $${limits.monthly}`
            });
        }

        // ❌ Balance check
        if (totalDeducted > parseFloat(user.balance)) {
            return res.status(400).json({
                msg: `Insufficient balance. A $${FEE} fee applies — you need $${totalDeducted.toFixed(2)}`
            });
        }

        // ✅ Deduct balance
        await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [totalDeducted, user.id]);

        // ✅ Save withdrawal
        const wResult = await dbRunReturning('INSERT INTO withdrawals (user_id, amount, details) VALUES (?, ?, ?)', [user.id, amt, details || '']);
        const withdrawalId = wResult.lastID;

        await dbRun(
            'INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
            [user.id, 'WITHDRAW', amt, details || '', 'PENDING']
        );

        await dbRun(
            'INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
            [user.id, 'FEE', FEE, 'Withdrawal processing fee', 'COMPLETED']
        );

        const uWS = await dbGet('SELECT email, username FROM users WHERE id = ?', [user.id]).catch(() => null);
        if (uWS) {
            sendUserEmail(user.id, () => Emails.withdrawalSubmitted(uWS.email, uWS.username, amt)).catch(() => {});
            Telegram.notifyWithdrawalRequested(uWS, amt, details, withdrawalId).catch(() => {});
        }
        res.json({ msg: 'Withdrawal submitted' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.post('/api/transactions/transfer', authenticate, async (req, res) => {
    try {
        const { recipient, amount } = req.body;
        const amt = parseFloat(amount);
        const sender = await dbGet('SELECT id, username, balance, vip_rank, is_admin FROM users WHERE id = ?', [req.user.id]);
        const PER_TRANSFER_CAP = { BRONZE: 5000, SILVER: 50000, GOLD: 200000, PLATINUM: 500000, DIAMOND: 2000000 };
        const cap = PER_TRANSFER_CAP[sender.vip_rank];
        if (cap && amt > cap) return res.status(400).json({ msg: `Transfer limit exceeded. Your ${sender.vip_rank} tier allows a maximum of $${cap.toLocaleString()} USDT per transfer to a single account. Please split this into multiple transfers, each at or below $${cap.toLocaleString()} USDT.` });
        if (parseFloat(sender.balance) < (amt + 1)) return res.status(400).json({ msg: 'Insufficient balance' });
        const recip = await dbGet('SELECT id, username, vip_rank, is_admin FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?', [recipient, recipient, parseInt(recipient) || 0]);
        if (!recip || recip.id === req.user.id) return res.status(404).json({ msg: 'Recipient not found' });
        if (!recip.vip_rank || recip.vip_rank === 'REGULAR') return res.status(400).json({ msg: `Transfer failed. The recipient's account is not eligible to receive funds. They must upgrade to at least VIP Bronze rank before they can receive transfers.` });
        await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [amt + 1, req.user.id]);
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [amt, recip.id]);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'TRANSFER_OUT', amt, `To: ${recip.username}`, 'COMPLETED']);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [recip.id, 'TRANSFER_IN', amt, `From: ${sender.username}`, 'COMPLETED']);
        {
            const [senderEmail, recipEmail] = await Promise.all([
                dbGet('SELECT email FROM users WHERE id = ?', [sender.id]).catch(() => null),
                dbGet('SELECT email FROM users WHERE id = ?', [recip.id]).catch(() => null),
            ]);
            const senderLabel = parseInt(sender.is_admin) === 1 ? 'Administrator' : sender.username;
            const recipLabel  = parseInt(recip.is_admin)  === 1 ? 'Administrator' : recip.username;
            if (senderEmail) sendUserEmail(sender.id, () => Emails.transferSent(senderEmail.email, sender.username, amt, recipLabel));
            if (recipEmail)  sendUserEmail(recip.id,  () => Emails.transferReceived(recipEmail.email, recip.username, amt, senderLabel));
        }
        res.json({ msg: 'Transfer successful' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/user/upgrade', authenticate, async (req, res) => {
    try {
        const { rank } = req.body;
        const costs = { BRONZE: 50, SILVER: 1000, GOLD: 3000, PLATINUM: 30000, DIAMOND: 50000 };
        const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const cost = costs[rank];
        if (parseFloat(user.deposit_balance) < cost) return res.status(400).json({ msg: `Your current deposit balance is insufficient for this upgrade. Please note that only funds deposited directly into your account count toward VIP eligibility — internal transfers received from other users do not qualify. To unlock ${rank} status, you need a cumulative deposit of at least $${cost.toLocaleString()} USDT. Please make a deposit to your account and try again.` });
        await dbRun('UPDATE users SET balance = balance - ?, deposit_balance = deposit_balance - ?, vip_rank = ? WHERE id = ?', [cost, cost, rank, req.user.id]);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'VIP_UPGRADE', cost, `Upgraded to ${rank} VIP rank`, 'COMPLETED']);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'VIP Upgrade Successful', `Congratulations! Your account has been upgraded to ${rank} VIP status. You now earn a daily investment return and enjoy all ${rank} benefits.`, 'UPGRADE', 'SUCCESS']);
        const uVIP = await dbGet('SELECT email, username FROM users WHERE id = ?', [req.user.id]).catch(() => null);
        if (uVIP) sendUserEmail(req.user.id, () => Emails.vipUpgrade(uVIP.email, uVIP.username, rank)).catch(() => {});
        res.json({ msg: `Successfully upgraded to ${rank}!` });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

// --- Notifications ---
app.get('/api/notifications', authenticate, async (req, res) => {
    try {
        const notifs = await dbAll('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
        res.json(notifs);
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/notifications/unread-count', authenticate, async (req, res) => {
    try {
        const result = await dbGet('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
        res.json({ count: parseInt(result.count) });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/notifications/read', authenticate, async (req, res) => {
    try {
        const { notification_id } = req.body;
        if (notification_id) {
            await dbRun('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [notification_id, req.user.id]);
        } else {
            await dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
        }
        res.json({ msg: 'Marked as read' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/market/prices', async (req, res) => {
    res.json({ bitcoin: { usd: 65420.50 }, ethereum: { usd: 3520.15 }, 'the-open-network': { usd: 5.20 } });
});

// ===== KYC ROUTES =====
app.get('/api/kyc/status', authenticate, async (req, res) => {
    try {
        const user = await dbGet('SELECT kyc_status FROM users WHERE id = ?', [req.user.id]);
        const submission = await dbGet(
            'SELECT id, country, id_type, status, rejection_reason, submitted_at, reviewed_at FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
            [req.user.id]
        );
        res.json({ kyc_status: user.kyc_status || 'NONE', submission: submission || null });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/kyc/submit', authenticate, upload.fields([
    { name: 'id_document', maxCount: 1 },
    { name: 'id_document_back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'extra_document', maxCount: 1 }
]), async (req, res) => {
    try {
        const user = await dbGet('SELECT kyc_status FROM users WHERE id = ?', [req.user.id]);
        if (user.kyc_status === 'APPROVED') return res.status(400).json({ msg: 'Your KYC is already approved.' });
        if (user.kyc_status === 'PENDING')  return res.status(400).json({ msg: 'Your KYC submission is already under review.' });

        const { country, id_type, id_number, extra_field_name, extra_field_value, extra_doc_required } = req.body;
        if (!country || !id_type || !id_number) return res.status(400).json({ msg: 'Country, ID type, and ID number are required.' });

        const toBase64 = (field) => {
            const files = req.files && req.files[field];
            if (!files || !files[0]) return null;
            const f = files[0];
            return `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
        };

        const id_document      = toBase64('id_document');
        const id_document_back = toBase64('id_document_back');
        const selfie           = toBase64('selfie');
        const extra_document   = toBase64('extra_document');

        if (!id_document)      return res.status(400).json({ msg: 'Front of your ID document is required.' });
        if (!id_document_back) return res.status(400).json({ msg: 'Back of your ID document is required.' });
        if (extra_doc_required === 'true' && !extra_document)
            return res.status(400).json({ msg: `A photo of your ${extra_field_name} document is required.` });

        const kResult = await dbRunReturning(
            `INSERT INTO kyc_submissions (user_id, country, id_type, id_number, id_document, id_document_back, selfie, extra_field_name, extra_field_value, extra_document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, country, id_type, id_number, id_document, id_document_back, selfie, extra_field_name || null, extra_field_value || null, extra_document || null]
        );
        const kycId = kResult.lastID;
        await dbRun('UPDATE users SET kyc_status = ? WHERE id = ?', ['PENDING', req.user.id]);
        const uKS = await dbGet('SELECT username, email, phone FROM users WHERE id = ?', [req.user.id]).catch(() => null);
        if (uKS) Telegram.notifyKycSubmitted(uKS, country, id_type, kycId).catch(() => {});
        res.json({ msg: 'KYC submitted successfully. Our team will review it within 24–48 hours.' });
    } catch (e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/kyc/pending', authenticateAdmin, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT k.id, k.user_id, k.country, k.id_type, k.id_number, k.extra_field_name, k.extra_field_value, k.status, k.submitted_at, k.reviewed_at, k.rejection_reason, u.username, u.email FROM kyc_submissions k JOIN users u ON k.user_id = u.id WHERE k.status = 'PENDING' ORDER BY k.submitted_at DESC`
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/kyc/verified', authenticateAdmin, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT k.id, k.user_id, k.country, k.id_type, k.id_number, k.extra_field_name, k.extra_field_value, k.status, k.submitted_at, k.reviewed_at, u.username, u.email, u.phone, u.country AS user_country FROM kyc_submissions k JOIN users u ON k.user_id = u.id WHERE k.status = 'APPROVED' ORDER BY k.reviewed_at DESC`
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/kyc/:id/docs', authenticateAdmin, async (req, res) => {
    try {
        const row = await dbGet(
            `SELECT id_document, id_document_back, selfie, extra_document, extra_field_name FROM kyc_submissions WHERE id = ?`,
            [req.params.id]
        );
        if (!row) return res.status(404).json({ msg: 'Not found' });
        res.json(row);
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/kyc/approve', authenticateAdmin, async (req, res) => {
    try {
        const { kyc_id } = req.body;
        const sub = await dbGet('SELECT * FROM kyc_submissions WHERE id = ?', [kyc_id]);
        if (!sub) return res.status(404).json({ msg: 'Submission not found' });
        await dbRun('UPDATE kyc_submissions SET status = ?, reviewed_at = NOW() WHERE id = ?', ['APPROVED', kyc_id]);
        await dbRun('UPDATE users SET kyc_status = ? WHERE id = ?', ['APPROVED', sub.user_id]);
        const uKA = await dbGet('SELECT email, username, phone FROM users WHERE id = ?', [sub.user_id]).catch(() => null);
        if (uKA) {
            sendUserEmail(sub.user_id, () => Emails.kycApproved(uKA.email, uKA.username)).catch(() => {});
            Telegram.notifyKycApproved(sub, uKA).catch(() => {});
        }
        res.json({ msg: 'KYC approved' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/kyc/reject', authenticateAdmin, async (req, res) => {
    try {
        const { kyc_id, reason } = req.body;
        const sub = await dbGet('SELECT * FROM kyc_submissions WHERE id = ?', [kyc_id]);
        if (!sub) return res.status(404).json({ msg: 'Submission not found' });
        const rejReason = reason || 'Did not meet requirements';
        await dbRun('UPDATE kyc_submissions SET status = ?, rejection_reason = ?, reviewed_at = NOW() WHERE id = ?', ['REJECTED', rejReason, kyc_id]);
        await dbRun('UPDATE users SET kyc_status = ? WHERE id = ?', ['REJECTED', sub.user_id]);
        const uKR = await dbGet('SELECT email, username FROM users WHERE id = ?', [sub.user_id]).catch(() => null);
        if (uKR) sendUserEmail(sub.user_id, () => Emails.kycRejected(uKR.email, uKR.username, rejReason)).catch(() => {});
        res.json({ msg: 'KYC rejected' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

// --- Email Centre ---
app.get('/api/admin/email/mailer-status', authenticateAdmin, (req, res) => {
    res.json({ ok: true, ...Emails.getMailerStatus() });
});

app.post('/api/admin/email/mailer-mode', authenticateAdmin, async (req, res) => {
    const { mode } = req.body;
    if (!['auto','hostinger','gmail'].includes(mode)) {
        return res.status(400).json({ ok: false, msg: 'Invalid mode. Use: auto, hostinger, or gmail.' });
    }
    Emails.setMailerMode(mode);
    try {
        await pool.query(
            `INSERT INTO app_settings (key, value) VALUES ('mailer_mode', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [mode]
        );
    } catch (e) {
        console.error('[MAILER-MODE]', e.message);
    }
    res.json({ ok: true, mode, msg: `Mailer mode set to "${mode}".` });
});

app.post('/api/admin/email/test', authenticateAdmin, async (req, res) => {
    try {
        const admin = await pool.query('SELECT email, username FROM users WHERE id = $1', [req.user.id]);
        const a = admin.rows[0];
        if (!a || !a.email) return res.status(400).json({ ok: false, msg: 'No email on your admin account.' });
        const status = Emails.getMailerStatus();
        const mode   = status.mode;
        if (mode === 'hostinger' && !status.hostinger) return res.status(500).json({ ok: false, msg: 'Hostinger credentials (SMTP_USER/SMTP_PASS) are not configured.' });
        if (mode === 'gmail'     && !status.gmail)     return res.status(500).json({ ok: false, msg: 'Gmail credentials (GMAIL_USER/GMAIL_APP_PASSWORD) are not configured.' });
        if (mode === 'auto' && !status.hostinger && !status.gmail) return res.status(500).json({ ok: false, msg: 'No email credentials configured in environment.' });
        await Emails.securityAlert(a.email, a.username, 'Test email fired from the Admin Email Centre — if you received this, email is working correctly.');
        res.json({ ok: true, msg: `Test email sent to ${a.email} via ${mode === 'auto' ? 'auto (Hostinger → Gmail)' : mode}. Check your inbox.` });
    } catch (e) {
        console.error('[EMAIL-TEST]', e);
        res.status(500).json({ ok: false, msg: e.message });
    }
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function drip(users, sendFn, label) {
    let sent = 0, failed = 0;
    for (const u of users) {
        try {
            await sendFn(u);
            sent++;
            console.log(`[EMAIL-DRIP] ${label} → ${u.email} (${sent}/${users.length})`);
        } catch(e) {
            failed++;
            console.error(`[EMAIL-DRIP] Failed → ${u.email}:`, e.message);
        }
        await sleep(400); // 400 ms gap — ~150 emails/min, well within Gmail limits
    }
    console.log(`[EMAIL-DRIP] ${label} complete — sent:${sent} failed:${failed}`);
}

app.post('/api/admin/email/kyc-reminder', authenticateAdmin, async (req, res) => {
    try {
        const users = await dbAll(
            `SELECT u.email, u.username FROM users u
             WHERE u.email_verified = 1 AND u.is_admin = 0
               AND (u.kyc_status IS NULL OR u.kyc_status NOT IN ('APPROVED','PENDING'))`
        );
        if (!users.length) return res.json({ msg: 'No eligible users found (all are verified or already pending).', sent: 0 });

        // Respond immediately — emails drip in the background
        res.json({ msg: `KYC reminder queued for ${users.length} user${users.length !== 1 ? 's' : ''}. Emails are being sent now.`, sent: users.length });
        drip(users, (u) => Emails.kycReminder(u.email, u.username), 'KYC-REMINDER');
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/email/broadcast', authenticateAdmin, async (req, res) => {
    try {
        const { audience, subject, body } = req.body;
        if (!audience || !subject || !body) return res.status(400).json({ msg: 'Audience, subject, and message are required.' });

        const audienceMap = {
            all:          `WHERE u.email_verified = 1 AND u.is_admin = 0`,
            kyc_verified: `WHERE u.email_verified = 1 AND u.is_admin = 0 AND u.kyc_status = 'APPROVED'`,
            regular:      `WHERE u.email_verified = 1 AND u.is_admin = 0 AND (u.vip_rank IS NULL OR u.vip_rank = 'REGULAR')`,
            bronze:       `WHERE u.email_verified = 1 AND u.is_admin = 0 AND UPPER(u.vip_rank) = 'BRONZE'`,
            silver:       `WHERE u.email_verified = 1 AND u.is_admin = 0 AND UPPER(u.vip_rank) = 'SILVER'`,
            gold:         `WHERE u.email_verified = 1 AND u.is_admin = 0 AND UPPER(u.vip_rank) = 'GOLD'`,
            platinum:     `WHERE u.email_verified = 1 AND u.is_admin = 0 AND UPPER(u.vip_rank) = 'PLATINUM'`,
            diamond:      `WHERE u.email_verified = 1 AND u.is_admin = 0 AND UPPER(u.vip_rank) = 'DIAMOND'`,
        };
        const where = audienceMap[audience.toLowerCase()];
        if (!where) return res.status(400).json({ msg: 'Invalid audience selection.' });

        const users = await dbAll(`SELECT u.email, u.username FROM users u ${where}`);
        if (!users.length) return res.json({ msg: 'No users found for the selected audience.', sent: 0 });

        // Respond immediately — emails drip in the background
        res.json({ msg: `Broadcast queued for ${users.length} user${users.length !== 1 ? 's' : ''}. Emails are being sent now.`, sent: users.length });
        drip(users, (u) => Emails.broadcastEmail(u.email, u.username, subject, body), `BROADCAST:${subject}`);
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

// ===== ANALYTICS ROUTES =====

function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function getVipColor(rank) {
    const colors = { BRONZE: '#cd7f32', SILVER: '#c0c0c0', GOLD: '#ffd700', PLATINUM: '#e5e4e2', DIAMOND: '#b9f2ff', REGULAR: '#94a3b8' };
    return colors[rank] || '#94a3b8';
}

app.get('/api/public/stats', async (req, res) => {
    try {
        const [members, paid, active] = await Promise.all([
            dbGet(`SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0 AND is_banned = 0`),
            dbGet(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'EARNING' AND status = 'COMPLETED'`),
            dbGet(`SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0 AND is_banned = 0 AND balance > 0`)
        ]);
        res.json({
            total_members: (parseInt(members.cnt) || 0) + 24318,
            total_paid_out: parseFloat(paid.total) || 0,
            active_investors: (parseInt(active.cnt) || 0) + 19847,
            uptime: 99.9
        });
    } catch (e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/user/balance-history', authenticate, async (req, res) => {
    try {
        const daysMap = { '7': 7, '30': 30, '90': 90, '365': 365 };
        const days = daysMap[req.query.days] || 30;
        const userId = req.user.id;

        const user = await dbGet(`SELECT balance FROM users WHERE id = ?`, [userId]);
        const currentBalance = parseFloat(user.balance) || 0;

        const rows = await dbAll(
            `SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day,
             SUM(CASE
               WHEN type IN ('DEPOSIT', 'EARNING', 'TRANSFER_IN') THEN amount
               WHEN type IN ('WITHDRAW', 'TRANSFER_OUT', 'VIP_UPGRADE', 'FEE') THEN -amount
               ELSE 0
             END) as net_change
             FROM transactions
             WHERE user_id = ? AND created_at >= NOW() - INTERVAL '${days} days' AND status = 'COMPLETED'
             GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') ORDER BY day ASC`,
            [userId]
        );

        const changeMap = {};
        let totalChange = 0;
        rows.forEach(r => {
            const k = String(r.day).slice(0, 10);
            changeMap[k] = parseFloat(r.net_change) || 0;
            totalChange += changeMap[k];
        });

        let balance = currentBalance - totalChange;
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            balance += (changeMap[key] || 0);
            result.push({ date: key, balance: Math.max(0, parseFloat(balance.toFixed(2))) });
        }

        const startBalance = result[0]?.balance || 0;
        const endBalance = result[result.length - 1]?.balance || 0;
        const change = endBalance - startBalance;
        const changePct = startBalance > 0 ? (change / startBalance * 100) : 0;

        res.json({ points: result, change, changePct, currentBalance });
    } catch (e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/public/activity', async (req, res) => {
    try {
        const [rows, activeRow] = await Promise.all([
            dbAll(
                `SELECT t.type, t.amount, t.created_at, u.vip_rank
                 FROM transactions t
                 JOIN users u ON u.id = t.user_id
                 WHERE t.type IN ('VIP_UPGRADE', 'DEPOSIT', 'EARNING', 'TRANSFER_IN')
                   AND t.status = 'COMPLETED'
                   AND u.is_admin = 0
                 ORDER BY t.created_at DESC
                 LIMIT 15`,
                []
            ),
            dbGet(`SELECT COUNT(*) as cnt FROM users WHERE is_admin = 0 AND is_banned = 0 AND balance > 0`)
        ]);

        const SYNTHETIC = [
            { icon: 'gem',        color: '#b9f2ff', text: '💎 A user just upgraded to <strong>Diamond VIP</strong>',                  time: 'just now'   },
            { icon: 'coins',      color: '#10b981', text: '🎉 <strong>$1,247.80</strong> in earnings paid out today',                  time: '2 min ago'  },
            { icon: 'users',      color: '#3b82f6', text: '👤 New investor joined from <strong>United Kingdom</strong>',              time: '5 min ago'  },
            { icon: 'medal',      color: '#ffd700', text: '🥇 A user upgraded to <strong>Gold VIP</strong>',                          time: '9 min ago'  },
            { icon: 'chart-line', color: '#f97316', text: '📈 Portfolio milestone reached: <strong>$100K total deposits</strong>',    time: '14 min ago' },
            { icon: 'coins',      color: '#10b981', text: '💰 <strong>$863.44</strong> distributed to investors',                     time: '21 min ago' },
            { icon: 'gem',        color: '#e5e4e2', text: '💎 A user upgraded to <strong>Platinum VIP</strong>',                      time: '29 min ago' },
            { icon: 'users',      color: '#3b82f6', text: '👤 New investor joined from <strong>Canada</strong>',                      time: '36 min ago' },
            { icon: 'coins',      color: '#10b981', text: '🎉 <strong>$2,190.00</strong> in earnings paid out',                       time: '44 min ago' },
            { icon: 'medal',      color: '#c0c0c0', text: '🥈 A user upgraded to <strong>Silver VIP</strong>',                        time: '1h ago'     },
            { icon: 'users',      color: '#3b82f6', text: '👤 New investor joined from <strong>Australia</strong>',                   time: '1h ago'     },
            { icon: 'coins',      color: '#10b981', text: '💰 <strong>$540.20</strong> in daily returns distributed',                 time: '2h ago'     },
        ];

        const vipEmoji = { BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💎', DIAMOND: '💎' };
        const realFeed = rows.map(r => {
            const ago = getTimeAgo(r.created_at);
            const amt = parseFloat(r.amount).toFixed(2);
            if (r.type === 'VIP_UPGRADE') {
                const e = vipEmoji[r.vip_rank] || '⭐';
                return { icon: 'gem', color: getVipColor(r.vip_rank), text: `${e} A user just upgraded to <strong>${r.vip_rank} VIP</strong>`, time: ago };
            } else if (r.type === 'EARNING') {
                return { icon: 'coins', color: '#10b981', text: `🎉 <strong>$${amt}</strong> in earnings paid out`, time: ago };
            } else if (r.type === 'DEPOSIT') {
                return { icon: 'users', color: '#3b82f6', text: `👤 New investor deposit received`, time: ago };
            } else {
                return { icon: 'sync-alt', color: '#8b5cf6', text: `💸 A member completed a transfer`, time: ago };
            }
        });

        // Real entries first; synthetic fills the rest up to 10
        const combined = [...realFeed];
        for (let i = 0; combined.length < 10 && i < SYNTHETIC.length; i++) {
            combined.push(SYNTHETIC[i]);
        }

        res.json({ feed: combined.slice(0, 10), active_count: (parseInt(activeRow.cnt) || 0) + 19847 });
    } catch (e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

// --- Smart Outreach Queue helpers ---
// ── Campaign queue state ────────────────────────────────────────────────────
let campaignIsRunning     = false;  // true while one campaign is actively sending
let campaignStopRequested = false;  // set to true by the stop endpoint; cleared when campaign stops
let pendingCampaignQueue  = [];     // waiting campaigns: [{ id, emails, subject, body, bonus_amount, daily_limit, sent, failed }]

function startNextQueued() {
    if (campaignIsRunning || pendingCampaignQueue.length === 0) return;
    const next = pendingCampaignQueue.shift();
    pool.query("UPDATE outreach_campaigns SET status='RUNNING' WHERE id=$1", [next.id])
        .then(() => {
            console.log(`[CAMPAIGNS] Starting queued campaign #${next.id} (${pendingCampaignQueue.length} still waiting)`);
            runCampaignQueue(next.id, next.emails, next.subject, next.body, next.bonus_amount, next.daily_limit, next.sent, next.failed);
        })
        .catch(err => console.error('[CAMPAIGNS] Error starting queued campaign:', err.message));
}
// ───────────────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function isHardBounce(err) {
    const msg = (err.message || '').toLowerCase();
    const code = err.responseCode || 0;
    return code >= 550 || msg.includes('user unknown') || msg.includes('does not exist') ||
        msg.includes('no such user') || msg.includes('invalid address') || msg.includes('mailbox not found');
}

// Wrap any user-targeted email send — auto-flags the user on hard bounce
async function sendUserEmail(userId, emailFn) {
    try {
        await emailFn();
    } catch (err) {
        if (isHardBounce(err)) {
            await pool.query('UPDATE users SET email_invalid = 1 WHERE id = $1', [userId]).catch(() => {});
            console.warn(`[EMAIL] Hard bounce — user #${userId} email flagged as invalid`);
        } else {
            console.error(`[EMAIL] Delivery failed for user #${userId}:`, err.message);
        }
    }
}

app.post('/api/admin/email/outreach', authenticateAdmin, async (req, res) => {
    try {
        const { emails, subject, body } = req.body;
        if (!emails || !subject || !body) return res.status(400).json({ msg: 'emails, subject, and body are required.' });
        const rawList = typeof emails === 'string' ? emails : emails.join('\n');
        const parsed = rawList.split(/[\n,;]+/).map(e => e.trim().toLowerCase())
            .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        const unique = [...new Set(parsed)];
        if (!unique.length) return res.status(400).json({ msg: 'No valid email addresses found.' });
        if (unique.length > 500) return res.status(400).json({ msg: 'Maximum 500 addresses per send. Split into batches.' });

        const bonus_amount = parseFloat(req.body.bonus_amount) || 0;
        const daily_limit  = Math.max(10, Math.min(parseInt(req.body.daily_limit) || 200, 500));

        // Filter suppressed
        const suppressedRows = await dbAll('SELECT email FROM outreach_suppressions', []);
        const suppressedSet  = new Set(suppressedRows.map(r => r.email.toLowerCase()));
        const active         = unique.filter(e => !suppressedSet.has(e));
        const suppressedCount = unique.length - active.length;
        if (!active.length) return res.status(400).json({ msg: 'All addresses are on the suppression list.' });

        // Shuffle order
        const shuffled = shuffleArray(active);

        const willQueue = campaignIsRunning;
        const initialStatus = willQueue ? 'QUEUED' : 'RUNNING';

        // Create campaign record (store full recipient list + settings for resumability)
        const campRow = await pool.query(
            'INSERT INTO outreach_campaigns (subject, total, suppressed, status, recipients, daily_limit, bonus_amount, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
            [subject, shuffled.length, suppressedCount, initialStatus, JSON.stringify(shuffled), daily_limit, bonus_amount, body]
        );
        const campaignId = campRow.rows[0].id;

        if (willQueue) {
            pendingCampaignQueue.push({ id: campaignId, emails: shuffled, subject, body, bonus_amount, daily_limit, sent: 0, failed: 0 });
            const position = pendingCampaignQueue.length;
            res.json({
                msg: `Campaign #${campaignId} queued (position ${position}) — it will start automatically when the current campaign finishes. ${shuffled.length} recipients ready${suppressedCount ? `, ${suppressedCount} suppressed` : ''}.`,
                campaign_id: campaignId, total: shuffled.length, suppressed: suppressedCount, queued: true, queue_position: position
            });
        } else {
            res.json({
                msg: `Campaign #${campaignId} started — ${shuffled.length} recipients queued${suppressedCount ? `, ${suppressedCount} suppressed` : ''}. Sending ~${daily_limit}/day with randomised intervals.`,
                campaign_id: campaignId, total: shuffled.length, suppressed: suppressedCount
            });
            runCampaignQueue(campaignId, shuffled, subject, body, bonus_amount, daily_limit, 0, 0);
        }
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

// Interruptible sleep — wakes every second to check the stop flag
async function sleepInterruptible(ms) {
    const tick = 1000;
    let elapsed = 0;
    while (elapsed < ms) {
        if (campaignStopRequested) return;
        await sleep(Math.min(tick, ms - elapsed));
        elapsed += tick;
    }
}

// Shared campaign queue runner (used by both new campaigns and resumes)
async function runCampaignQueue(campaignId, emailList, subject, body, bonus_amount, daily_limit, startSent, startFailed) {
    campaignIsRunning     = true;
    campaignStopRequested = false;
    const baseMs = (86400 / daily_limit) * 1000;
    let sent = startSent, failed = startFailed;
    let stoppedManually = false;
    try {
        for (let i = 0; i < emailList.length; i++) {
            // Check stop flag before each send
            if (campaignStopRequested) {
                stoppedManually = true;
                console.log(`[CAMPAIGN #${campaignId}] Stop requested — pausing at recipient ${sent + 1}.`);
                break;
            }
            const email = emailList[i];
            let success = false;
            for (let attempt = 1; attempt <= 2 && !success; attempt++) {
                try {
                    await Emails.outreachEmail(email, subject, body, bonus_amount);
                    success = true; sent++;
                    await pool.query('UPDATE outreach_campaigns SET sent=$1 WHERE id=$2', [sent, campaignId]);
                    console.log(`[CAMPAIGN #${campaignId}] ${sent}/${startSent + emailList.length} ✓ ${email}`);
                } catch (err) {
                    console.warn(`[CAMPAIGN #${campaignId}] attempt ${attempt} failed for ${email}: ${err.message}`);
                    if (isHardBounce(err)) {
                        await pool.query('INSERT INTO outreach_suppressions (email, reason) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING', [email, 'hard_bounce']);
                        break;
                    } else if (attempt < 2) {
                        await sleepInterruptible(60000);
                    }
                }
            }
            if (!success) {
                failed++;
                await pool.query('UPDATE outreach_campaigns SET failed=$1 WHERE id=$2', [failed, campaignId]);
            }
            if (i < emailList.length - 1) {
                const jitter = (Math.random() * 0.6 - 0.3) * baseMs;
                await sleepInterruptible(Math.max(5000, Math.round(baseMs + jitter)));
            }
        }
        if (stoppedManually) {
            await pool.query("UPDATE outreach_campaigns SET status='INTERRUPTED' WHERE id=$1", [campaignId]);
            console.log(`[CAMPAIGN #${campaignId}] Stopped manually — sent:${sent} failed:${failed}. Can be resumed.`);
        } else {
            await pool.query("UPDATE outreach_campaigns SET status='COMPLETED' WHERE id=$1", [campaignId]);
            console.log(`[CAMPAIGN #${campaignId}] Done — sent:${sent} failed:${failed}`);
        }
    } catch (err) {
        console.error(`[CAMPAIGN #${campaignId}] Queue error:`, err.message);
        await pool.query("UPDATE outreach_campaigns SET status='INTERRUPTED' WHERE id=$1", [campaignId]);
    } finally {
        campaignIsRunning     = false;
        campaignStopRequested = false;
        startNextQueued(); // auto-start next queued campaign (even after a manual stop)
    }
}

// Resume an interrupted campaign from where it left off
app.post('/api/admin/email/campaigns/:id/resume', authenticateAdmin, async (req, res) => {
    try {
        const campRow = await pool.query('SELECT * FROM outreach_campaigns WHERE id=$1', [req.params.id]);
        if (!campRow.rows.length) return res.status(404).json({ msg: 'Campaign not found.' });
        const c = campRow.rows[0];
        if (c.status === 'RUNNING') return res.status(400).json({ msg: 'Campaign is already running.' });
        if (c.status === 'COMPLETED') return res.status(400).json({ msg: 'Campaign already completed.' });
        if (!c.recipients) return res.status(400).json({ msg: 'No recipient list stored — please start a new campaign.' });

        const allRecipients = JSON.parse(c.recipients);
        const alreadySent   = c.sent || 0;
        const remaining     = allRecipients.slice(alreadySent); // skip already-sent ones

        if (!remaining.length) {
            await pool.query("UPDATE outreach_campaigns SET status='COMPLETED' WHERE id=$1", [c.id]);
            return res.json({ msg: 'All recipients already sent to — campaign marked completed.' });
        }

        // Re-filter suppressed in case new entries were added since original send
        const suppressedRows = await dbAll('SELECT email FROM outreach_suppressions', []);
        const suppressedSet  = new Set(suppressedRows.map(r => r.email.toLowerCase()));
        const toSend = remaining.filter(e => !suppressedSet.has(e));

        const daily_limit = Math.max(10, Math.min(parseInt(req.body.daily_limit) || c.daily_limit || 200, 500));

        if (campaignIsRunning) {
            // Another campaign is currently active — queue this resume
            await pool.query("UPDATE outreach_campaigns SET status='QUEUED', daily_limit=$1 WHERE id=$2", [daily_limit, c.id]);
            pendingCampaignQueue.push({ id: c.id, emails: toSend, subject: c.subject, body: c.body, bonus_amount: parseFloat(c.bonus_amount) || 0, daily_limit, sent: alreadySent, failed: c.failed || 0 });
            const position = pendingCampaignQueue.length;
            return res.json({
                msg: `Campaign #${c.id} queued for resume (position ${position}) — it will continue from recipient ${alreadySent + 1} once the active campaign finishes.`,
                campaign_id: c.id, remaining: toSend.length, queued: true, queue_position: position
            });
        }

        await pool.query("UPDATE outreach_campaigns SET status='RUNNING', daily_limit=$1 WHERE id=$2", [daily_limit, c.id]);

        res.json({
            msg: `Campaign #${c.id} resumed — ${toSend.length} remaining recipients queued (${alreadySent} already sent). Sending ~${daily_limit}/day.`,
            campaign_id: c.id, remaining: toSend.length, already_sent: alreadySent
        });

        runCampaignQueue(c.id, toSend, c.subject, c.body, parseFloat(c.bonus_amount) || 0, daily_limit, alreadySent, c.failed || 0);
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

// Extend a completed campaign — reuse same subject/body/bonus, send to new recipients
app.post('/api/admin/email/campaigns/:id/extend', authenticateAdmin, async (req, res) => {
    try {
        const campRow = await pool.query('SELECT * FROM outreach_campaigns WHERE id=$1', [req.params.id]);
        if (!campRow.rows.length) return res.status(404).json({ msg: 'Campaign not found.' });
        const orig = campRow.rows[0];

        const { emails, daily_limit: rawLimit } = req.body;
        if (!emails) return res.status(400).json({ msg: 'No emails provided.' });
        const rawList = typeof emails === 'string' ? emails : emails.join('\n');
        const parsed  = rawList.split(/[\n,;]+/).map(e => e.trim().toLowerCase())
            .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        const unique = [...new Set(parsed)];
        if (!unique.length) return res.status(400).json({ msg: 'No valid email addresses found.' });
        if (unique.length > 500) return res.status(400).json({ msg: 'Maximum 500 addresses per send. Split into batches.' });

        const daily_limit = Math.max(10, Math.min(parseInt(rawLimit) || orig.daily_limit || 200, 500));

        // Filter suppressed
        const suppRows  = await pool.query('SELECT email FROM outreach_suppressions');
        const suppSet   = new Set(suppRows.rows.map(r => r.email.toLowerCase()));
        const active    = unique.filter(e => !suppSet.has(e));
        const suppCount = unique.length - active.length;
        if (!active.length) return res.status(400).json({ msg: 'All addresses are on the suppression list.' });

        const shuffled = shuffleArray(active);
        const willQueue = campaignIsRunning;
        const newStatus = willQueue ? 'QUEUED' : 'RUNNING';

        const newCamp = await pool.query(
            'INSERT INTO outreach_campaigns (subject, total, suppressed, status, recipients, daily_limit, bonus_amount, body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
            [orig.subject, shuffled.length, suppCount, newStatus, JSON.stringify(shuffled), daily_limit, orig.bonus_amount, orig.body]
        );
        const newId = newCamp.rows[0].id;

        if (willQueue) {
            pendingCampaignQueue.push({ id: newId, emails: shuffled, subject: orig.subject, body: orig.body, bonus_amount: parseFloat(orig.bonus_amount) || 0, daily_limit, sent: 0, failed: 0 });
            return res.json({ msg: `Campaign #${newId} queued — ${shuffled.length} new recipients${suppCount ? `, ${suppCount} suppressed` : ''}. Starts when the active campaign finishes.`, campaign_id: newId, queued: true });
        }

        res.json({ msg: `Campaign #${newId} started — ${shuffled.length} new recipients${suppCount ? `, ${suppCount} suppressed` : ''}. Sending ~${daily_limit}/day.`, campaign_id: newId });
        runCampaignQueue(newId, shuffled, orig.subject, orig.body, parseFloat(orig.bonus_amount) || 0, daily_limit, 0, 0);
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

// Stop a running campaign (marks INTERRUPTED, auto-starts next queued)
app.post('/api/admin/email/campaigns/:id/stop', authenticateAdmin, async (req, res) => {
    try {
        const campRow = await pool.query('SELECT id, status FROM outreach_campaigns WHERE id=$1', [req.params.id]);
        if (!campRow.rows.length) return res.status(404).json({ msg: 'Campaign not found.' });
        const c = campRow.rows[0];
        if (c.status !== 'RUNNING') return res.status(400).json({ msg: `Campaign is not currently running (status: ${c.status}).` });
        // Set the stop flag regardless of in-memory state — loop will honour it; if loop already exited, mark interrupted directly
        campaignStopRequested = true;
        if (!campaignIsRunning) {
            await pool.query("UPDATE outreach_campaigns SET status='INTERRUPTED' WHERE id=$1 AND status='RUNNING'", [c.id]);
            startNextQueued();
        }
        res.json({ msg: `Campaign #${c.id} stopping — sending will pause after the current email. The next queued campaign (if any) will start automatically.` });
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/email/campaigns', authenticateAdmin, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT id, subject, total, sent, failed, suppressed, status, daily_limit, bonus_amount, created_at,
                    CASE WHEN recipients IS NOT NULL AND recipients <> '' THEN 1 ELSE 0 END AS has_recipients
             FROM outreach_campaigns ORDER BY created_at DESC LIMIT 20`,
            []
        );
        res.json({ campaigns: rows });
    } catch(e) { res.status(500).json({ msg: 'Server error' }); }
});

// Get remaining (unsent) recipients for a campaign
app.get('/api/admin/email/campaigns/:id/recipients', authenticateAdmin, async (req, res) => {
    try {
        const campRow = await pool.query('SELECT sent, recipients, status, total FROM outreach_campaigns WHERE id=$1', [req.params.id]);
        if (!campRow.rows.length) return res.status(404).json({ msg: 'Campaign not found.' });
        const c = campRow.rows[0];
        if (!c.recipients) return res.status(400).json({ msg: 'No recipient list stored for this campaign.' });
        const all      = JSON.parse(c.recipients);
        const alreadySent = c.sent || 0;
        const remaining   = all.slice(alreadySent);
        res.json({ total: all.length, sent: alreadySent, remaining: remaining.length, emails: remaining });
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

// Delete a campaign record (only COMPLETED or INTERRUPTED — cannot delete active ones)
app.delete('/api/admin/email/campaigns/:id', authenticateAdmin, async (req, res) => {
    try {
        const campRow = await pool.query('SELECT id, status FROM outreach_campaigns WHERE id=$1', [req.params.id]);
        if (!campRow.rows.length) return res.status(404).json({ msg: 'Campaign not found.' });
        const c = campRow.rows[0];
        if (!['COMPLETED', 'INTERRUPTED'].includes(c.status)) {
            return res.status(400).json({ msg: `Cannot delete a ${c.status} campaign — stop it first.` });
        }
        await pool.query('DELETE FROM outreach_campaigns WHERE id=$1', [c.id]);
        res.json({ msg: `Campaign #${c.id} deleted.` });
    } catch(e) { console.error(e); res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/email/suppression', authenticateAdmin, async (req, res) => {
    try {
        const list = await dbAll('SELECT * FROM outreach_suppressions ORDER BY created_at DESC', []);
        res.json({ list });
    } catch(e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/email/suppression/add', authenticateAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ msg: 'Email required.' });
        const e = email.toLowerCase().trim();
        await pool.query('INSERT INTO outreach_suppressions (email, reason) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING', [e, 'manual']);
        // Also flag the user account so transactional emails are blocked too
        await pool.query('UPDATE users SET email_invalid=1 WHERE LOWER(email)=$1', [e]);
        res.json({ msg: 'Added to suppression list. All emails (including transactional) are now blocked for this address.' });
    } catch(e) { res.status(500).json({ msg: 'Server error' }); }
});

app.post('/api/admin/email/suppression/remove', authenticateAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        const e = email.toLowerCase().trim();
        await pool.query('DELETE FROM outreach_suppressions WHERE email=$1', [e]);
        // Clear the email_invalid flag so transactional emails resume
        await pool.query('UPDATE users SET email_invalid=0 WHERE LOWER(email)=$1', [e]);
        res.json({ msg: 'Removed from suppression list. Transactional emails will resume for this address.' });
    } catch(e) { res.status(500).json({ msg: 'Server error' }); }
});

// --- Inactivity Penalty ---
const PENALTY_DAYS = 14;
const PENALTY_RATE = 0.01; // 1%

// GET: preview which users are inactive (no approved deposit in 14 days, balance > 0)
app.get('/api/admin/users/inactive', authenticateAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.email, u.balance,
                   MAX(d.created_at) AS last_deposit_at
            FROM users u
            LEFT JOIN deposits d ON d.user_id = u.id AND d.status = 'APPROVED'
            WHERE u.is_admin = 0
              AND (u.is_banned IS NULL OR u.is_banned = 0)
              AND (u.email_invalid IS NULL OR u.email_invalid = 0)
              AND u.balance > 0
              AND u.vip_rank != 'REGULAR'
            GROUP BY u.id, u.username, u.email, u.balance
            HAVING MAX(d.created_at) IS NULL
                OR MAX(d.created_at) < NOW() - INTERVAL '${PENALTY_DAYS} days'
            ORDER BY u.balance DESC
        `);
        const users = result.rows.map(u => ({
            ...u,
            days_inactive: u.last_deposit_at
                ? Math.floor((Date.now() - new Date(u.last_deposit_at).getTime()) / 86400000)
                : null,
            penalty_amount: parseFloat((parseFloat(u.balance) * PENALTY_RATE).toFixed(2)),
        }));
        res.json({ users, count: users.length });
    } catch(e) {
        console.error('[PENALTY] inactive list error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

// In-memory email job tracker (survives across requests, resets on restart)
const emailJob = { active: false, type: '', total: 0, sent: 0, failed: 0, done: false, startedAt: null };

const BATCH_SIZE  = 10;   // emails per batch
const BATCH_PAUSE = 30000; // ms between batches (30 s)

async function runEmailBatch(users, emailFn, label) {
    emailJob.active    = true;
    emailJob.done      = false;
    emailJob.total     = users.length;
    emailJob.sent      = 0;
    emailJob.failed    = 0;
    emailJob.startedAt = Date.now();

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        for (const u of batch) {
            try {
                await emailFn(u);
                emailJob.sent++;
            } catch(e) {
                console.error(`[${label}] Failed → ${u.email}:`, e.message);
                emailJob.failed++;
            }
            await new Promise(r => setTimeout(r, 1500)); // 1.5 s between individual emails
        }
        // Pause between batches (skip after last batch)
        if (i + BATCH_SIZE < users.length) {
            console.log(`[${label}] Batch done — waiting ${BATCH_PAUSE / 1000}s before next batch…`);
            await new Promise(r => setTimeout(r, BATCH_PAUSE));
        }
    }
    emailJob.done   = true;
    emailJob.active = false;
    console.log(`[${label}] Email job complete — sent:${emailJob.sent} failed:${emailJob.failed}`);
}

// GET: live email job progress
app.get('/api/admin/users/penalty-email-status', authenticateAdmin, (req, res) => {
    res.json({ ...emailJob });
});

// POST: send warning emails to all inactive users (background batches)
app.post('/api/admin/users/penalty-warn', authenticateAdmin, async (req, res) => {
    if (emailJob.active) return res.status(409).json({ msg: 'An email job is already running. Check progress above.' });
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.email,
                   MAX(d.created_at) AS last_deposit_at
            FROM users u
            LEFT JOIN deposits d ON d.user_id = u.id AND d.status = 'APPROVED'
            WHERE u.is_admin = 0
              AND (u.is_banned IS NULL OR u.is_banned = 0)
              AND (u.email_invalid IS NULL OR u.email_invalid = 0)
              AND u.balance > 0
              AND u.vip_rank != 'REGULAR'
            GROUP BY u.id, u.username, u.email, u.balance
            HAVING MAX(d.created_at) IS NULL
                OR MAX(d.created_at) < NOW() - INTERVAL '${PENALTY_DAYS} days'
        `);
        const users = result.rows.map(u => ({
            ...u,
            daysInactive: u.last_deposit_at
                ? Math.floor((Date.now() - new Date(u.last_deposit_at).getTime()) / 86400000)
                : PENALTY_DAYS,
        }));

        emailJob.type = 'warn';
        // Respond immediately — emails fire in background
        res.json({ ok: true, total: users.length, msg: `Warning emails queued for ${users.length} users.` });

        // Background batch send (no await)
        runEmailBatch(users, u => Emails.penaltyWarning(u.email, u.username, u.daysInactive), 'PENALTY-WARN').catch(console.error);
    } catch(e) {
        console.error('[PENALTY-WARN] error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

const PENALTY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// GET: cooldown status for the penalty apply button
app.get('/api/admin/users/penalty-cooldown', authenticateAdmin, async (req, res) => {
    try {
        const r = await pool.query(`SELECT value FROM app_settings WHERE key='penalty_last_applied' LIMIT 1`);
        if (!r.rows.length) return res.json({ onCooldown: false, lastApplied: null, remainingMs: 0 });
        const lastApplied = new Date(r.rows[0].value).getTime();
        const elapsed     = Date.now() - lastApplied;
        const remaining   = Math.max(0, PENALTY_COOLDOWN_MS - elapsed);
        res.json({ onCooldown: remaining > 0, lastApplied: r.rows[0].value, remainingMs: remaining });
    } catch(e) {
        res.status(500).json({ msg: 'Server error' });
    }
});

// POST: apply 1% penalty instantly to DB, then send emails in background batches
app.post('/api/admin/users/penalty-apply', authenticateAdmin, async (req, res) => {
    if (emailJob.active) return res.status(409).json({ msg: 'An email job is already running. Check progress above.' });

    // 24-hour cooldown check
    try {
        const r = await pool.query(`SELECT value FROM app_settings WHERE key='penalty_last_applied' LIMIT 1`);
        if (r.rows.length) {
            const elapsed = Date.now() - new Date(r.rows[0].value).getTime();
            if (elapsed < PENALTY_COOLDOWN_MS) {
                const remaining = PENALTY_COOLDOWN_MS - elapsed;
                const hrs  = Math.floor(remaining / 3600000);
                const mins = Math.floor((remaining % 3600000) / 60000);
                return res.status(429).json({ msg: `Cooldown active — next penalty available in ${hrs}h ${mins}m.`, onCooldown: true, remainingMs: remaining });
            }
        }
    } catch(e) { /* non-fatal — proceed */ }
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.email, u.balance,
                   MAX(d.created_at) AS last_deposit_at
            FROM users u
            LEFT JOIN deposits d ON d.user_id = u.id AND d.status = 'APPROVED'
            WHERE u.is_admin = 0
              AND (u.is_banned IS NULL OR u.is_banned = 0)
              AND (u.email_invalid IS NULL OR u.email_invalid = 0)
              AND u.balance > 0
              AND u.vip_rank != 'REGULAR'
            GROUP BY u.id, u.username, u.email, u.balance
            HAVING MAX(d.created_at) IS NULL
                OR MAX(d.created_at) < NOW() - INTERVAL '${PENALTY_DAYS} days'
        `);
        const users = result.rows;

        // Apply all DB penalties immediately
        let applied = 0, dbFailed = 0;
        const emailQueue = [];
        for (const u of users) {
            const penalty    = parseFloat((parseFloat(u.balance) * PENALTY_RATE).toFixed(2));
            const newBalance = parseFloat((parseFloat(u.balance) - penalty).toFixed(2));
            const daysInactive = u.last_deposit_at
                ? Math.floor((Date.now() - new Date(u.last_deposit_at).getTime()) / 86400000)
                : PENALTY_DAYS;
            try {
                await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, u.id]);
                await pool.query(
                    `INSERT INTO transactions (user_id, type, amount, details, status)
                     VALUES ($1, 'PENALTY', $2, $3, 'COMPLETED')`,
                    [u.id, -penalty, `1% inactivity fee — no deposit in ${daysInactive} days`]
                );
                emailQueue.push({ ...u, penalty, newBalance, daysInactive });
                applied++;
            } catch(e) {
                console.error(`[PENALTY-APPLY] DB failed → ${u.email}:`, e.message);
                dbFailed++;
            }
        }

        // Stamp the cooldown timestamp
        await pool.query(
            `INSERT INTO app_settings (key, value) VALUES ('penalty_last_applied', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [new Date().toISOString()]
        );

        emailJob.type = 'apply';
        // Respond immediately with DB result
        res.json({ ok: true, applied, dbFailed, total: users.length, emailTotal: emailQueue.length, lastApplied: new Date().toISOString() });

        // Background batch emails (no await)
        runEmailBatch(emailQueue, u => Emails.penaltyApplied(u.email, u.username, u.penalty, u.newBalance, u.daysInactive), 'PENALTY-APPLY').catch(console.error);
    } catch(e) {
        console.error('[PENALTY-APPLY] error:', e);
        res.status(500).json({ msg: 'Server error' });
    }
});

app.get('*path', (req, res) => {
    res.status(404).send('Not Found');
});
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`); 
    console.log('*** PRODUCTION BUILD V3.0.1 (POSTGRES READY) ACTIVE ***');
});
