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
 * Kiểm tra quyền truy cập hội thoại: phải là participant,
 * hoặc là luật sư/admin đối với hội thoại broadcast (câu hỏi chung)
 */
const assertCanAccessConversation = async (conversationID, userID, role) => {
    const conversation = await chatConversationModel.findById(conversationID);
    if (!conversation) {
        const error = new Error("Hội thoại không tồn tại");
        error.statusCode = 404;
        throw error;
    }

    const isParticipant = Array.isArray(conversation.participants) &&
        conversation.participants.some(p => p && p.toString() === userID.toString());

    const isAllowedBroadcast = conversation.isBroadcast &&
        (role === 'lawyer' || role === 'admin');

    if (!isParticipant && !isAllowedBroadcast) {
        const error = new Error("Bạn không có quyền truy cập hội thoại này");
        error.statusCode = 403;
        throw error;
    }

    return conversation;
};

/**
 * Lưu tin nhắn và cập nhật tin nhắn cuối cùng của hội thoại
 */
const saveMessage = async ({ conversationID, senderID, text, attachments, senderRole }) => {
    // Chặn IDOR: người gửi phải là participant (hoặc luật sư/admin với broadcast)
    await assertCanAccessConversation(conversationID, senderID, senderRole);

    // Ép kiểu chuỗi để tránh lưu object/NoSQL injection vào DB
    const safeText = typeof text === 'string' ? text.slice(0, 5000) : '';

    const message = await chatMessageModel.create({
        conversationID,
        senderID,
        text: safeText,
        attachments: Array.isArray(attachments) ? attachments : []
    });

    // Cập nhật lastMessage và thêm senderID vào participants nếu chưa có
    await chatConversationModel.findByIdAndUpdate(conversationID, {
        $set: {
            lastMessage: {
                text: safeText,
                senderID,
                createdAt: message.createdAt
            }
        },
        $addToSet: {
            participants: senderID
        }
    });

    return message;
};

/**
 * Lấy danh sách câu hỏi chung (broadcast)
 */
const getBroadcastConversations = async () => {
    return await chatConversationModel.find({ isBroadcast: true })
        .populate('participants', 'fullname avatar role')
        .populate('lastMessage.senderID', 'fullname avatar role expoPushToken')
        .sort({ updatedAt: -1 })
        .lean();
};

/**
 * Xử lý tạo tin nhắn chung (broadcast chat)
 */
const createBroadcastConversation = async (userID) => {
    return await chatConversationModel.create({
        participants: [userID],
        isBroadcast: true
    });
};

/**
 * Lấy danh sách hội thoại của người dùng
 */
const getConversationList = async (userID) => {
    return await chatConversationModel.find({
        participants: userID
    })
        .populate('participants', 'fullname avatar role')
        .populate('lastMessage.senderID', 'fullname avatar role expoPushToken')
        .sort({ updatedAt: -1 })
        .lean();
};

/**
 * Lấy lịch sử tin nhắn (chỉ participant hoặc luật sư/admin với broadcast)
 */
const getMessageHistory = async (conversationID, userID, role, page = 1, limit = 20) => {
    // Chặn IDOR: chỉ participant mới đọc được tin nhắn của hội thoại
    await assertCanAccessConversation(conversationID, userID, role);

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
    markAsRead,
    getBroadcastConversations,
    createBroadcastConversation
};
