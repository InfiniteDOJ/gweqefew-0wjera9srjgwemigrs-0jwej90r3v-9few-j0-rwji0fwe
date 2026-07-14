const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration 
const SELLER_KEY = process.env.SELLER_KEY; // Pulled securely from your cloud environment variables
const KEY_EXPIRY_DAYS = 14;                 // 2 weeks
const AD_URLS = [
    "https://linkvertise.com/your-ad-link-1", // Step 1 Ad
    "https://linkvertise.com/your-ad-link-2", // Step 2 Ad
    "https://linkvertise.com/your-ad-link-3"  // Step 3 Ad
];

// Middleware Configuration
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'session-security-random-string-123!',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false, // Set to true if your platform forces HTTPS out of the box (like Render)
        maxAge: 1000 * 60 * 20 // 20 minutes to complete the process
    }
}));

// Route: Begins or resets the session sequence
app.get('/api/start', (req, res) => {
    req.session.currentStep = 0;
    req.session.completed = false;
    res.json({ success: true, redirect: `/api/step/0` });
});

// Route: Redirects users to the proper link step
app.get('/api/step/:id', (req, res) => {
    const step = parseInt(req.params.id);

    if (req.session.currentStep === undefined) {
        return res.redirect('/');
    }

    // Keep user aligned with their actual session tracking status
    if (step !== req.session.currentStep) {
        return res.redirect(`/api/step/${req.session.currentStep}`);
    }

    if (step >= AD_URLS.length) {
        req.session.completed = true;
        return res.redirect('/?status=ready');
    }

    res.redirect(AD_URLS[step]);
});

// Route: Gateway destination callbacks for your ad shorteners
app.get('/api/callback', (req, res) => {
    const callbackStep = parseInt(req.query.step);

    if (req.session.currentStep === undefined || callbackStep !== req.session.currentStep) {
        return res.status(400).send("Session mismatch or invalid tracking. Please restart.");
    }

    req.session.currentStep += 1;

    if (req.session.currentStep >= AD_URLS.length) {
        req.session.completed = true;
        res.redirect('/?status=ready');
    } else {
        res.redirect(`/api/step/${req.session.currentStep}`);
    }
});

// Route: Connects directly to KeyAuth API only if session verification validates
app.post('/api/claim-key', async (req, res) => {
    if (!req.session.completed) {
        return res.status(403).json({ error: "Access denied. Complete all steps first." });
    }

    if (!SELLER_KEY) {
        return res.status(500).json({ error: "Server Configuration Error: SELLER_KEY is missing." });
    }

    try {
        // Querying the KeyAuth Seller Engine
        const response = await axios.get('https://keyauth.win/api/seller/', {
            params: {
                sellerkey: SELLER_KEY,
                type: 'add',
                expiry: KEY_EXPIRY_DAYS,
                mask: '******-******-******-******',
                level: '1',
                amount: '1',
                format: 'JSON'
            }
        });

        if (response.data && response.data.success) {
            const structuralKey = response.data.key;
            
            // Clean up session parameters to prevent repetitive exploits
            req.session.destroy();
            
            res.json({ success: true, key: structuralKey });
        } else {
            res.status(500).json({ error: "KeyAuth Registry rejected request. Check your configuration parameters." });
        }
    } catch (error) {
        res.status(500).json({ error: "Failed to communicate with KeyAuth authentication servers." });
    }
});

app.listen(PORT, () => {
    console.log(`Server executing successfully on port: ${PORT}`);
});