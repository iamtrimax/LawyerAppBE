const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { z } = require('zod');
const { getDriver } = require('../config/neo4j');
const { generateEmbedding } = require('./embedding.service');
require('dotenv').config();

// Lấy danh sách các API Keys khả dụng
const getApiKeys = () => {
    return (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
};

// Schema đầu ra bằng Zod cho LangChain
const graphSchema = z.object({
    nodes: z.array(z.object({
        id: z.string().describe("Chuỗi định danh duy nhất (ví dụ: 'doc_123', 'doc_123_dieu_1')"),
        type: z.string().describe("Loại node ('Document', 'Chapter', 'Section', 'Article', 'Clause', 'Item')"),
        title: z.string().describe("Tiêu đề ngắn gọn"),
        content: z.string().describe("Nội dung chi tiết của điều khoản")
    })),
    relationships: z.array(z.object({
        source: z.string().describe("ID của node nguồn"),
        target: z.string().describe("ID của node đích"),
        type: z.string().describe("Loại quan hệ: 'CONTAINS' (cha chứa con) hoặc 'REFERENCES' (tham chiếu chéo)")
    }))
});

/**
 * Trích xuất đồ thị cho một mảng các bài viết (batch) sử dụng LangChain
 */
const extractGraphFromBatch = async (articles) => {
    const apiKeys = getApiKeys();
    let currentKeyIndex = 0;
    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts && currentKeyIndex < apiKeys.length) {
        try {
            console.log(`ℹ️ [GraphExtraction] Đang phân tích batch gồm ${articles.length} bài viết sử dụng Key #${currentKeyIndex + 1}`);
            const activeKey = apiKeys[currentKeyIndex];
            
            // Khởi tạo model LangChain với Structured Output
            const llm = new ChatGoogleGenerativeAI({
                modelName: "gemini-2.5-flash",
                apiKey: activeKey,
                maxOutputTokens: 8192,
                temperature: 0, // Temperature 0 để lấy output chính xác định dạng
            });

            const structuredLlm = llm.withStructuredOutput(graphSchema, { name: "extract_graph" });

            // Nối nội dung các bài viết
            let batchedContent = "";
            articles.forEach((article, index) => {
                const contentToSend = (article.textContent || article.content || "").substring(0, 10000);
                batchedContent += `\n\n--- BÀI VIẾT SỐ ${index + 1} ---\n`;
                batchedContent += `ID: ${article._id}\n`;
                batchedContent += `Tiêu đề: ${article.title}\n`;
                batchedContent += `Nội dung: \n${contentToSend}\n`;
            });

            const prompt = `
Bạn là một chuyên gia pháp luật và xử lý dữ liệu.
Nhiệm vụ của bạn là phân tích các văn bản pháp luật dưới đây và trích xuất cấu trúc phân cấp chi tiết theo từng điều khoản, cùng với các mối quan hệ tham chiếu chéo.

DANH SÁCH VĂN BẢN (BATCH):
${batchedContent}

Yêu cầu đầu ra dạng JSON bao gồm:
1. "nodes": Danh sách các thực thể. BẮT BUỘC tạo một node "Document" cho mỗi BÀI VIẾT (Sử dụng ID của bài viết làm định danh theo định dạng 'doc_' + ID).
2. "relationships": Các mối quan hệ liên kết ("CONTAINS" hoặc "REFERENCES"). Đảm bảo các node thuộc về đúng bài viết của nó (CONTAINS từ Document của bài viết đó).

Quy tắc:
- Hãy chia nhỏ văn bản đến mức "Khoản" (hoặc "Điểm").
- Đảm bảo id của mỗi node là duy nhất (phải gắn thêm _id của bài viết vào id của node để tránh trùng lặp giữa các bài viết, ví dụ: "doc_123456_dieu_1").
- Trả về JSON chuẩn theo cấu trúc yêu cầu.
`;
            
            // Gọi LangChain
            const graphData = await structuredLlm.invoke(prompt);

            if (!graphData || !graphData.nodes) {
                console.warn("⚠️ [GraphExtraction] Định dạng graph không hợp lệ hoặc rỗng.");
                return null;
            }

            console.log(`➡️ [GraphExtraction] Đã trích xuất ${graphData.nodes.length} nodes và ${graphData.relationships?.length || 0} quan hệ từ Gemini cho batch này.`);

            // Đảm bảo Node gốc Document được tạo
            articles.forEach(article => {
                const docId = `doc_${article._id.toString()}`;
                const hasDocNode = graphData.nodes.some(n => n.id === docId || (n.type === 'Document' && n.title === article.title));
                
                if (!hasDocNode) {
                    graphData.nodes.unshift({
                        id: docId,
                        type: 'Document',
                        title: article.title,
                        content: (article.textContent || article.content || "").substring(0, 1000)
                    });
                }
            });

            // Tự động thêm quan hệ CONTAINS từ Document đến các Điều lớn (Article) nếu không được chỉ định
            if (graphData.relationships) {
                articles.forEach(article => {
                    const docId = `doc_${article._id.toString()}`;
                    graphData.nodes.forEach(node => {
                        // Kiểm tra nếu node chứa article ID và là node cha (Article, Chapter, Section)
                        if (node.id.includes(article._id.toString()) && node.id !== docId && ['Article', 'Chapter', 'Section'].includes(node.type)) {
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
                });
            }

            // Tạo Vector Embeddings cho từng node (dùng vòng lặp tuần tự)
            console.log(`🧠 [GraphExtraction] Bắt đầu sinh embeddings cho ${graphData.nodes.length} nodes...`);
            for (let node of graphData.nodes) {
                const textToEmbed = `${node.title}. ${node.content}`;
                node.embedding = await generateEmbedding(textToEmbed, activeKey);
                // Giảm rate limit embedding
                await new Promise(r => setTimeout(r, 100));
            }

            // Lưu vào Neo4j
            // Vì batch chứa nhiều bài viết, ta gán chung hoặc gán theo logic. Neo4j saveGraphToNeo4j hiện tại 
            // lưu cho 1 article. Ta sửa thành saveGraphBatchToNeo4j.
            await saveGraphBatchToNeo4j(graphData);

            return graphData;

        } catch (error) {
            attempt++;
            const errorMessage = error.message || '';
            console.error(`❌ [GraphExtraction] Lỗi (Lần thử ${attempt}/${maxAttempts}):`, errorMessage);
            
            const isQuotaOrOverload = errorMessage.includes('429') || errorMessage.includes('Quota exceeded') || errorMessage.includes('503') || errorMessage.includes('high demand');
            if (isQuotaOrOverload) {
                currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
                console.log(`🔄 [GraphExtraction] Đang xoay sang Gemini API Key tiếp theo (Key #${currentKeyIndex + 1})`);
            }
            
            if (attempt < maxAttempts) {
                const backoffDelay = Math.pow(2, attempt) * 1000;
                console.log(`⏳ Đang đợi ${backoffDelay}ms trước khi thử lại...`);
                await new Promise(r => setTimeout(r, backoffDelay));
            }
        }
    }
    console.error(`❌ [GraphExtraction] Đã thử ${maxAttempts} lần đều thất bại cho batch này.`);
    return null;
};

/**
 * Lưu Graph Data của một Batch vào Neo4j
 */
const saveGraphBatchToNeo4j = async (graphData) => {
    const driver = getDriver();
    const session = driver.session();
    try {
        console.log(`💾 [Neo4j] Bắt đầu ghi đồ thị của Batch vào Neo4j...`);

        // Với batch, ta không xóa theo articleMongoId vì _id nằm rải rác trong node
        // ID trong node đã được yêu cầu chứa mongoId của article
        // 2. Tạo các Nodes
        for (let node of graphData.nodes) {
            // Giả sử ID đã mang tính duy nhất
            const uniqueNodeId = node.id;
            
            // Tìm mongoId gốc bằng cách tách chuỗi nếu node id có định dạng chứa id,
            // nhưng để đơn giản ta có thể lưu mongoId là string rỗng hoặc cố gắng lấy
            // vì LLM trả về ID tự do. 
            const mongoIdMatch = uniqueNodeId.match(/[0-9a-fA-F]{24}/);
            const mongoId = mongoIdMatch ? mongoIdMatch[0] : 'batch_extracted';

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
                        mongoId: mongoId,
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
                const uniqueSourceId = rel.source;
                const uniqueTargetId = rel.target;
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
        console.log(`✅ [Neo4j] Đã lưu thành công đồ thị Batch`);
    } catch (error) {
        console.error("❌ [Neo4j] Lỗi khi lưu đồ thị batch:", error.message);
    } finally {
        await session.close();
    }
};

module.exports = {
    extractGraphFromBatch,
    saveGraphBatchToNeo4j
};
