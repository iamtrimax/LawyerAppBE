const mongoose = require('mongoose');
const chatServices = require('../services/chat.services');

const startChatController = async (req, res) => {
    try {
        const { targetID } = req.body; // userID của người muốn chat cùng
        if (!mongoose.Types.ObjectId.isValid(targetID)) {
            return res.status(400).json({ success: false, message: "ID đối tượng không hợp lệ" });
        }
        const conversation = await chatServices.getOrCreateConversation(req.user._id, targetID);
        res.status(200).json({ success: true, data: conversation });
    } catch (error) {
        console.error("startChatController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getConversationsController = async (req, res) => {
    try {
        const conversations = await chatServices.getConversationList(req.user._id);
        res.status(200).json({ success: true, data: conversations });
    } catch (error) {
        console.error("getConversationsController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMessagesController = async (req, res) => {
    try {
        const { conversationID } = req.params;

        if (!mongoose.Types.ObjectId.isValid(conversationID)) {
            return res.status(400).json({ success: false, message: "Mã hội thoại (conversationID) không hợp lệ" });
        }

        const { page, limit } = req.query;
        const history = await chatServices.getMessageHistory(
            conversationID,
            parseInt(page) || 1,
            parseInt(limit) || 20
        );

        // Đánh dấu đã đọc khi mở hội thoại
        await chatServices.markAsRead(conversationID, req.user._id);

        res.status(200).json({ success: true, ...history });
    } catch (error) {
        console.error("getMessagesController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const sendMessageController = async (req, res) => {
    try {
        const { conversationID, text, attachments } = req.body;
        const senderID = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(conversationID)) {
            return res.status(400).json({ success: false, message: "Mã hội thoại không hợp lệ" });
        }

        const message = await chatServices.saveMessage({
            conversationID,
            senderID,
            text,
            attachments
        });

        // Gửi qua socket nếu client đang online
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            io.to(conversationID).emit("receive_message", message);
        } catch (socketError) {
            // Socket chưa khởi tạo hoặc lỗi, vẫn trả về thành công vì đã lưu DB
            console.warn("Socket notification failed:", socketError.message);
        }

        res.status(201).json({ success: true, data: message });
    } catch (error) {
        console.error("sendMessageController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    startChatController,
    getConversationsController,
    getMessagesController,
    sendMessageController
};
