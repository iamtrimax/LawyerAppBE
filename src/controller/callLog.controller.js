const callLogServices = require('../services/callLog.services');
const mongoose = require('mongoose');

/**
 * Lấy danh sách nhật ký cuộc gọi của người dùng hiện tại
 */
const getCallLogs = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const userId = req.user._id;

        const data = await callLogServices.getUserCallLogs(
            userId,
            parseInt(page) || 1,
            parseInt(limit) || 20
        );

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("getCallLogs error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Tạo thủ công một nhật ký cuộc gọi mới
 */
const createCallLog = async (req, res) => {
    try {
        const { receiverId, type, status, startTime } = req.body;
        const callerId = req.user._id;

        if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
            return res.status(400).json({ success: false, message: "ID người nhận không hợp lệ" });
        }

        const log = await callLogServices.createCallLog({
            callerId,
            receiverId,
            type,
            status,
            startTime
        });

        res.status(201).json({ success: true, data: log });
    } catch (error) {
        console.error("createCallLog error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Cập nhật thủ công trạng thái hoặc thời gian cuộc gọi theo ID cuộc gọi
 */
const updateCallLog = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, startTime, endTime, duration } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "ID cuộc gọi không hợp lệ" });
        }

        const log = await callLogServices.updateCallLog(id, {
            status,
            startTime,
            endTime,
            duration
        });

        if (!log) {
            return res.status(404).json({ success: false, message: "Không tìm thấy cuộc gọi" });
        }

        res.status(200).json({ success: true, data: log });
    } catch (error) {
        console.error("updateCallLog error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Xóa một bản ghi nhật ký cuộc gọi
 */
const deleteCallLog = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "ID cuộc gọi không hợp lệ" });
        }

        const result = await callLogServices.deleteCallLog(userId, id);
        if (!result) {
            return res.status(404).json({ success: false, message: "Không tìm thấy cuộc gọi hoặc bạn không có quyền xóa" });
        }

        res.status(200).json({ success: true, message: "Xóa nhật ký cuộc gọi thành công" });
    } catch (error) {
        console.error("deleteCallLog error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Xóa toàn bộ lịch sử cuộc gọi của người dùng hiện tại
 */
const clearCallLogs = async (req, res) => {
    try {
        const userId = req.user._id;
        await callLogServices.clearUserCallLogs(userId);

        res.status(200).json({ success: true, message: "Xóa toàn bộ nhật ký cuộc gọi thành công" });
    } catch (error) {
        console.error("clearCallLogs error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getCallLogs,
    createCallLog,
    updateCallLog,
    deleteCallLog,
    clearCallLogs
};
