// data-server.js
const express = require('express');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000; // Use a different port, Render provides this.

const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, {});

app.use(cors()); // Allow requests from your main app
app.use(express.json());

// Middleware to ensure DB is loaded
const loadDb = async (req, res, next) => {
    await db.read();
    db.data = db.data || { users: {}, chatData: {} }; // Initialize if empty
    next();
};
app.use(loadDb);

// --- API Endpoints ---

// GET all initial data
app.get('/data', (req, res) => {
    res.json(db.data);
});

// GET all users
app.get('/users', (req, res) => {
    res.json(db.data.users);
});

// GET a specific user
app.get('/users/:username', (req, res) => {
    const user = db.data.users[req.params.username];
    if (user) {
        res.json(user);
    } else {
        res.status(404).json({ message: "User not found" });
    }
});

// POST (create) a new user
app.post('/users', async (req, res) => {
    const { username, userData } = req.body;
    db.data.users[username] = userData;
    await db.write();
    res.status(201).json(db.data.users[username]);
});

// PATCH (update) a user
app.patch('/users/:username', async (req, res) => {
    const username = req.params.username;
    if (db.data.users[username]) {
        db.data.users[username] = { ...db.data.users[username], ...req.body };
        await db.write();
        res.json(db.data.users[username]);
    } else {
        res.status(404).json({ message: "User not found" });
    }
});

// GET all chat data
app.get('/chatdata', (req, res) => {
    res.json(db.data.chatData);
});

// PATCH (update) chat data (for roles, permissions, etc.)
app.patch('/chatdata', async (req, res) => {
    db.data.chatData = { ...db.data.chatData, ...req.body };
    await db.write();
    res.json(db.data.chatData);
});

// POST a new message to a channel
app.post('/messages/:channel', async (req, res) => {
    const channel = req.params.channel;
    const message = req.body;
    if (db.data.chatData.channels[channel]) {
        db.data.chatData.channels[channel].messages.push(message);
        await db.write();
        res.status(201).json(message);
    } else {
        res.status(404).json({ message: "Channel not found" });
    }
});

// ... you can add more specific endpoints for updating messages, etc. as needed

app.listen(PORT, () => {
    console.log(`Data API server is running on port ${PORT}`);
});
