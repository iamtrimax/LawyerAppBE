const axios = require('axios');
require('dotenv').config();

const ollamaBaseUrl = () => (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');

const generateEmbedding = async (text, options = {}) => {
    if (!text || !text.trim()) return null;
    const model = process.env.OLLAMA_EMBEDDING_MODEL;
    if (!model) throw new Error('OLLAMA_EMBEDDING_MODEL chưa được cấu hình');

    const response = await axios.post(`${ollamaBaseUrl()}/api/embed`, {
        model,
        input: text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000)
    }, { timeout: 120000, ...(options.signal ? { signal: options.signal } : {}) });

    const embedding = response.data?.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Ollama không trả về embedding hợp lệ');
    }
    return embedding;
};

module.exports = { generateEmbedding };
