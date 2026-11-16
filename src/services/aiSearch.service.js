const NodeCache = require('node-cache');
const { retrieve, refreshIndex } = require('./rag.service');
const { generateChatCompletion } = require('./ollama.service');
const { runInteractiveRequest } = require('./ollamaPriority.service');
const { isIndexedLookupQuery, searchIndexedDocuments } = require('./fastSearch.service');
const sanitizeError = require('../utils/sanitizeError');
require('dotenv').config();

const searchCache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 500 });
const hasVietnameseDiacritics = (text) => /[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/.test(text);
const internalReasoningPatterns = [
    /^\s*(?:okay\b|first\b|let me\b|the user\b|looking at\b|i need to\b|we need to\b|according to (?:rule|the context)\b|the answer should\b|now i should\b)/i,
    /\b(?:the user's query|the user is asking|the context has|i should respond|i need to make sure|let me check|rule [1-8])\b/i,
    /^\s*(?:tôi sẽ suy nghĩ|tôi cần phân tích|tôi cần kiểm tra|trước hết tôi cần|người dùng đang hỏi|theo quy tắc|quy tắc số?\s*[1-8])/i
];

const isFinalVietnameseAnswer = (answer) => {
    const text = String(answer || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text || internalReasoningPatterns.some((pattern) => pattern.test(text))) return false;
    const firstSentence = text.split(/[.!?\n]/, 1)[0];
    return hasVietnameseDiacritics(firstSentence);
};

const createExtractiveFallback = (query, matches) => {
    const stopWords = new Set(['luật', 'cho', 'tôi', 'về', 'của', 'là', 'và', 'các', 'những', 'được', 'thế', 'nào', 'quy', 'định', 'theo', 'trong', 'khi', 'nếu', 'hãy', 'với']);
    const terms = String(query || '').toLocaleLowerCase('vi').split(/\s+/).filter((word) => word.length > 2 && !stopWords.has(word));
    const excerpts = matches.slice(0, 4).map((match, index) => {
        const sentences = String(match.content || '').split(/(?<=[.!?;])\s+/).filter((sentence) => sentence.length > 35);
        const best = sentences.map((sentence, order) => ({
            sentence,
            order,
            score: terms.reduce((score, term) => score + (sentence.toLocaleLowerCase('vi').includes(term) ? 1 : 0), 0)
        })).sort((a, b) => b.score - a.score || a.order - b.order)[0]?.sentence;
        if (!best || !hasVietnameseDiacritics(best)) return null;
        return `${best.slice(0, 500)} [Nguồn ${index + 1}]`;
    }).filter(Boolean);

    if (!excerpts.length) {
        return 'Mình chưa thể tạo câu trả lời tiếng Việt đáng tin cậy từ các đoạn tài liệu hiện có. Bạn vui lòng hỏi cụ thể hơn để mình tra cứu lại.';
    }
    return `Theo tài liệu trong hệ thống:\n\n${excerpts.map((excerpt) => `• ${excerpt}`).join('\n\n')}`;
};

const createVietnameseStreamGuard = (onToken, onReplace) => {
    let buffered = '';
    let released = false;
    let rejected = false;
    let sentLength = 0;

    return {
        push(token) {
            buffered += token;
            if (!onToken || rejected) return;
            if (internalReasoningPatterns.some((pattern) => pattern.test(buffered))) {
                rejected = true;
                return;
            }
            if (!released) {
                const firstSentenceEnd = buffered.search(/[.!?\n]/);
                if (firstSentenceEnd >= 0) {
                    const opening = buffered.slice(0, firstSentenceEnd + 1);
                    if (!hasVietnameseDiacritics(opening)) {
                        rejected = true;
                        return;
                    }
                    released = true;
                    onToken(buffered);
                    sentLength = buffered.length;
                } else if (buffered.length >= 180) {
                    if (!hasVietnameseDiacritics(buffered)) {
                        rejected = true;
                        return;
                    }
                    released = true;
                    onToken(buffered);
                    sentLength = buffered.length;
                }
                return;
            }
            onToken(token);
            sentLength += token.length;
        },
        finish(answer, fallback) {
            if (!isFinalVietnameseAnswer(answer) || rejected) {
                console.warn('[AI Output Guard] Đã chặn nội dung suy luận/không phải tiếng Việt; dùng câu trả lời trích xuất từ tài liệu.');
                if (onReplace) onReplace(fallback);
                else if (onToken) onToken(fallback);
                return fallback;
            }
            if (onToken && !released) onToken(answer);
            else if (onToken && answer.length > sentLength) onToken(answer.slice(sentLength));
            return answer;
        }
    };
};

const generateAnswer = async ({ query, history = [], matches, onToken, onReplace, signal }) => {
    const isQwen3 = process.env.OLLAMA_CHAT_MODEL?.toLowerCase().startsWith('qwen3');
    const context = matches.slice(0, 4).map((match, index) =>
        `[Nguồn ${index + 1}] Tiêu đề: ${match.title}\nDanh mục: ${match.category || 'Pháp luật'}\nNội dung trích từ tài liệu đã lưu trong hệ thống: ${match.content.slice(0, 2200)}`
    ).join('\n\n');
    const messages = [
        {
            role: 'system',
            content: `Bạn là trợ lý pháp luật dành cho người dùng Việt Nam.
Hãy trả lời hoàn toàn bằng tiếng Việt. Chỉ viết câu trả lời cuối cùng; không nêu suy nghĩ nội bộ, phân tích từng bước, lời tự thuật hoặc nhắc lại yêu cầu trong prompt.
Trả lời trực tiếp câu hỏi và giải thích quy định bằng ngôn ngữ dễ hiểu. Nêu đối tượng, điều kiện, quyền/nghĩa vụ và hệ quả khi tài liệu có thông tin. Không chỉ liệt kê tài liệu hoặc chỉ dẫn nguồn.
Chỉ sử dụng CONTEXT bên dưới. Đặt [Nguồn 1], [Nguồn 2]... ngay sau nhận định được tài liệu hỗ trợ. Không tự tạo điều luật, số liệu hoặc căn cứ.
Nếu CONTEXT không đủ, nêu rõ giới hạn bằng tiếng Việt và chỉ kết luận phần có căn cứ.
Lịch sử chỉ dùng để hiểu câu hỏi tiếp nối, không phải căn cứ pháp lý.

CONTEXT (đoạn trích từ tài liệu trong hệ thống):
${context || '(Không tìm thấy tài liệu liên quan trong dữ liệu hệ thống.)'}`
        },
        ...history.slice(-8).filter((message) => message?.text && message.senderID !== 'AI_ASSISTANT' && !message.isAiResponse).slice(-3).map((message) => ({
            role: 'user',
            content: String(message.text).slice(0, 1200)
        })),
        {
            role: 'user',
            content: `${query}${isQwen3 ? '\n/no_think' : ''}`
        }
    ];

    const outputGuard = createVietnameseStreamGuard(onToken, onReplace);
    let modelAnswer = '';
    try {
        modelAnswer = await generateChatCompletion(messages, {
            temperature: 0.3,
            onToken: (token) => outputGuard.push(token),
            signal,
            allowEmptyContent: true,
            ...(isQwen3 ? { think: false } : {}),
            modelOptions: { top_p: 0.8, top_k: 20, num_ctx: 8192, num_predict: 512 }
        });
    } catch (error) {
        if (signal?.aborted) throw error;
        console.warn(`[AI Output Guard] Model không tạo được câu trả lời chuẩn; dùng trích đoạn tài liệu: ${error.message}`);
    }
    return outputGuard.finish(modelAnswer, createExtractiveFallback(query, matches));
};

const aiSearch = async (query, history = [], streamCallbacks = {}) => runInteractiveRequest(async () => {
    try {
        if (streamCallbacks.signal?.aborted) throw new Error('Yêu cầu chat đã bị hủy.');
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery) throw new Error('Câu hỏi không được để trống');

        const cacheQuery = normalizedQuery.toLocaleLowerCase('vi').replace(/[.,!?;:()"“”]/g, ' ').replace(/\s+/g, ' ').trim();
        const cacheKey = `rag_vi_answer_v7_${cacheQuery}`;
        if (!history.length) {
            const cached = searchCache.get(cacheKey);
            if (cached) {
                console.log('[AI Fast Path] Cache hit; trả câu trả lời đã lưu trong bộ nhớ.');
                streamCallbacks.onStatus?.('Đã tìm thấy câu trả lời trong bộ nhớ đệm.');
                streamCallbacks.onToken?.(cached.answer);
                return cached;
            }
        }

        if (isIndexedLookupQuery(normalizedQuery)) {
            streamCallbacks.onStatus?.('Đang tra cứu nhanh tài liệu trong MongoDB...');
            const fastPathStartedAt = Date.now();
            const fastResult = await searchIndexedDocuments(normalizedQuery);
            if (fastResult) {
                console.log(`[AI Fast Path] Trả ${fastResult.sources.length} tài liệu từ MongoDB trong ${Date.now() - fastPathStartedAt} ms.`);
                if (!history.length) searchCache.set(cacheKey, fastResult);
                streamCallbacks.onToken?.(fastResult.answer);
                return fastResult;
            }
            console.log(`[AI Fast Path] Chưa tìm thấy tài liệu phù hợp trong ${Date.now() - fastPathStartedAt} ms; chuyển sang RAG.`);
        }

        console.log('[AI Route] Chuyển sang RAG: embedding → vector search → Qwen.');
        streamCallbacks.onStatus?.('Đang tìm tài liệu liên quan trong hệ thống...');
        const retrievalStartedAt = Date.now();
        const matches = await retrieve(normalizedQuery, undefined, { signal: streamCallbacks.signal });
        console.log(`[RAG] Truy xuất xong trong ${Date.now() - retrievalStartedAt} ms; tìm thấy ${matches.length} đoạn.`);
        const uniqueMatches = [];
        const seenSourceIds = new Set();
        for (const match of matches) {
            if (seenSourceIds.has(match.sourceId)) continue;
            seenSourceIds.add(match.sourceId);
            uniqueMatches.push(match);
            if (uniqueMatches.length === 4) break;
        }
        const generationStartedAt = Date.now();
        streamCallbacks.onStatus?.('Đang tổng hợp câu trả lời...');
        const answer = await generateAnswer({
            query: normalizedQuery,
            history,
            matches: uniqueMatches,
            onToken: streamCallbacks.onToken,
            onReplace: streamCallbacks.onReplace,
            signal: streamCallbacks.signal
        });
        console.log(`[RAG] Sinh câu trả lời xong trong ${Date.now() - generationStartedAt} ms.`);
        const sourceMap = new Map();
        for (const match of uniqueMatches) {
            if (!sourceMap.has(match.sourceId)) {
                const [sourceTypeFromId, ...idParts] = String(match.sourceId || '').split(':');
                const sourceType = match.sourceType || sourceTypeFromId || 'unknown';
                const documentId = idParts.join(':') || String(match._id || '');
                sourceMap.set(match.sourceId, {
                    // Keep the Mongo document ID explicit for client navigation.
                    _id: documentId,
                    id: documentId,
                    sourceId: match.sourceId,
                    sourceType,
                    ...(sourceType === 'article' ? {
                        articleId: documentId,
                        articleApiPath: `/api/articles/${documentId}`
                    } : {}),
                    title: match.title,
                    url: match.url,
                    category: match.category,
                    content: match.content
                });
            }
        }

        const result = { answer, sources: [...sourceMap.values()] };
        if (!history.length) searchCache.set(cacheKey, result);
        return result;
    } catch (error) {
        console.error('RAG search error:', error.message);
        throw new Error('Lỗi trong quá trình RAG xử lý câu hỏi: ' + sanitizeError(error));
    }
});

const initializeRagIndex = async () => {
    console.log('[RAG] Backend đã kết nối MongoDB, bắt đầu nạp chỉ mục.');
    try {
        const status = await refreshIndex();
        console.log(`[RAG] Chỉ mục sẵn sàng: ${status.sources} tài liệu, ${status.chunks} đoạn; mới tạo ${status.embeddedChunks} embeddings.`);
        return status;
    } catch (error) {
        console.error('RAG index initialization failed:', error.message);
        throw error;
    }
};

module.exports = { aiSearch, initializeRagIndex, refreshRagIndex: refreshIndex };
