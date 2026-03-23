const mongoose = require('mongoose');
const chatServices = require('../services/chat.services');
const chatConversationModel = require('../model/chatConversation.model');
const userModel = require('../model/user.model');
const { sendPushNotification } = require('../services/notification.services');

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

const createBroadcastController = async (req, res) => {
    try {
        let { text, attachments } = req.body;
        const senderID = req.user._id;

        if (!text) {
            return res.status(400).json({ success: false, message: "Nội dung không được để trống" });
        }

        let parsedAttachments = [];
        if (Array.isArray(attachments)) {
            parsedAttachments = attachments;
        } else if (typeof attachments === 'string') {
            try {
                parsedAttachments = JSON.parse(attachments);
                if (!Array.isArray(parsedAttachments)) parsedAttachments = [];
            } catch (error) {
                parsedAttachments = [];
            }
        }

        // Tạo hội thoại chung (broadcast)
        const conversation = await chatServices.createBroadcastConversation(senderID);

        // Lưu câu hỏi vào tin nhắn
        const message = await chatServices.saveMessage({
            conversationID: conversation._id,
            senderID,
            text,
            attachments: parsedAttachments
        });

        // Thông báo đến tất cả luật sư (nếu có logic socket/notification)
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            // Phát cho những người nghe sự kiện broadcast
            io.emit("new_broadcast_question", {
                conversation,
                message
            });
        } catch (socketError) {
            console.warn("Socket broadcast notification failed:", socketError.message);
        }

        res.status(201).json({ success: true, data: { conversation, message } });
    } catch (error) {
        console.error("createBroadcastController error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getBroadcastsController = async (req, res) => {
    try {
        // Chỉ luật sư và admin mới được xem danh sách broadcast câu hỏi chung
        if (req.user.role !== 'lawyer' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Không có quyền truy cập" });
        }

        const broadcasts = await chatServices.getBroadcastConversations();
        res.status(200).json({ success: true, data: broadcasts });
    } catch (error) {
        console.error("getBroadcastsController error:", error);
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
        let { conversationID, text, attachments } = req.body;
        const senderID = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(conversationID)) {
            return res.status(400).json({ success: false, message: "Mã hội thoại không hợp lệ" });
        }

        let parsedAttachments = [];
        if (Array.isArray(attachments)) {
            parsedAttachments = attachments;
        } else if (typeof attachments === 'string') {
            try {
                parsedAttachments = JSON.parse(attachments);
                if (!Array.isArray(parsedAttachments)) parsedAttachments = [];
            } catch (error) {
                parsedAttachments = [];
            }
        }

        const message = await chatServices.saveMessage({
            conversationID,
            senderID,
            text,
            attachments: parsedAttachments
        });

        // Gửi qua socket và Push Notification
        try {
            const { getIO } = require('../config/socket');
            const io = getIO();
            io.to(conversationID).emit("receive_message", message);

            // Tìm conversation và user để gửi thông báo
            const sender = await userModel.findById(senderID);
            const conversation = await chatConversationModel.findById(conversationID).populate('participants');

            if (conversation && conversation.participants) {
                const senderName = sender ? sender.fullname : "Người dùng";
                const notifyText = text || "Bạn có một tin nhắn mới";

                conversation.participants.forEach(participant => {
                    const participantIDStr = participant._id.toString();
                    if (participantIDStr !== senderID.toString()) {
                        // Gửi socket event cập nhật conversation list
                        io.to(participantIDStr).emit("update_conversation_list", {
                            conversationID,
                            message,
                            senderName
                        });

                        // Gửi thông báo đẩy (nếu offline/chưa mở app)
                        if (participant.expoPushToken) {
                            sendPushNotification(
                                participant.expoPushToken,
                                `Tin nhắn mới từ ${senderName}`,
                                notifyText,
                                { type: 'chat', conversationID }
                            ).catch(err => console.error("Push error:", err));
                        }
                    }
                });
            }
        } catch (socketError) {
            console.warn("Socket/Push notification failed:", socketError.message);
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
    sendMessageController,
    createBroadcastController,
    getBroadcastsController
};
