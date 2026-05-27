const Article = require('../model/article.model');
const { extractGraphFromArticle } = require('../services/graphExtraction.service');
const { graphSearch } = require('../services/graphSearch.service');
const { getDriver } = require('../config/neo4j');

/**
 * Trích xuất đồ thị cho tất cả bài viết/văn bản pháp luật hiện có trong MongoDB
 */
const buildGraphForAllArticles = async (req, res) => {
    try {
        console.log("🚀 [GraphController] Bắt đầu xây dựng đồ thị cho tất cả bài viết...");
        // Không chặn request, chạy background
        res.status(202).json({
            success: true,
            message: "Tiến trình xây dựng đồ thị toàn bộ bài viết đã bắt đầu trong background."
        });

        // Tìm tất cả các bài viết hợp lệ
        const articles = await Article.find({ status: 'Published' });
        console.log(`📊 [GraphController] Tìm thấy ${articles.length} bài viết cần xử lý.`);

        let successCount = 0;
        let failCount = 0;

        for (let article of articles) {
            try {
                const result = await extractGraphFromArticle(article);
                if (result) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (err) {
                console.error(`❌ [GraphController] Lỗi xử lý bài viết ${article._id}:`, err.message);
                failCount++;
            }
            // Tránh rate limit của Gemini API
            await new Promise(r => setTimeout(r, 1000));
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

        const graphData = await extractGraphFromArticle(article);
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
