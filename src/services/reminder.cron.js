const cron = require("node-cron");
const bookingModel = require("../model/booking.model");
const { sendUnifiedNotification } = require("./notification.services");

/**
 * Khởi tạo cron job chạy mỗi 5 phút để kiểm tra lịch hẹn
 */
const initReminderCron = () => {
    // Chạy mỗi 5 phút
    cron.schedule("*/5 * * * *", async () => {
        // console.log("-----------------------------------------");
        // console.log("Đang kiểm tra lịch hẹn để gửi nhắc nhở...");

        try {
            const now = new Date();

            // Tìm các booking:
            // 1. Trạng thái Confirmed
            // 2. Chưa gửi nhắc nhở
            const bookings = await bookingModel.find({
                status: "Confirmed",
                reminderSent: false
            }).populate({
                path: "userID",
                select: "fullname email expoPushToken"
            }).populate({
                path: "lawyerID",
                populate: {
                    path: "userID",
                    select: "fullname email expoPushToken"
                }
            });

            for (const booking of bookings) {
                try {
                    // Tính thời gian bắt đầu của booking
                    // date: YYYY-MM-DD, timeSlot.start: HH:mm
                    const [year, month, day] = booking.date.split("-").map(Number);
                    const [hour, minute] = booking.timeSlot.start.split(":").map(Number);

                    const bookingStartTime = new Date(year, month - 1, day, hour, minute);

                    // Tính khoảng cách thời gian (ms)
                    const diffMs = bookingStartTime - now;
                    const diffMinutes = Math.floor(diffMs / (1000 * 60));

                    // Nếu cách thời gian hiện tại từ 55 đến 65 phút
                    if (diffMinutes >= 55 && diffMinutes <= 65) {
                        console.log(`Gửi nhắc nhở cho booking: ${booking._id}`);

                        // 1. Thông báo cho khách hàng
                        const user = booking.userID;
                        const userMsg = `Nhắc nhở: Bạn có lịch hẹn với Luật sư ${booking.lawyerID.userID.fullname} vào lúc ${booking.timeSlot.start} hôm nay.`;
                        await sendUnifiedNotification(user, "🔔 Nhắc nhở lịch hẹn sắp tới", userMsg, { bookingId: booking._id });

                        // 2. Thông báo cho luật sư
                        const lawyerUser = booking.lawyerID.userID;
                        const lawyerMsg = `Nhắc nhở: Bạn có lịch hẹn với khách hàng ${user.fullname} vào lúc ${booking.timeSlot.start} hôm nay.`;
                        await sendUnifiedNotification(lawyerUser, "🔔 Nhắc nhở lịch hẹn sắp tới", lawyerMsg, { bookingId: booking._id });

                        // Đánh dấu đã gửi
                        booking.reminderSent = true;
                        await booking.save();
                    }
                } catch (err) {
                    console.error(`Lỗi khi xử lý nhắc nhở cho booking ${booking._id}:`, err);
                }
            }

        } catch (error) {
            console.error("Lỗi trong quá trình chạy cron nhắc nhở:", error);
        }

        console.log("Hoàn tất kiểm tra nhắc nhở.");
        console.log("-----------------------------------------");
    });
};

module.exports = { initReminderCron };
