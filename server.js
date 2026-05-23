const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 5000;

const routes = {
    '/':         path.join(__dirname, 'index.html'),
    '/purged':   path.join(__dirname, 'purged',  'index.html'),
    '/purged/':  path.join(__dirname, 'purged',  'index.html'),
    '/spoiled':  path.join(__dirname, 'spoiled', 'index.html'),
    '/spoiled/': path.join(__dirname, 'spoiled', 'index.html'),
};

http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    if (routes[urlPath]) {
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        fs.createReadStream(routes[urlPath]).pipe(res);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`Server on port ${PORT}`);
    console.log(`  /purged/  → purged/index.html`);
    console.log(`  /spoiled/ → spoiled/index.html`);
});
