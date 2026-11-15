const { aiSearch } = require('../services/aiSearch.service');
const articleServices = require('../services/article.services');
const sanitizeError = require('../utils/sanitizeError');

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
        res.status(400).json({ success: false, message: sanitizeError(error) });
    }
};

const getArticlesController = async (req, res) => {
    try {
        const { category, tag, page, limit, search } = req.query;
        const result = await articleServices.getArticles({ category, tag, page, limit, search });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.log("getArticlesController error: ", error);
        res.status(400).json({ success: false, message: sanitizeError(error) });
    }
};

const getArticleDetailController = async (req, res) => {
    try {
        const article = await articleServices.getArticleDetail(req.params.id);
        res.status(200).json({ success: true, data: article });
    } catch (error) {
        console.log("getArticleDetailController error: ", error);
        res.status(404).json({ success: false, message: sanitizeError(error) });
    }
};

const getArticleBySlugController = async (req, res) => {
    try {
        const article = await articleServices.getArticleBySlug(req.params.slug);
        res.status(200).json({ success: true, data: article });
    } catch (error) {
        console.log("getArticleBySlugController error: ", error);
        res.status(404).json({ success: false, message: sanitizeError(error) });
    }
};

const getArticleByLawyerController = async (req, res) => {
    try {
        const articles = await articleServices.getArticleByLawyer(req.lawyer._id);
        res.status(200).json({ success: true, data: articles });
    } catch (error) {
        console.log("getArticleByLawyerController error: ", error);
        res.status(400).json({ success: false, message: sanitizeError(error) });
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
        res.status(400).json({ success: false, message: sanitizeError(error) });
    }
};

const deleteArticleController = async (req, res) => {
    try {
        const result = await articleServices.deleteArticle(req.lawyer._id, req.params.id);
        res.status(200).json({ success: true, message: result.message });
    } catch (error) {
        console.log("deleteArticleController error: ", error);
        res.status(400).json({ success: false, message: sanitizeError(error) });
    }
};

const aiSearchController = async (req, res) => {
    const startedAt = Date.now();
    try {
        const { query, history = [] } = req.method === 'POST' ? req.body : req.query;
        if (!query) {
            return res.status(400).json({ success: false, message: "Vui lòng nhập câu hỏi" });
        }
        console.log(`[AI Chat HTTP] Bắt đầu xử lý câu hỏi (${String(query).length} ký tự).`);
        const result = await aiSearch(query, Array.isArray(history) ? history : []);
        console.log(`[AI Chat HTTP] Hoàn tất trong ${Date.now() - startedAt} ms; ${result.sources.length} nguồn.`);
        // Check if we hit quota (custom message from service)
        if (result.answer.includes("quá tải") || result.answer.includes("giới hạn")) {
            return res.status(429).json({ success: false, data: result });
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error(`[AI Chat HTTP] Lỗi sau ${Date.now() - startedAt} ms:`, error.message);
        res.status(500).json({ success: false, message: sanitizeError(error) });
    }
};

const aiSearchStreamController = async (req, res) => {
    const startedAt = Date.now();
    const { query, history = [] } = req.body || {};
    if (!query) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập câu hỏi' });
    }

    res.status(200);
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    const abortController = new AbortController();
    const handleClientDisconnect = () => {
        if (!res.writableEnded) abortController.abort();
    };
    res.on('close', handleClientDisconnect);
    const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(': keep-alive\n\n');
    }, 15000);

    const sendEvent = (event, data) => {
        if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    console.log(`[AI Chat HTTP] Bắt đầu stream câu hỏi (${String(query).length} ký tự).`);
    try {
        sendEvent('status', { message: 'Đang chuẩn bị tìm tài liệu...' });
        const result = await aiSearch(query, Array.isArray(history) ? history : [], {
            signal: abortController.signal,
            onStatus: (message) => sendEvent('status', { message }),
            onToken: (token) => sendEvent('token', { token })
        });
        sendEvent('sources', { sources: result.sources });
        sendEvent('done', { elapsedMs: Date.now() - startedAt });
        console.log(`[AI Chat HTTP] Stream hoàn tất trong ${Date.now() - startedAt} ms; ${result.sources.length} nguồn.`);
    } catch (error) {
        console.error(`[AI Chat HTTP] Stream lỗi sau ${Date.now() - startedAt} ms:`, error.message);
        sendEvent('error', { message: sanitizeError(error) });
    } finally {
        clearInterval(heartbeat);
        res.off('close', handleClientDisconnect);
        if (!res.destroyed) res.end();
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
        res.status(500).json({ success: false, message: sanitizeError(error) });
    }
};

module.exports = {
    createArticleController,
    getArticlesController,
    getArticleDetailController,
    getArticleBySlugController,
    getArticleByLawyerController,
    updateArticleController,
    deleteArticleController,
    aiSearchController,
    aiSearchStreamController,
    trackArticleDownloadController
};
