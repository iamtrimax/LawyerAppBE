const crypto = require('crypto');
const Article = require('../model/article.model');
const LegalResource = require('../model/legalResource.model');
const LegalForm = require('../model/legalForm.model');
const RagChunk = require('../model/ragChunk.model');
const { generateEmbedding } = require('./embedding.service');
const { runBackgroundRequest } = require('./ollamaPriority.service');
require('dotenv').config();

const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 250;
const TOP_K = 5;
const MAX_VECTOR_INDEX_BYTES = (Number(process.env.RAG_VECTOR_INDEX_MAX_MB) || 512) * 1024 * 1024;
let indexPromise = null;
let vectorIndex = null;
const displayTitle = (title) => String(title || '').replace(/\s+/g, ' ').slice(0, 120);

const plainText = (value) => String(value || '')
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

const splitIntoChunks = (text) => {
    const result = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + CHUNK_SIZE, text.length);
        if (end < text.length) {
            const boundary = text.lastIndexOf(' ', end);
            if (boundary > start + CHUNK_SIZE * 0.65) end = boundary;
        }
        const content = text.slice(start, end).trim();
        if (content) result.push(content);
        if (end >= text.length) break;
        start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
    return result;
};

const sourceCollections = [
    {
        model: Article,
        filter: { status: 'Published' },
        projection: '_id title content textContent category sourceUrl',
        toSource: (doc) => ({
            sourceId: `article:${doc._id}`,
            sourceType: 'article',
            title: doc.title,
            url: doc.sourceUrl || '',
            category: doc.category || '',
            text: plainText(doc.textContent || doc.content)
        })
    },
    {
        model: LegalResource,
        filter: { isPublished: true },
        projection: '_id title content description category sourceUrl',
        toSource: (doc) => ({
            sourceId: `legalResource:${doc._id}`,
            sourceType: 'legalResource',
            title: doc.title,
            url: doc.sourceUrl || '',
            category: doc.category || '',
            text: plainText(`${doc.description || ''}\n${doc.content || ''}`)
        })
    },
    {
        model: LegalForm,
        filter: { status: 'approved' },
        projection: '_id name description category fileUrl',
        toSource: (doc) => ({
            sourceId: `legalForm:${doc._id}`,
            sourceType: 'legalForm',
            title: doc.name,
            url: doc.fileUrl || '',
            category: doc.category || '',
            text: plainText(`${doc.name}\n${doc.description || ''}`)
        })
    }
];

const countSources = async () => Promise.all(sourceCollections.map(({ model, filter }) => model.countDocuments(filter)))
    .then((counts) => counts.reduce((sum, count) => sum + count, 0));

async function* getSources() {
    for (const { model, filter, projection, toSource } of sourceCollections) {
        const cursor = model.find(filter).select(projection).lean().cursor({ batchSize: 50 });
        for await (const doc of cursor) {
            const source = toSource(doc);
            if (source.text.length > 0) yield source;
        }
    }
}

const buildVectorIndex = async (model) => {
    const total = await RagChunk.countDocuments({ embeddingModel: model });
    if (!total) return { model, dimension: 0, count: 0, vectors: new Float32Array(0), norms: new Float32Array(0), entries: [] };

    const sample = await RagChunk.findOne({ embeddingModel: model }).select('embedding').lean();
    const dimension = sample?.embedding?.length || 0;
    if (!dimension) return { model, dimension: 0, count: 0, vectors: new Float32Array(0), norms: new Float32Array(0), entries: [] };
    const estimatedBytes = total * dimension * Float32Array.BYTES_PER_ELEMENT + total * Float32Array.BYTES_PER_ELEMENT;
    if (estimatedBytes > MAX_VECTOR_INDEX_BYTES) {
        throw new Error(`Chỉ mục cần khoảng ${Math.ceil(estimatedBytes / 1024 / 1024)} MB, vượt ngưỡng ${Math.floor(MAX_VECTOR_INDEX_BYTES / 1024 / 1024)} MB`);
    }

    // Float32Array stores each vector component in 4 bytes instead of retaining
    // millions of boxed JavaScript numbers in the V8 heap.
    const vectors = new Float32Array(total * dimension);
    const norms = new Float32Array(total);
    const entries = new Array(total);
    const cursor = RagChunk.find({ embeddingModel: model })
        .select('sourceId chunkIndex embedding')
        .lean()
        .cursor({ batchSize: 50 });
    let count = 0;

    for await (const row of cursor) {
        if (count >= total) break;
        if (!Array.isArray(row.embedding) || row.embedding.length !== dimension) continue;
        const offset = count * dimension;
        let normSquared = 0;
        for (let component = 0; component < dimension; component++) {
            const value = row.embedding[component];
            vectors[offset + component] = value;
            normSquared += value * value;
        }
        norms[count] = Math.sqrt(normSquared);
        entries[count] = { sourceId: row.sourceId, chunkIndex: row.chunkIndex };
        count++;
    }

    return {
        model,
        dimension,
        count,
        vectors: count === total ? vectors : vectors.slice(0, count * dimension),
        norms: count === total ? norms : norms.slice(0, count),
        entries: count === total ? entries : entries.slice(0, count)
    };
};

const refreshIndex = async ({ force = false } = {}) => {
    if (indexPromise) {
        console.log('[RAG] Đã có lượt đồng bộ đang chạy; dùng chung tiến trình đó, không khởi động lượt mới.');
        return indexPromise;
    }
    indexPromise = (async () => {
        const model = process.env.OLLAMA_EMBEDDING_MODEL;
        if (!model) throw new Error('OLLAMA_EMBEDDING_MODEL chưa được cấu hình');

        console.log(`[RAG] Bắt đầu đồng bộ chỉ mục bằng embedding model "${model}".`);
        if (!vectorIndex || vectorIndex.model !== model) {
            try {
                const preloadStartedAt = Date.now();
                vectorIndex = await buildVectorIndex(model);
                console.log(`[RAG] Nạp chỉ mục tìm kiếm đã lưu: ${vectorIndex.count} đoạn; ${Date.now() - preloadStartedAt} ms.`);
            } catch (error) {
                vectorIndex = null;
                console.error(`[RAG] Chưa nạp được chỉ mục tìm kiếm đã lưu: ${error.message}`);
            }
        }
        const totalSources = await countSources();
        console.log(`[RAG] Tìm thấy ${totalSources} tài liệu trong MongoDB.`);
        const activeSourceIds = new Set();
        let indexChanged = !vectorIndex || vectorIndex.model !== model;
        let embeddedChunks = 0;
        let processedSources = 0;
        let totalChunks = 0;

        for await (const source of getSources()) {
            activeSourceIds.add(source.sourceId);
            const sourceChunks = splitIntoChunks(`${source.title}\n${source.text}`);
            const existingRows = await RagChunk.find({ embeddingModel: model, sourceId: source.sourceId })
                .select('chunkIndex contentHash embedding')
                .lean();
            const existingByIndex = new Map(existingRows.map((row) => [row.chunkIndex, row]));
            let sourceEmbeddedChunks = 0;
            const sourceStartedAt = Date.now();
            console.log(`[RAG] [${processedSources + 1}/${totalSources}] Đang xử lý "${displayTitle(source.title)}" (${sourceChunks.length} đoạn).`);
            const operations = [];

            for (let chunkIndex = 0; chunkIndex < sourceChunks.length; chunkIndex++) {
                const content = sourceChunks[chunkIndex];
                const contentHash = crypto.createHash('sha256').update(content).digest('hex');
                const existingRow = existingByIndex.get(chunkIndex);
                let embedding = existingRow?.contentHash === contentHash && !force
                    ? existingRow.embedding
                    : null;
                if (!Array.isArray(embedding) || embedding.length === 0) {
                    if (embeddedChunks === 0) console.log('[RAG] Đang tạo embeddings mới; lần đầu có thể mất thời gian khi Ollama nạp model.');
                    try {
                        embedding = await runBackgroundRequest(() => generateEmbedding(content));
                    } catch (error) {
                        console.error(`[RAG] Lỗi ở "${displayTitle(source.title)}", đoạn ${chunkIndex + 1}/${sourceChunks.length}: ${error.message}`);
                        throw error;
                    }
                    if (!embedding) {
                        const error = new Error(`Không tạo được embedding cho ${source.title}`);
                        console.error(`[RAG] Lỗi ở "${displayTitle(source.title)}", đoạn ${chunkIndex + 1}/${sourceChunks.length}: ${error.message}`);
                        throw error;
                    }
                    embeddedChunks++;
                    sourceEmbeddedChunks++;
                    indexChanged = true;
                }

                const row = {
                    sourceId: source.sourceId,
                    sourceType: source.sourceType,
                    title: source.title,
                    url: source.url,
                    category: source.category,
                    chunkIndex,
                    content,
                    contentHash,
                    embeddingModel: model,
                    embedding
                };
                operations.push({
                    updateOne: {
                        filter: { embeddingModel: model, sourceId: row.sourceId, chunkIndex },
                        update: { $set: row },
                        upsert: true
                    }
                });

                // Lưu theo từng lô nhỏ để tiến độ đã hoàn tất vẫn dùng lại được nếu Ollama hoặc tiến trình lỗi.
                if (operations.length >= 25) {
                    await RagChunk.bulkWrite(operations.splice(0, 25), { ordered: true });
                }
                totalChunks++;
            }

            if (operations.length) {
                await RagChunk.bulkWrite(operations.splice(0), { ordered: true });
            }
            const deletedChunkResult = await RagChunk.deleteMany({
                embeddingModel: model,
                sourceId: source.sourceId,
                chunkIndex: { $gte: sourceChunks.length }
            });
            if (deletedChunkResult.deletedCount > 0) indexChanged = true;
            processedSources++;
            console.log(`[RAG] [${processedSources}/${totalSources}] Hoàn tất "${displayTitle(source.title)}": ${sourceChunks.length} đoạn, ${sourceEmbeddedChunks} embeddings mới, ${Date.now() - sourceStartedAt} ms.`);
            existingByIndex.clear();
            existingRows.length = 0;
            sourceChunks.length = 0;
            source.text = '';
        }

        const indexedSourceIds = await RagChunk.distinct('sourceId', { embeddingModel: model });
        const staleSourceIds = indexedSourceIds.filter((sourceId) => !activeSourceIds.has(sourceId));
        for (let index = 0; index < staleSourceIds.length; index += 200) {
            const deletedSourceResult = await RagChunk.deleteMany({
                embeddingModel: model,
                sourceId: { $in: staleSourceIds.slice(index, index + 200) }
            });
            if (deletedSourceResult.deletedCount > 0) indexChanged = true;
        }
        await RagChunk.deleteMany({ embeddingModel: { $ne: model } });
        if (indexChanged) {
            const vectorIndexStartedAt = Date.now();
            vectorIndex = null;
            try {
                vectorIndex = await buildVectorIndex(model);
                console.log(`[RAG] Chỉ mục vector nén sẵn sàng: ${vectorIndex.count} đoạn, ${vectorIndex.dimension} chiều; ${Date.now() - vectorIndexStartedAt} ms.`);
            } catch (error) {
                vectorIndex = null;
                console.error(`[RAG] Không dựng được chỉ mục vector nén; sẽ tìm kiếm theo cursor MongoDB: ${error.message}`);
            }
        }
        return { sources: processedSources, chunks: totalChunks, embeddedChunks };
    })();

    try {
        return await indexPromise;
    } finally {
        indexPromise = null;
    }
};

const cosineSimilarity = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : -1;
};

const retrieve = async (query, limit = TOP_K, options = {}) => {
    const model = process.env.OLLAMA_EMBEDDING_MODEL;
    const queryEmbedding = await generateEmbedding(query, { signal: options.signal });
    if (!queryEmbedding) return [];

    const activeVectorIndex = vectorIndex;
    if (activeVectorIndex?.model === model && activeVectorIndex.dimension === queryEmbedding.length) {
        const queryNorm = Math.sqrt(queryEmbedding.reduce((sum, value) => sum + value * value, 0));
        if (!queryNorm || !limit) return [];
        const topCandidates = [];
        for (let rowIndex = 0; rowIndex < activeVectorIndex.count; rowIndex++) {
            const offset = rowIndex * activeVectorIndex.dimension;
            let dot = 0;
            for (let component = 0; component < activeVectorIndex.dimension; component++) {
                dot += queryEmbedding[component] * activeVectorIndex.vectors[offset + component];
            }
            const denominator = queryNorm * activeVectorIndex.norms[rowIndex];
            const similarity = denominator ? dot / denominator : -1;
            if (similarity <= 0.12) continue;

            const entry = activeVectorIndex.entries[rowIndex];
            const candidate = { ...entry, similarity };
            if (topCandidates.length < limit) {
                topCandidates.push(candidate);
                continue;
            }
            let lowestIndex = 0;
            for (let index = 1; index < topCandidates.length; index++) {
                if (topCandidates[index].similarity < topCandidates[lowestIndex].similarity) lowestIndex = index;
            }
            if (similarity > topCandidates[lowestIndex].similarity) topCandidates[lowestIndex] = candidate;
        }

        topCandidates.sort((a, b) => b.similarity - a.similarity);
        if (!topCandidates.length) return [];
        const documents = await RagChunk.find({
            embeddingModel: model,
            $or: topCandidates.map(({ sourceId, chunkIndex }) => ({ sourceId, chunkIndex }))
        }).select('sourceId sourceType title url category chunkIndex content').lean();
        const documentByKey = new Map(documents.map((doc) => [`${doc.sourceId}:${doc.chunkIndex}`, doc]));
        return topCandidates.map((candidate) => ({
            ...documentByKey.get(`${candidate.sourceId}:${candidate.chunkIndex}`),
            similarity: candidate.similarity
        })).filter((match) => match.sourceId);
    }

    const cursor = RagChunk.find({ embeddingModel: model })
        .select('sourceId sourceType title url category chunkIndex content embedding')
        .lean()
        .cursor({ batchSize: 50 });
    const topMatches = [];

    for await (const chunk of cursor) {
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        if (similarity <= 0.12) continue;

        const match = { ...chunk, similarity };
        if (topMatches.length < limit) {
            topMatches.push(match);
            continue;
        }

        let lowestIndex = 0;
        for (let index = 1; index < topMatches.length; index++) {
            if (topMatches[index].similarity < topMatches[lowestIndex].similarity) lowestIndex = index;
        }
        if (similarity > topMatches[lowestIndex].similarity) topMatches[lowestIndex] = match;
    }

    return topMatches.sort((a, b) => b.similarity - a.similarity);
};

module.exports = { refreshIndex, retrieve };
