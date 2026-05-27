const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate embedding for a given text (Supports Multi-key Rotation)
 * Uses gemini-embedding-001 model
 */
const generateEmbedding = async (text, customApiKey = null) => {
    if (!text) return null;

    // Phân tách danh sách các API Keys nếu có nhiều key
    const keys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
    
    // Clean text: remove HTML tags and limit length to avoid token limits
    const cleanText = text.replace(/<[^>]*>?/gm, '').substring(0, 10000);

    let retryCount = 0;
    const MAX_RETRIES = 3;
    let keyIndex = 0;

    // Sử dụng custom key được truyền từ graphExtraction hoặc thử lần lượt các key
    if (customApiKey) {
        const genAI = new GoogleGenerativeAI(customApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        try {
            const result = await model.embedContent(cleanText);
            return result.embedding.values;
        } catch (err) {
            console.error('Embedding Generation Error (Custom Key):', err.message);
        }
    }

    while (retryCount <= MAX_RETRIES && keyIndex < keys.length) {
        const currentKey = keys[keyIndex];
        const genAI = new GoogleGenerativeAI(currentKey);
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

        try {
            const result = await model.embedContent(cleanText);
            return result.embedding.values;
        } catch (err) {
            const errorMessage = err.message || '';
            const isInvalidKey = errorMessage.includes('API key not valid') || errorMessage.includes('400');
            const isQuotaError = errorMessage.includes('429') || errorMessage.includes('Quota exceeded') || errorMessage.includes('rate limit');
            
            if (isInvalidKey) {
                console.warn(`⚠️ Key #${keyIndex + 1} không hợp lệ. Đang xoay sang Key tiếp theo...`);
                keyIndex++;
                continue;
            }

            if (isQuotaError && retryCount < MAX_RETRIES) {
                retryCount++;
                const delay = Math.pow(2, retryCount) * 2000;
                console.warn(`Embedding Quota exceeded. Retrying ${retryCount}/${MAX_RETRIES} in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            console.error('Embedding Generation Error:', err.message);
            return null;
        }
    }
    return null;
};

module.exports = {
    generateEmbedding
};
