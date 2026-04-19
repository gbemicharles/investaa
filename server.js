require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const Emails = require('./mailer');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_in_prod';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

const upload = multer({ dest: path.join(__dirname, 'uploads/') });

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

        console.log('PostgreSQL database initialized.');
    } catch (err) {
        console.error('CRITICAL: Database initialization failed!', err);
    }
}

const EARNING_RATES = {
    BRONZE:   0.01,
    SILVER:   0.02,
    GOLD:     0.025,
    PLATINUM: 0.04,
    DIAMOND:  0.05
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

initDb().then(() => {
    startEarningsScheduler();
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
app.use(express.static(path.join(__dirname, '.'))); // Changed to '.' for Replit root static serving
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function formatUser(user) {
    if (!user) return null;
    return {
        ...user,
        role: user.is_admin === 1 ? 'ADMIN' : 'USER',
        balance: parseFloat(user.balance || 0),
        deposit_balance: parseFloat(user.deposit_balance || 0)
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

        const existing = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [username, email]);
        if (existing) return res.status(400).json({ msg: 'Username or email already exists' });

        const hashed = await bcrypt.hash(password, 10);
        const hashedPin = await bcrypt.hash(pin, 10);
        const is_admin = username === 'john' ? 1 : 0;

        const result = await dbRunReturning(
            'INSERT INTO users (username, email, password, pin, phone, country, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, hashed, hashedPin, phone || '', country || 'United States', is_admin]
        );

        // Generate verification code (6 digits, expires in 30 minutes)
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        // Admin accounts skip verification
        const verifiedFlag = is_admin ? 1 : 0;
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

        if (is_admin) {
            const userToken = jwt.sign({ id: result.lastID, username, is_admin: 1 }, JWT_SECRET, { expiresIn: '7d' });
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
        const token = jwt.sign({ id: user.id, username: user.username, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: formatUser(user) });
    } catch (e) {
        console.error('Login failed:', e.message);
        res.status(500).json({ msg: 'Server error during login' });
    }
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

// --- Admin Actions ---
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
        await dbRun('UPDATE users SET balance = balance + ?, deposit_balance = deposit_balance + ? WHERE id = ?', [amount, amount, deposit.user_id]);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'DEPOSIT', amount, `Via ${deposit.network}`, 'COMPLETED']);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [deposit.user_id, 'Deposit Approved', `Your deposit of $${amount.toFixed(2)} was approved!`, 'DEPOSIT', 'SUCCESS']);
        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]);
            if (u) Emails.depositApproved(u.email, u.username, amount);
        } catch (e) {}
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
        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [deposit.user_id]);
            if (u) Emails.depositRejected(u.email, u.username);
        } catch (e) {}
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
        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]);
            if (u) Emails.withdrawalApproved(u.email, u.username, w.amount);
        } catch (e) {}
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
        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [w.user_id]);
            if (u) Emails.withdrawalRejected(u.email, u.username, w.amount);
        } catch (e) {}
        res.json({ msg: 'Withdrawal rejected' });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
});

app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await dbAll(
            'SELECT id, username, email, phone, country, balance, deposit_balance, vip_rank, is_admin, created_at FROM users ORDER BY created_at DESC'
        );
        res.json(users.map(u => ({ ...u, balance: parseFloat(u.balance || 0), deposit_balance: parseFloat(u.deposit_balance || 0) })));
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
        try {
            const u = await dbGet('SELECT email FROM users WHERE id = ?', [user.id]);
            if (u) Emails.accountFunded(u.email, user.username, amount);
        } catch (e) {}
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
        try {
            const u = await dbGet('SELECT email FROM users WHERE id = ?', [user.id]);
            if (u) Emails.passwordResetByAdmin(u.email, user.username);
        } catch (e) {}
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

// --- Actions ---
app.post('/api/transactions/submit-deposit', authenticate, upload.single('proof'), async (req, res) => {
    try {
        const { amount, network, txid, usdt_amount, crypto_amount, exchange_rate } = req.body;
        const proof_path = req.file ? req.file.path : null;
        const usdtAmt = parseFloat(usdt_amount || amount);
        await dbRunReturning('INSERT INTO deposits (user_id, amount, network, txid, proof_path, usdt_amount, crypto_amount, exchange_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.user.id, parseFloat(amount), network, txid || '', proof_path, usdtAmt, parseFloat(crypto_amount || amount), parseFloat(exchange_rate || 1)]);
        await dbRun('INSERT INTO notifications (user_id, title, message, type, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'Deposit Submitted', `Your deposit of $${usdtAmt.toFixed(2)} USDT via ${network} has been received and is currently under review. Our team will verify your transaction and credit your account within 10–30 minutes. You will be notified once it is approved.`, 'DEPOSIT', 'PENDING']);
        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
            if (u) Emails.depositSubmitted(u.email, u.username, usdtAmt, network);
        } catch (e) {}
        res.json({ msg: 'Deposit submitted for review', amount: usdtAmt });
    } catch (e) { res.status(500).json({ msg: 'Server error' }); }
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
            try {
                Emails.securityAlert(user.email, user.username, `An incorrect transaction PIN was entered while attempting to withdraw $${parseFloat(amount || 0).toFixed(2)} USDT from your account.`);
            } catch (e) {}
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
        await dbRun('INSERT INTO withdrawals (user_id, amount, details) VALUES (?, ?, ?)', [user.id, amt, details || '']);

        await dbRun(
            'INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
            [user.id, 'WITHDRAW', amt, details || '', 'PENDING']
        );

        await dbRun(
            'INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)',
            [user.id, 'FEE', FEE, 'Withdrawal processing fee', 'COMPLETED']
        );

        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [user.id]);
            if (u) Emails.withdrawalSubmitted(u.email, u.username, amt);
        } catch (e) {}
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
        const sender = await dbGet('SELECT id, username, balance, vip_rank FROM users WHERE id = ?', [req.user.id]);
        const PER_TRANSFER_CAP = { BRONZE: 5000, SILVER: 50000, GOLD: 200000, PLATINUM: 500000, DIAMOND: 2000000 };
        const cap = PER_TRANSFER_CAP[sender.vip_rank];
        if (cap && amt > cap) return res.status(400).json({ msg: `Transfer limit exceeded. Your ${sender.vip_rank} tier allows a maximum of $${cap.toLocaleString()} USDT per transfer to a single account. Please split this into multiple transfers, each at or below $${cap.toLocaleString()} USDT.` });
        if (parseFloat(sender.balance) < (amt + 1)) return res.status(400).json({ msg: 'Insufficient balance' });
        const recip = await dbGet('SELECT id, username, vip_rank FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?) OR id = ?', [recipient, recipient, parseInt(recipient) || 0]);
        if (!recip || recip.id === req.user.id) return res.status(404).json({ msg: 'Recipient not found' });
        if (!recip.vip_rank || recip.vip_rank === 'REGULAR') return res.status(400).json({ msg: `Transfer failed. The recipient's account is not eligible to receive funds. They must upgrade to at least VIP Bronze rank before they can receive transfers.` });
        await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [amt + 1, req.user.id]);
        await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [amt, recip.id]);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'TRANSFER_OUT', amt, `To: ${recip.username}`, 'COMPLETED']);
        await dbRun('INSERT INTO transactions (user_id, type, amount, details, status) VALUES (?, ?, ?, ?, ?)', [recip.id, 'TRANSFER_IN', amt, `From: ${sender.username}`, 'COMPLETED']);
        try {
            const [senderEmail, recipEmail] = await Promise.all([
                dbGet('SELECT email FROM users WHERE id = ?', [sender.id]),
                dbGet('SELECT email FROM users WHERE id = ?', [recip.id]),
            ]);
            if (senderEmail) Emails.transferSent(senderEmail.email, sender.username, amt, recip.username);
            if (recipEmail) Emails.transferReceived(recipEmail.email, recip.username, amt, sender.username);
        } catch (e) {}
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
        try {
            const u = await dbGet('SELECT email, username FROM users WHERE id = ?', [req.user.id]);
            if (u) Emails.vipUpgrade(u.email, u.username, rank);
        } catch (e) {}
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

app.get('*path', (req, res) => {
    // If the request looks like an asset (has a dot) but wasn't caught by static middleware, return 404
    if (req.path.includes('.') || req.path.startsWith('/api')) {
        return res.status(404).send('Not Found');
    }

    const indexPath = path.join(__dirname, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('CRITICAL: Failed to serve index.html from:', indexPath);
            console.error('If you see this, make sure index.html is in the SAME folder as server.js!');
            res.status(500).send('Project Error: index.html is missing from the server root. File structure audit required.');
        }
    });
});
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`); 
    console.log('*** PRODUCTION BUILD V3.0.1 (POSTGRES READY) ACTIVE ***');
});
