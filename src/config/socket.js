const { Server } = require("socket.io");

const { saveMessage } = require("../services/chat.services");
const User = require("../model/user.model");
const { sendPushNotification } = require("../services/notification.services");

let io;
const userSockets = new Map(); // Link userId -> socket.id

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket) => {
        console.log("A user connected:", socket.id);

        // Đăng ký UserId với SocketId
        socket.on("register", (userId) => {
            userSockets.set(userId, socket.id);
            console.log(`User ${userId} registered with socket ${socket.id}`);
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

            // LUÔN LUÔN gửi Push Notification để đảm bảo người dùng nhận được trên Lock Screen
            try {
                const receiver = await User.findById(receiverId);
                if (receiver && receiver.expoPushToken) {
                    console.log("Sending push notification to:", receiverId);
                    await sendPushNotification(
                        receiver.expoPushToken,
                        "Cuộc gọi đến",
                        `${callerName} đang gọi cho bạn...`,
                        { 
                            callerId, 
                            callerName, 
                            type, 
                            offer, // Cực kỳ quan trọng để bên nhận có thể accept
                            action: "incoming-call" 
                        }
                    );
                }
            } catch (error) {
                console.error("Lỗi khi gửi push notification cho cuộc gọi:", error);
            }

            if (receiverSocketId) {
                // Nếu online, gửi thêm sự kiện incoming-call qua socket để xử lý nhanh
                io.to(receiverSocketId).emit("incoming-call", {
                    callerId,
                    callerName,
                    type,
                    offer
                });
            }
        });

        // Người nhận chấp nhận cuộc gọi
        socket.on("accept-call", (data) => {
            const { callerId, answer } = data;
            const callerSocketId = userSockets.get(callerId);
            if (callerSocketId) {
                io.to(callerSocketId).emit("call-accepted", { answer, fromSocketId: socket.id });
            }
        });

        // Người nhận từ chối cuộc gọi
        socket.on("reject-call", (data) => {
            const { callerId } = data;
            const callerSocketId = userSockets.get(callerId);
            if (callerSocketId) {
                io.to(callerSocketId).emit("call-rejected");
            }
        });

        // Gửi ứng viên ICE (WebRTC)
        socket.on("ice-candidate", (data) => {
            const { targetId, candidate } = data;
            const targetSocketId = userSockets.get(targetId);
            if (targetSocketId) {
                io.to(targetSocketId).emit("ice-candidate", { candidate });
            }
        });

        // Kết thúc cuộc gọi
        socket.on("hang-up", (data) => {
            const { targetId } = data;
            const targetSocketId = userSockets.get(targetId);
            if (targetSocketId) {
                io.to(targetSocketId).emit("hang-up");
            }
        });

        // Logic chat cũ
        socket.on("send_message", async (data) => {
            try {
                const { conversationID, text, senderID, attachments } = data;

                // Lưu vào database
                const savedMsg = await saveMessage({ conversationID, senderID, text, attachments });

                // Gửi tới toàn bộ thành viên trong room hội thoại
                io.to(conversationID).emit("receive_message", savedMsg);

                console.log(`Message sent in room ${conversationID}`);
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
