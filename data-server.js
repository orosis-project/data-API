// data-server.js
const express = require('express');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 10000;

const file = path.join(__dirname, 'security-db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, { security: {} });

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const loadDb = async (req, res, next) => {
    await db.read();
    db.data = db.data || { security: {} };
    next();
};
app.use(loadDb);

const getUserSecurity = (username) => {
    if (!db.data.security[username]) {
        db.data.security[username] = {
            devices: [],
            buddy: null,
            buddyRequests: [],
            faceId: null,
            twoFactorSecret: null,
            twoFactorEnabled: false
        };
    }
    return db.data.security[username];
};

// --- Security Endpoints ---
app.get('/security/:username', (req, res) => {
    const userSecurity = getUserSecurity(req.params.username);
    res.json(userSecurity);
});

// --- Device Endpoints ---
app.post('/security/:username/devices', async (req, res) => {
    const { username } = req.params;
    const { id, name } = req.body;
    if (!id || !name) {
        return res.status(400).json({ message: "Device ID and name are required." });
    }
    const userSecurity = getUserSecurity(username);
    if (!userSecurity.devices.some(d => d.id === id)) {
        userSecurity.devices.push({ id, name, added: Date.now() });
        await db.write();
    }
    res.status(201).json(userSecurity);
});

// --- Face ID Endpoints ---
app.post('/security/:username/faceid', async (req, res) => {
    const { username } = req.params;
    const { faceId } = req.body;
    if (!faceId) {
        return res.status(400).json({ message: "Face ID data is required." });
    }
    const userSecurity = getUserSecurity(username);
    userSecurity.faceId = faceId;
    await db.write();
    res.status(201).json({ message: "Face ID enrolled successfully." });
});

app.post('/security/:username/faceid/remove', async (req, res) => {
    const { username } = req.params;
    const userSecurity = getUserSecurity(username);
    userSecurity.faceId = null;
    await db.write();
    res.status(200).json({ message: "Face ID removed." });
});

// --- Buddy System Endpoints ---
app.post('/buddy/request', async (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) {
        return res.status(400).json({ message: "Both 'from' and 'to' usernames are required." });
    }
    getUserSecurity(to); 
    getUserSecurity(from);

    if (from === to) {
        return res.status(400).json({ message: "You cannot be your own buddy." });
    }
    
    const toUser = db.data.security[to];
    if (!toUser.buddyRequests.some(r => r.from === from)) {
        toUser.buddyRequests.push({ from, timestamp: Date.now() });
        await db.write();
    }
    res.status(200).json({ message: "Request sent." });
});

app.post('/buddy/respond', async (req, res) => {
    const { to, from, action } = req.body;
    if (!to || !from || !action) {
        return res.status(400).json({ message: "Missing required fields." });
    }
    
    const toUser = getUserSecurity(to);
    const fromUser = getUserSecurity(from);

    const requestIndex = toUser.buddyRequests.findIndex(r => r.from === from);
    if (requestIndex === -1) {
        return res.status(404).json({ message: "Request not found." });
    }

    toUser.buddyRequests.splice(requestIndex, 1);

    if (action === 'accept') {
        toUser.buddy = from;
        fromUser.buddy = to;
    }
    
    await db.write();
    res.status(200).json(toUser);
});

// --- 2FA Endpoints ---
app.post('/security/:username/2fa/setup', async (req, res) => {
    const { username } = req.params;
    const secret = speakeasy.generateSecret({ name: `Chat Space (${username})` });
    
    const userSecurity = getUserSecurity(username);
    userSecurity.twoFactorSecret = secret.base32;
    await db.write();

    qrcode.toString(secret.otpauth_url, { type: 'svg' }, (err, svg) => {
        if (err) return res.status(500).json({ message: "Could not generate QR code." });
        res.json({ secret: secret.base32, qrCode: svg });
    });
});

app.post('/security/:username/2fa/verify', async (req, res) => {
    const { username } = req.params;
    const { token } = req.body;
    const userSecurity = getUserSecurity(username);

    if (!userSecurity.twoFactorSecret) {
        return res.status(400).json({ message: "2FA setup not initiated." });
    }

    const verified = speakeasy.totp.verify({
        secret: userSecurity.twoFactorSecret,
        encoding: 'base32',
        token: token
    });

    if (verified) {
        userSecurity.twoFactorEnabled = true;
        await db.write();
        res.status(200).json({ message: "2FA enabled successfully." });
    } else {
        res.status(400).json({ message: "Invalid token." });
    }
});

app.post('/security/:username/2fa/disable', async (req, res) => {
    const { username } = req.params;
    const userSecurity = getUserSecurity(username);
    userSecurity.twoFactorEnabled = false;
    userSecurity.twoFactorSecret = null;
    await db.write();
    res.status(200).json({ message: "2FA disabled." });
});

app.post('/login/2fa', async (req, res) => {
    const { username, token } = req.body;
    const userSecurity = getUserSecurity(username);

    if (!userSecurity.twoFactorEnabled || !userSecurity.twoFactorSecret) {
        return res.status(400).json({ message: "2FA is not enabled for this user." });
    }

    const verified = speakeasy.totp.verify({
        secret: userSecurity.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 1
    });

    if (verified) {
        res.status(200).json({ message: "Verification successful." });
    } else {
        res.status(401).json({ message: "Invalid token." });
    }
});

app.listen(PORT, () => {
    console.log(`Data API server (Security) is running on port ${PORT}`);
});
