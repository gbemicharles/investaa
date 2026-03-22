document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

async function initDashboard() {
    // Update live data
    await updateCryptoPrices();
    
    // Set interval for updates (every 60 seconds to avoid rate limits)
    setInterval(updateCryptoPrices, 60000);

    // Sidebar Toggle for Mobile
    const menuToggle = document.querySelector('.menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.style.transform = sidebar.style.transform === 'translateX(0px)' ? 'translateX(-100%)' : 'translateX(0px)';
            sidebar.style.width = sidebar.style.width === '280px' ? '0' : '280px';
        });
    }
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
