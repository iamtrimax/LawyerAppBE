const legalFormServices = require("../services/legalForm.services");
const userModel = require("../model/user.model");

const getFormsController = async (req, res) => {
    try {
        const { category, page, limit, search } = req.query;
        const result = await legalFormServices.getForms({
            category,
            search,
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 10
        });

        const baseUrl = `${req.protocol}://${req.get('host')}/api/legal-forms/view/`;
        result.data = result.data.map(form => ({
            ...form,
            fileUrl: form.fileUrl && form.fileUrl.startsWith('http') ? `${baseUrl}${form._id}.png` : form.fileUrl
        }));

        res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error("getFormsController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getFormDetailController = async (req, res) => {
    try {
        const { id } = req.params;
        const form = await legalFormServices.getFormDetail(id);
        if (!form) return res.status(404).json({ success: false, message: "Không tìm thấy văn bản" });

        const baseUrl = `${req.protocol}://${req.get('host')}/api/legal-forms/view/`;
        if (form.fileUrl && form.fileUrl.startsWith('http')) {
            form.fileUrl = `${baseUrl}${form._id}.png`;
        }

        res.status(200).json({ success: true, data: form });
    } catch (error) {
        console.error("getFormDetailController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Tìm kiếm văn bản mẫu
 */
const searchFormsController = async (req, res) => {
    try {
        const { q } = req.query;
        let forms = await legalFormServices.searchForms(q);

        const baseUrl = `${req.protocol}://${req.get('host')}/api/legal-forms/view/`;
        forms = forms.map(form => ({
            ...form,
            fileUrl: form.fileUrl && form.fileUrl.startsWith('http') ? `${baseUrl}${form._id}.png` : form.fileUrl
        }));

        res.status(200).json({ success: true, data: forms });
    } catch (error) {
        console.error("searchFormsController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const trackDownloadController = async (req, res) => {
    try {
        const { id } = req.params;

        // Access control: Only members, lawyers, or admins can download
        const user = await userModel.findById(req.userId);
        if (!user || !['member', 'lawyer', 'admin'].includes(user.role)) {
            return res.status(403).json({
                success: false,
                message: "Quyền tải tài liệu chỉ dành cho Thành viên chính thức. Vui lòng nâng cấp tài khoản."
            });
        }

        const form = await legalFormServices.incrementDownload(id);
        res.status(200).json({ success: true, data: form });
    } catch (error) {
        console.error("trackDownloadController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const createFormController = async (req, res) => {
    try {
        const form = await legalFormServices.createForm(req.body);
        res.status(201).json({ success: true, data: form });
    } catch (error) {
        console.error("createFormController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateFormController = async (req, res) => {
    try {
        const form = await legalFormServices.updateForm(req.params.id, req.body);
        res.status(200).json({ success: true, data: form });
    } catch (error) {
        console.error("updateFormController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteFormController = async (req, res) => {
    try {
        await legalFormServices.deleteForm(req.params.id);
        res.status(200).json({ success: true, message: "Xóa văn bản thành công" });
    } catch (error) {
        console.error("deleteFormController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Lawyer: Đăng biểu mẫu mới
 */
const createLawyerFormController = async (req, res) => {
    try {
        const data = { ...req.body, lawyerID: req.lawyer._id };
        const form = await legalFormServices.createForm(data);
        res.status(201).json({ success: true, data: form });
    } catch (error) {
        console.error("createLawyerFormController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Lawyer: Lấy danh sách biểu mẫu của tôi
 */
const getMyFormsController = async (req, res) => {
    try {
        const forms = await legalFormServices.getLawyerForms(req.lawyer._id);
        res.status(200).json({ success: true, data: forms });
    } catch (error) {
        console.error("getMyFormsController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Lawyer: Cập nhật biểu mẫu của tôi
 */
const updateMyFormController = async (req, res) => {
    try {
        const form = await legalFormServices.updateLawyerForm(req.params.id, req.body, req.lawyer._id);
        res.status(200).json({ success: true, data: form });
    } catch (error) {
        console.error("updateMyFormController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Lawyer: Xóa biểu mẫu của tôi
 */
const deleteMyFormController = async (req, res) => {
    try {
        await legalFormServices.deleteLawyerForm(req.params.id, req.lawyer._id);
        res.status(200).json({ success: true, message: "Xóa biểu mẫu thành công" });
    } catch (error) {
        console.error("deleteMyFormController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const axios = require('axios');

/**
 * Proxy để xem file từ maudon.vn (vượt hotlinking protection)
 */
const viewFileController = async (req, res) => {
    try {
        const { id } = req.params;
        const form = await legalFormServices.getFormDetail(id);

        if (!form || !form.fileUrl) {
            return res.status(404).json({ success: false, message: "Không tìm thấy file" });
        }

        // Nếu là link nội bộ (do người dùng upload) thì redirect hoặc phục vụ trực tiếp
        if (!form.fileUrl.startsWith('http')) {
            return res.redirect(form.fileUrl);
        }

        const response = await axios.get(form.fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://www.maudon.vn/'
            },
            responseType: 'stream',
            timeout: 10000
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
        response.data.pipe(res);
    } catch (error) {
        console.error("viewFileController error:", error.message);
        res.status(500).json({ success: false, message: "Không thể tải file: " + error.message });
    }
};

module.exports = {
    getFormsController,
    getFormDetailController,
    trackDownloadController,
    createFormController,
    updateFormController,
    deleteFormController,
    createLawyerFormController,
    getMyFormsController,
    updateMyFormController,
    deleteMyFormController,
    searchFormsController,
    viewFileController
};
