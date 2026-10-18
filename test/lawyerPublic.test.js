const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const id = '0123456789abcdef01234567';
const lawyer = {
    _id: id, userID: { _id: '1123456789abcdef01234567', fullname: 'Nguyễn Văn An', isActived: true, password: 'secret', email: 'private@example.com' },
    isApproved: true, avatar: 'avatar.png', specialty: ['Dân sự'], operatingProvinces: ['Hà Nội'],
    firmName: 'Văn phòng luật', lawyerId: 'LS001', yearsOfExperience: 8, introduction: 'Giới thiệu thực tế',
    bankInfo: { accountNumber: 'private' }, commissionRate: 50, lawyerCardImage: 'private-document.png',
};
const query = value => ({ select() { return this; }, populate() { return this; }, lean: async () => value });
function service(model = {}) {
    const filename = path.join(__dirname, '../src/services/lawyerPublic.services.js');
    const module = { exports: {} }, localRequire = createRequire(filename);
    new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
        name => name === '../model/lawyer.model' ? model : localRequire(name), module, module.exports
    );
    return module.exports;
}

test('Vietnamese lawyer names become readable slugs; first assignment is persisted and stable', async () => {
    let writes = 0;
    const api = service({ findOneAndUpdate: (filter, update) => {
        writes++;
        assert.equal(filter._id, id);
        assert.equal(update.$set.slug, 'nguyen-van-an');
        return query({ slug: update.$set.slug });
    } });
    assert.equal(api.generateLawyerSlug(lawyer.userID.fullname.normalize('NFD')), 'nguyen-van-an');
    const result = await api.withLawyerSlug(lawyer);
    assert.equal(result.slug, 'nguyen-van-an');
    assert.equal((await api.withLawyerSlug({ ...result, userID: { ...result.userID, fullname: 'Đổi tên' } })).slug, 'nguyen-van-an');
    assert.equal(writes, 1);
});

test('duplicate names receive an ID suffix; concurrent assignments reuse the saved slug', async () => {
    let attempts = 0;
    const api = service({ findOneAndUpdate: (filter, update) => {
        if (++attempts === 1) return { select() { return this; }, lean: async () => { const error = new Error('duplicate'); error.code = 11000; throw error; } };
        return query({ slug: update.$set.slug });
    } });
    assert.equal((await api.withLawyerSlug(lawyer)).slug, `nguyen-van-an-${id}`);
    const concurrent = service({ findOneAndUpdate: () => query(null), findById: () => query({ slug: 'nguyen-van-an' }) });
    assert.equal((await concurrent.withLawyerSlug(lawyer)).slug, 'nguyen-van-an');
});

test('public projection excludes private documents, bank data, email and credentials', () => {
    const result = service().toPublicLawyer({ ...lawyer, slug: 'nguyen-van-an' });
    assert.equal(result.userID.fullname, lawyer.userID.fullname);
    assert.equal(result.introduction, lawyer.introduction);
    const legacy = service().toPublicLawyer({ ...lawyer, specialty: 'Dân sự, Đất đai', operatingProvinces: 'Hà Nội' });
    assert.deepEqual(legacy.specialty, ['Dân sự', 'Đất đai']);
    assert.deepEqual(legacy.operatingProvinces, ['Hà Nội']);
    assert.deepEqual(Object.keys(result.userID).sort(), ['_id', 'fullname']);
    for (const key of ['bankInfo', 'commissionRate', 'lawyerCardImage', 'password', 'refreshTokens']) assert.equal(Object.hasOwn(result, key), false);
    assert.equal(service().toPublicLawyer({ ...lawyer, isApproved: false }), null);
    assert.equal(service().toPublicLawyer({ ...lawyer, userID: { ...lawyer.userID, isActived: false } }), null);
});

test('slug/ID lookup requires approved active lawyers and preserves profile ID used for booking', async () => {
    const api = service({ findOne: filter => {
        assert.equal(filter.isApproved, true);
        return query({ ...lawyer, slug: 'nguyen-van-an' });
    } });
    const result = await api.getPublicLawyerBySlug('nguyen-van-an');
    assert.equal(result._id, id);
    assert.equal((await api.getPublicLawyerById(id)).userID._id, lawyer.userID._id);
    const inactive = service({ findOne: () => query({ ...lawyer, userID: null }), find: () => query([]) });
    assert.equal(await inactive.getPublicLawyerById(id), null);
    assert.equal(await inactive.getPublicLawyerBySlug('nguyen-van-an'), null);
    for (const invalid of [{}, null, '', '../private', 'bad?query=1']) assert.equal(await api.getPublicLawyerBySlug(invalid), null);
    assert.equal(await api.getPublicLawyerById('bad-id'), null);
});

test('a direct name URL resolves a legacy profile before Discovery has been opened', async () => {
    const api = service({ findOne: () => query(null), find: () => query([lawyer]), findOneAndUpdate: () => query({ slug: 'nguyen-van-an' }) });
    assert.equal((await api.getPublicLawyerBySlug('nguyen-van-an'))._id, id);
    assert.equal(await api.getPublicLawyerBySlug('not-found'), null);
});

test('lawyer model keeps public slug immutable and bounds introduction length', async () => {
    const Model = require('../src/model/lawyer.model');
    const doc = Model.hydrate({ ...lawyer, userID: lawyer.userID._id, slug: 'nguyen-van-an' });
    doc.slug = 'changed';
    assert.equal(doc.slug, 'nguyen-van-an');
    doc.introduction = 'x'.repeat(5001);
    assert.ok(doc.validateSync().errors.introduction);
});


test('private profile update saves trimmed public introduction and rejects invalid text before writing', async () => {
    const filename = path.join(__dirname, '../src/services/lawyer.services.js');
    const module = { exports: {} };
    let saved;
    const mocks = {
        '../model/lawyer.model': { findByIdAndUpdate: async (profileId, update) => { assert.equal(profileId, id); saved = update; } },
        '../config/redis': { del: async () => {}, keys: async () => [], get: async () => JSON.stringify({ introduction: saved?.introduction }) },
    };
    new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(
        name => mocks[name] || {}, module, module.exports
    );
    const result = await module.exports.updateLawyerProfile(lawyer.userID._id, id, { introduction: '  Giới thiệu luật sư  ' });
    assert.equal(saved.introduction, 'Giới thiệu luật sư');
    assert.equal(result.introduction, saved.introduction);
    for (const invalid of [{}, 'x'.repeat(5001)]) {
        await assert.rejects(module.exports.updateLawyerProfile(lawyer.userID._id, id, { introduction: invalid }));
    }
});
