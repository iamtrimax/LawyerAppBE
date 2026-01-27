const legalResourceServices = require("../services/legalResource.services");

const getResourcesController = async (req, res) => {
    try {
        const { category, language, page, limit } = req.query;
        const result = await legalResourceServices.getResources({
            category,
            language,
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 10
        });
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        console.error("getResourcesController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getResourceDetailController = async (req, res) => {
    try {
        const { id } = req.params;
        const resource = await legalResourceServices.getResourceDetail(id);
        res.status(200).json({ success: true, data: resource });
    } catch (error) {
        console.error("getResourceDetailController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const searchResourcesController = async (req, res) => {
    try {
        const { q, language } = req.query;
        const resources = await legalResourceServices.searchResources(q, language);
        res.status(200).json({ success: true, data: resources });
    } catch (error) {
        console.error("searchResourcesController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const createResourceController = async (req, res) => {
    try {
        const resource = await legalResourceServices.createResource(req.body);
        res.status(201).json({ success: true, data: resource });
    } catch (error) {
        console.error("createResourceController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateResourceController = async (req, res) => {
    try {
        const resource = await legalResourceServices.updateResource(req.params.id, req.body);
        res.status(200).json({ success: true, data: resource });
    } catch (error) {
        console.error("updateResourceController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteResourceController = async (req, res) => {
    try {
        await legalResourceServices.deleteResource(req.params.id);
        res.status(200).json({ success: true, message: "Xóa tài liệu thành công" });
    } catch (error) {
        console.error("deleteResourceController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getResourcesController,
    getResourceDetailController,
    searchResourcesController,
    createResourceController,
    updateResourceController,
    deleteResourceController
};
