const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DB_FILE = path.join(__dirname, 'memory.json');

const VALID_CATEGORIES = ['U', 'A', 'R', 'E', 'I', 'L', 'P', 'T', 'M', 'C'];

function now() {
  return Date.now();
}

function makeId() {
  return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { memories: [] };
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw);
    if (!Array.isArray(db.memories)) {
      return { memories: [] };
    }
    return db;
  } catch (error) {
    console.warn('Failed to read memory.json, using empty database:', error.message);
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

      if (body.length > 10 * 1024 * 1024) {
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

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeCategory(category) {
  const value = String(category || '').trim().toUpperCase();
  return VALID_CATEGORIES.includes(value) ? value : 'E';
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return tags
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

function normalizeEmbedding(embedding) {
  if (!Array.isArray(embedding)) return null;

  const cleaned = embedding
    .map(n => Number(n))
    .filter(n => Number.isFinite(n));

  return cleaned.length > 0 ? cleaned : null;
}

function normalizeLinkedMemories(linkedMemories) {
  if (!Array.isArray(linkedMemories)) return [];

  return linkedMemories
    .map(id => String(id || '').trim())
    .filter(Boolean);
}

function normalizeMemoryFragment(body) {
  const timestamp = now();

  const content = String(body.content || '').trim();
  if (!content) {
    throw new Error('content is required');
  }

  return {
    id: body.id ? String(body.id) : makeId(),
    content,
    tags: normalizeTags(body.tags),
    category: normalizeCategory(body.category),
    importance: clampNumber(body.importance, 1, 10, 5),
    emotionalWeight: clampNumber(body.emotionalWeight, 1, 10, 3),

    // 111/2222 compatible time fields
    createdAt: body.createdAt ?? timestamp,
    memoryTime: body.memoryTime ?? timestamp,
    lastRecalled: body.lastRecalled ?? 0,
    recallCount: clampNumber(body.recallCount, 0, 999999, 0),

    // embedding can exist, but does not have to exist yet
    embedding: normalizeEmbedding(body.embedding),

    linkedMemories: normalizeLinkedMemories(body.linkedMemories),

    source: body.source ? String(body.source) : 'external',
    context: body.context ? String(body.context) : ''
  };
}

function memoryToSearchText(memory) {
  return [
    memory.content,
    memory.category,
    Array.isArray(memory.tags) ? memory.tags.join(' ') : '',
    memory.context || '',
    memory.source || ''
  ].join(' ').toLowerCase();
}

function simpleSearch(memories, query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  const safeLimit = clampNumber(limit, 1, 200, 20);

  if (!q) {
    return memories.slice(-safeLimit).reverse();
  }

  const terms = q.split(/\s+/).filter(Boolean);

  const scored = memories
    .map(memory => {
      const text = memoryToSearchText(memory);
      let score = 0;

      for (const term of terms) {
        if (text.includes(term)) score += 1;
      }

      if (memory.content && memory.content.toLowerCase().includes(q)) {
        score += 3;
      }

      score += (Number(memory.importance) || 0) * 0.05;
      score += (Number(memory.emotionalWeight) || 0) * 0.03;

      return { memory, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, safeLimit).map(item => item.memory);
}

function getPath(req) {
  try {
    return new URL(req.url, `http://${req.headers.host}`).pathname;
  } catch {
    return req.url;
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = getPath(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (pathname === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'Aion Memory Server',
      message: 'Memory server is running.',
      format: '111/2222-compatible'
    });
    return;
  }

  if (pathname === '/memory/list' && req.method === 'GET') {
    const db = readDb();

    sendJson(res, 200, {
      ok: true,
      count: db.memories.length,
      memories: db.memories
    });
    return;
  }

  if (pathname === '/memory/add' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const memory = normalizeMemoryFragment(body);

      const db = readDb();

      const existingIndex = db.memories.findIndex(item => item.id === memory.id);

      if (existingIndex >= 0) {
        db.memories[existingIndex] = {
          ...db.memories[existingIndex],
          ...memory,
          updatedAt: now()
        };
      } else {
        db.memories.push({
          ...memory,
          updatedAt: now()
        });
      }

      writeDb(db);

      sendJson(res, 200, {
        ok: true,
        memory: existingIndex >= 0 ? db.memories[existingIndex] : db.memories[db.memories.length - 1]
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }

    return;
  }

  if (pathname === '/memory/search' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const db = readDb();

      const results = simpleSearch(db.memories, body.query || '', body.limit || 20);

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

  if (pathname === '/memory/delete' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const id = String(body.id || '').trim();

      if (!id) {
        sendJson(res, 400, {
          ok: false,
          error: 'id is required'
        });
        return;
      }

      const db = readDb();
      const before = db.memories.length;
      db.memories = db.memories.filter(memory => memory.id !== id);
      writeDb(db);

      sendJson(res, 200, {
        ok: true,
        deleted: before - db.memories.length
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message
      });
    }

    return;
  }

  if (pathname === '/memory/clear' && req.method === 'POST') {
    writeDb({ memories: [] });

    sendJson(res, 200, {
      ok: true,
      message: 'All memories cleared.'
    });
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
  console.log('Format: 111/2222-compatible memory fragments');
});