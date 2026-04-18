document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

async function initDashboard() {
    // Update live data
    await updateCryptoPrices();
    
    // Set interval for updates (every 60 seconds to avoid rate limits)
    setInterval(updateCryptoPrices, 60000);

    initSidebarToggle();
}

function initSidebarToggle() {
    const menuToggle = document.querySelector('.menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!menuToggle || !sidebar) return;

    // Backdrop overlay (created once)
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
    }

    const close = () => {
        sidebar.classList.remove('open');
        backdrop.classList.remove('show');
        document.body.style.overflow = '';
    };
    const open = () => {
        sidebar.classList.add('open');
        backdrop.classList.add('show');
        document.body.style.overflow = 'hidden';
    };

    menuToggle.addEventListener('click', () => {
        sidebar.classList.contains('open') ? close() : open();
    });
    backdrop.addEventListener('click', close);

    // Close when navigating to another page link inside sidebar
    sidebar.querySelectorAll('a').forEach(a => a.addEventListener('click', close));

    // Close when window grows past mobile breakpoint
    window.addEventListener('resize', () => {
        if (window.innerWidth > 1024) close();
    });
}

async function updateCryptoPrices() {
    const listContainer = document.getElementById('crypto-list');
    const cryptoIds = ['bitcoin', 'ethereum', 'solana', 'tether'];
    
    const data = await CryptoAPI.getMarketPrices(cryptoIds);
    
    if (listContainer) {
        listContainer.innerHTML = ''; // Clear skeleton/old items
        
        cryptoIds.forEach(id => {
            if (data[id]) {
                const item = data[id];
                const changeClass = item.usd_24h_change >= 0 ? 'positive' : 'negative';
                const sign = item.usd_24h_change >= 0 ? '+' : '';
                
                const cryptoHtml = `
                    <div class="crypto-item">
                        <div class="crypto-icon">
                            <i class="fab fa-${id === 'bitcoin' ? 'bitcoin' : id === 'ethereum' ? 'ethereum' : 'google-wallet'}"></i>
                        </div>
                        <div class="crypto-info">
                            <span class="symbol">${id.toUpperCase()}</span>
                            <span class="name">${id.charAt(0).toUpperCase() + id.slice(1)}</span>
                        </div>
                        <div class="crypto-price">
                            <span class="price">$${item.usd.toLocaleString()}</span>
                            <span class="change ${changeClass}">${sign}${item.usd_24h_change.toFixed(2)}%</span>
                        </div>
                    </div>
                `;
                listContainer.insertAdjacentHTML('beforeend', cryptoHtml);
            }
        });
    }
}
