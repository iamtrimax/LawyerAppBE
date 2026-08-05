const CallLog = require('../model/callLog.model');
const Lawyer = require('../model/lawyer.model');
const User = require('../model/user.model');

// Ép kiểu an toàn: chặn NoSQL injection khi client gửi object qua body/query
const toStr = (value) => (typeof value === 'string' ? value : '');

/**
 * Tạo mới một bản ghi cuộc gọi
 */
const createCallLog = async ({ callerId, receiverId, type, status, startTime }) => {
    const safeType = toStr(type) || 'audio';
    const safeStatus = toStr(status) || 'missed';
    const safeStartTime = startTime instanceof Date ? startTime : new Date(toStr(startTime) || Date.now());
    return await CallLog.create({
        callerId,
        receiverId,
        type: safeType,
        status: safeStatus,
        startTime: isNaN(safeStartTime.getTime()) ? new Date() : safeStartTime
    });
};

/**
 * Cập nhật một bản ghi cuộc gọi theo ID
 */
const applyCallLogUpdate = (callLog, updateData) => {
    if (updateData.status) callLog.status = toStr(updateData.status);
    if (updateData.startTime) callLog.startTime = new Date(toStr(updateData.startTime));
    if (updateData.endTime) {
        const end = new Date(toStr(updateData.endTime));
        callLog.endTime = isNaN(end.getTime()) ? new Date() : end;
        const start = callLog.startTime || callLog.createdAt;
        const diffMs = callLog.endTime.getTime() - new Date(start).getTime();
        callLog.duration = Math.max(0, Math.round(diffMs / 1000));
    }
    if (updateData.duration !== undefined) {
        const duration = Number(updateData.duration);
        callLog.duration = Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0;
    }
};

const updateCallLog = async (logId, updateData) => {
    const callLog = await CallLog.findById(logId);
    if (!callLog) return null;

    applyCallLogUpdate(callLog, updateData);

    await callLog.save();
    return callLog;
};

/**
 * Tìm cuộc gọi gần nhất giữa 2 user và cập nhật (hỗ trợ socket/client cũ)
 */
const updateLatestCallLog = async (callerId, receiverId, updateData) => {
    // Tìm cuộc gọi gần nhất trong vòng 5 phút qua
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const callLog = await CallLog.findOne({
        callerId,
        receiverId,
        createdAt: { $gte: fiveMinutesAgo }
    }).sort({ createdAt: -1 });

    if (!callLog) return null;

    applyCallLogUpdate(callLog, updateData);

    await callLog.save();
    return callLog;
};

/**
 * Lấy danh sách nhật ký cuộc gọi của user (có phân trang)
 */
const getUserCallLogs = async (userId, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    const logs = await CallLog.find({
        $or: [
            { callerId: userId },
            { receiverId: userId }
        ]
    })
    .populate('callerId', 'fullname email phone role')
    .populate('receiverId', 'fullname email phone role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

    const total = await CallLog.countDocuments({
        $or: [
            { callerId: userId },
            { receiverId: userId }
        ]
    });

    // Bổ sung thông tin đối phương và avatar nếu họ là luật sư
    const enrichedLogs = await Promise.all(logs.map(async (log) => {
        const isCaller = log.callerId._id.toString() === userId.toString();
        const otherUser = isCaller ? log.receiverId : log.callerId;
        const selfUser = isCaller ? log.callerId : log.receiverId;
        
        let otherAvatar = null;
        let selfAvatar = null;

        // Lấy avatar của đối phương nếu là luật sư
        if (otherUser && otherUser.role === 'lawyer') {
            const lawyer = await Lawyer.findOne({ userID: otherUser._id }).select('avatar').lean();
            if (lawyer) {
                otherAvatar = lawyer.avatar;
            }
        }

        // Lấy avatar của bản thân nếu là luật sư
        if (selfUser && selfUser.role === 'lawyer') {
            const lawyer = await Lawyer.findOne({ userID: selfUser._id }).select('avatar').lean();
            if (lawyer) {
                selfAvatar = lawyer.avatar;
            }
        }

        return {
            ...log,
            callerId: {
                ...log.callerId,
                avatar: isCaller ? selfAvatar : otherAvatar
            },
            receiverId: {
                ...log.receiverId,
                avatar: isCaller ? otherAvatar : selfAvatar
            },
            otherUser: {
                ...otherUser,
                avatar: otherAvatar
            },
            isIncoming: !isCaller
        };
    }));

    return {
        logs: enrichedLogs,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
};

/**
 * Xóa một bản ghi nhật ký cuộc gọi
 */
const deleteCallLog = async (userId, logId) => {
    return await CallLog.findOneAndDelete({
        _id: logId,
        $or: [
            { callerId: userId },
            { receiverId: userId }
        ]
    });
};

/**
 * Xóa toàn bộ lịch sử cuộc gọi của user
 */
const clearUserCallLogs = async (userId) => {
    return await CallLog.deleteMany({
        $or: [
            { callerId: userId },
            { receiverId: userId }
        ]
    });
};

module.exports = {
    createCallLog,
    updateCallLog,
    updateLatestCallLog,
    getUserCallLogs,
    deleteCallLog,
    clearUserCallLogs
};
