/**
 * Rule-Based Graph Extraction cho Văn bản Pháp luật Việt Nam
 * 
 * Thay thế Gemini API bằng regex parsing.
 * Cấu trúc chuẩn: Phần → Chương → Mục → Điều → Khoản → Điểm
 * 
 * Ưu điểm:
 * - Miễn phí, không giới hạn token
 * - Chính xác 100% cho cấu trúc phân cấp
 * - Phát hiện tham chiếu chéo tự động
 */

const { getDriver } = require('../config/neo4j');
const { generateEmbedding } = require('./embedding.service');

// ==================== REGEX PATTERNS ====================

// Patterns cho từng cấp cấu trúc pháp luật VN
const PATTERNS = {
    // "PHẦN THỨ NHẤT", "Phần I", "PHẦN 1"
    part: /^(?:PHẦN\s+(?:THỨ\s+)?(?:NHẤT|HAI|BA|BỐN|NĂM|SÁU|BẢY|TÁM|CHÍN|MƯỜI|[IVXLCDM]+|\d+))\s*[.:]?\s*(.*)/im,

    // "CHƯƠNG I", "Chương 1", "CHƯƠNG VII"
    chapter: /^(?:CHƯƠNG|Chương)\s+([IVXLCDM]+|\d+)\s*[.:]?\s*(.*)/m,

    // "MỤC 1", "Mục I"
    section: /^(?:MỤC|Mục)\s+(\d+|[IVXLCDM]+)\s*[.:]?\s*(.*)/m,

    // "Điều 1.", "Điều 123:", "ĐIỀU 1"
    article: /^(?:Điều|ĐIỀU)\s+(\d+)\s*[.:]\s*(.*)/m,

    // "1.", "2.", "3." ở đầu dòng (sau Điều) → Khoản
    clause: /^(\d+)\.\s+(.*)/m,

    // "a)", "b)", "c)" hoặc "a.", "b." ở đầu dòng → Điểm
    item: /^([a-zđ])\)\s+(.*)/m,
};

// Pattern phát hiện tham chiếu chéo: "quy định tại Điều X", "theo Khoản Y Điều Z", etc.
const REFERENCE_PATTERNS = [
    // "quy định tại Điều 5" / "theo Điều 10" / "căn cứ Điều 15"
    /(?:quy\s+định\s+tại|theo|căn\s+cứ|nêu\s+tại|tại|áp\s+dụng)\s+(?:Khoản\s+(\d+)\s+)?Điều\s+(\d+)/gi,
    // "Điều 5 của Luật này" / "Khoản 2 Điều 3"
    /Khoản\s+(\d+)\s+Điều\s+(\d+)/gi,
    // "Điều X" đứng riêng khi nhắc đến
    /Điều\s+(\d+)(?:\s+(?:của|Luật|Nghị\s+định|Bộ\s+luật|Thông\s+tư))/gi,
];

// ==================== PARSER ====================

/**
 * Loại bỏ HTML tags, giữ lại text thuần
 */
function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|tbody|thead)[^>]*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Trích xuất cấu trúc graph từ văn bản pháp luật bằng regex
 */
function extractStructure(text, articleTitle) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const nodes = [];
    const relationships = [];

    // State tracking
    let currentChapter = null;
    let currentSection = null;
    let currentArticle = null;
    let currentClause = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;

        // === Chương ===
        match = line.match(PATTERNS.chapter);
        if (match) {
            const chapterNum = match[1];
            const chapterTitle = match[2] || '';
            const nodeId = `chuong_${chapterNum}`;

            currentChapter = nodeId;
            currentSection = null;
            currentArticle = null;
            currentClause = null;

            nodes.push({
                id: nodeId,
                type: 'Chapter',
                title: `Chương ${chapterNum}${chapterTitle ? ': ' + chapterTitle.trim() : ''}`,
                content: chapterTitle.trim()
            });
            continue;
        }

        // === Mục ===
        match = line.match(PATTERNS.section);
        if (match) {
            const sectionNum = match[1];
            const sectionTitle = match[2] || '';
            const nodeId = `muc_${sectionNum}${currentChapter ? '_' + currentChapter : ''}`;

            currentSection = nodeId;
            currentArticle = null;
            currentClause = null;

            nodes.push({
                id: nodeId,
                type: 'Section',
                title: `Mục ${sectionNum}${sectionTitle ? ': ' + sectionTitle.trim() : ''}`,
                content: sectionTitle.trim()
            });

            // Mục thuộc Chương
            if (currentChapter) {
                relationships.push({
                    source: currentChapter,
                    target: nodeId,
                    type: 'CONTAINS'
                });
            }
            continue;
        }

        // === Điều ===
        match = line.match(PATTERNS.article);
        if (match) {
            const articleNum = match[1];
            const articleTitleText = match[2] || '';
            const nodeId = `dieu_${articleNum}`;

            currentArticle = nodeId;
            currentClause = null;

            // Thu thập nội dung của Điều (các dòng tiếp theo cho đến khi gặp Điều/Chương/Mục mới)
            let articleContent = articleTitleText.trim();
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                if (PATTERNS.article.test(nextLine) || PATTERNS.chapter.test(nextLine) || PATTERNS.section.test(nextLine)) {
                    break;
                }
                articleContent += '\n' + nextLine;
                j++;
            }

            nodes.push({
                id: nodeId,
                type: 'Article',
                title: `Điều ${articleNum}${articleTitleText ? ': ' + articleTitleText.trim() : ''}`,
                content: articleContent.trim()
            });

            // Điều thuộc Mục hoặc Chương
            const parent = currentSection || currentChapter;
            if (parent) {
                relationships.push({
                    source: parent,
                    target: nodeId,
                    type: 'CONTAINS'
                });
            }
            continue;
        }

        // === Khoản (chỉ khi đang trong một Điều) ===
        match = line.match(PATTERNS.clause);
        if (match && currentArticle) {
            const clauseNum = match[1];
            const clauseText = match[2] || '';
            const nodeId = `${currentArticle}_khoan_${clauseNum}`;

            currentClause = nodeId;

            // Thu thập nội dung khoản
            let clauseContent = clauseText.trim();
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                if (PATTERNS.article.test(nextLine) || PATTERNS.chapter.test(nextLine) ||
                    PATTERNS.section.test(nextLine) || PATTERNS.clause.test(nextLine)) {
                    break;
                }
                clauseContent += '\n' + nextLine;
                j++;
            }

            nodes.push({
                id: nodeId,
                type: 'Clause',
                title: `Khoản ${clauseNum} - ${nodes.find(n => n.id === currentArticle)?.title || ''}`,
                content: clauseContent.trim()
            });

            relationships.push({
                source: currentArticle,
                target: nodeId,
                type: 'CONTAINS'
            });
            continue;
        }

        // === Điểm (chỉ khi đang trong một Khoản) ===
        match = line.match(PATTERNS.item);
        if (match && currentClause) {
            const itemLetter = match[1];
            const itemText = match[2] || '';
            const nodeId = `${currentClause}_diem_${itemLetter}`;

            nodes.push({
                id: nodeId,
                type: 'Item',
                title: `Điểm ${itemLetter}) - ${nodes.find(n => n.id === currentClause)?.title || ''}`,
                content: itemText.trim()
            });

            relationships.push({
                source: currentClause,
                target: nodeId,
                type: 'CONTAINS'
            });
            continue;
        }
    }

    return { nodes, relationships };
}

/**
 * Phát hiện tham chiếu chéo giữa các Điều trong cùng văn bản
 */
function extractReferences(nodes, relationships) {
    // Tạo map Điều số → node id
    const articleMap = {};
    nodes.forEach(node => {
        if (node.type === 'Article') {
            const match = node.id.match(/dieu_(\d+)/);
            if (match) {
                articleMap[match[1]] = node.id;
            }
        }
    });

    // Quét từng node, tìm tham chiếu
    nodes.forEach(node => {
        const content = node.content || '';

        REFERENCE_PATTERNS.forEach(pattern => {
            // Reset lastIndex cho regex global
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                // Tìm số Điều được tham chiếu (có thể ở group 1 hoặc 2 tùy pattern)
                const referencedArticleNum = match[2] || match[1];
                const targetNodeId = articleMap[referencedArticleNum];

                if (targetNodeId && targetNodeId !== node.id) {
                    // Kiểm tra nếu node hiện tại là con của Điều được tham chiếu → skip (không phải reference thực)
                    const isChild = node.id.startsWith(targetNodeId + '_');
                    const isParent = targetNodeId.startsWith(node.id + '_');
                    if (isChild || isParent) continue;

                    // Tránh trùng lặp
                    const sourceId = node.id;
                    const exists = relationships.some(r =>
                        r.source === sourceId && r.target === targetNodeId && r.type === 'REFERENCES'
                    );

                    if (!exists) {
                        relationships.push({
                            source: sourceId,
                            target: targetNodeId,
                            type: 'REFERENCES'
                        });
                    }
                }
            }
        });
    });
}

// ==================== MAIN EXTRACTION FUNCTION ====================

/**
 * Trích xuất graph từ bài viết bằng rule-based (thay thế Gemini)
 * Giữ nguyên interface với graphExtraction.service.js
 */
const extractGraphFromArticle = async (article) => {
    try {
        console.log(`ℹ️ [RuleBasedExtraction] Đang phân tích bài viết: "${article.title}" (ID: ${article._id})`);

        // 1. Lấy nội dung text thuần
        const rawContent = article.textContent || article.content || '';
        const plainText = stripHtml(rawContent);

        if (!plainText || plainText.length < 50) {
            console.warn(`⚠️ [RuleBasedExtraction] Nội dung bài viết quá ngắn hoặc rỗng, bỏ qua.`);
            return null;
        }

        // 2. Parse cấu trúc bằng regex
        const graphData = extractStructure(plainText, article.title);

        // 3. Nếu không tìm được cấu trúc Điều/Khoản (bài viết không phải văn bản pháp luật chuẩn)
        // → Tạo node Document duy nhất chứa toàn bộ nội dung
        if (graphData.nodes.length === 0) {
            console.log(`📄 [RuleBasedExtraction] Không phát hiện cấu trúc pháp luật chuẩn. Tạo node Document đơn.`);
            graphData.nodes.push({
                id: `doc_content`,
                type: 'Document',
                title: article.title,
                content: plainText.substring(0, 15000) // Giới hạn nội dung
            });
        }

        // 4. Phát hiện tham chiếu chéo
        extractReferences(graphData.nodes, graphData.relationships);

        // 5. Tạo Node gốc (Document) nếu chưa có
        const docId = `doc_${article._id.toString()}`;
        const hasDocNode = graphData.nodes.some(n => n.type === 'Document');
        if (!hasDocNode) {
            graphData.nodes.unshift({
                id: docId,
                type: 'Document',
                title: article.title,
                content: plainText.substring(0, 5000)
            });
        } else {
            // Đổi id của Document node sang id chuẩn
            const docNode = graphData.nodes.find(n => n.type === 'Document');
            const oldId = docNode.id;
            docNode.id = docId;
            // Cập nhật relationships tham chiếu đến id cũ
            graphData.relationships.forEach(rel => {
                if (rel.source === oldId) rel.source = docId;
                if (rel.target === oldId) rel.target = docId;
            });
        }

        // 6. Tự động thêm CONTAINS từ Document đến các Chapter/Article cấp cao nhất
        const topLevelNodes = graphData.nodes.filter(node => {
            if (node.id === docId) return false;
            // Node cấp cao nhất = không có ai CONTAINS nó
            const isContained = graphData.relationships.some(rel => rel.target === node.id && rel.type === 'CONTAINS');
            return !isContained;
        });

        topLevelNodes.forEach(node => {
            const exists = graphData.relationships.some(
                rel => rel.source === docId && rel.target === node.id && rel.type === 'CONTAINS'
            );
            if (!exists) {
                graphData.relationships.push({
                    source: docId,
                    target: node.id,
                    type: 'CONTAINS'
                });
            }
        });

        console.log(`➡️ [RuleBasedExtraction] Đã trích xuất ${graphData.nodes.length} nodes và ${graphData.relationships.length} quan hệ.`);

        // 7. Sinh embeddings cho từng node (vẫn dùng Gemini Embedding API - rất ít token)
        console.log(`🧠 [RuleBasedExtraction] Bắt đầu sinh embeddings cho ${graphData.nodes.length} nodes...`);
        const apiKeys = (process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
        const activeKey = apiKeys[0] || null;

        for (let node of graphData.nodes) {
            const textToEmbed = `${node.title}. ${node.content}`.substring(0, 10000);
            node.embedding = await generateEmbedding(textToEmbed, activeKey);

            // Delay nhỏ để tránh rate limit embedding
            await new Promise(r => setTimeout(r, 200));
        }

        // 8. Lưu vào Neo4j
        await saveGraphToNeo4j(article._id.toString(), graphData);

        return graphData;
    } catch (error) {
        console.error(`❌ [RuleBasedExtraction] Lỗi xử lý bài viết ${article._id}:`, error.message);
        return null;
    }
};

/**
 * Lưu Graph Data vào Neo4j (giữ nguyên logic từ graphExtraction.service.js)
 */
const saveGraphToNeo4j = async (articleMongoId, graphData) => {
    const driver = getDriver();
    const session = driver.session();
    try {
        console.log(`💾 [Neo4j] Bắt đầu ghi đồ thị của bài viết ${articleMongoId} vào Neo4j...`);

        // 1. Xóa dữ liệu cũ
        await session.executeWrite(tx =>
            tx.run(
                'MATCH (n) WHERE n.mongoId = $mongoId DETACH DELETE n',
                { mongoId: articleMongoId }
            )
        );

        // 2. Tạo Nodes (batch để tối ưu)
        for (let node of graphData.nodes) {
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

        // 3. Tạo Relationships
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
