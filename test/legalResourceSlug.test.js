const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { generateLegalResourceSlug } = require('../src/utils/legalResourceSlug');
const id = '0123456789abcdef01234567';
const slug = `company-law-${id}`;
const legacy = { _id: id, title: 'Company Law!', isPublished: true };
function services(model, cache = {}) {
    const filename = path.join(__dirname, '../src/services/legalResource.services.js');
    const module = { exports: {} }, localRequire = createRequire(filename);
    const mocks = {
        '../model/legalResource.model': model,
        '../config/redis': { get: async () => null, set: async () => {}, keys: async () => [], del: async () => {}, ...cache },
    };
    new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
        name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name), module, module.exports
    );
    return module.exports;
}
const query = value => ({ select() { return this; }, lean: async () => value });

test('resource schema generates stable slugs for new and legacy records', async () => {
    const Model = require('../src/model/legalResource.model');
    const fields = { ...legacy, content: '<p>Full content</p>', category: 'Corporate' };
    for (const doc of [new Model(fields), Model.hydrate(fields)]) {
        await doc.validate();
        assert.equal(doc.slug, slug);
        doc.title = 'Changed';
        await doc.validate();
        assert.equal(doc.slug, slug);
    }
    assert.equal(generateLegalResourceSlug('!!!', id), `legal-resource-${id}`);
});

test('old list and detail caches get usable slugs; detail persists missing slug and counts one view', async () => {
    const api = services({}, { get: async () => JSON.stringify({ data: [legacy] }) });
    assert.equal((await api.getResources({})).data[0].slug, slug);
    let writes = 0, views = 0;
    const detail = services({
        updateOne: async (filter, update) => { writes++; assert.equal(update.$set.slug, slug); },
        findByIdAndUpdate: () => ({ exec: async () => { views++; } }),
    }, { get: async () => JSON.stringify(legacy) });
    assert.equal((await detail.getResourceDetail(id)).slug, slug);
    assert.equal(writes, 1);
    assert.equal(views, 1);
});

test('slug lookup supports old published resources and rejects missing, invalid and unpublished ones', async () => {
    let views = 0;
    const api = services({
        findOne: filter => {
            assert.equal(filter.isPublished, true);
            return query(filter._id === id ? legacy : null);
        },
        findById: () => query(legacy),
        updateOne: async () => {},
        findByIdAndUpdate: async () => { views++; },
    });
    assert.equal((await api.getResourceBySlug(slug)).slug, slug);
    assert.equal(views, 1);
    for (const value of [{}, null, '', '../bad', 'missing', `wrong-${id}`]) assert.equal(await api.getResourceBySlug(value), null);
    const unpublished = services({ findOne: () => query(null) });
    assert.equal(await unpublished.getResourceBySlug(slug), null);
});

test('stored slug resolves renamed title and update ignores a client slug override', async () => {
    // Cached detail increments views in the background too.
    const cached = services({
        findOne: () => query({ _id: id }),
        findByIdAndUpdate: () => ({ exec: async () => {} }),
    }, { get: async () => JSON.stringify({ ...legacy, title: 'New title', slug }) });
    assert.equal((await cached.getResourceBySlug(slug)).title, 'New title');
    const doc = { ...legacy, toObject() { return { ...legacy }; }, set(key, value) { this[key] = value; }, async save() {} };
    const update = services({ findById: async () => doc });
    const result = await update.updateResource(id, { title: 'Renamed', slug: 'override' });
    assert.equal(result.slug, slug);
    assert.equal(result.title, 'Renamed');
});
