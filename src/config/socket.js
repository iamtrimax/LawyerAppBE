const { Server } = require("socket.io");

const { saveMessage } = require("../services/chat.services");

let io;

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket) => {
        console.log("A user connected:", socket.id);

        // Join room hội thoại hoặc room cá nhân
        socket.on("join", (roomId) => {
            socket.join(roomId);
            console.log(`Socket ${socket.id} joined room ${roomId}`);
        });

        // Xử lý gửi tin nhắn thời gian thực
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
