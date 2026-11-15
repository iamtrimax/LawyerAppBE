const mongoose = require('mongoose');

const ragChunkSchema = new mongoose.Schema({
    sourceId: { type: String, required: true },
    sourceType: { type: String, enum: ['article', 'legalResource', 'legalForm'], required: true },
    title: { type: String, required: true },
    url: { type: String, default: '' },
    category: { type: String, default: '' },
    chunkIndex: { type: Number, required: true },
    content: { type: String, required: true },
    contentHash: { type: String, required: true },
    embeddingModel: { type: String, required: true },
    embedding: { type: [Number], required: true }
}, { timestamps: true });

ragChunkSchema.index({ embeddingModel: 1, sourceId: 1, chunkIndex: 1 }, { unique: true });

module.exports = mongoose.model('RagChunk', ragChunkSchema);
