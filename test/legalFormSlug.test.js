const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { generateLegalFormSlug, withLegalFormSlug } = require('../src/utils/legalFormSlug');
const id = '0123456789abcdef01234567';
const legacy = { _id: id, name: 'Đơn xin nghỉ phép' };
const slug = `don-xin-nghi-phep-${id}`;

function services(model, cache = {}) {
    const filename = path.join(__dirname, '../src/services/legalForm.services.js');
    const module = { exports: {} };
    const localRequire = createRequire(filename);
    const mocks = {
        '../model/legalForm.model': model,
        '../config/redis': { keys: async () => [], ...cache },
    };
    new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
        name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name), module, module.exports
    );
    return module.exports;
}
const detailQuery = form => ({ populate() { return this; }, lean: async () => form });

test('Vietnamese slugs are deterministic, unique across duplicate names and support decomposed accents', () => {
    assert.equal(generateLegalFormSlug(legacy.name, id), slug);
    assert.equal(generateLegalFormSlug(legacy.name.normalize('NFD'), id), slug);
    assert.notEqual(generateLegalFormSlug(legacy.name, '1123456789abcdef01234567'), slug);
    assert.equal(generateLegalFormSlug('!!!', id), `bieu-mau-${id}`);
    assert.equal(withLegalFormSlug({ ...legacy, name: 'Tên đã sửa', slug }).slug, slug);
});

test('an old cached list returns shareable slugs without waiting for cache expiry', async () => {
    const api = services({}, { get: async () => JSON.stringify({ data: [legacy], pagination: { total: 1 } }) });
    const result = await api.getForms({});
    assert.equal(result.data[0].slug, slug);
    assert.equal(result.pagination.total, 1);
});

test('shared URL resolves an old record and persists its slug', async () => {
    let update;
    const api = services({
        findOne: () => ({ select() { return this; }, lean: async () => null }),
        findById: value => { assert.equal(value, id); return detailQuery(legacy); },
        updateOne: async (...args) => { update = args; },
    });
    assert.equal((await api.getFormBySlug(slug)).slug, slug);
    assert.equal(update[0]._id, id);
    assert.equal(update[1].$set.slug, slug);
    assert.equal(update[2].overwriteImmutable, true);
    assert.equal(await api.getFormBySlug(`sai-ten-${id}`), null);
});

test('a stored slug still resolves after title changes; missing/malformed slugs return no result', async () => {
    const api = services({
        findOne: () => ({ select() { return this; }, lean: async () => ({ _id: id }) }),
        findById: () => detailQuery({ ...legacy, name: 'Tên mới', slug }),
    });
    assert.equal((await api.getFormBySlug(slug)).name, 'Tên mới');
    for (const invalid of [null, {}, '', '../../bad', 'bad?x=1']) assert.equal(await api.getFormBySlug(invalid), null);
    const missing = services({ findOne: () => ({ select() { return this; }, lean: async () => null }) });
    assert.equal(await missing.getFormBySlug('khong-ton-tai'), null);
});

test('admin/lawyer rename initializes old slug before changing name and ignores client slug overrides', async () => {
    for (const method of ['updateForm', 'updateLawyerForm']) {
        const form = {
            ...legacy,
            toObject() { return { _id: this._id, name: this.name, slug: this.slug }; },
            set(key, value) { this[key] = value; },
            async save() {},
        };
        const api = services({ findById: async () => form, findOne: async () => form });
        const result = await api[method](id, { name: 'Tên mới', slug: 'client-override' }, 'lawyer-id');
        assert.equal(result.slug, slug);
        assert.equal(result.name, 'Tên mới');
    }
});

test('Mongoose validation generates immutable slugs for new and hydrated legacy forms without a database', async () => {
    const Model = require('../src/model/legalForm.model');
    const fields = { ...legacy, category: 'Khác', fileUrl: 'https://example.com/form.docx', fileType: 'DOCX' };
    for (const form of [new Model(fields), Model.hydrate(fields)]) {
        await form.validate();
        assert.equal(form.slug, slug);
        form.name = 'Đổi tên sau khi có link';
        await form.validate();
        assert.equal(form.slug, slug);
    }
    const stored = Model.hydrate({ ...fields, slug });
    stored.slug = 'khong-duoc-doi';
    assert.equal(stored.slug, slug);
});
