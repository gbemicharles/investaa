const CryptoAPI = {
    // Using CoinGecko's public API (no key needed for basic usage)
    BASE_URL: 'https://api.coingecko.com/api/v3',

    async getMarketPrices(ids = ['bitcoin', 'ethereum', 'tether', 'binancecoin', 'cardano', 'solana']) {
        const fallback = {
            bitcoin: { usd: 65420.50, usd_24h_change: 2.4 },
            ethereum: { usd: 3520.15, usd_24h_change: -1.2 },
            tether: { usd: 1.00, usd_24h_change: 0.01 },
            'the-open-network': { usd: 5.20, usd_24h_change: 1.5 },
            solana: { usd: 145.80, usd_24h_change: 5.6 }
        };

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(`${this.BASE_URL}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            return { ...fallback, ...data };
        } catch (error) {
            console.warn('Crypto price fetch returned fallback:', error.message || error);
            return fallback;
        }
    }
};

