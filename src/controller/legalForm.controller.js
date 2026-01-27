const legalFormServices = require("../services/legalForm.services");

const getFormsController = async (req, res) => {
    try {
        const { category, page, limit } = req.query;
        const result = await legalFormServices.getForms({
            category,
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 10
        });
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
        const forms = await legalFormServices.searchForms(q);
        res.status(200).json({ success: true, data: forms });
    } catch (error) {
        console.error("searchFormsController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const trackDownloadController = async (req, res) => {
    try {
        const { id } = req.params;
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
    searchFormsController
};
