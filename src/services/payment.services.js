const bookingModel = require("../model/booking.model");
require('dotenv').config();

const createSePayPaymentUrl = (amount, description) => {
    // Lấy thông tin tài khoản ngân hàng từ biến môi trường
    // Nếu chưa cấu hình, vui lòng thêm vào file .env:
    // SEPAY_BANK_CODE=MB (hoặc TPBank, Vietcombank...)
    // SEPAY_ACCOUNT_NUMBER=STK_CUA_BAN
    const BANK_CODE = process.env.SEPAY_BANK_CODE;
    const ACCOUNT_NUMBER = process.env.SEPAY_ACCOUNT_NUMBER;

    if (!amount || amount <= 0) {
        throw new Error("Số tiền thanh toán phải lớn hơn 0");
    }

    // Tạo URL QR Code theo định dạng của SePay
    // Template: https://qr.sepay.vn/img?acc={acc}&bank={bank}&amount={amount}&des={des}
    const url = `https://qr.sepay.vn/img?acc=${ACCOUNT_NUMBER}&bank=${BANK_CODE}&amount=${amount}&des=${encodeURIComponent(description)}`;

    return url;
};


const verifySePayWebhook = (data, token) => {
    // API Key từ biến môi trường (lấy từ https://my.sepay.vn)
    const SEPAY_API_KEY = process.env.SEPAY_API_KEY;

    if (!SEPAY_API_KEY) {
        throw new Error("Chua cau hinh SEPAY_API_KEY");
    }

    // Kiểm tra header Authorization
    // SePay gửi header: Authorization: Bearer <API Key>
    if (!token || !token.startsWith("Apikey ")) {
        throw new Error("Thieu hoac sai dinh dang Authorization header");
    }

    const receivedKey = token.split(" ")[1];

    if (receivedKey !== SEPAY_API_KEY) {
        throw new Error("API Key khong hop le");
    }

    // Các thông tin quan trọng từ Webhook
    // id, gateway, transactionDate, accountNumber, subAccount, code, content, transferType, description, amount, referenceCode
    return data;
};

const { getIO } = require("../config/socket");

const client = require("../config/redis");
const lawyerModel = require("../model/lawyer.model");
const memberUpgradeModel = require("../model/memberUpgrade.model");
const userModel = require("../model/user.model");

const getMemberUpgradePrice = () => {
    const price = Number(process.env.MEMBER_UPGRADE_PRICE || 99000);
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error("MEMBER_UPGRADE_PRICE khong hop le");
    }
    return price;
};

const createMemberUpgradePayment = async (userId) => {
    const user = await userModel.findById(userId);
    if (!user) {
        throw new Error("Nguoi dung khong ton tai");
    }

    if (user.role === "member") {
        throw new Error("Tai khoan da la member");
    }

    if (user.role !== "customer") {
        throw new Error("Chi customer moi co the nang cap len member");
    }

    const amount = getMemberUpgradePrice();
    let upgrade = await memberUpgradeModel.findOne({
        userID: userId,
        status: 'Pending',
        amount
    }).sort({ createdAt: -1 });

    if (!upgrade) {
        upgrade = await memberUpgradeModel.create({
            userID: userId,
            amount,
            paymentCode: `UPGRADE-${userId}-${Date.now()}`
        });
    }

    const description = `UPGRADE MEMBER ${upgrade._id}`;
    const qrUrl = createSePayPaymentUrl(upgrade.amount, description);

    return {
        upgrade,
        qrUrl,
        amount: upgrade.amount,
        description
    };
};

const getMemberUpgradePaymentStatus = async (userId, upgradeId) => {
    const upgrade = await memberUpgradeModel.findOne({
        _id: upgradeId,
        userID: userId
    }).select('-paymentInfo.fullWebhookData');

    if (!upgrade) {
        throw new Error("Khong tim thay giao dich nang cap member");
    }

    const user = await userModel.findById(userId).select('role');

    return {
        upgrade,
        currentRole: user?.role
    };
};

const processMemberUpgradePayment = async (webhookData, transactionContent) => {
    const match = transactionContent.match(/UPGRADE(?:\s+MEMBER)?\s+([0-9a-fA-F]{24})/i);
    if (!match) {
        return null;
    }

    const upgrade = await memberUpgradeModel.findById(match[1]);
    if (!upgrade) {
        return null;
    }

    if (upgrade.status === 'Paid') {
        return upgrade;
    }

    const paidAmount = Number(webhookData.transferAmount || webhookData.amount || 0);
    if (paidAmount < upgrade.amount) {
        throw new Error("So tien thanh toan nang cap member chua du");
    }

    const user = await userModel.findById(upgrade.userID);
    if (!user) {
        throw new Error("Nguoi dung nang cap member khong ton tai");
    }

    if (user.role !== 'customer' && user.role !== 'member') {
        throw new Error("Role hien tai khong duoc phep nang cap member");
    }

    user.role = 'member';
    await user.save();

    upgrade.status = 'Paid';
    upgrade.paidAt = new Date();
    upgrade.paymentInfo = {
        transactionID: webhookData.id,
        gateway: webhookData.gateway,
        content: webhookData.content,
        description: webhookData.description,
        senderAccount: webhookData.sender_account || webhookData.source_account || "",
        senderName: webhookData.sender_name || "",
        fullWebhookData: webhookData
    };
    await upgrade.save();

    try {
        const io = getIO();
        io.to(upgrade.userID.toString()).emit("member_upgrade_success", {
            message: "Nang cap member thanh cong!",
            userId: upgrade.userID.toString(),
            upgradeId: upgrade._id.toString()
        });
    } catch (socketError) {
        console.error("Loi khi gui socket event nang cap member:", socketError.message);
    }

    return upgrade;
};

const processPaymentWebhook = async (webhookData) => {
    try {
        console.log("Webhook data:", webhookData);

        // Giả sử nội dung chuyển khoản (content hoặc description) chứa Booking ID
        const transactionContent = webhookData.content || webhookData.description || "";

        const memberUpgrade = await processMemberUpgradePayment(webhookData, transactionContent);
        if (memberUpgrade) {
            console.log(`Member upgrade ${memberUpgrade._id} paid and user role updated.`);
            return memberUpgrade;
        }

        const bookingIdRegex = /[0-9a-fA-F]{24}/;
        const match = transactionContent.match(bookingIdRegex);

        if (match) {
            const bookingId = match[0];
            const booking = await bookingModel.findById(bookingId);

            if (booking) {
                // Lấy thông tin luật sư để biết tỷ lệ hoa hồng
                const lawyer = await lawyerModel.findById(booking.lawyerID);
                const commissionRate = lawyer ? (lawyer.commissionRate || 0) : 0;

                booking.status = 'Confirmed';
                booking.paymentStatus = 'Paid';

                // Tính toán hoa hồng và số tiền trả cho luật sư
                booking.commissionAmount = (booking.price * commissionRate) / 100;
                booking.lawyerPayoutAmount = booking.price - booking.commissionAmount;
                booking.payoutStatus = lawyer?.isCollaborator ? 'Pending' : 'N/A';

                // Lưu thông tin thanh toán để hoàn tiền sau này
                booking.paymentInfo = {
                    transactionID: webhookData.id,
                    gateway: webhookData.gateway,
                    content: webhookData.content,
                    description: webhookData.description,
                    // Một số ngân hàng hoặc SePay có thể cung cấp thêm sender_account/sender_name
                    senderAccount: webhookData.sender_account || webhookData.source_account || "",
                    senderName: webhookData.sender_name || "",
                    fullWebhookData: webhookData
                };

                await booking.save();
                console.log(`Booking ${bookingId} confirmed and payment info saved.`);

                // XÓA CACHE REDIS
                try {
                    await client.del(`user_bookings:${booking.userID}`);
                    await client.del(`booking_detail:${bookingId}`);
                    console.log(`Redis cache invalidated for booking: ${bookingId}`);
                } catch (redisError) {
                    console.error("Lỗi khi xóa cache Redis:", redisError.message);
                }

                // PHÁT EVENT WEBSOCKET
                try {
                    const io = getIO();
                    io.to(bookingId).emit("payment_success", {
                        message: "Thanh toán thành công!",
                        bookingId: bookingId
                    });
                    console.log(`Socket event emitted to room: ${bookingId}`);
                } catch (socketError) {
                    console.error("Lỗi khi gửi socket event:", socketError.message);
                }

                return booking;
            } else {
                console.log(`Booking ${bookingId} not found.`);
            }
        } else {
            console.log("No Booking ID found in transaction content.");
        }
    } catch (error) {
        console.error("Error processing payment webhook:", error);
    }
};

module.exports = {
    createSePayPaymentUrl,
    createMemberUpgradePayment,
    getMemberUpgradePaymentStatus,
    verifySePayWebhook,
    processPaymentWebhook
};
