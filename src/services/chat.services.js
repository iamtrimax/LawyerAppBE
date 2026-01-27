const chatConversationModel = require('../model/chatConversation.model');
const chatMessageModel = require('../model/chatMessage.model');

/**
 * Lấy hoặc tạo cuộc hội thoại giữa 2 người
 */
const getOrCreateConversation = async (participant1, participant2) => {
    let conversation = await chatConversationModel.findOne({
        participants: { $all: [participant1, participant2] }
    });

    if (!conversation) {
        conversation = await chatConversationModel.create({
            participants: [participant1, participant2]
        });
    }

    return conversation;
};

/**
 * Lưu tin nhắn và cập nhật tin nhắn cuối cùng của hội thoại
 */
const saveMessage = async ({ conversationID, senderID, text, attachments }) => {
    const message = await chatMessageModel.create({
        conversationID,
        senderID,
        text,
        attachments: attachments || []
    });

    // Cập nhật lastMessage trong conversation
    await chatConversationModel.findByIdAndUpdate(conversationID, {
        lastMessage: {
            text,
            senderID,
            createdAt: message.createdAt
        }
    });

    return message;
};

/**
 * Lấy danh sách hội thoại của người dùng
 */
const getConversationList = async (userID) => {
    return await chatConversationModel.find({
        participants: userID
    })
        .populate('participants', 'fullname avatar role')
        .sort({ updatedAt: -1 })
        .lean();
};

/**
 * Lấy lịch sử tin nhắn
 */
const getMessageHistory = async (conversationID, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    const messages = await chatMessageModel.find({ conversationID })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await chatMessageModel.countDocuments({ conversationID });

    return {
        messages: messages.reverse(),
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
};

/**
 * Đánh dấu đã đọc toàn bộ tin nhắn trong hội thoại
 */
const markAsRead = async (conversationID, userID) => {
    return await chatMessageModel.updateMany(
        { conversationID, senderID: { $ne: userID }, isRead: false },
        { $set: { isRead: true } }
    );
};

module.exports = {
    getOrCreateConversation,
    saveMessage,
    getConversationList,
    getMessageHistory,
    markAsRead
};
