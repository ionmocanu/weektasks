// Tiny zero-dependency Node server: static files + JSON task API
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { }

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { tasks: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Migrate old per-day-arrays format
    if (raw && !raw.tasks && raw.monday !== undefined) {
      const migrated = { tasks: [] };
      for (const day of VALID_DAYS) {
        for (const t of (raw[day] || [])) {
          migrated.tasks.push({
            id: t.id || genId(),
            text: t.text,
            days: [day],
            repeat: false,
            createdAt: new Date().toISOString().slice(0, 10),
            completions: {},
            subtasks: []
          });
        }
      }
      writeData(migrated);
      return migrated;
    }
    // Ensure all tasks have a subtasks array (migration for older v3 data)
    if (raw && raw.tasks) {
      let mutated = false;
      for (const t of raw.tasks) {
        if (!Array.isArray(t.subtasks)) { t.subtasks = []; mutated = true; }
      }
      if (mutated) writeData(raw);
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
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
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
        completions: {},
        subtasks: []
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
      data.tasks = data.tasks.filter(t => {
        if (t.repeat) return true;
        return !t.completions[completionKey];
      });
      writeData(data);
      return sendJSON(res, 200, { ok: true });
    }

    // -------- Subtasks --------
    if (url.pathname === '/api/subtasks' && req.method === 'POST') {
      const body = await readBody(req);
      const { taskId, text } = JSON.parse(body || '{}');
      const trimmed = (text || '').trim();
      if (!trimmed) return sendJSON(res, 400, { error: 'Empty subtask' });
      const data = readData();
      const t = data.tasks.find(t => t.id === taskId);
      if (!t) return sendJSON(res, 404, { error: 'Parent not found' });
      const sub = { id: genId(), text: trimmed, completions: {} };
      if (!Array.isArray(t.subtasks)) t.subtasks = [];
      t.subtasks.push(sub);
      writeData(data);
      return sendJSON(res, 200, sub);
    }

    if (url.pathname === '/api/subtasks' && req.method === 'PATCH') {
      const body = await readBody(req);
      const { taskId, subtaskId, text, completionKey, done } = JSON.parse(body || '{}');
      const data = readData();
      const t = data.tasks.find(t => t.id === taskId);
      if (!t) return sendJSON(res, 404, { error: 'Parent not found' });
      const sub = (t.subtasks || []).find(s => s.id === subtaskId);
      if (!sub) return sendJSON(res, 404, { error: 'Subtask not found' });

      if (typeof text === 'string' && text.trim()) sub.text = text.trim();
      if (completionKey && typeof done === 'boolean') {
        if (done) sub.completions[completionKey] = true;
        else delete sub.completions[completionKey];
      }
      writeData(data);
      return sendJSON(res, 200, sub);
    }

    if (url.pathname === '/api/subtasks' && req.method === 'DELETE') {
      const body = await readBody(req);
      const { taskId, subtaskId } = JSON.parse(body || '{}');
      const data = readData();
      const t = data.tasks.find(t => t.id === taskId);
      if (!t) return sendJSON(res, 404, { error: 'Parent not found' });
      t.subtasks = (t.subtasks || []).filter(s => s.id !== subtaskId);
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
      const cache = ext === '.html'
        ? 'no-cache'
        : 'public, max-age=3600';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cache,
      });
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