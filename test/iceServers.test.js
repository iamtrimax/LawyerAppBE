const test = require('node:test');
const assert = require('node:assert/strict');
const { createIceServerService, sanitizeIceServers } = require('../src/services/iceServers.services');
const server = { urls: 'turn:relay.example.com:443', username: 'test-user', credential: 'test-credential' };

test('provider API key stays in server-side request and only ICE fields reach the client', async () => {
    let count = 0, clock = 0;
    const env = { METERED_TURN_CREDENTIALS_URL: 'https://provider.example/credentials', METERED_TURN_API_KEY: 'server-only-provider-key' };
    const get = createIceServerService({ env, now: () => clock, httpGet: async (url, options) => {
        count++;
        assert.equal(url, env.METERED_TURN_CREDENTIALS_URL);
        assert.equal(options.params.apiKey, env.METERED_TURN_API_KEY);
        return { data: [{ ...server, apiKey: env.METERED_TURN_API_KEY, internal: 'must-not-return' }] };
    } });
    const result = await get();
    assert.deepEqual(result, [{ ...server, urls: [server.urls] }]);
    assert.equal(JSON.stringify(result).includes(env.METERED_TURN_API_KEY), false);
    await get();
    assert.equal(count, 1);
    clock = 60001;
    await get();
    assert.equal(count, 2);
});

test('fallback credentials come from backend env when provider is unavailable', async () => {
    const get = createIceServerService({
        env: { METERED_TURN_CREDENTIALS_URL: 'https://provider.example', METERED_TURN_API_KEY: 'private', TURN_FALLBACK_ICE_SERVERS_JSON: JSON.stringify([server]) },
        httpGet: async () => { throw new Error('provider failure with sensitive request config'); },
    });
    assert.deepEqual(await get(), [{ ...server, urls: [server.urls] }]);
    await assert.rejects(createIceServerService({ env: {} })(), /unavailable/);
    await assert.rejects(createIceServerService({ env: { TURN_FALLBACK_ICE_SERVERS_JSON: 'invalid' } })(), /unavailable/);
});

test('malformed ICE URLs and extra fields are rejected', () => {
    assert.deepEqual(sanitizeIceServers([{ urls: 'https://not-an-ice-server' }, null]), []);
    assert.deepEqual(sanitizeIceServers([{ urls: ['stun:relay.example.com', 'javascript:bad'], apiKey: 'private' }]), [{ urls: ['stun:relay.example.com'] }]);
});

test('credentials controller rejects inactive accounts and does not cache or expose internal errors', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const filename = path.join(__dirname, '../src/controller/iceServers.controller.js');
    function load(getIceServers) {
        const module = { exports: {} };
        new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(() => ({ getIceServers }), module, module.exports);
        return module.exports.getIceServersController;
    }
    function response() {
        return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    }
    let calls = 0;
    const controller = load(async () => { calls++; return [server]; });
    const denied = response();
    await controller({ user: { isActived: false } }, denied);
    assert.equal(denied.code, 403);
    assert.equal(calls, 0);
    const allowed = response();
    await controller({ user: { isActived: true } }, allowed);
    assert.equal(allowed.headers['Cache-Control'], 'no-store');
    assert.equal(allowed.code, 200);
    assert.deepEqual(allowed.body, { data: [server] });
    const failure = response();
    await load(async () => { throw new Error('private-provider-key'); })({ user: { isActived: true } }, failure);
    assert.equal(failure.code, 503);
    assert.equal(JSON.stringify(failure.body).includes('private-provider-key'), false);
});
