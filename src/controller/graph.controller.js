const Article = require('../model/article.model');
const { extractGraphFromBatch } = require('../services/graphExtraction.service');
const { graphSearch } = require('../services/graphSearch.service');
const { getDriver } = require('../config/neo4j');

const buildGraphForAllArticles = async (req, res) => {
    try {
        console.log("🚀 [GraphController] Bắt đầu xây dựng đồ thị cho tất cả bài viết...");
        // Không chặn request, chạy background
        res.status(202).json({
            success: true,
            message: "Tiến trình xây dựng đồ thị toàn bộ bài viết đã bắt đầu trong background."
        });

        // Đếm tổng số bài viết trước
        const totalArticles = await Article.countDocuments({ status: 'Published' });
        console.log(`📊 [GraphController] Tìm thấy tổng cộng ${totalArticles} bài viết cần xử lý.`);

        // Sử dụng cursor để stream dữ liệu từ MongoDB
        const cursor = Article.find({ status: 'Published' })
            .select('title content textContent status')
            .cursor();

        let successCount = 0;
        let failCount = 0;
        let processedCount = 0;
        let batch = [];
        const BATCH_SIZE = 10; // Cấu hình kích thước an toàn cho JSON output của Gemini

        for (let article = await cursor.next(); article != null; article = await cursor.next()) {
            batch.push(article);
            processedCount++;

            // Khi gom đủ BATCH_SIZE hoặc là bài cuối cùng
            if (batch.length >= BATCH_SIZE || processedCount === totalArticles) {
                console.log(`⏳ [GraphController] Processing Batch [${processedCount - batch.length + 1} - ${processedCount}]/${totalArticles}`);
                
                try {
                    const result = await extractGraphFromBatch(batch);
                    if (result) {
                        successCount += batch.length;
                    } else {
                        failCount += batch.length;
                    }
                } catch (err) {
                    console.error(`❌ [GraphController] Lỗi xử lý batch:`, err.message);
                    failCount += batch.length;
                }

                // Giải phóng tham chiếu bộ nhớ
                batch = [];

                // Delay nhỏ giữa các batch để tránh rate limit của Gemini API
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log(`🏁 [GraphController] Tiến trình hoàn tất. Thành công: ${successCount}, Thất bại: ${failCount}`);
    } catch (error) {
        console.error("❌ [GraphController] Lỗi xây dựng đồ thị tổng thể:", error.message);
    }
};

/**
 * Xây dựng đồ thị cho một bài viết đơn lẻ
 */
const buildGraphForArticle = async (req, res) => {
    try {
        const { articleId } = req.params;
        const article = await Article.findById(articleId);
        if (!article) {
            return res.status(404).json({ success: false, message: "Không tìm thấy bài viết" });
        }

        const graphData = await extractGraphFromBatch([article]);
        if (!graphData) {
            return res.status(500).json({ success: false, message: "Trích xuất đồ thị thất bại" });
        }

        res.status(200).json({
            success: true,
            message: "Đã xây dựng đồ thị thành công cho bài viết.",
            nodesCount: graphData.nodes.length,
            relationshipsCount: graphData.relationships?.length || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Thử nghiệm truy vấn GraphRAG trực tiếp
 */
const testQueryGraph = async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ success: false, message: "Vui lòng nhập câu truy vấn (query)" });
        }

        const results = await graphSearch(query);
        res.status(200).json({
            success: true,
            resultsCount: results.length,
            results: results.map(r => ({
                title: r.title,
                similarity: r.similarity,
                mongoId: r.mongoId,
                fullContext: r.fullContext
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Xóa sạch toàn bộ dữ liệu trong Neo4j (Dùng cho Admin khi cần reset)
 */
const clearAllGraphData = async (req, res) => {
    const driver = getDriver();
    const session = driver.session();
    try {
        await session.executeWrite(tx => tx.run('MATCH (n) DETACH DELETE n'));
        res.status(200).json({ success: true, message: "Đã xóa toàn bộ dữ liệu đồ thị trong Neo4j." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    } finally {
        await session.close();
    }
};

module.exports = {
    buildGraphForAllArticles,
    buildGraphForArticle,
    testQueryGraph,
    clearAllGraphData
};
