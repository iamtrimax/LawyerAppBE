const { refreshRagIndex } = require('../services/aiSearch.service');
const sanitizeError = require('../utils/sanitizeError');

const reindexRagController = async (req, res) => {
    try {
        const result = await refreshRagIndex({ force: req.body?.force === true });
        return res.status(200).json({ success: true, message: 'Đã cập nhật chỉ mục RAG.', data: result });
    } catch (error) {
        return res.status(503).json({ success: false, message: sanitizeError(error) });
    }
};

module.exports = { reindexRagController };
