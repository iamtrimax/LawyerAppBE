const { getDriver } = require('../config/neo4j');
const { generateEmbedding } = require('./embedding.service');

// Cosine similarity
const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Tìm kiếm nâng cao kết hợp Vector Search & Graph Traversal (GraphRAG)
 */
const graphSearch = async (query, limit = 5) => {
    const driver = getDriver();
    const session = driver.session();
    try {
        console.log(`🔍 [GraphSearch] Đang tìm kiếm đồ thị cho truy vấn: "${query}"`);
        const queryEmbedding = await generateEmbedding(query);
        if (!queryEmbedding) {
            console.warn("⚠️ [GraphSearch] Không sinh được embedding cho truy vấn. Sử dụng tìm kiếm từ khóa hoặc trả về trống.");
            return [];
        }

        // 1. Lấy tất cả KnowledgeNode có chứa embedding trong Neo4j
        const result = await session.executeRead(tx => 
            tx.run(
                `MATCH (n:KnowledgeNode) 
                 WHERE n.embedding IS NOT NULL AND size(n.embedding) > 0
                 RETURN n.id AS id, n.localId AS localId, n.mongoId AS mongoId, 
                        n.type AS type, n.title AS title, n.content AS content, 
                        n.embedding AS embedding`
            )
        );

        const nodes = result.records.map(record => ({
            id: record.get('id'),
            localId: record.get('localId'),
            mongoId: record.get('mongoId'),
            type: record.get('type'),
            title: record.get('title'),
            content: record.get('content'),
            embedding: record.get('embedding')
        }));

        console.log(`📊 [GraphSearch] Neo4j có tổng cộng ${nodes.length} nodes để so sánh.`);

        // 2. Tính toán độ tương đồng cosine và lấy top K tương tự nhất
        const SIMILARITY_THRESHOLD = 0.65; // Đặt ngưỡng thấp hơn một chút vì node nhỏ hơn, chi tiết hơn
        const rankedNodes = nodes.map(node => {
            const similarity = cosineSimilarity(queryEmbedding, node.embedding);
            return { ...node, similarity };
        })
        .filter(n => n.similarity >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

        if (rankedNodes.length === 0) {
            console.log("⚠️ [GraphSearch] Không tìm thấy node nào vượt ngưỡng tương đồng.");
            return [];
        }

        console.log(`🎯 [GraphSearch] Tìm thấy ${rankedNodes.length} nodes tương đồng cao.`);

        // 3. Với mỗi node tương đồng cao, truy vấn Neo4j để mở rộng ngữ cảnh qua quan hệ (REFERENCES, CONTAINS)
        const expandedContexts = [];
        const processedIds = new Set();

        for (let baseNode of rankedNodes) {
            if (processedIds.has(baseNode.id)) continue;
            processedIds.add(baseNode.id);

            // Tìm các node liên quan trực tiếp đến node này (tham chiếu hoặc chứa)
            const relationResult = await session.executeRead(tx =>
                tx.run(
                    `MATCH (n:KnowledgeNode {id: $id})-[r:REFERENCES|CONTAINS]-(related:KnowledgeNode)
                     RETURN related.id AS id, related.type AS type, related.title AS title, 
                            related.content AS content, type(r) AS relType, 
                            startNode(r).id = n.id AS isOutgoing`
                    , { id: baseNode.id }
                )
            );

            const relatedNodes = relationResult.records.map(record => ({
                id: record.get('id'),
                type: record.get('type'),
                title: record.get('title'),
                content: record.get('content'),
                relType: record.get('relType'),
                direction: record.get('isOutgoing') ? 'outgoing' : 'incoming'
            }));

            // Tạo văn bản ngữ cảnh tích hợp cho node này
            let contextSnippet = `[ĐIỀU KHOẢN GỐC]: ${baseNode.title}\nNội dung: ${baseNode.content}\n`;
            
            if (relatedNodes.length > 0) {
                contextSnippet += `Quan hệ liên quan:\n`;
                relatedNodes.slice(0, 3).forEach(rel => {
                    if (rel.relType === 'CONTAINS') {
                        if (rel.direction === 'outgoing') {
                            contextSnippet += ` - Chứa điều khoản con: [${rel.title}]: ${rel.content.substring(0, 300)}...\n`;
                        } else {
                            contextSnippet += ` - Thuộc văn bản/mục cha: [${rel.title}]\n`;
                        }
                    } else if (rel.relType === 'REFERENCES') {
                        if (rel.direction === 'outgoing') {
                            contextSnippet += ` - Tham chiếu trực tiếp đến: [${rel.title}]: ${rel.content.substring(0, 300)}...\n`;
                        } else {
                            contextSnippet += ` - Được tham chiếu bởi: [${rel.title}]: ${rel.content.substring(0, 300)}...\n`;
                        }
                    }
                });
            }

            expandedContexts.push({
                mongoId: baseNode.mongoId,
                title: baseNode.title,
                content: baseNode.content,
                similarity: baseNode.similarity,
                fullContext: contextSnippet
            });
        }

        return expandedContexts;
    } catch (error) {
        console.error("❌ [GraphSearch] Lỗi khi thực hiện tìm kiếm GraphRAG:", error.message);
        return [];
    } finally {
        await session.close();
    }
};

module.exports = {
    graphSearch
};
