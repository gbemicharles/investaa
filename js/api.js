const API_URL = window.location.origin + '/api';

const API = {
    async register(userData) {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        return res.json();
    },

    async verifyEmail(data) {
        const res = await fetch(`${API_URL}/auth/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.token) {
            localStorage.setItem('token', result.token);
            localStorage.setItem('user', JSON.stringify(result.user));
        }
        return result;
    },

    async resendCode(username) {
        const res = await fetch(`${API_URL}/auth/resend-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        return res.json();
    },

    async resetPassword(data) {
        const res = await fetch(`${API_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async login(loginData) {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData)
        });
        const data = await res.json();
        if (data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
        }
        return data;
    },

    async getProfile() {
        const token = localStorage.getItem('token');
        if (!token) return null;
        try {
            const res = await fetch(`${API_URL}/user/profile`, {
                headers: { 
                    'x-auth-token': token,
                    'Authorization': `Bearer ${token}`
                }
            });
            if (!res.ok) {
                if (res.status === 401) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                }
                return null;
            }
            return await res.json();
        } catch (err) {
            console.error('Profile fetch failed', err);
            return null;
        }
    },

    async deposit(amount, details) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/transactions/deposit`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ amount, details })
        });
        return res.json();
    },

    async transfer(recipient, amount) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/transactions/transfer`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ recipient, amount })
        });
        return res.json();
    },

    async withdraw(amount, details, pin) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/transactions/withdraw`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ amount, details, pin })
        });
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ msg: `HTTP ${res.status}: ${res.statusText}` }));
            throw new Error(errorData.msg || 'Withdrawal failed');
        }
        
        return res.json();
    },

    async upgrade(rank) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/user/upgrade`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ rank })
        });
        return res.json();
    },

    async getTransactions(page = 1, limit = 5) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/transactions?page=${page}&limit=${limit}`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async getLimits() {
        const token = localStorage.getItem('token');
        if (!token) return null;
        const res = await fetch(`${API_URL}/transactions/limits`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    },

    isAuthenticated() {
        return !!localStorage.getItem('token');
    },

    async submitDeposit(formData) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/transactions/submit-deposit`, {
            method: 'POST',
            headers: { 
                // Note: When sending FormData, DO NOT set Content-Type header manually
                // The browser will set it with the correct boundary
                'x-auth-token': token 
            },
            body: formData
        });
        return res.json();
    },

    // Admin Methods
    async getPendingDeposits() {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/deposits/pending`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async approveDeposit(depositId, usdtAmount) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/deposits/approve`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ deposit_id: depositId, usdt_amount: usdtAmount })
        });
        return res.json();
    },

    async rejectDeposit(depositId) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/deposits/reject`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ deposit_id: depositId })
        });
        return res.json();
    },

    async adminResetUserPassword(identifier, newPassword) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/reset-user-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
            body: JSON.stringify({ identifier, newPassword })
        });
        return res.json();
    },

    async adminFundUser(identifier, amount) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/fund-user`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ identifier, amount })
        });
        return res.json();
    },

    async getNotifications() {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/notifications`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async getUnreadCount() {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/notifications/unread-count`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async markNotificationsRead(notificationId = null) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/notifications/read`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-token': token 
            },
            body: JSON.stringify({ notification_id: notificationId })
        });
        return res.json();
    },

    async adminGetUsers() {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/users`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async adminGetPendingWithdrawals() {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/pending-withdrawals`, {
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async adminApproveWithdrawal(id) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/approve-withdrawal/${id}`, {
            method: 'POST',
            headers: { 'x-auth-token': token }
        });
        return res.json();
    },

    async adminRejectWithdrawal(id) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/admin/reject-withdrawal/${id}`, {
            method: 'POST',
            headers: { 'x-auth-token': token }
        });
        return res.json();
    }
};

// Global Logout Listener for all pages including api.js
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtns = document.querySelectorAll('.logout-btn, #logout-btn');
    logoutBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to logout?')) {
                API.logout();
            }
        });
    });
});
