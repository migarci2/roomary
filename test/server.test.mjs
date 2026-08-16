import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createRoomaryServer } from '../server.mjs';

function requestWithHost(url, host, init = {}) {
  const body = init.body ?? '';
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: init.method ?? 'GET',
      headers: { ...init.headers, host, 'content-length': Buffer.byteLength(body) }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers
      })));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('serves Roomary and compiles cached local scenes safely', async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'roomary-server-'));
  const server = createRoomaryServer({
    dbPath: join(temporaryDirectory, 'cache.sqlite'),
    openaiApiKey: null,
    cacheMaxEntries: 1,
    allowedHosts: ['roomary.test']
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryDirectory, { recursive: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'roomary' });

  const trustedRemoteHost = await requestWithHost(`${baseUrl}/api/health`, `roomary.test:${server.address().port}`);
  assert.equal(trustedRemoteHost.status, 200);

  const untrustedHost = await requestWithHost(`${baseUrl}/api/health`, 'attacker.example');
  assert.equal(untrustedHost.status, 421);
  assert.equal((await untrustedHost.json()).error.code, 'untrusted_host');

  const landing = await fetch(`${baseUrl}/`);
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('content-type'), /^text\/html/);
  assert.match(await landing.text(), /Roomary/i);

  const editor = await fetch(`${baseUrl}/editor.html`);
  assert.match(await editor.text(), /<meta name="roomary-api" content="server">/);

  const hiddenFile = await fetch(`${baseUrl}/.roomary-cache.sqlite`);
  assert.equal(hiddenFile.status, 403);

  const request = {
    description: 'A bed beneath a window, a desk facing the door and a red rug.',
    current: [],
    patch: false
  };
  const compile = () => fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request)
  });

  const firstResponse = await compile();
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.ok(Array.isArray(first.objects));
  assert.ok(Array.isArray(first.graph.entities));
  assert.ok(Array.isArray(first.graph.relations));
  assert.equal(typeof first.diagnostics.valid, 'boolean');
  assert.deepEqual(first.provenance.engine, 'local');
  assert.equal(first.provenance.model, null);
  assert.equal(first.provenance.cacheHit, false);
  assert.ok(Array.isArray(first.provenance.warnings));

  const secondResponse = await compile();
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.provenance.cacheHit, true);
  assert.deepEqual(second.objects, first.objects);

  const replaceWithOldState = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...request, current: first.objects, relations: first.graph.relations })
  });
  assert.equal((await replaceWithOldState.json()).provenance.cacheHit, true);

  const patch = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'Make the rug blue.',
      current: first.objects,
      patch: true,
      relations: first.graph.relations
    })
  });
  const patched = await patch.json();
  assert.equal(patch.status, 200);
  assert.deepEqual(patched.graph.relations, first.graph.relations);
  assert.equal(patched.objects.find((object) => object.type === 'rug').color, '#537897');

  const evicted = await compile();
  assert.equal((await evicted.json()).provenance.cacheHit, false);

  const invalid = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: '', current: [], patch: false })
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'invalid_description');

  const invalidCurrent = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'A bed.', current: [{ type: 'bed' }], patch: true })
  });
  assert.equal(invalidCurrent.status, 400);
  assert.equal((await invalidCurrent.json()).error.code, 'invalid_current');

  const invalidRelations = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'Move the bed.',
      current: first.objects,
      patch: true,
      relations: [{ type: 'behind', subjectType: 'bed', targetType: 'window' }]
    })
  });
  assert.equal(invalidRelations.status, 400);
  assert.equal((await invalidRelations.json()).error.code, 'invalid_relations');

  const danglingRelation = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'Move the bed.',
      current: first.objects,
      patch: true,
      relations: [{ type: 'beneath', subject: 'missing', target: first.objects.find(({ type }) => type === 'window').id, subjectType: 'bed', targetType: 'window' }]
    })
  });
  assert.equal(danglingRelation.status, 400);
  assert.equal((await danglingRelation.json()).error.code, 'invalid_relations');

  const oversized = await fetch(`${baseUrl}/api/scenes/compile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'x'.repeat(70 * 1024), current: [], patch: false })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'payload_too_large');
});

test('uses schema-constrained AI output and caches the validated plan', async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'roomary-openai-'));
  let providerCalls = 0;
  const server = createRoomaryServer({
    dbPath: join(temporaryDirectory, 'cache.sqlite'),
    openaiApiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      providerCalls += 1;
      const request = JSON.parse(options.body);
      assert.equal(request.text.format.type, 'json_schema');
      assert.equal(request.text.format.strict, true);
      if (JSON.parse(request.input).description === 'trigger provider failure') {
        return new Response('raw-provider-secret', { status: 500 });
      }
      return new Response(JSON.stringify({
        output: [{ content: [{ text: JSON.stringify({ canonicalDescription: 'A blue bed beneath a window.' }) }] }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryDirectory, { recursive: true });
  });

  const url = `http://127.0.0.1:${server.address().port}/api/scenes/compile`;
  const rebound = await requestWithHost(url, 'attacker.example', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'A bed.' })
  });
  assert.equal(rebound.status, 421);
  assert.equal(providerCalls, 0);

  const compile = () => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'A cerulean sleeping place below the glass opening.' })
  });
  const first = await (await compile()).json();
  const second = await (await compile()).json();

  assert.equal(first.provenance.engine, 'openai');
  assert.equal(first.provenance.model, 'test-model');
  assert.equal(first.objects.find((object) => object.type === 'bed').color, '#537897');
  assert.equal(second.provenance.cacheHit, true);
  assert.equal(providerCalls, 1);

  const serverLogs = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => serverLogs.push(parts.map(String).join(' '));
  let failed;
  try {
    failed = await (await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'trigger provider failure' })
    })).json();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(failed.provenance.engine, 'local');
  assert.deepEqual(failed.provenance.warnings, ['Provider unavailable; deterministic local fallback used.']);
  assert.doesNotMatch(JSON.stringify(failed), /raw-provider-secret/);
  assert.match(serverLogs.join(' '), /raw-provider-secret/);
});
