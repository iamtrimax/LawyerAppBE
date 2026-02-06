const { aiSearch } = require('../services/aiSearch.service');
const articleServices = require('../services/article.services');

const createArticleController = async (req, res) => {
    try {
        const article = await articleServices.createArticle({
            lawyerId: req.lawyer._id,
            ...req.body
        });
        res.status(201).json({
            success: true,
            message: "Tạo bài viết thành công",
            data: article
        });
    } catch (error) {
        console.log("createArticleController error: ", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

const getArticlesController = async (req, res) => {
    try {
        const { category, tag, page, limit, search } = req.query;
        const result = await articleServices.getArticles({ category, tag, page, limit, search });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.log("getArticlesController error: ", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

const getArticleDetailController = async (req, res) => {
    try {
        const article = await articleServices.getArticleDetail(req.params.id);
        res.status(200).json({ success: true, data: article });
    } catch (error) {
        console.log("getArticleDetailController error: ", error);
        res.status(404).json({ success: false, message: error.message });
    }
};

const getArticleByLawyerController = async (req, res) => {
    try {
        const articles = await articleServices.getArticleByLawyer(req.lawyer._id);
        res.status(200).json({ success: true, data: articles });
    } catch (error) {
        console.log("getArticleByLawyerController error: ", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

const updateArticleController = async (req, res) => {
    try {
        const article = await articleServices.updateArticle(req.lawyer._id, req.params.id, req.body);
        res.status(200).json({
            success: true,
            message: "Cập nhật bài viết thành công",
            data: article
        });
    } catch (error) {
        console.log("updateArticleController error: ", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

const deleteArticleController = async (req, res) => {
    try {
        const result = await articleServices.deleteArticle(req.lawyer._id, req.params.id);
        res.status(200).json({ success: true, message: result.message });
    } catch (error) {
        console.log("deleteArticleController error: ", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

const aiSearchController = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ success: false, message: "Vui lòng nhập câu hỏi" });
        }
        const result = await aiSearch(query);
        console.log("Result: ", result.answer, result.sources);
        // Check if we hit quota (custom message from service)
        if (result.answer.includes("quá tải") || result.answer.includes("giới hạn")) {
            return res.status(429).json({ success: false, data: result });
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.log("aiSearchController error: ", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const trackArticleDownloadController = async (req, res) => {
    try {
        const { id } = req.params;

        // Kiểm tra quyền: Chỉ cho phép member, lawyer, hoặc admin tải xuống
        const user = req.user;
        if (!user || !['member', 'lawyer', 'admin'].includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: "Quyền tải tài liệu chỉ dành cho Thành viên chính thức. Vui lòng nâng cấp tài khoản."
            });
        }

        const article = await articleServices.incrementArticleDownload(id);
        if (!article) {
            return res.status(404).json({ success: false, message: "Không tìm thấy bài viết" });
        }

        res.status(200).json({ success: true, data: article });
    } catch (error) {
        console.log("trackArticleDownloadController error: ", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createArticleController,
    getArticlesController,
    getArticleDetailController,
    getArticleByLawyerController,
    updateArticleController,
    deleteArticleController,
    aiSearchController,
    trackArticleDownloadController
};
