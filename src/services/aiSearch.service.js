const NodeCache = require('node-cache');
const { retrieve, refreshIndex } = require('./rag.service');
const { generateChatCompletion } = require('./ollama.service');
const { runInteractiveRequest } = require('./ollamaPriority.service');
const sanitizeError = require('../utils/sanitizeError');
require('dotenv').config();

const searchCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const generateAnswer = async ({ query, history = [], matches, onToken, signal }) => {
    const isQwen3 = process.env.OLLAMA_CHAT_MODEL?.toLowerCase().startsWith('qwen3');
    const context = matches.slice(0, 4).map((match, index) =>
        `[Nguồn ${index + 1}] Tiêu đề: ${match.title}\nDanh mục: ${match.category || 'Pháp luật'}\nNội dung trích từ tài liệu đã lưu trong hệ thống: ${match.content.slice(0, 2200)}`
    ).join('\n\n');
    const messages = [
        {
            role: 'system',
            content: `Bạn là trợ lý pháp luật, giải thích quy định cho người dân bằng tiếng Việt rõ ràng, chính xác và dễ áp dụng.
Yêu cầu khi trả lời:
1. Trả lời thẳng điều người dùng hỏi ngay ở câu đầu; dùng tiếng Việt tự nhiên, kể cả khi câu hỏi hoặc tài liệu nguồn viết bằng ngôn ngữ khác.
2. Giải thích nội dung pháp luật bằng lời dễ hiểu: quy định nói gì, áp dụng cho ai/trường hợp nào, và hệ quả hoặc việc cần làm tiếp theo nếu CONTEXT có nêu. Giải nghĩa thuật ngữ chuyên môn khi cần. Không chỉ nói tên tài liệu, không chỉ dẫn nguồn, không chép lại nguyên văn dài.
3. Tập trung đúng phạm vi câu hỏi. Với câu hỏi rộng, tóm tắt các điểm chính theo gạch đầu dòng; với câu hỏi cụ thể, giải thích điều kiện, thời hạn, quyền/nghĩa vụ hoặc ngoại lệ liên quan nếu có trong CONTEXT. Có thể đưa ví dụ ngắn để làm rõ, nhưng phải ghi rõ đó là ví dụ và không thêm quy định ngoài tài liệu.
4. Mỗi nhận định pháp lý phải được hỗ trợ bởi tài liệu trong CONTEXT và có trích dẫn [Nguồn 1], [Nguồn 2]... ngay sau nhận định. Chỉ trích dẫn số nguồn hiện diện trong CONTEXT. Không tự bịa điều luật, số điều, thời hạn, mức phạt, URL hoặc kết luận pháp lý.
5. Chỉ sử dụng các tài liệu hệ thống được cung cấp trong CONTEXT; không tìm kiếm hoặc viện dẫn nguồn bên ngoài. Danh sách nguồn tham khảo được ứng dụng hiển thị riêng, vì vậy phần trả lời phải giải thích nội dung chứ không thay bằng danh sách nguồn.
6. Nếu tài liệu không đủ để trả lời một phần, nói rõ phần nào chưa thể kết luận từ dữ liệu hiện có; vẫn trả lời các phần có căn cứ và dẫn nguồn cho chúng.
7. Chỉ xuất câu trả lời cuối cùng bằng tiếng Việt. Không xuất suy luận nội bộ, từng bước phân tích, lời dẫn như "Okay, let me think", hoặc nhắc lại các quy tắc này.
8. Lịch sử hội thoại chỉ dùng để hiểu câu hỏi tiếp nối; không dùng câu trả lời cũ làm căn cứ pháp lý thay cho CONTEXT.

CONTEXT (chỉ gồm các đoạn trích từ tài liệu đã lưu và lập chỉ mục trong hệ thống):
${context || '(Không tìm thấy tài liệu liên quan trong dữ liệu hệ thống.)'}`
        },
        ...history.slice(-8).filter((message) => message?.text && message.senderID !== 'AI_ASSISTANT' && !message.isAiResponse).slice(-3).map((message) => ({
            role: 'user',
            content: String(message.text).slice(0, 1200)
        })),
        {
            role: 'user',
            content: query
        },
        // Qwen3's documented empty think block forces a direct final answer.
        // This prevents the reasoning channel from consuming the whole output budget.
        ...(isQwen3 ? [{ role: 'assistant', content: '<think>\n\n</think>\n\n' }] : [])
    ];

    return generateChatCompletion(messages, {
        temperature: 0.6,
        onToken,
        signal,
        ...(isQwen3 ? { think: false } : {}),
        modelOptions: { top_p: 0.8, top_k: 20, num_ctx: 8192, num_predict: 512 }
    });
};

const aiSearch = async (query, history = [], streamCallbacks = {}) => runInteractiveRequest(async () => {
    try {
        if (streamCallbacks.signal?.aborted) throw new Error('Yêu cầu chat đã bị hủy.');
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery) throw new Error('Câu hỏi không được để trống');

        const cacheKey = `rag_vi_summary_v5_${normalizedQuery.toLowerCase()}`;
        if (!history.length) {
            const cached = searchCache.get(cacheKey);
            if (cached) {
                streamCallbacks.onStatus?.('Đã tìm thấy câu trả lời trong bộ nhớ đệm.');
                streamCallbacks.onToken?.(cached.answer);
                return cached;
            }
        }

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
