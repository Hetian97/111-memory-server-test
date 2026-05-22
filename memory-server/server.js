const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DB_FILE = path.join(__dirname, 'memory.json');

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { memories: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (error) {
    return { memories: [] };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function makeId() {
  return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function simpleSearch(memories, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return memories;

  return memories.filter(memory => {
    const text = [
      memory.content,
      memory.category,
      Array.isArray(memory.tags) ? memory.tags.join(' ') : ''
    ].join(' ').toLowerCase();

    return text.includes(q);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'Aion Memory Server',
      message: 'Memory server is running.'
    });
    return;
  }

  if (req.url === '/memory/list' && req.method === 'GET') {
    const db = readDb();
    sendJson(res, 200, {
      ok: true,
      count: db.memories.length,
      memories: db.memories
    });
    return;
  }

  if (req.url === '/memory/add' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);

      if (!body.content || !String(body.content).trim()) {
        sendJson(res, 400, {
          ok: false,
          error: 'content is required'
        });
        return;
      }

      const db = readDb();

      const memory = {
        id: makeId(),
        content: String(body.content).trim(),
        category: body.category || 'general',
        tags: Array.isArray(body.tags) ? body.tags : [],
        importance: Number(body.importance || 3),
        source: body.source || 'manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      db.memories.push(memory);
      writeDb(db);

      sendJson(res, 200, {
        ok: true,
        memory
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }

    return;
  }

  if (req.url === '/memory/search' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const db = readDb();

      const results = simpleSearch(db.memories, body.query || '');

      sendJson(res, 200, {
        ok: true,
        query: body.query || '',
        count: results.length,
        memories: results
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }

    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: 'Not found'
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Aion Memory Server running at http://127.0.0.1:${PORT}`);
  console.log(`Health check: http://127.0.0.1:${PORT}/health`);
});