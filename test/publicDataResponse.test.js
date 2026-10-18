const test = require('node:test');
const assert = require('node:assert/strict');
const publicData = require('../middleware/publicDataResponse');
const { publicPayload } = require('../src/utils/publicPayload');
function respond(type, body, status = 200) {
    let result;
    const res = { statusCode: status, status(code) { this.statusCode = code; return this; }, json(value) { result = value; return this; } };
    publicData(type)({}, res, () => {});
    res.json(body);
    assert.deepEqual(Object.keys(result), ['data']);
    return { status: res.statusCode, body: result };
}
const privateValue = 'PRIVATE-SECRET';
const user = { _id: 'user', fullname: 'Tên luật sư', password: privateValue, refreshTokens: privateValue, email: privateValue, phone: privateValue, isActived: true };
const author = { _id: 'profile', avatar: 'photo', userID: user, bankInfo: privateValue, lawyerCardImage: privateValue };
const article = { _id: 'article', title: 'Article', content: '<p>Visible</p>', author, embedding: [privateValue], externalId: privateValue, textContent: privateValue, htmlContent: privateValue, crawledAt: privateValue, __v: privateValue, attachments: [{ name: 'Document', url: '/file', secret: privateValue }] };

test('public detail exposes only rendered article fields and safe author/attachment fields', () => {
    const result = respond('article', { success: true, data: article, debug: privateValue }).body;
    assert.equal(result.data.content, article.content);
    assert.equal(result.data.author.userID._id, 'user');
    assert.equal(result.data.author.userID.fullname, user.fullname);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('public lawyer search and profiles remove bank data, documents and user account metadata even from old cache records', () => {
    const lawyer = { ...author, slug: 'ten-luat-su', isApproved: true, firmName: 'Office', introduction: 'Visible biography', commissionRate: privateValue };
    for (const type of ['lawyer', 'lawyerSearch']) {
        const result = respond(type, { success: true, data: type === 'lawyer' ? lawyer : [lawyer] }).body;
        assert.equal(JSON.stringify(result).includes(privateValue), false);
        const value = Array.isArray(result.data) ? result.data[0] : result.data;
        assert.equal(value.introduction, lawyer.introduction);
        assert.equal(value.userID._id, 'user');
    }
    const flat = respond('lawyers', { success: true, data: [{ ...lawyer, fullname: user.fullname, profileId: 'profile', email: privateValue }] }).body.data[0];
    assert.equal(flat.profileId, 'profile');
    assert.equal(flat.fullname, user.fullname);
    assert.equal(JSON.stringify(flat).includes(privateValue), false);
});

test('list pagination remains inside data without leaking arbitrary metadata', () => {
    const paging = { total: 20, page: 1, limit: 10, totalPages: 2, debug: privateValue };
    const forms = respond('forms', { success: true, data: [{ _id: 'form', name: 'Name', description: 'Visible', lawyerID: author, internal: privateValue }], pagination: paging }).body;
    assert.equal(forms.data.items[0].description, 'Visible');
    assert.equal(forms.data.pagination.total, 20);
    assert.equal(JSON.stringify(forms).includes(privateValue), false);
    const resources = respond('resources', { data: [{ _id: 'resource', title: 'Title', content: 'Visible', embedding: privateValue }], pagination: paging }).body;
    assert.equal(resources.data.items[0].content, 'Visible');
    assert.equal(JSON.stringify(resources).includes(privateValue), false);
    const articles = respond('articles', { data: { articles: [article], total: 20, page: 1, totalPages: 2, debug: privateValue } }).body;
    assert.equal(articles.data.articles[0].title, 'Article');
    assert.equal(articles.data.totalPages, 2);
    assert.equal(JSON.stringify(articles).includes(privateValue), false);
});

test('search and detail variants consistently filter form, resource and AI metadata', () => {
    const form = { _id: 'form', name: 'Form', fileUrl: '/public/file', lawyerID: author, debug: privateValue };
    const resource = { _id: 'resource', title: 'Resource', content: 'Visible', attachments: [{ name: 'Doc', url: '/public', private: privateValue }], debug: privateValue };
    for (const [type, value] of [['form', form], ['formSearch', [form]], ['resource', resource], ['resourceSearch', [resource]]]) {
        assert.equal(JSON.stringify(respond(type, { data: value }).body).includes(privateValue), false);
    }
    const ai = respond('articleSearch', { data: { answer: 'Visible answer', sources: [{ title: 'Source', url: '/source', content: 'Visible', embedding: privateValue }], debug: privateValue } }).body;
    assert.equal(ai.data.answer, 'Visible answer');
    assert.equal(JSON.stringify(ai).includes(privateValue), false);
});

test('public errors keep HTTP status and only safe data messages, without DB names or stack traces', () => {
    for (const code of [400, 403, 404, 429, 500]) {
        const result = respond('article', { success: false, message: privateValue, stack: privateValue }, code);
        assert.equal(result.status, code);
        assert.equal(typeof result.body.data.message, 'string');
        assert.equal(JSON.stringify(result.body).includes(privateValue), false);
    }
    assert.equal(respond('article', { success: false, message: privateValue }).status, 400);
});

test('null or missing payloads are safe and response types must be explicit', () => {
    assert.equal(respond('article', { data: null }).body.data, null);
    assert.deepEqual(respond('lawyerSearch', {}).body.data, []);
    assert.throws(() => publicPayload('unsupported', {}));
});
