const { GoogleGenerativeAI } = require('@google/generative-ai');
const Article = require('../model/article.model');
const { generateEmbedding } = require('./embedding.service');
const NodeCache = require('node-cache');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const searchCache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

/**
 * Cosine Similarity Calculation
 */
const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * AI Search Service using RAG + Vector Search + Caching
 */
const aiSearch = async (query) => {
    try {
        const startTime = Date.now();

        // 0. CHECK CACHE
        const cacheKey = `search_${query.toLowerCase().trim()}`;
        const cachedResult = searchCache.get(cacheKey);
        if (cachedResult) {
            console.log("🚀 Serving from Cache");
            console.log(`TotalSearchTime: ${Date.now() - startTime}ms`);
            return cachedResult;
        }

        // 1. Generate Embedding for the query
        let queryEmbedding = null;
        try {
            queryEmbedding = await generateEmbedding(query);
        } catch (embedError) {
            console.warn("⚠️ Embedding generation failed (likely quota), continuing with Text Search.");
        }

        let articles = [];

        if (queryEmbedding) {
            const vectorStartTime = Date.now();
            console.log("Using Vector Search...");

            // OPTIMIZATION: Fetch ONLY _id and embedding first to minimize data transfer
            const candidates = await Article.find({
                embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
            }).select('embedding');

            if (candidates.length > 0) {
                // Calculate similarity in memory
                const ranked = candidates.map(doc => {
                    if (!doc.embedding || doc.embedding.length === 0) return { _id: doc._id, similarity: 0 };
                    return {
                        _id: doc._id,
                        similarity: cosineSimilarity(queryEmbedding, doc.embedding)
                    };
                })
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 2); // OPTIMIZATION: Reduce from 3 to 2

                // Fetch full details only for the winners
                const topIds = ranked.map(r => r._id);
                const topArticles = await Article.find({ _id: { $in: topIds } })
                    .select('title content category sourceUrl');

                // Merge similarity scores back
                articles = topArticles.map(art => {
                    const rank = ranked.find(r => r._id.equals(art._id));
                    return { ...art._doc, similarity: rank ? rank.similarity : 0 };
                }).sort((a, b) => b.similarity - a.similarity);
            }
            console.log(`VectorRanking: ${Date.now() - vectorStartTime}ms`);
        }

        // FALLBACK: If vector search yields no results, use Text Search
        if (articles.length === 0) {
            console.log("Falling back to Text Search...");
            articles = await Article.find(
                { $text: { $search: query } },
                { score: { $meta: 'textScore' } }
            )
                .sort({ score: { $meta: 'textScore' } })
                .limit(2) // OPTIMIZATION: Reduce from 3 to 2
                .select('title content category sourceUrl');
        }

        if (articles.length === 0) {
            return {
                answer: "Xin lỗi, tôi không tìm thấy tài liệu pháp luật nào liên quan đến câu hỏi của bạn trong cơ sở dữ liệu hiện tại.",
                sources: []
            };
        }

        // 3. CONSTRUCT CONTEXT
        let context = "Dưới đây là một số thông tin từ các văn bản pháp luật tìm thấy:\n\n";
        articles.forEach((art, index) => {
            const similarityLabel = art.similarity ? ` (Độ tương đương: ${(art.similarity * 100).toFixed(1)}%)` : '';
            // OPTIMIZATION: Reduce content length from 2000 to 1500
            context += `[Tài liệu ${index + 1}]${similarityLabel}:\nTiêu đề: ${art.title}\nLoại: ${art.category}\nNội dung: ${art.content.replace(/<[^>]*>?/gm, '').substring(0, 1500)}...\n\n`;
        });

        // 4. GENERATE ANSWER WITH GEMINI
        // Switched to gemini-1.5-flash for better free quota (15 RPM vs 5 RPM)
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
Bạn là một trợ lý AI chuyên gia về pháp luật Việt Nam. 
Dựa vào ngữ cảnh (CONTEXT) được cung cấp dưới đây, hãy trả lời câu hỏi của người dùng một cách chính xác, chuyên sâu và khách quan.

LƯU Ý QUAN TRỌNG:
1. Nếu câu hỏi yêu cầu một điều khoản cụ thể, hãy trích dẫn chính xác nội dung từ ngữ cảnh.
2. Nếu ngữ cảnh không chứa thông tin để trả lời, hãy nói rằng bạn hiện chưa có dữ liệu chính xác về điều khoản này.
3. Luôn ghi rõ nguồn trích dẫn ở cuối câu trả lời.
4. Ưu tiên sự chính xác tuyệt đối vì đây là thông tin pháp luật.

---
CONTEXT:
${context}
---

CÂU HỎI CỦA NGƯỜI DÙNG:
${query}

TRẢ LỜI:
`;

        let answer = "";
        let retryCount = 0;
        const MAX_RETRIES = 3;

        while (retryCount <= MAX_RETRIES) {
            try {
                const result = await model.generateContent(prompt);
                const response = await result.response;
                answer = response.text();
                break;
            } catch (err) {
                if ((err.message.includes('429') || err.message.includes('Quota exceeded')) && retryCount < MAX_RETRIES) {
                    retryCount++;
                    // Faster backoff: 1s, 2s, 4s
                    const delay = Math.pow(2, retryCount) * 1000;
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                // If we failed after all retries because of Quota or other error, 
                // DO NOT THROW. Return sources so user can investigate themselves.
                if (retryCount === MAX_RETRIES) {
                    console.error("AI Generation failed after max retries:", err.message);
                    answer = "Hiện tại hệ thống AI đang quá tải (hết lượt miễn phí). Tuy nhiên, tôi đã tìm thấy các văn bản gốc liên quan dưới đây. Bạn vui lòng tham khảo trực tiếp nhé!";
                    break;
                }
                throw err;
            }
        }

        console.log(`TotalSearchTime: ${Date.now() - startTime}ms`);

        const finalResult = {
            answer: answer.trim(),
            sources: articles.map(a => ({
                _id: a._id,
                title: a.title,
                url: a.sourceUrl,
                category: a.category
            }))
        };

        // SAVE TO CACHE
        searchCache.set(cacheKey, finalResult);

        return finalResult;

    } catch (error) {
        console.error('AI Search Error:', error.message);
        throw new Error('Lỗi trong quá trình AI xử lý câu hỏi: ' + error.message);
    }
};

module.exports = {
    aiSearch
};
