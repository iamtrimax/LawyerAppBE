const { GoogleGenerativeAI } = require('@google/generative-ai');
const Article = require('../model/article.model');
const { generateEmbedding } = require('./embedding.service');
const NodeCache = require('node-cache');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

// Cấu hình axios với timeout
const axiosInstance = axios.create({
    timeout: 8000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
});

/**
 * Crawl nội dung chính từ URL, hỗ trợ follow redirect
 * Trả về { title, content, textContent, finalUrl } hoặc null
 */
async function crawlUrl(url) {
    try {
        // Follow redirect để lấy URL thực (đặc biệt cho Google grounding redirect)
        const response = await axiosInstance.get(url, { maxRedirects: 5 });
        const finalUrl = response.request?.res?.responseUrl || response.config?.url || url;
        const $ = cheerio.load(response.data);
        
        // Loại bỏ các thẻ rác
        $('script, style, nav, footer, header, ads, .ads, #ads, iframe, noscript, .sidebar, .menu, .breadcrumb, .related-posts').remove();
        
        // Trích xuất tiêu đề thực từ trang
        const pageTitle = $('h1').first().text().trim() 
            || $('title').text().trim()
            || $('meta[property="og:title"]').attr('content')
            || '';
        
        // Lấy nội dung (ưu tiên các thẻ bài viết)
        let content = $('article').html() 
            || $('.post-content').html() 
            || $('.entry-content').html()
            || $('.content-detail').html()
            || $('.article-content').html()
            || $('#content').html() 
            || $('main').html() 
            || $('body').html();
        
        // Làm sạch text
        if (content) {
            const $content = cheerio.load(content);
            $content('script, style, nav, footer, header, ads, iframe').remove();
            content = $content.html();
        }
        
        const textContent = content ? cheerio.load(content).text().replace(/\s+/g, ' ').trim() : '';
        
        return {
            title: pageTitle,
            content: content ? content.substring(0, 8000) : '',
            textContent: textContent.substring(0, 3000),
            finalUrl: finalUrl
        };
    } catch (error) {
        console.error(`Crawl error for ${url}:`, error.message);
        return null;
    }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const searchCache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// IN-MEMORY VECTOR CACHE FOR SPEEDING UP SEARCH
let vectorCache = [];
let isCacheInitializing = false;

/**
 * Initialize the Vector Cache from Database
 */
const initializeVectorCache = async () => {
    if (isCacheInitializing) return;
    isCacheInitializing = true;
    try {
        console.log("📥 Initializing AI Vector Cache...");
        const startTime = Date.now();
        const candidates = await Article.find({
            embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
        }).select('embedding');
        
        vectorCache = candidates.map(doc => ({
            _id: doc._id,
            embedding: doc.embedding
        }));
        
        console.log(`✅ AI Vector Cache Initialized: ${vectorCache.length} articles in ${Date.now() - startTime}ms`);
    } catch (error) {
        console.error("❌ Failed to initialize AI Vector Cache:", error.message);
    } finally {
        isCacheInitializing = false;
    }
};

/**
 * Update or Add a single article to the Vector Cache
 */
const updateVectorCache = (articleId, embedding) => {
    if (!articleId || !embedding) return;
    const index = vectorCache.findIndex(v => v._id.toString() === articleId.toString());
    if (index !== -1) {
        vectorCache[index].embedding = embedding;
    } else {
        vectorCache.push({ _id: articleId, embedding });
    }
};

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
 * AI Search Service using RAG + Vector Search + Caching + History Context
 */
const aiSearch = async (query, history = []) => {
    try {
        const startTime = Date.now();

        // 0. CHECK CACHE (Chỉ cache cho query đơn lẻ, có history thì bỏ qua cache để đảm bảo tính động)
        const cacheKey = `search_${query.toLowerCase().trim()}`;
        if (history.length === 0) {
            const cachedResult = searchCache.get(cacheKey);
            if (cachedResult) {
                console.log("🚀 Serving from Cache");
                return cachedResult;
            }
        }

        // 1. DIRECT TITLE SEARCH (Ưu tiên khớp tiêu đề)
        let articles = [];
        try {
            const titleMatches = await Article.find({
                title: { $regex: query.trim(), $options: 'i' }
            }).select('title content category sourceUrl')
              .limit(3);
            
            if (titleMatches.length > 0) {
                articles = titleMatches.map(art => ({
                    ...art.toObject(),
                    similarity: 1.0, // Gán độ tương đồng tối đa cho khớp tiêu đề
                    matchType: 'title'
                }));
                console.log(`🔍 Found ${articles.length} articles by Title Match`);
            }
        } catch (titleError) {
            console.warn("⚠️ Title search failed, continuing with Vector search.");
        }

        // 2. VECTOR SEARCH (Tìm theo ý nghĩa nếu chưa đủ hoặc để bổ sung)
        let queryEmbedding = null;
        try {
            queryEmbedding = await generateEmbedding(query);
        } catch (embedError) {
            console.warn("⚠️ Embedding generation failed, continuing with current results.");
        }

        if (queryEmbedding) {
            if (vectorCache.length === 0) await initializeVectorCache();

            if (vectorCache.length > 0) {
                const SIMILARITY_THRESHOLD = 0.85; 
                const ranked = vectorCache.map(doc => ({
                    _id: doc._id,
                    similarity: cosineSimilarity(queryEmbedding, doc.embedding)
                }))
                .filter(r => r.similarity >= SIMILARITY_THRESHOLD)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, 3);

                if (ranked.length > 0) {
                    const topIds = ranked.map(r => r._id);
                    const topArticles = await Article.find({ _id: { $in: topIds } })
                        .select('title content category sourceUrl');

                    topArticles.forEach(art => {
                        // Tránh trùng lặp với kết quả tìm theo tiêu đề
                        if (!articles.find(a => a._id.toString() === art._id.toString())) {
                            const rank = ranked.find(r => r._id.toString() === art._id.toString());
                            articles.push({
                                ...art.toObject(),
                                similarity: rank ? rank.similarity : 0,
                                matchType: 'vector'
                            });
                        }
                    });
                }
            }
        }

        // Sắp xếp lại: Khớp tiêu đề lên trước, sau đó đến độ tương đồng vector
        articles.sort((a, b) => {
            if (a.matchType === 'title' && b.matchType !== 'title') return -1;
            if (a.matchType !== 'title' && b.matchType === 'title') return 1;
            return b.similarity - a.similarity;
        });

        // Text search fallback đã bị loại bỏ vì trả về nguồn không liên quan.
        // Nếu vector search không tìm thấy (ngưỡng 90%), Google Search sẽ bổ sung.

        const hasLocalContext = articles.length > 0;

        // 3. CONSTRUCT CONTEXT & HISTORY
        let context = "Dưới đây là một số thông tin từ các văn bản pháp luật tìm thấy:\n\n";
        articles.forEach((art, index) => {
            context += `[Tài liệu ${index + 1}]:\nTiêu đề: ${art.title}\nNội dung: ${art.content.replace(/<[^>]*>?/gm, '').substring(0, 1500)}...\n\n`;
        });

        // Định dạng lịch sử hội thoại
        let historyContext = "";
        if (history && history.length > 0) {
            historyContext = "LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:\n";
            history.slice(-5).forEach(msg => { // Lấy 5 tin nhắn gần nhất
                const role = (msg.senderID === 'AI_ASSISTANT' || msg.isAiResponse) ? "AI" : "Người dùng";
                historyContext += `${role}: ${msg.text}\n`;
            });
            historyContext += "\n--- END HISTORY ---\n\n";
        }

        // 4. CONSTRUCT PROMPT
        const systemPrompt = hasLocalContext ? `
Bạn là một trợ lý AI pháp luật thân thiện. 
NHIỆM VỤ: Trả lời câu hỏi dựa trên CONTEXT và HISTORY.

QUY TẮC ƯU TIÊN:
1. SỬ DỤNG CONTEXT: Đây là các bài viết chính thống trong hệ thống của chúng ta. Bạn PHẢI ưu tiên sử dụng thông tin từ CONTEXT để trả lời.
2. CHỈ DÙNG GOOGLE KHI CẦN: Chỉ sử dụng Google Search nếu CONTEXT không chứa thông tin cụ thể hoặc câu hỏi yêu cầu dữ liệu mới nhất mà CONTEXT chưa cập nhật.
3. TÍNH CHÍNH XÁC: Tuyệt đối không nhầm lẫn giữa các quy định. Nếu CONTEXT nói về chủ đề A nhưng người dùng hỏi về chủ đề B, hãy sử dụng kiến thức chung hoặc Google Search thay vì cố ép nội dung từ CONTEXT vào.

PHONG CÁCH TRẢ LỜI:
1. NGẮN GỌN & ĐÚNG TRỌNG TÂM.
2. TỰ NHIÊN: Trò chuyện như người bình thường, không máy móc.
3. BÁM SÁT HISTORY: Nếu có câu hỏi tiếp nối.

---
${historyContext}
CONTEXT (ƯU TIÊN):
${context}
---
` : `
Bạn là một trợ lý AI pháp luật thân thiện. 
Hãy sử dụng kiến thức của bạn kết hợp với Google Search để trả lời NGẮN GỌN, TỰ NHIÊN như đang chat bình thường.
Bám sát HISTORY nếu người dùng đang hỏi tiếp các ý trước.

---
${historyContext}
---
`;

        const finalPrompt = `${systemPrompt}\nCÂU HỎI HIỆN TẠI: ${query}\nTRẢ LỜI:`;

        // 5. GENERATE ANSWER WITH MULTI-KEY & MULTI-MODEL FALLBACK
        const API_KEYS = process.env.GEMINI_API_KEY.split(',').map(k => k.trim());
        const AVAILABLE_MODELS = [
            "gemini-2.5-flash", 
            "gemini-2.5-pro",
            "gemini-2.0-flash",
            "gemini-flash-latest",
            "gemini-pro-latest"
        ];

        let answer = "";
        let keyIndex = 0;
        let modelIndex = 0;
        let retryCount = 0;
        const MAX_RETRIES_PER_MODEL = 1;

        // Vòng lặp thử từng Key
        while (keyIndex < API_KEYS.length && !answer) {
            const currentKey = API_KEYS[keyIndex];
            const genAIInstance = new GoogleGenerativeAI(currentKey);
            modelIndex = 0; // Reset model cho key mới

            // Vòng lặp thử từng Model của Key đó
            while (modelIndex < AVAILABLE_MODELS.length) {
                const currentModelName = AVAILABLE_MODELS[modelIndex];
                const model = genAIInstance.getGenerativeModel({ 
                    model: currentModelName,
                    tools: [{ googleSearch: {} }] 
                });

                try {
                    const result = await model.generateContent(finalPrompt);
                    const response = await result.response;
                    answer = response.text();
                    
                    // 6. TRÍCH XUẤT GROUNDING METADATA (GOOGLE SEARCH SOURCES)
                    if (response.candidates?.[0]?.groundingMetadata) {
                        const metadata = response.candidates[0].groundingMetadata;
                        const searchSources = [];
                        
                        if (metadata.groundingChunks) {
                            // Lấy danh sách URL từ Google Grounding
                            const rawChunks = metadata.groundingChunks
                                .filter(chunk => chunk.web)
                                .slice(0, 3); // Giới hạn 3 nguồn để tối ưu tốc độ

                            // Luôn crawl Google sources để lấy title + content thật
                            console.log(`🕸️ Đang crawl ${rawChunks.length} nguồn từ Google...`);
                            const crawlPromises = rawChunks.map(async (chunk, index) => {
                                const crawled = await crawlUrl(chunk.web.uri);
                                
                                // CHỈ CHẤP NHẬN BÀI VIẾT LẤY ĐƯỢC "TOÀN BỘ NỘI DUNG" (Độ dài textContent > 600 ký tự)
                                if (crawled && crawled.textContent && crawled.textContent.length > 600) {
                                    return {
                                        _id: `google-source-${index}-${Date.now()}`,
                                        title: crawled.title || chunk.web.title || "Nguồn từ Google",
                                        sourceUrl: crawled.finalUrl || chunk.web.uri,
                                        category: "Tham khảo Google",
                                        content: crawled.content || ""
                                    };
                                } else {
                                    console.log(`⏭️ Bỏ qua nguồn Google không đủ nội dung hoặc bị chặn: ${chunk.web.uri}`);
                                    return null;
                                }
                            });
                            const crawledSources = (await Promise.all(crawlPromises)).filter(Boolean);

                            if (articles.length === 0) {
                                // Không có bài viết nội bộ -> dùng Google sources
                                articles = crawledSources;
                            } else {
                                // Có bài viết nội bộ -> bổ sung Google sources
                                const existingUrls = articles.map(a => a.sourceUrl);
                                crawledSources.forEach(s => {
                                    if (!existingUrls.includes(s.sourceUrl)) {
                                        articles.push(s);
                                    }
                                });
                            }
                        }
                    }

                    if (answer) break; 
                } catch (err) {
                    const errorMessage = err.message || "";
                    const isQuotaError = errorMessage.includes('429') || 
                                       errorMessage.includes('Quota exceeded') || 
                                       errorMessage.includes('rate limit');
                    const isRetryableError = errorMessage.includes('503') || 
                                           errorMessage.includes('high demand');

                    if (isQuotaError) {
                        console.warn(`⚠️ Key ${keyIndex + 1} - Model ${currentModelName} hết quota.`);
                        modelIndex++;
                        continue;
                    }

                    if (isRetryableError && retryCount < MAX_RETRIES_PER_MODEL) {
                        retryCount++;
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }

                    modelIndex++;
                    retryCount = 0;
                }
            }

            if (!answer) {
                console.warn(`❌ Toàn bộ model của Key ${keyIndex + 1} đều không khả dụng. Chuyển sang Key tiếp theo...`);
                keyIndex++;
            }
        }

        if (!answer) {
            answer = "Hiện tại tất cả các khóa API và mô hình AI đều đã hết lượt dùng miễn phí (Quota exceeded). Vui lòng thử lại sau vài phút hoặc bổ sung API Key mới.";
        }

        console.log(`TotalSearchTime: ${Date.now() - startTime}ms`);

        // 7. LỌC NGUỒN THAM KHẢO CHÍNH XÁC (RELEVANCE FILTERING)
        const stopWords = ['trong', 'của', 'theo', 'được', 'những', 'các', 'một', 'cho', 'này', 'với', 'đến', 'từ', 'là', 'và', 'hoặc', 'không', 'có', 'tại', 'về', 'phần', 'điều', 'khoản', 'quy', 'định', 'hướng', 'dẫn', 'thi', 'hành'];
        
        const filterRelevantSources = (sources, query, answer) => {
            const queryKeywords = query.toLowerCase().split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.includes(w));
            
            return sources.filter(source => {
                const titleLower = (source.title || "").toLowerCase();
                const id = source._id?.toString() || '';
                
                // 1. Nếu là nguồn nội bộ và đã đạt ngưỡng tương đồng vector cao -> Giữ lại
                // (Chỉ lọc thêm nếu query keywords rất đặc thù)
                if (!id.startsWith('google-source-')) {
                    const matchCount = queryKeywords.filter(kw => titleLower.includes(kw)).length;
                    // Nếu có ít nhất 1 từ khóa quan trọng hoặc độ tương đồng vector đã đảm bảo
                    return matchCount >= 1 || queryKeywords.length === 0;
                }
                
                // 2. Nếu là nguồn Google: Kiểm tra độ liên quan kỹ hơn
                if (id.startsWith('google-source-')) {
                    if (titleLower.length < 5) return false;
                    const matchCount = queryKeywords.filter(kw => titleLower.includes(kw)).length;
                    return matchCount >= 2; // Nguồn Google phải khớp ít nhất 2 từ khóa
                }
                
                return false;
            });
        };

        const relevantArticles = filterRelevantSources(articles, query, answer);

        const finalResult = {
            answer: answer.trim(),
            sources: relevantArticles.filter(a => a && a._id).map(a => ({
                _id: a._id,
                title: a.title,
                url: a.sourceUrl,
                category: a.category,
                content: a.content || ""
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
    aiSearch,
    initializeVectorCache,
    updateVectorCache
};
