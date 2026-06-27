const express = require('express');
const path    = require('path');
const fs      = require('fs');
const app     = express();
const PORT    = process.env.PORT || 5000;

const DATA_DIR      = path.join(__dirname, 'data');
const VISITORS_FILE = path.join(DATA_DIR, 'visitors.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

function ensureData() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

/* ── visitors ── */
function loadVisitors() {
    try { return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8')); }
    catch { return { total: 1337, sessions: {} }; }
}
function saveVisitors(d) {
    try { ensureData(); fs.writeFileSync(VISITORS_FILE, JSON.stringify(d)); } catch {}
}
const SESSION_TTL = 5 * 60 * 1000;
let visitors = loadVisitors();
function pruneExpired() {
    const now = Date.now(); let ch = false;
    for (const [id, ts] of Object.entries(visitors.sessions)) {
        if (now - ts > SESSION_TTL) { delete visitors.sessions[id]; ch = true; }
    }
    if (ch) saveVisitors(visitors);
}
setInterval(pruneExpired, 60 * 1000);

/* ── messages ── */
function loadMessages() {
    try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); }
    catch { return []; }
}
function saveMessages(msgs) {
    try { ensureData(); fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs)); } catch {}
}

/* ── spotify token cache ── */
let spToken = null, spExpiry = 0;
async function getSpToken() {
    if (spToken && Date.now() < spExpiry) return spToken;
    const cid = process.env.SPOTIFY_CLIENT_ID;
    const csc = process.env.SPOTIFY_CLIENT_SECRET;
    if (!cid || !csc) return null;
    try {
        const r = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${cid}:${csc}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        });
        const d = await r.json();
        if (d.access_token) {
            spToken  = d.access_token;
            spExpiry = Date.now() + (d.expires_in - 60) * 1000;
            return spToken;
        }
    } catch {}
    return null;
}

/* ── middleware ── */
app.use(express.json());

/* ── api: visitors ── */
app.get('/api/visitors', (req, res) => {
    pruneExpired();
    res.json({ total: visitors.total, online: Object.keys(visitors.sessions).length });
});
app.post('/api/visitors/ping', (req, res) => {
    const sid = req.body && req.body.sid;
    if (!sid) return res.status(400).json({ error: 'missing sid' });
    const isNew = !visitors.sessions[sid];
    visitors.sessions[sid] = Date.now();
    if (isNew) visitors.total += 1;
    saveVisitors(visitors);
    pruneExpired();
    res.json({ total: visitors.total, online: Object.keys(visitors.sessions).length });
});

/* ── api: spotify preview ── */
app.get('/api/spotify-preview', async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'missing id' });
    try {
        /* 1 — try official API if creds available */
        const token = await getSpToken();
        if (token) {
            const r = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const d = await r.json();
            if (d.preview_url) return res.json({ preview_url: d.preview_url });
        }
        /* 2 — scrape embed page (no creds needed) */
        const er = await fetch(`https://open.spotify.com/embed/track/${id}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const html = await er.text();
        /* pattern in __NEXT_DATA__ JSON */
        const m1 = html.match(/"audioPreview"\s*:\s*\{"url"\s*:\s*"([^"]+)"/);
        if (m1) return res.json({ preview_url: m1[1] });
        const m2 = html.match(/"preview_url"\s*:\s*"(https:\/\/p\.scdn\.co[^"]+)"/);
        if (m2) return res.json({ preview_url: m2[1] });
        return res.json({ preview_url: null });
    } catch {
        res.json({ preview_url: null });
    }
});

/* ── api: messages ── */
app.post('/api/messages', (req, res) => {
    const { text, token } = req.body;
    if (!text || !token) return res.status(400).json({ error: 'missing fields' });
    const msgs = loadMessages();
    const msg = {
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        text: String(text).slice(0, 400),
        token: String(token),
        timestamp: Date.now(),
        reply: null
    };
    msgs.push(msg);
    saveMessages(msgs);
    res.json({ success: true, id: msg.id });
});

app.get('/api/messages/mine', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'missing token' });
    const msgs = loadMessages();
    res.json(msgs.filter(m => m.token === token).map(m => ({ id: m.id, reply: m.reply, timestamp: m.timestamp })));
});

app.get('/api/messages/all', (req, res) => {
    const pw = req.query.password;
    if (!process.env.ADMIN_PASSWORD || pw !== process.env.ADMIN_PASSWORD)
        return res.status(401).json({ error: 'unauthorized' });
    res.json(loadMessages().map(m => ({ id: m.id, text: m.text, timestamp: m.timestamp, reply: m.reply })));
});

app.post('/api/messages/:id/reply', (req, res) => {
    const { password, reply } = req.body;
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD)
        return res.status(401).json({ error: 'unauthorized' });
    const msgs = loadMessages();
    const msg = msgs.find(m => m.id === req.params.id);
    if (!msg) return res.status(404).json({ error: 'not found' });
    msg.reply = String(reply || '').slice(0, 1000);
    saveMessages(msgs);
    res.json({ success: true });
});
/* ── health / wake ── */
app.get('/ping',   (_, res) => res.send('pong'));
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() }));
/* ── static ── */
app.use('/purged',  express.static(path.join(__dirname, 'purged')));
app.use('/spoiled', express.static(path.join(__dirname, 'spoiled')));
app.get('/purged',  (_, res) => res.sendFile(path.join(__dirname, 'purged',  'index.html')));
app.get('/spoiled', (_, res) => res.sendFile(path.join(__dirname, 'spoiled', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.redirect(Math.random() < 0.5 ? '/purged' : '/spoiled'));
app.get('*', (_, res) => res.redirect('/'));

app.listen(PORT, '0.0.0.0', () => console.log(`s3lf on :${PORT}`));
