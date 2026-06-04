const { aiSearch } = require("../services/aiSearch.service");
const { Server } = require("socket.io");

const { saveMessage } = require("../services/chat.services");
const User = require("../model/user.model");
const { sendPushNotification } = require("../services/notification.services");
const callLogServices = require("../services/callLog.services");

let io;
const userSockets = new Map(); // Link userId -> socket.id
const pendingOffersByReceiver = new Map(); // Lưu trữ offer cho người dùng offline/background

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket) => {
        console.log("A user connected:", socket.id);

        // Đăng ký UserId với SocketId (Hỗ trợ cả Guest ID)
        socket.on("register", (userId) => {
            if (!userId) return;
            
            // 1. Kiểm tra xem người dùng này đã có socket (thiết bị) khác đang kết nối chưa
            const existingSocketId = userSockets.get(userId.toString());
            
            // Nếu có và khác với socket ID hiện tại, force_logout thiết bị cũ
            if (existingSocketId && existingSocketId !== socket.id) {
                io.to(existingSocketId).emit('force_logout', {
                    reason: 'Tài khoản của bạn đã được đăng nhập trên một thiết bị khác. Phiên làm việc hiện tại sẽ bị đăng xuất.'
                });
                console.log(`Force logout sent to device ${existingSocketId} for user ${userId}`);
            }

            // 2. Cập nhật thiết bị mới nhất vào map
            userSockets.set(userId.toString(), socket.id);
            socket.join(userId.toString());
            console.log(`User/Guest ${userId} registered with socket ${socket.id}`);

            // Chỉ kiểm tra cuộc gọi cho người dùng thật (không phải Guest)
            if (!userId.toString().startsWith('guest_')) {
                const pendingCall = pendingOffersByReceiver.get(userId);
                if (pendingCall) {
                    console.log(`Syncing pending call to re-activated user: ${userId}`);
                    socket.emit("incoming-call", pendingCall);
                }
            }
        });

        // Cập nhật Expo Push Token cho User
        socket.on("update-push-token", async (data) => {
            const { userId, pushToken } = data;
            try {
                if (userId && pushToken) {
                    await User.findByIdAndUpdate(userId, { expoPushToken: pushToken });
                    console.log(`Push token updated for user ${userId}`);
                }
            } catch (error) {
                console.error("Error updating push token:", error);
            }
        });

        // Join room hội thoại hoặc room cá nhân
        socket.on("join", (roomId) => {
            socket.join(roomId);
            console.log(`Socket ${socket.id} joined room ${roomId}`);
        });

        // --- TÍNH NĂNG CUỘC GỌI (CALLING) ---

        // Bắt đầu cuộc gọi
        socket.on("call-user", async (data) => {
            const { callerId, callerName, receiverId, type, offer } = data;
            const receiverSocketId = userSockets.get(receiverId);

            // Tạo bản ghi nhật ký cuộc gọi ban đầu
            let callLogId = null;
            try {
                if (callerId && receiverId && !callerId.toString().startsWith('guest_') && !receiverId.toString().startsWith('guest_')) {
                    const log = await callLogServices.createCallLog({
                        callerId,
                        receiverId,
                        type,
                        status: 'missed',
                        startTime: new Date()
                    });
                    if (log) callLogId = log._id;
                }
            } catch (err) {
                console.error("Lỗi khi ghi call log ban đầu:", err);
            }

            // 1. Lưu Offer vào bộ nhớ tạm để đồng bộ sau (Tránh gửi gói tin quá lớn qua Push)
            pendingOffersByReceiver.set(receiverId, {
                callerId,
                callerName,
                callerSocketId: socket.id,
                type,
                offer,
                callLogId: callLogId ? callLogId.toString() : undefined
            });

            // 2. Gửi Push Notification SIÊU NHẸ (Không kèm offer) để đảm bảo Android/iOS không chặn
            try {
                const receiver = await User.findById(receiverId);
                if (receiver && receiver.expoPushToken) {
                    console.log("Sending lightweight push notification to:", receiverId);
                    await sendPushNotification(
                        receiver.expoPushToken,
                        "Cuộc gọi đến",
                        `${callerName} đang gọi cho bạn...`,
                        {
                            callerId,
                            callerName,
                            type,
                            callLogId: callLogId ? callLogId.toString() : undefined,
                            // CHÚ Ý: Không gửi offer ở đây để tối ưu dung lượng tin nhắn Push
                            action: "incoming-call"
                        }
                    );
                }
            } catch (error) {
                console.error("Lỗi khi gửi push notification cho cuộc gọi:", error);
            }

            // 3. Nếu online, gửi thêm sự kiện qua socket (Có kèm offer)
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("incoming-call", {
                    callerId,
                    callerName,
                    callerSocketId: socket.id,
                    type,
                    offer,
                    callLogId: callLogId ? callLogId.toString() : undefined
                });
            }
        });

        // Người nhận chấp nhận cuộc gọi
        socket.on("accept-call", async (data) => {
            const { callerId, answer, callLogId } = data;
            const callerSocketId = userSockets.get(callerId);

            // Tìm UserId của người chấp nhận để dọn dẹp hàng chờ
            let receiverId = null;
            for (let [uid, sid] of userSockets.entries()) {
                if (sid === socket.id) {
                    receiverId = uid;
                    pendingOffersByReceiver.delete(uid);
                    break;
                }
            }

            // Cập nhật cuộc gọi thành 'connected'
            try {
                if (callLogId) {
                    await callLogServices.updateCallLog(callLogId, {
                        status: 'connected',
                        startTime: new Date()
                    });
                } else if (callerId && receiverId) {
                    await callLogServices.updateLatestCallLog(callerId, receiverId, {
                        status: 'connected',
                        startTime: new Date()
                    });
                }
            } catch (err) {
                console.error("Lỗi khi cập nhật accept-call log:", err);
            }

            if (callerSocketId) {
                io.to(callerSocketId).emit("call-accepted", { answer, fromSocketId: socket.id });
            }
        });

        // Người nhận từ chối cuộc gọi
        socket.on("reject-call", async (data) => {
            const { callerId, callLogId } = data;
            const callerSocketId = userSockets.get(callerId);

            // Dọn dẹp hàng chờ
            let receiverId = null;
            for (let [uid, sid] of userSockets.entries()) {
                if (sid === socket.id) {
                    receiverId = uid;
                    pendingOffersByReceiver.delete(uid);
                    break;
                }
            }

            // Cập nhật cuộc gọi thành 'rejected'
            try {
                if (callLogId) {
                    await callLogServices.updateCallLog(callLogId, {
                        status: 'rejected',
                        endTime: new Date()
                    });
                } else if (callerId && receiverId) {
                    await callLogServices.updateLatestCallLog(callerId, receiverId, {
                        status: 'rejected',
                        endTime: new Date()
                    });
                }
            } catch (err) {
                console.error("Lỗi khi cập nhật reject-call log:", err);
            }

            if (callerSocketId) {
                io.to(callerSocketId).emit("call-rejected");
            }
        });

        // Gửi ứng viên ICE (WebRTC)
        socket.on("ice-candidate", (data) => {
            const { targetId, candidate } = data;

            // Tìm socket ID: Nếu targetId là User ID thì lấy từ map, 
            // nếu không tìm thấy thì xem như targetId chính là Socket ID
            const targetSocketId = userSockets.get(targetId) || targetId;

            if (targetSocketId) {
                io.to(targetSocketId).emit("ice-candidate", { candidate });
            }
        });

        // Kết thúc cuộc gọi
        socket.on("hang-up", async (data) => {
            const { targetId, callLogId } = data;
            const targetSocketId = userSockets.get(targetId) || targetId;

            // 1. Dọn dẹp hàng chờ
            pendingOffersByReceiver.delete(targetId);

            // Tìm UserId của người gọi (người kích hoạt hang-up là socket.id)
            let selfUserId = null;
            for (let [uid, sid] of userSockets.entries()) {
                if (sid === socket.id) {
                    selfUserId = uid;
                    break;
                }
            }

            // Tìm UserId của target
            let targetUserId = targetId;
            for (let [uid, sid] of userSockets.entries()) {
                if (sid === targetId) {
                    targetUserId = uid;
                    break;
                }
            }

            // Cập nhật cuộc gọi thành 'ended' hoặc tính toán duration
            try {
                const endTime = new Date();
                if (callLogId) {
                    const log = await callLogServices.updateCallLog(callLogId, { endTime });
                    if (log && log.status === 'connected') {
                        await callLogServices.updateCallLog(callLogId, { status: 'ended' });
                    }
                } else if (selfUserId && targetUserId) {
                    // Cố gắng tìm cuộc gọi theo cả 2 hướng và cập nhật kết thúc
                    const log1 = await callLogServices.updateLatestCallLog(selfUserId, targetUserId, { endTime });
                    if (log1) {
                        if (log1.status === 'connected') {
                            await callLogServices.updateCallLog(log1._id, { status: 'ended' });
                        }
                    } else {
                        const log2 = await callLogServices.updateLatestCallLog(targetUserId, selfUserId, { endTime });
                        if (log2 && log2.status === 'connected') {
                            await callLogServices.updateCallLog(log2._id, { status: 'ended' });
                        }
                    }
                }
            } catch (err) {
                console.error("Lỗi khi cập nhật hang-up log:", err);
            }

            // 2. Gửi qua Socket nếu đối phương đang online
            if (targetSocketId) {
                io.to(targetSocketId).emit("hang-up");
            }

            // 3. Dự phòng: Gửi Push Notification "ngắt máy" để máy người nghe dừng reo (nếu họ đang offline/background)
            try {
                // Nếu targetId là Socket ID, chúng ta cần tìm lại User ID để lấy token
                let receiverUserId = targetId;
                for (let [uid, sid] of userSockets.entries()) {
                    if (sid === targetId) {
                        receiverUserId = uid;
                        break;
                    }
                }

                const receiver = await User.findById(receiverUserId);
                if (receiver && receiver.expoPushToken) {
                    await sendPushNotification(
                        receiver.expoPushToken,
                        "Cuộc gọi đã kết thúc",
                        "Người gọi đã gác máy",
                        { action: "hang-up" }
                    );
                }
            } catch (error) {
                console.error("Lỗi khi gửi push notification hang-up:", error);
            }
        });

        // Logic chat
        socket.on("send_message", async (data) => {
            try {
                const { conversationID, text, senderID, attachments, isAiChat } = data;

                // 1. Nếu là Chat AI
                if (isAiChat || conversationID === 'AI_CHAT') {
                    // Gọi AI Search để lấy câu trả lời
                    try {
                        const { history } = data; // Nhận history từ frontend
                        const aiResponse = await aiSearch(text, history);
                        
                        const aiMsg = {
                            _id: `ai-${Date.now()}`,
                            conversationID: conversationID || 'AI_CHAT',
                            text: aiResponse.answer,
                            senderID: 'AI_ASSISTANT',
                            createdAt: new Date(),
                            isAiResponse: true,
                            sources: aiResponse.sources
                        };

                        // Gửi phản hồi AI cho người dùng
                        socket.emit("receive_message", aiMsg);
                    } catch (aiError) {
                        console.error("AI Search Error in Socket:", aiError);
                        socket.emit("receive_message", {
                            _id: `ai-err-${Date.now()}`,
                            conversationID: conversationID || 'AI_CHAT',
                            text: "Xin lỗi, hiện tại tôi không thể xử lý câu hỏi này. Vui lòng thử lại sau.",
                            senderID: 'AI_ASSISTANT',
                            createdAt: new Date(),
                            isAiResponse: true
                        });
                    }
                    return;
                }

                // 2. Chat thông thường (giữa người với người)
                // Lưu vào database
                const savedMsg = await saveMessage({ conversationID, senderID, text, attachments });

                // Gửi tới toàn bộ thành viên trong room hội thoại
                io.to(conversationID).emit("receive_message", savedMsg);

                console.log(`Message sent in room ${conversationID}`);

                // Gửi Push Notification cho người nhận
                try {
                    const chatConversationModel = require("../model/chatConversation.model");
                    const sender = await User.findById(senderID);
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
                                    message: savedMsg,
                                    senderName
                                });

                                // Gửi thông báo đẩy (nếu offline/chưa mở app)
                                if (participant.expoPushToken) {
                                    sendPushNotification(
                                        participant.expoPushToken,
                                        `Tin nhắn mới từ ${senderName}`,
                                        notifyText,
                                        { type: 'chat', conversationID, senderID: senderID.toString(), senderName }
                                    ).catch(err => console.error("Push error:", err));
                                }
                            }
                        });
                    }
                } catch (pushErr) {
                    console.error("Socket send push notification error:", pushErr);
                }
            } catch (error) {
                console.error("Socket send_message error:", error);
                socket.emit("error", { message: "Gửi tin nhắn thất bại" });
            }
        });

        socket.on("disconnect", () => {
            console.log("User disconnected:", socket.id);
            // Xóa mapping khi người dùng mất kết nối
            for (let [userId, socketId] of userSockets.entries()) {
                if (socketId === socket.id) {
                    userSockets.delete(userId);
                    console.log(`User ${userId} (socket ${socket.id}) removed from mapping`);
                    break;
                }
            }
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("Socket.io chưa được khởi tạo!");
    }
    return io;
};

module.exports = { initSocket, getIO };
