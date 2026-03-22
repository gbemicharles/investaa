const chatbotResponses = {
    "greeting": "Hello! I'm your Virtual Assistant. How can I help you today?",
    "options": [
        "Lost Transaction PIN",
        "How to Top Up",
        "Transaction PIN Details",
        "How to Withdraw",
        "Internal Transfer Info",
        "VIP Membership"
    ],
    "Lost Transaction PIN": "If you've lost your Transaction PIN, please contact our support team via the 'Support' page. For security, PIN resets require identity verification.",
    "How to Top Up": "To top up, navigate to the 'Deposit' page, select your preferred network (USDT, BTC, etc.), and follow the instructions to send funds to your generated address. Minimum deposit is 50 USDT.",
    "Transaction PIN Details": "Your Transaction PIN is a 4-6 digit code set during registration. It is required for all withdrawals and internal transfers to ensure the security of your funds.",
    "How to Withdraw": "Withdrawals can be made via the 'Withdraw' page. Simply enter your destination wallet address and the amount. A flat fee of 1 USDT applies to all withdrawals.",
    "Internal Transfer Info": "You can send funds instantly to other users using their Username, Email, or Phone Number on the 'Transfer' page. A 1 USDT fee applies.",
    "VIP Membership": "Our VIP Club offers higher transaction limits. Bronze starts at 50 USDT deposit, while Diamond offers up to $30M monthly limits!"
};

function initChatbot() {
    const body = document.body;
    
    // Create Chat Widget HTML
    const widget = document.createElement('div');
    widget.className = 'chat-parent'; // Parent container
    widget.innerHTML = `
        <div class="chat-semipage" id="chat-semipage">
            <div class="chat-header">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <i class="fas fa-robot" style="font-size: 1.5rem;"></i>
                    <div>
                        <h2>Virtual Assistant</h2>
                        <span style="font-size: 0.7rem; opacity: 0.8;">Always active</span>
                    </div>
                </div>
                <i class="fas fa-times" id="chat-close" style="cursor: pointer; font-size: 1.2rem;"></i>
            </div>
            <div class="chat-messages" id="chat-messages">
                <div class="msg bot">
                    ${chatbotResponses.greeting}
                    <div class="chat-options">
                        ${chatbotResponses.options.map(opt => `<button class="chat-option-btn"><i class="fas fa-chevron-right" style="margin-right: 8px; font-size: 0.7rem;"></i> ${opt}</button>`).join('')}
                    </div>
                </div>
            </div>
            <div class="chat-input-area">
                <div class="chat-input-wrapper">
                    <input type="text" placeholder="Type your question..." id="chat-input">
                    <i class="fas fa-paper-plane" style="color: var(--accent-primary); cursor: pointer;"></i>
                </div>
            </div>
        </div>
        <div class="chat-widget">
            <div class="chat-toggle" id="chat-toggle">
                <i class="fas fa-headset"></i>
            </div>
        </div>
    `;
    body.appendChild(widget);

    const toggle = document.getElementById('chat-toggle');
    const semipage = document.getElementById('chat-semipage');
    const close = document.getElementById('chat-close');
    const messages = document.getElementById('chat-messages');
    const input = document.getElementById('chat-input');

    toggle.addEventListener('click', () => semipage.classList.add('active'));
    close.addEventListener('click', () => semipage.classList.remove('active'));

    // Handle Option Clicks
    messages.addEventListener('click', (e) => {
        const btn = e.target.closest('.chat-option-btn');
        if (btn) {
            const question = btn.innerText.trim();
            addMessage(question, 'user');
            
            setTimeout(() => {
                const answer = chatbotResponses[question] || "I'm sorry, I don't have information on that topic yet. Would you like to speak with a human agent?";
                addMessage(answer, 'bot');
            }, 600);
        }
    });

    // Handle Text Input
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            const userText = input.value.trim();
            addMessage(userText, 'user');
            const val = userText.toLowerCase();
            input.value = '';
            
            setTimeout(() => {
                let foundAnswer = "I'm not sure about that. Try selecting one of the options above or visit the Support page.";
                if (val.includes('pin')) foundAnswer = chatbotResponses["Transaction PIN Details"];
                if (val.includes('deposit') || val.includes('top up')) foundAnswer = chatbotResponses["How to Top Up"];
                if (val.includes('withdraw')) foundAnswer = chatbotResponses["How to Withdraw"];
                if (val.includes('transfer')) foundAnswer = chatbotResponses["Internal Transfer Info"];
                if (val.includes('vip')) foundAnswer = chatbotResponses["VIP Membership"];
                
                addMessage(foundAnswer, 'bot');
            }, 800);
        }
    });

    function addMessage(text, sender) {
        const msg = document.createElement('div');
        msg.className = `msg ${sender}`;
        msg.innerText = text;
        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;
    }
}

// Ensure style is loaded then init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatbot);
} else {
    initChatbot();
}
