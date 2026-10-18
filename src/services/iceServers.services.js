const axios = require('axios');
function sanitizeIceServers(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap(server => {
        if (!server || typeof server !== 'object') return [];
        const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
            .filter(url => typeof url === 'string' && /^(stun|turn|turns):/.test(url));
        if (!urls.length) return [];
        const result = { urls };
        if (typeof server.username === 'string') result.username = server.username;
        if (typeof server.credential === 'string') result.credential = server.credential;
        return [result];
    });
}
function createIceServerService({ env = process.env, httpGet = axios.get, now = Date.now } = {}) {
    let cache;
    let expiresAt = 0;
    return async () => {
        if (cache && now() < expiresAt) return cache;
        let servers = [];
        if (env.METERED_TURN_CREDENTIALS_URL && env.METERED_TURN_API_KEY) {
            try {
                const response = await httpGet(env.METERED_TURN_CREDENTIALS_URL, {
                    params: { apiKey: env.METERED_TURN_API_KEY }, timeout: 10000,
                });
                servers = sanitizeIceServers(response.data);
            } catch {
                // Do not log Axios errors: their request config contains the provider API key.
            }
        }
        if (!servers.length && env.TURN_FALLBACK_ICE_SERVERS_JSON) {
            try { servers = sanitizeIceServers(JSON.parse(env.TURN_FALLBACK_ICE_SERVERS_JSON)); }
            catch { /* Invalid fallback is handled by the generic error below. */ }
        }
        if (!servers.length) throw new Error('TURN credentials are unavailable');
        cache = servers;
        expiresAt = now() + 60000;
        return servers;
    };
}
module.exports = { sanitizeIceServers, createIceServerService, getIceServers: createIceServerService() };
