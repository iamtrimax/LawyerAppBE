const Article = require('../model/article.model');
const LegalResource = require('../model/legalResource.model');
const LegalForm = require('../model/legalForm.model');

const LOOKUP_INTENT = /(?:tra cứu|liệt kê|danh sách|cho (?:tôi )?xem|xem các|tìm (?:kiếm )?(?:bài viết|tài liệu|nguồn|luật|quy định)|cho (?:tôi )?(?:bài viết|tài liệu|nguồn)|các bài viết|các tài liệu|bài viết nào|tài liệu nào|nguồn nào|tài liệu về|bài viết về)/i;
const STOP_WORDS = new Set([
    'tìm', 'tra', 'cứu', 'liệt', 'kê', 'danh', 'sách', 'cho', 'tôi', 'xin', 'hãy', 'xem',
    'các', 'những', 'một', 'vài', 'nào', 'bài', 'viết', 'tài', 'liệu', 'nguồn',
    'trong', 'hệ', 'thống', 'về', 'liên', 'quan', 'đến', 'giúp', 'với', 'cho', 'biết', 'nói', 'kiếm'
]);

const cleanText = (value) => String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const getSearchPhrase = (query) => String(query || '')
    .toLocaleLowerCase('vi')
    .replace(/[.,!?;:()[\]{}"“”]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term))
    .slice(0, 12)
    .join(' ');

const isIndexedLookupQuery = (query) => LOOKUP_INTENT.test(String(query || '')) && Boolean(getSearchPhrase(query));

const makeSnippet = (value, terms) => {
    const text = cleanText(value);
    if (!text) return '';
    const sentences = text.split(/(?<=[.!?;])\s+/).filter(Boolean);
    const ranked = sentences.map((sentence, index) => ({
        sentence,
        index,
        score: terms.reduce((score, term) => score + (sentence.toLocaleLowerCase('vi').includes(term) ? 1 : 0), 0)
    })).sort((a, b) => b.score - a.score || a.index - b.index);
    return (ranked[0]?.sentence || text).slice(0, 360);
};

const queryCollection = async (model, filter, projection) => {
    try {
        const fields = Object.fromEntries(projection.fields.split(/\s+/).filter(Boolean).map((field) => [field, 1]));
        return await model.find({ ...filter, $text: { $search: projection.searchPhrase } })
            .select({ ...fields, score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } })
            .limit(3)
            .lean();
    } catch (error) {
        console.warn(`[AI Fast Path] Text index query failed for ${model.modelName}: ${error.message}`);
        return [];
    }
};

const searchIndexedDocuments = async (query) => {
    const searchPhrase = getSearchPhrase(query);
    if (!searchPhrase) return null;
    const terms = searchPhrase.split(' ');
    const queryConfig = (fields) => ({ fields, searchPhrase });
    const [articles, resources, forms] = await Promise.all([
        queryCollection(Article, { status: 'Published', isPublished: { $ne: false } }, queryConfig('_id title textContent content category sourceUrl')),
        queryCollection(LegalResource, { isPublished: true }, queryConfig('_id title description content category sourceUrl')),
        queryCollection(LegalForm, { status: 'approved' }, queryConfig('_id name description category fileUrl'))
    ]);

    const hits = [
        ...articles.map((doc) => ({
            _id: String(doc._id), sourceId: `article:${doc._id}`, sourceType: 'article',
            title: doc.title, category: doc.category || '', url: doc.sourceUrl || '',
            text: doc.textContent || doc.content || '', score: doc.score || 0
        })),
        ...resources.map((doc) => ({
            _id: String(doc._id), sourceId: `legalResource:${doc._id}`, sourceType: 'legalResource',
            title: doc.title, category: doc.category || '', url: doc.sourceUrl || '',
            text: `${doc.description || ''} ${doc.content || ''}`, score: doc.score || 0
        })),
        ...forms.map((doc) => ({
            _id: String(doc._id), sourceId: `legalForm:${doc._id}`, sourceType: 'legalForm',
            title: doc.name, category: doc.category || '', url: doc.fileUrl || '',
            text: `${doc.name || ''} ${doc.description || ''}`, score: doc.score || 0
        }))
    ].sort((a, b) => b.score - a.score).slice(0, 4);

    if (!hits.length) return null;
    const sources = hits.map((hit) => ({
        _id: hit._id,
        id: hit._id,
        sourceId: hit.sourceId,
        sourceType: hit.sourceType,
        ...(hit.sourceType === 'article' ? {
            articleId: hit._id,
            articleApiPath: `/api/articles/${hit._id}`
        } : {}),
        title: hit.title,
        url: hit.url,
        category: hit.category,
        content: makeSnippet(hit.text, terms)
    }));

    const answer = [
        `Mình tìm thấy ${sources.length} tài liệu liên quan trong hệ thống:`,
        ...sources.map((source, index) => {
            const detail = source.content ? ` ${source.content}` : '';
            const category = source.category ? ` (${source.category})` : '';
            return `${index + 1}. ${source.title}${category}.${detail} [Nguồn ${index + 1}]`;
        })
    ].join('\n\n');

    return { answer, sources };
};

module.exports = { isIndexedLookupQuery, searchIndexedDocuments };
