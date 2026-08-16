import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { CATALOG, compileScene, validateObjects } from './scene-core.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CACHE_ENTRIES = 500;
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'];
const CATALOGUE = new Set(CATALOG.map(({ type }) => type));
const RELATION_TYPES = new Set(['beneath', 'beside', 'facing']);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const requestHash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function hostnameFromAuthority(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Host must be a non-empty string.');
  let parsed;
  try { parsed = new URL(`http://${value.trim()}`); }
  catch { throw new TypeError('Host is malformed.'); }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new TypeError('Host is malformed.');
  }
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    ...headers
  });
  response.end(payload);
}

async function readJson(request, maxBytes) {
  const declaredSize = Number(request.headers['content-length']);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    request.resume();
    throw new HttpError(413, 'payload_too_large', `JSON body must not exceed ${maxBytes} bytes.`);
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', `JSON body must not exceed ${maxBytes} bytes.`);
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_request', 'Request body must be a JSON object.');
  }

  if (typeof value.description !== 'string' || !value.description.trim()) {
    throw new HttpError(400, 'invalid_description', 'description must be a non-empty string.');
  }
  if (value.description.length > 12_000) {
    throw new HttpError(400, 'invalid_description', 'description must not exceed 12000 characters.');
  }
  if (value.patch !== undefined && typeof value.patch !== 'boolean') {
    throw new HttpError(400, 'invalid_patch', 'patch must be a boolean.');
  }
  const patch = value.patch ?? false;
  if (patch && value.current !== undefined && !Array.isArray(value.current)) {
    throw new HttpError(400, 'invalid_current', 'current must be an array.');
  }
  if (patch && value.relations !== undefined && !Array.isArray(value.relations)) {
    throw new HttpError(400, 'invalid_relations', 'relations must be an array.');
  }

  const current = patch ? (value.current ?? []) : [];
  if (current.length > 100) throw new HttpError(400, 'invalid_current', 'current must contain at most 100 objects.');

  const cleanCurrent = current.map((object, index) => {
    if (!object || typeof object !== 'object' || Array.isArray(object) || !CATALOGUE.has(object.type)) {
      throw new HttpError(400, 'invalid_current', `current[${index}] has an unsupported object type.`);
    }
    const clean = { type: object.type };
    for (const field of ['id', 'label', 'color']) {
      if (object[field] !== undefined) {
        if (typeof object[field] !== 'string' || object[field].length > 100) {
          throw new HttpError(400, 'invalid_current', `current[${index}].${field} must be a short string.`);
        }
        clean[field] = object[field];
      }
    }
    if (clean.color !== undefined && !/^#[0-9a-f]{6}$/i.test(clean.color)) {
      throw new HttpError(400, 'invalid_current', `current[${index}].color must be a six-digit hex value.`);
    }
    if (typeof clean.label !== 'string' || !clean.label) {
      throw new HttpError(400, 'invalid_current', `current[${index}].label must be a non-empty string.`);
    }
    for (const field of ['x', 'z', 'rotation']) {
      if (object[field] !== undefined) {
        if (!Number.isFinite(object[field])) {
          throw new HttpError(400, 'invalid_current', `current[${index}].${field} must be finite.`);
        }
        clean[field] = object[field];
      }
    }
    return clean;
  });
  const validation = validateObjects(cleanCurrent);
  if (!validation.valid) throw new HttpError(400, 'invalid_current', validation.errors[0]);

  const suppliedRelations = patch ? (value.relations ?? []) : [];
  if (suppliedRelations.length > 100) {
    throw new HttpError(400, 'invalid_relations', 'relations must contain at most 100 entries.');
  }
  const cleanRelations = suppliedRelations.map((relation, index) => {
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
      throw new HttpError(400, 'invalid_relations', `relations[${index}] must be an object.`);
    }
    const { type, subjectType, targetType } = relation;
    if (!RELATION_TYPES.has(type)) {
      throw new HttpError(400, 'invalid_relations', `relations[${index}].type is unsupported.`);
    }
    if (!CATALOGUE.has(subjectType) || !CATALOGUE.has(targetType) || subjectType === targetType) {
      throw new HttpError(400, 'invalid_relations', `relations[${index}] must reference two different catalogue types.`);
    }
    const clean = { type, subjectType, targetType };
    for (const endpoint of ['subject', 'target']) {
      if (typeof relation[endpoint] !== 'string' || !relation[endpoint] || relation[endpoint].length > 100) {
        throw new HttpError(400, 'invalid_relations', `relations[${index}].${endpoint} must be a short non-empty id.`);
      }
      clean[endpoint] = relation[endpoint];
    }
    if (clean.subject === clean.target) {
      throw new HttpError(400, 'invalid_relations', `relations[${index}] cannot relate an object to itself.`);
    }
    const subject = cleanCurrent.find((object) => object.id === clean.subject);
    const target = cleanCurrent.find((object) => object.id === clean.target);
    if (!subject || !target || subject.type !== subjectType || target.type !== targetType) {
      throw new HttpError(400, 'invalid_relations', `relations[${index}] must reference matching current objects.`);
    }
    return clean;
  });

  return {
    description: value.description.trim(),
    current: cleanCurrent,
    patch,
    relations: patch ? cleanRelations : []
  };
}

function outputText(body) {
  const chunks = [];
  for (const output of body?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      else if (typeof content?.text?.value === 'string') chunks.push(content.text.value);
    }
  }
  if (chunks.length) return chunks.join('').trim();
  return typeof body?.output_text === 'string' ? body.output_text.trim() : '';
}

async function canonicaliseWithOpenAI(input, { apiKey, model, fetchImpl, timeoutMs }) {
  const response = await fetchImpl(OPENAI_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      instructions: [
        'Convert English or Spanish room prose into one conservative English sentence for a deterministic scene compiler.',
        `Use only these object names: ${[...CATALOGUE].join(', ')}.`,
        'Preserve only objects, removals, colours, and facts explicitly present in the input.',
        'The only spatial relation words allowed are beneath, beside, and facing.',
        'Do not infer furniture or relationships. For a patch, preserve explicit remove/without instructions.'
      ].join(' '),
      input: JSON.stringify({
        description: input.description,
        mode: input.patch ? 'patch' : 'replace',
        currentObjects: input.current.map(({ type }) => type)
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'roomary_scene_description',
          strict: true,
          schema: {
            type: 'object',
            properties: { canonicalDescription: { type: 'string' } },
            required: ['canonicalDescription'],
            additionalProperties: false
          }
        }
      }
    })
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`OpenAI returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  let parsed;
  try { parsed = JSON.parse(outputText(await response.json())); }
  catch { throw new Error('OpenAI returned invalid structured output.'); }
  if (typeof parsed?.canonicalDescription !== 'string' || !parsed.canonicalDescription.trim() || parsed.canonicalDescription.length > 12_000) {
    throw new Error('OpenAI returned an invalid canonicalDescription.');
  }
  return parsed.canonicalDescription.trim();
}

function openCache(path) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS scene_cache (
      request_hash TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT
  `);
  return {
    database,
    get: database.prepare('SELECT response_json FROM scene_cache WHERE request_hash = ?'),
    put: database.prepare(`
      INSERT INTO scene_cache (request_hash, response_json, created_at) VALUES (?, ?, ?)
      ON CONFLICT(request_hash) DO UPDATE SET response_json = excluded.response_json, created_at = excluded.created_at
    `),
    count: database.prepare('SELECT COUNT(*) AS entries FROM scene_cache'),
    prune: database.prepare(`
      DELETE FROM scene_cache WHERE request_hash IN (
        SELECT request_hash FROM scene_cache ORDER BY created_at ASC, rowid ASC LIMIT ?
      )
    `)
  };
}

function staticPath(rootDir, rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname); }
  catch { throw new HttpError(400, 'invalid_url', 'Malformed request URL.'); }
  if (pathname.includes('\0')) throw new HttpError(400, 'invalid_url', 'Malformed request URL.');
  if (pathname.split('/').some((part) => part.startsWith('.'))) {
    throw new HttpError(403, 'forbidden', 'Hidden files are not public.');
  }
  const candidate = resolve(rootDir, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  if (candidate !== rootDir && !candidate.startsWith(`${rootDir}${sep}`)) {
    throw new HttpError(403, 'forbidden', 'Path is outside the public directory.');
  }
  return candidate;
}

export function createRoomaryServer(options = {}) {
  const rootDir = resolve(options.rootDir ?? ROOT);
  const dbPath = options.dbPath ?? process.env.ROOMARY_DB_PATH ?? resolve(ROOT, '.roomary-cache.sqlite');
  const apiKey = options.openaiApiKey === undefined ? process.env.OPENAI_API_KEY : options.openaiApiKey;
  const model = options.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const cacheMaxEntries = Number(options.cacheMaxEntries ?? process.env.ROOMARY_CACHE_MAX_ENTRIES ?? MAX_CACHE_ENTRIES);
  if (!Number.isSafeInteger(cacheMaxEntries) || cacheMaxEntries < 1) {
    throw new TypeError('cacheMaxEntries must be a positive integer.');
  }
  const configuredHosts = options.allowedHosts ?? (process.env.ROOMARY_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? []);
  if (!Array.isArray(configuredHosts)) throw new TypeError('allowedHosts must be an array.');
  const allowedHosts = new Set([...LOOPBACK_HOSTS, ...configuredHosts.map(hostnameFromAuthority)]);
  const cache = openCache(dbPath);

  const server = createServer(async (request, response) => {
    try {
      let requestHost;
      try { requestHost = hostnameFromAuthority(request.headers.host); }
      catch { throw new HttpError(421, 'untrusted_host', 'Host header is missing or malformed.'); }
      if (!allowedHosts.has(requestHost)) {
        throw new HttpError(421, 'untrusted_host', 'Host is not allowed by this Roomary server.');
      }
      const url = new URL(request.url, 'http://localhost');

      if (url.pathname === '/api/health') {
        if (request.method !== 'GET') return sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use GET.' } }, { allow: 'GET' });
        return sendJson(response, 200, { ok: true, service: 'roomary' });
      }

      if (url.pathname === '/api/scenes/compile') {
        if (request.method !== 'POST') return sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use POST.' } }, { allow: 'POST' });
        if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
          throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
        }

        const startedAt = performance.now();
        const input = validateRequest(await readJson(request, maxBodyBytes));
        const hash = requestHash({
          ...input,
          compiler: 'roomary.scene.v1',
          provider: apiKey ? `openai:${model}` : 'local'
        });
        const cached = cache.get.get(hash);
        if (cached) {
          const payload = JSON.parse(cached.response_json);
          payload.provenance = { ...payload.provenance, latencyMs: Math.round(performance.now() - startedAt), cacheHit: true };
          return sendJson(response, 200, payload);
        }

        let description = input.description;
        let engine = 'local';
        let usedModel = null;
        const warnings = [];
        if (apiKey) {
          try {
            description = await canonicaliseWithOpenAI(input, { apiKey, model, fetchImpl, timeoutMs });
            engine = 'openai';
            usedModel = model;
          } catch (error) {
            console.warn('[roomary] Provider canonicalisation failed; using local compiler.', error);
            warnings.push('Provider unavailable; deterministic local fallback used.');
          }
        } else {
          warnings.push('OPENAI_API_KEY is not configured; deterministic local compiler used.');
        }

        // ponytail: catalogue grammar is deliberately bounded; add an ontology only when real stories exceed it.
        const compilation = compileScene(description, input.current, input.patch, {
          relations: input.patch ? input.relations : []
        });
        const payload = {
          ...compilation,
          provenance: {
            engine,
            model: usedModel,
            latencyMs: Math.round(performance.now() - startedAt),
            cacheHit: false,
            warnings
          }
        };
        if (!apiKey || engine === 'openai') {
          cache.put.run(hash, JSON.stringify(payload), Date.now());
          const excess = Number(cache.count.get().entries) - cacheMaxEntries;
          if (excess > 0) cache.prune.run(excess);
        }
        return sendJson(response, 200, payload);
      }

      if (!['GET', 'HEAD'].includes(request.method)) {
        return sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use GET or HEAD.' } }, { allow: 'GET, HEAD' });
      }
      const path = staticPath(rootDir, request.url);
      let content;
      try { content = await readFile(path); }
      catch (error) {
        if (['ENOENT', 'EISDIR'].includes(error.code)) throw new HttpError(404, 'not_found', 'File not found.');
        throw error;
      }
      const apiMarker = '<meta name="roomary-api" content="local">';
      if (extname(path).toLowerCase() === '.html' && content.includes(apiMarker)) {
        content = Buffer.from(content.toString().replace(apiMarker, '<meta name="roomary-api" content="server">'));
      }
      response.writeHead(200, {
        'content-type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'content-length': content.length,
        'x-content-type-options': 'nosniff'
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (response.headersSent) return response.end();
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      sendJson(response, status, {
        error: {
          code: error instanceof HttpError ? error.code : 'internal_error',
          message: error instanceof HttpError ? error.message : 'Internal server error.'
        }
      });
    }
  });

  server.once('close', () => cache.database.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const server = createRoomaryServer();
  server.listen(port, host, () => console.log(`Roomary listening on http://${host}:${port}`));
}
