// Tiny zero-dependency Node server: static files + JSON task API
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const VALID_DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

/*
 * Data model
 * ----------
 * {
 *   tasks: [
 *     {
 *       id: "abc123",
 *       text: "Clean kitchen",
 *       days: ["monday", "wednesday"],
 *       repeat: true,                           // resets each new week if true
 *       createdAt: "2026-05-07",
 *       completions: { "2026-W19-monday": true }
 *     }
 *   ]
 * }
 */

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { tasks: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Migrate old format (per-day arrays) -> new flat format
    if (raw && !raw.tasks && raw.monday !== undefined) {
      const migrated = { tasks: [] };
      for (const day of VALID_DAYS) {
        for (const t of (raw[day] || [])) {
          migrated.tasks.push({
            id: t.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
            text: t.text,
            days: [day],
            repeat: false,
            createdAt: new Date().toISOString().slice(0, 10),
            completions: {}
          });
        }
      }
      writeData(migrated);
      return migrated;
    }
    return raw && raw.tasks ? raw : { tasks: [] };
  } catch (e) {
    return { tasks: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(DATA_FILE)) writeData({ tasks: [] });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isValidDays(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every(d => VALID_DAYS.includes(d));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      return sendJSON(res, 200, readData());
    }

    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const body = await readBody(req);
      const { text, days, repeat } = JSON.parse(body || '{}');
      const trimmed = (text || '').trim();
      if (!trimmed) return sendJSON(res, 400, { error: 'Empty task' });
      if (!isValidDays(days)) return sendJSON(res, 400, { error: 'Invalid days' });

      const data = readData();
      const task = {
        id: genId(),
        text: trimmed,
        days,
        repeat: !!repeat,
        createdAt: new Date().toISOString().slice(0, 10),
        completions: {}
      };
      data.tasks.push(task);
      writeData(data);
      return sendJSON(res, 200, task);
    }

    if (url.pathname === '/api/tasks' && req.method === 'PATCH') {
      const body = await readBody(req);
      const { id, text, days, repeat, completionKey, done } = JSON.parse(body || '{}');
      const data = readData();
      const t = data.tasks.find(t => t.id === id);
      if (!t) return sendJSON(res, 404, { error: 'Not found' });

      if (typeof text === 'string' && text.trim()) t.text = text.trim();
      if (days !== undefined) {
        if (!isValidDays(days)) return sendJSON(res, 400, { error: 'Invalid days' });
        t.days = days;
      }
      if (typeof repeat === 'boolean') t.repeat = repeat;

      if (completionKey && typeof done === 'boolean') {
        if (done) t.completions[completionKey] = true;
        else delete t.completions[completionKey];
      }

      writeData(data);
      return sendJSON(res, 200, t);
    }

    if (url.pathname === '/api/tasks' && req.method === 'DELETE') {
      const body = await readBody(req);
      const { id } = JSON.parse(body || '{}');
      const data = readData();
      data.tasks = data.tasks.filter(t => t.id !== id);
      writeData(data);
      return sendJSON(res, 200, { ok: true });
    }

    if (url.pathname === '/api/clear-done' && req.method === 'POST') {
      const body = await readBody(req);
      const { completionKey } = JSON.parse(body || '{}');
      const data = readData();
      // Remove non-recurring tasks that have this completion key marked done
      data.tasks = data.tasks.filter(t => {
        if (t.repeat) return true;
        return !t.completions[completionKey];
      });
      writeData(data);
      return sendJSON(res, 200, { ok: true });
    }

    // ---------- Static files ----------
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(PUBLIC_DIR, filePath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    });

  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WeekTasks running on port ${PORT}, data at ${DATA_FILE}`);
});
