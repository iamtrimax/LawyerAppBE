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

// Lấy danh sách các API Keys khả dụng
const getApiKeys = () => {
    return (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
};

/**
 * Trích xuất cấu trúc các điều khoản và quan hệ từ nội dung văn bản pháp luật bằng Gemini (Hỗ trợ Retry & Key Rotation)
 */
const extractGraphFromArticle = async (article) => {
    const apiKeys = getApiKeys();
    let currentKeyIndex = 0;
    let attempt = 0;
    const maxAttempts = 5;
    
    while (attempt < maxAttempts && currentKeyIndex < apiKeys.length) {
        try {
            console.log(`ℹ️ [GraphExtraction] Đang phân tích bài viết: "${article.title}" (ID: ${article._id}) sử dụng Key #${currentKeyIndex + 1}`);
            const activeKey = apiKeys[currentKeyIndex];
            const genAI = new GoogleGenerativeAI(activeKey);
            
            // Định nghĩa JSON Schema đầu ra bắt buộc cho Gemini
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            nodes: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        id: { type: "STRING" },
                                        type: { type: "STRING" },
                                        title: { type: "STRING" },
                                        content: { type: "STRING" }
                                    },
                                    required: ["id", "type", "title", "content"]
                                }
                            },
                            relationships: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        source: { type: "STRING" },
                                        target: { type: "STRING" },
                                        type: { type: "STRING" }
                                    },
                                    required: ["source", "target", "type"]
                                }
                            }
                        },
                        required: ["nodes", "relationships"]
                    }
                }
            });

        // Chỉ gửi tối đa 15000 ký tự nội dung để tránh vượt quá giới hạn token đầu ra
        const contentToSend = (article.textContent || article.content || "").substring(0, 15000);

        const prompt = `
Bạn là một chuyên gia pháp luật và xử lý dữ liệu.
Nhiệm vụ của bạn là phân tích văn bản pháp luật dưới đây và trích xuất cấu trúc phân cấp chi tiết theo từng điều khoản, cùng với các mối quan hệ tham chiếu chéo giữa các điều khoản đó.

Văn bản pháp luật:
Tiêu đề: ${article.title}
Nội dung: 
${contentToSend}

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
- Trả về JSON khớp chính xác theo schema được yêu cầu. Không được viết dở dang hoặc cắt ngắn kết quả JSON.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonText = response.text();
        
        let graphData;
        try {
            // Tự động sửa lỗi JSON kết thúc dở dang (ví dụ: thiếu đóng ] hoặc } do hết ký tự tối đa)
            const cleanJsonText = repairJson(jsonText);
            graphData = JSON.parse(cleanJsonText);
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
            node.embedding = await generateEmbedding(textToEmbed, activeKey);
        }

        // Lưu vào Neo4j
        await saveGraphToNeo4j(article._id.toString(), graphData);

        return graphData;
        } catch (error) {
            attempt++;
            const errorMessage = error.message || '';
            console.error(`❌ [GraphExtraction] Lỗi (Lần thử ${attempt}/${maxAttempts}):`, errorMessage);
            
            // Nếu lỗi do hết quota (429) hoặc quá tải (503), hãy đổi API Key tiếp theo
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
    console.error(`❌ [GraphExtraction] Đã thử ${maxAttempts} lần đều thất bại cho bài viết ${article._id}`);
    return null;
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

/**
 * Tự động sửa lỗi chuỗi JSON bị ngắt quãng giữa chừng
 */
function repairJson(jsonStr) {
    let clean = jsonStr.trim();
    if (!clean) return '{}';
    
    // Nếu bị cắt ngang trong cặp nháy kép
    let openQuotes = 0;
    for (let i = 0; i < clean.length; i++) {
        if (clean[i] === '"' && (i === 0 || clean[i-1] !== '\\')) {
            openQuotes++;
        }
    }
    
    // Nếu số nháy kép là lẻ, chuỗi đang bị ngắt giữa chừng
    if (openQuotes % 2 !== 0) {
        clean += '"';
    }
    
    // Bổ sung các dấu đóng ngoặc còn thiếu
    let stack = [];
    for (let i = 0; i < clean.length; i++) {
        const char = clean[i];
        if (char === '"' && (i === 0 || clean[i-1] !== '\\')) {
            // Skip strings content
            let nextQuote = clean.indexOf('"', i + 1);
            while (nextQuote !== -1 && clean[nextQuote - 1] === '\\') {
                nextQuote = clean.indexOf('"', nextQuote + 1);
            }
            if (nextQuote !== -1) {
                i = nextQuote;
            } else {
                break;
            }
        } else if (char === '{' || char === '[') {
            stack.push(char);
        } else if (char === '}') {
            if (stack[stack.length - 1] === '{') stack.pop();
        } else if (char === ']') {
            if (stack[stack.length - 1] === '[') stack.pop();
        }
    }
    
    // Đóng ngược từ stack
    while (stack.length > 0) {
        const last = stack.pop();
        if (last === '{') {
            clean += '}';
        } else if (last === '[') {
            clean += ']';
        }
    }
    
    return clean;
}

module.exports = {
    extractGraphFromArticle,
    saveGraphToNeo4j
};
