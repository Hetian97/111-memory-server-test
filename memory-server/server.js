const http = require('http');
const path = require('path');
const fs = require('fs');

const {
  db,
  addMemory,
  listMemories,
  deleteMemory,
  clearAllMemories,
  getMemoryStats,
  listUnembeddedMemories
} = require('./db');

const PORT = 8765;
const BACKUP_DIR = path.join(__dirname, 'backups');

const VALID_CATEGORIES = ['U', 'A', 'R', 'E', 'I', 'L', 'P', 'T', 'M', 'C'];

function now() {
  return Date.now();
}

function makeId() {
  return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
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
    chatId: body.chatId ? String(body.chatId) : null,
    content,
    tags: normalizeTags(body.tags),
    category: normalizeCategory(body.category),
    importance: clampNumber(body.importance, 1, 10, 5),
    emotionalWeight: clampNumber(body.emotionalWeight, 1, 10, 3),

    createdAt: body.createdAt ?? timestamp,
    memoryTime: body.memoryTime ?? timestamp,
    lastRecalled: body.lastRecalled ?? 0,
    recallCount: clampNumber(body.recallCount, 0, 999999, 0),

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
    return memories.slice(0, safeLimit);
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

async function backupSqliteDb() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');

    const backupFile = path.join(BACKUP_DIR, `memory-${timestamp}.db`);
    const latestBackupFile = path.join(__dirname, 'memory.backup.db');

    await db.backup(backupFile);
    await db.backup(latestBackupFile);

    console.log('[memory-server] 已备份 memory.db:', backupFile);

    return {
      ok: true,
      backupFile,
      latestBackupFile,
      timestamp
    };
  } catch (error) {
    console.warn('[memory-server] 备份 memory.db 失败:', error.message);

    return {
      ok: false,
      error: error.message
    };
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
    const memories = listMemories();

    sendJson(res, 200, {
      ok: true,
      service: 'Aion Memory Server',
      message: 'Memory server is running.',
      format: '111/2222-compatible-sqlite',
      storage: 'sqlite',
      count: memories.length
    });
    return;
  }

  if (pathname === '/memory/list' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);

    const filters = {
      chatId: url.searchParams.get('chatId') || '',
      category: url.searchParams.get('category') || '',
      minImportance: url.searchParams.get('minImportance') || '',
      maxImportance: url.searchParams.get('maxImportance') || '',
      query: url.searchParams.get('query') || '',
      limit: url.searchParams.get('limit') || 500
    };

    const memories = listMemories(filters);

    sendJson(res, 200, {
      ok: true,
      count: memories.length,
      filters,
      memories
    });
    return;
  }

  if (pathname === '/memory/stats' && req.method === 'GET') {
    const stats = getMemoryStats();

    sendJson(res, 200, {
      ok: true,
      storage: 'sqlite',
      stats
    });
    return;
  }

  if (pathname === '/memory/unembedded' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = url.searchParams.get('limit') || 100;
    const memories = listUnembeddedMemories(limit);

    sendJson(res, 200, {
      ok: true,
      count: memories.length,
      memories
    });
    return;
  }

  if (pathname === '/memory/add' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const memory = normalizeMemoryFragment(body);

      await backupSqliteDb();

      const savedMemory = addMemory({
        ...memory,
        updatedAt: now()
      });

      sendJson(res, 200, {
        ok: true,
        memory: savedMemory
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
      const memories = listMemories(body.chatId || null);
      const results = simpleSearch(memories, body.query || '', body.limit || 20);

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

  if (pathname === '/memory/backup' && req.method === 'POST') {
    const result = await backupSqliteDb();

    if (result.ok) {
      sendJson(res, 200, {
        ok: true,
        message: 'SQLite memory database backed up.',
        backupFile: result.backupFile,
        latestBackupFile: result.latestBackupFile,
        timestamp: result.timestamp
      });
    } else {
      sendJson(res, 500, {
        ok: false,
        error: result.error || 'Backup failed'
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

      await backupSqliteDb();

      const deleted = deleteMemory(id);

      sendJson(res, 200, {
        ok: true,
        deleted: deleted ? 1 : 0
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
    await backupSqliteDb();

    const deleted = clearAllMemories();

    sendJson(res, 200, {
      ok: true,
      deleted,
      message: 'All memories cleared.'
    });
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: 'Not found'
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Aion Memory Server running at http://0.0.0.0:${PORT}`);
  console.log(`Local health check: http://127.0.0.1:${PORT}/health`);
  console.log(`Tailscale access: http://100.81.84.121:${PORT}/health`);
  console.log('Storage: SQLite memory.db');
});