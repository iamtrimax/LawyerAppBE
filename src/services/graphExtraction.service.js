const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getDriver } = require('../config/neo4j');
const { generateEmbedding } = require('./embedding.service');
require('dotenv').config();

// Hỗ trợ multi-key fallback
const getGenAI = () => {
    const keys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
    const key = keys[0] || '';
    return new GoogleGenerativeAI(key);
};

/**
 * Trích xuất cấu trúc các điều khoản và quan hệ từ nội dung văn bản pháp luật bằng Gemini
 */
const extractGraphFromArticle = async (article) => {
    try {
        console.log(`ℹ️ [GraphExtraction] Đang phân tích bài viết: "${article.title}" (ID: ${article._id})`);
        
        const genAI = getGenAI();
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const prompt = `
Bạn là một chuyên gia pháp luật và xử lý dữ liệu.
Nhiệm vụ của bạn là phân tích văn bản pháp luật dưới đây và trích xuất cấu trúc phân cấp chi tiết theo từng điều khoản, cùng với các mối quan hệ tham chiếu chéo giữa các điều khoản đó.

Văn bản pháp luật:
Tiêu đề: ${article.title}
Nội dung: 
${article.textContent || article.content}

Yêu cầu đầu ra dạng JSON gồm 2 mảng chính:
1. "nodes": Danh sách các thực thể (mức điều khoản hoặc văn bản lớn):
   - Mỗi node cần có các trường:
     + "id": Chuỗi định danh duy nhất (ví dụ: "dieu_1", "dieu_2_khoan_1")
     + "type": Loại node ("Document" cho văn bản gốc, "Chapter" cho Chương, "Section" cho Mục, "Article" cho Điều, "Clause" cho Khoản, "Item" cho Điểm)
     + "title": Tiêu đề ngắn gọn (ví dụ: "Điều 1: Phạm vi điều chỉnh")
     + "content": Nội dung chi tiết của điều khoản đó (phải giữ lại đầy đủ nội dung chữ của điều khoản)

2. "relationships": Các mối quan hệ liên kết:
   - "source": id của node nguồn
   - "target": id của node đích
   - "type": Loại quan hệ ("CONTAINS" cho quan hệ cha-con như văn bản chứa điều, điều chứa khoản; "REFERENCES" cho quan hệ tham chiếu chéo như Điều này nhắc tới Điều kia, ví dụ "Thực hiện theo quy định tại Khoản 2 Điều 5...")

Quy tắc:
- Hãy chia nhỏ văn bản đến mức "Khoản" (hoặc "Điểm" nếu có nội dung cụ thể rõ ràng).
- Nếu phát hiện nội dung của Điều/Khoản có nhắc tới các Điều/Khoản khác trong chính văn bản này hoặc văn bản pháp luật khác, hãy tạo quan hệ "REFERENCES".
- Trả về JSON theo đúng định dạng sau:
{
  "nodes": [
     { "id": "chuoi_id", "type": "Article", "title": "...", "content": "..." }
  ],
  "relationships": [
     { "source": "chuoi_id_1", "target": "chuoi_id_2", "type": "CONTAINS" }
  ]
}
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text();
        
        let graphData;
        try {
            graphData = JSON.parse(jsonText);
        } catch (parseError) {
            console.error("❌ [GraphExtraction] Lỗi parse JSON từ Gemini:", parseError.message);
            console.log("Raw output:", jsonText);
            return null;
        }

        if (!graphData.nodes || !Array.isArray(graphData.nodes)) {
            console.warn("⚠️ [GraphExtraction] Định dạng graph không hợp lệ hoặc rỗng.");
            return null;
        }

        console.log(`➡️ [GraphExtraction] Đã trích xuất ${graphData.nodes.length} nodes và ${graphData.relationships?.length || 0} quan hệ từ Gemini.`);

        // Tạo Node gốc đại diện cho Văn bản (Document) nếu chưa có
        const docId = `doc_${article._id.toString()}`;
        const hasDocNode = graphData.nodes.some(n => n.type === 'Document');
        if (!hasDocNode) {
            graphData.nodes.unshift({
                id: docId,
                type: 'Document',
                title: article.title,
                content: article.textContent || article.content
            });
        }

        // Tự động thêm quan hệ CONTAINS từ Document đến các Điều lớn (Article) nếu không được chỉ định
        if (graphData.relationships) {
            graphData.nodes.forEach(node => {
                if (node.type === 'Article' && node.id !== docId) {
                    const isContained = graphData.relationships.some(rel => rel.target === node.id && rel.type === 'CONTAINS');
                    if (!isContained) {
                        graphData.relationships.push({
                            source: docId,
                            target: node.id,
                            type: 'CONTAINS'
                        });
                    }
                }
            });
        }

        // Tạo Vector Embeddings cho từng node để phục vụ tìm kiếm kết hợp
        console.log(`🧠 [GraphExtraction] Bắt đầu sinh embeddings cho ${graphData.nodes.length} nodes...`);
        for (let node of graphData.nodes) {
            const textToEmbed = `${node.title}. ${node.content}`;
            node.embedding = await generateEmbedding(textToEmbed);
        }

        // Lưu vào Neo4j
        await saveGraphToNeo4j(article._id.toString(), graphData);

        return graphData;
    } catch (error) {
        console.error("❌ [GraphExtraction] Lỗi trong quá trình trích xuất đồ thị:", error.message);
        return null;
    }
};

/**
 * Lưu Graph Data vào Neo4j
 */
const saveGraphToNeo4j = async (articleMongoId, graphData) => {
    const driver = getDriver();
    const session = driver.session();
    try {
        console.log(`💾 [Neo4j] Bắt đầu ghi đồ thị của bài viết ${articleMongoId} vào Neo4j...`);
        
        // 1. Xóa các dữ liệu cũ liên quan đến bài viết này để build lại sạch sẽ
        await session.executeWrite(tx => 
            tx.run(
                'MATCH (n) WHERE n.mongoId = $mongoId DETACH DELETE n',
                { mongoId: articleMongoId }
            )
        );

        // 2. Tạo các Nodes
        for (let node of graphData.nodes) {
            // Chuẩn hóa ID để duy nhất trong toàn hệ thống Neo4j bằng cách kết hợp mongoId
            const uniqueNodeId = `${articleMongoId}_${node.id}`;
            await session.executeWrite(tx => 
                tx.run(
                    `MERGE (n:KnowledgeNode {id: $id})
                     SET n.localId = $localId,
                         n.mongoId = $mongoId,
                         n.type = $type,
                         n.title = $title,
                         n.content = $content,
                         n.embedding = $embedding`,
                    {
                        id: uniqueNodeId,
                        localId: node.id,
                        mongoId: articleMongoId,
                        type: node.type,
                        title: node.title,
                        content: node.content || "",
                        embedding: node.embedding || []
                    }
                )
            );
        }

        // 3. Tạo các Relationships
        if (graphData.relationships && graphData.relationships.length > 0) {
            for (let rel of graphData.relationships) {
                const uniqueSourceId = `${articleMongoId}_${rel.source}`;
                const uniqueTargetId = `${articleMongoId}_${rel.target}`;
                const relType = rel.type === 'CONTAINS' ? 'CONTAINS' : 'REFERENCES';

                await session.executeWrite(tx => 
                    tx.run(
                        `MATCH (a:KnowledgeNode {id: $sourceId}), (b:KnowledgeNode {id: $targetId})
                         MERGE (a)-[r:${relType}]->(b)`,
                        {
                            sourceId: uniqueSourceId,
                            targetId: uniqueTargetId
                        }
                    )
                );
            }
        }
        console.log(`✅ [Neo4j] Đã lưu thành công đồ thị cho bài viết ${articleMongoId}`);
    } catch (error) {
        console.error("❌ [Neo4j] Lỗi khi lưu đồ thị:", error.message);
    } finally {
        await session.close();
    }
};

module.exports = {
    extractGraphFromArticle,
    saveGraphToNeo4j
};
