const { verifySePayWebhook, createSePayPaymentUrl, processPaymentWebhook } = require("../services/payment.services");

const handleSePayWebhookController = async (req, res) => {
    try {
        const data = req.body;
        const token = req.headers.authorization;

        // Xác thực Webhook
        const verifiedData = verifySePayWebhook(data, token);

        // TODO: Xử lý logic nghiệp vụ tại đây
        // Ví dụ: Tìm đơn hàng, cập nhật trạng thái đã thanh toán, v.v.

        // Xử lý cập nhật đơn hàng
        await processPaymentWebhook(verifiedData);

        return res.status(200).json({
            success: true,
            message: "Webhook received successfully"
        });

    } catch (error) {
        console.error("SePay Webhook Error:", error.message);
        return res.status(400).json({
            success: false,
            message: error.message || "Webhook processing failed"
        });
    }
};

const createPaymentLinkController = async (req, res) => {
    try {
        const { amount, description } = req.body;

        if (!amount || !description) {
            return res.status(400).json({
                success: false,
                message: "Amount and description are required"
            });
        }

        // Chỉ trả về QR Code (autofill 100% khi quét)
        const qrUrl = createSePayPaymentUrl(amount, description);

        return res.status(200).json({
            success: true,
            qrUrl,
            message: "Quét mã QR bằng app ngân hàng để thanh toán"
        });
    } catch (error) {
        console.error("Create Payment Link Error:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to create payment link"
        });
    }
}

module.exports = {
    handleSePayWebhookController,
    createPaymentLinkController
};
