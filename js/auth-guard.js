(function() {
    const publicPages = ['login.html', 'register.html'];
    const path = window.location.pathname;
    const currentPage = path.split('/').pop() || 'index.html';

    // Check for authentication token
    if (!publicPages.includes(currentPage)) {
        const token = localStorage.getItem('token');
        if (!token) {
            // Not authenticated, redirect to login
            console.warn('[AUTH_GUARD] No token found, redirecting to login.html');
            window.location.replace('login.html');
        }
    }
})();
