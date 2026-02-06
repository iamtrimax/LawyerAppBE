const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate embedding for a given text
 * Uses text-embedding-004 model
 */
const generateEmbedding = async (text) => {
    if (!text) return null;

    // Clean text: remove HTML tags and limit length to avoid token limits
    const cleanText = text.replace(/<[^>]*>?/gm, '').substring(0, 10000);

    const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (retryCount <= MAX_RETRIES) {
        try {
            const result = await model.embedContent(cleanText);
            return result.embedding.values;
        } catch (err) {
            const isQuotaError = err.message.includes('429') || err.message.includes('Quota exceeded');
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
