const { generateFormContent, buildDocxFromContent, COMMON_FORM_TYPES, getAiGenerationHistory } = require('../services/legalAiChat.service');

/**
 * GET /legal/ai-chat/form-types
 * Trả về danh sách mẫu đơn phổ biến có sẵn
 */
const getFormTypesController = async (req, res) => {
    res.status(200).json({ success: true, data: COMMON_FORM_TYPES });
};

/**
 * POST /legal/ai-chat
 * Nhận prompt của người dùng → AI tạo nội dung → trả về JSON xem trước + link tải DOCX
 *
 * Body: { prompt: "Tôi cần mẫu đơn xin ly hôn" }
 */
const legalAiChatController = async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || prompt.trim().length < 5) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng mô tả loại mẫu đơn bạn cần tạo (ít nhất 5 ký tự)'
            });
        }

        // Yêu cầu AI sinh nội dung mẫu đơn (userID là null nếu không có xác thực)
        const userID = req.user ? req.user._id : null;
        const formData = await generateFormContent(prompt.trim(), userID);
        console.log("prompt: ", prompt);
        // Trả về nội dung dạng JSON để phía client xem preview
        res.status(200).json({
            success: true,
            message: 'Mẫu đơn đã được tạo thành công và lưu vào lịch sử.',
            data: {
                title: formData.title,
                formType: formData.formType,
                notes: formData.notes,
                sections: formData.sections,
                downloadHint: 'Gọi POST /legal/ai-chat/download với cùng prompt để tải file DOCX'
            }
        });
    } catch (error) {
        console.error('legalAiChatController error:', error.message);

        // Lỗi JSON parse từ AI
        if (error instanceof SyntaxError) {
            return res.status(502).json({
                success: false,
                message: 'AI trả về dữ liệu không hợp lệ. Vui lòng thử lại với mô tả cụ thể hơn.'
            });
        }

        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * POST /legal/ai-chat/download
 * Nhận prompt của người dùng → AI tạo nội dung → gửi file DOCX trực tiếp để download
 *
 * Body: { prompt: "Tôi cần mẫu đơn xin ly hôn" }
 */
const downloadLegalFormController = async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || prompt.trim().length < 5) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng mô tả loại mẫu đơn bạn cần tạo (ít nhất 5 ký tự)'
            });
        }

        // Sinh nội dung từ AI (không lưu lại lịch sử trùng lặp nếu vừa bấm preview)
        const formData = await generateFormContent(prompt.trim());

        // Tạo file DOCX
        const docxBuffer = await buildDocxFromContent(formData);

        // Tạo tên file an toàn
        const safeTitle = (formData.title || 'mau-don-phap-ly')
            .toLowerCase()
            .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\s-]/gi, '')
            .replace(/\s+/g, '-')
            .substring(0, 60);

        const filename = `${safeTitle}-${Date.now()}.docx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Length', docxBuffer.length);
        res.status(200).send(docxBuffer);

    } catch (error) {
        console.error('downloadLegalFormController error:', error.message);

        if (error instanceof SyntaxError) {
            return res.status(502).json({
                success: false,
                message: 'AI trả về dữ liệu không hợp lệ. Vui lòng thử lại với mô tả cụ thể hơn.'
            });
        }

        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /legal/ai-chat/history
 * Lấy danh sách các mẫu đơn AI đã sinh của người dùng
 */
const getAiHistoryController = async (req, res) => {
    try {
        const history = await getAiGenerationHistory(req.user._id);
        res.status(200).json({ success: true, data: history });
    } catch (error) {
        console.error('getAiHistoryController error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getFormTypesController,
    legalAiChatController,
    downloadLegalFormController,
    getAiHistoryController
};
