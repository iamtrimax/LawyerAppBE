const express = require("express");
const { userRegisterController, verifyEmailController, loginController, updateToken, searchLawyerByCategoryController, getLawyerScheduleByIdController, createBookingController, getUserBookingsController, getBookingDetailController, updateUserProfileController, changePasswordController, checkAccountExistsController, resetPasswordController, verifyForgotPasswordOTPController, cancelBookingController, getUserProfileController, getReferralHistoryController } = require("../controller/user.controller");
const { lawyerRegisterController, getLawyerDetailController, updateScheduleController, getMyScheduleController, getLawyerBookingsController, getLawyerBookingDetailController, confirmBookingPaymentController, updateLawyerProfileController, getLawyersController } = require("../controller/lawyer.controller");
const verifyAccessToken = require("../../middleware/verifyAccessToken");
const verifyAdmin = require("../../middleware/verifyAdmin");
const { aprroveLawyerController, getLawyerDetailForAdminController } = require("../controller/admin.controller");
const verifyLawyer = require("../../middleware/verifyLawyer");
const rateLimiter = require("../../middleware/rateLimiter");
const { handleSePayWebhookController, createPaymentLinkController } = require("../controller/payment.controller");
const {
    createArticleController,
    getArticlesController,
    getArticleDetailController,
    getArticleByLawyerController,
    updateArticleController,
    deleteArticleController,
    aiSearchController,
    trackArticleDownloadController
} = require("../controller/article.controller");
const {
    getResourcesController,
    getResourceDetailController,
    searchResourcesController,
    createResourceController,
    updateResourceController,
    deleteResourceController
} = require("../controller/legalResource.controller");
const {
    getFormsController,
    getFormDetailController,
    trackDownloadController,
    createFormController,
    updateFormController,
    deleteFormController,
    searchFormsController,
    viewFileController,
    createLawyerFormController,
    getMyFormsController,
    updateMyFormController,
    deleteMyFormController
} = require("../controller/legalForm.controller");
const {
    startChatController,
    getConversationsController,
    getMessagesController,
    sendMessageController,
    createBroadcastController,
    getBroadcastsController
} = require("../controller/chat.controller");
const {
    getFormTypesController,
    legalAiChatController,
    downloadLegalFormController,
    getAiHistoryController
} = require("../controller/legalAiChat.controller");

const router = express.Router();

// 1. Định nghĩa các mức Rate Limit khác nhau
const globalLimiter = rateLimiter({ prefix: "global", max: 100 });
const authLimiter = rateLimiter({ prefix: "auth", max: 5, windowMs: 60000 * 5 }); // 5 lần/5 phút cho login/register/forgot-password
const paymentLimiter = rateLimiter({ prefix: "payment", max: 3, windowMs: 60000 }); // 3 lần/phút cho tạo link thanh toán

// 2. Áp dụng Rate Limiting global mặc định cho tất cả route
router.use(globalLimiter);

// 3. Định nghĩa các route

// article routes
router.get("/articles/ai-search", aiSearchController);
router.get("/articles", getArticlesController);
router.get("/articles/:id", getArticleDetailController);
router.post("/articles/create", verifyAccessToken, verifyLawyer, createArticleController);
router.get("/articles/lawyer/my-articles", verifyAccessToken, verifyLawyer, getArticleByLawyerController);
router.put("/articles/update/:id", verifyAccessToken, verifyLawyer, updateArticleController);
router.delete("/articles/delete/:id", verifyAccessToken, verifyLawyer, deleteArticleController);
router.post("/articles/:id/download", verifyAccessToken, trackArticleDownloadController);

//user routes
router.post("/register", authLimiter, userRegisterController);
router.post("/verify-email", verifyEmailController);
router.post("/login", authLimiter, loginController);
router.post("/update-token", updateToken);
router.get("/search-lawyer", searchLawyerByCategoryController)
router.get("/schedule/:lawyerId", getLawyerScheduleByIdController);
router.post("/booking/create", verifyAccessToken, createBookingController);
router.get("/booking/list", verifyAccessToken, getUserBookingsController);
router.get("/booking/detail/:bookingId", verifyAccessToken, getBookingDetailController);
router.put("/profile", verifyAccessToken, updateUserProfileController);
router.get("/profile", verifyAccessToken, getUserProfileController);
router.get("/referrals", verifyAccessToken, getReferralHistoryController);
router.post("/change-password", verifyAccessToken, changePasswordController);
router.post("/forgot-password/check-email", authLimiter, checkAccountExistsController);
router.post("/forgot-password/verify-otp", verifyForgotPasswordOTPController);
router.post("/forgot-password/reset", authLimiter, resetPasswordController);
router.post("/booking/cancel/:bookingId", verifyAccessToken, cancelBookingController);

// English Legal Data (Feature 3)
router.get("/legal-resources", getResourcesController);
router.get("/legal-resources/search", searchResourcesController);
router.get("/legal-resources/:id", getResourceDetailController);

// Legal Forms (Feature 4)
router.get("/legal-forms", getFormsController);
router.get("/legal-forms/search", searchFormsController);
router.get("/legal-forms/:id", getFormDetailController);
router.get("/legal-forms/view/:id.png", viewFileController);
router.post("/legal-forms/:id/download", verifyAccessToken, trackDownloadController);

// lawyer routes
router.get("/lawyers", getLawyersController);
router.post("/lawyer/register", authLimiter, lawyerRegisterController)
router.post("/lawyer/update-schedule", verifyAccessToken, verifyLawyer, updateScheduleController);
router.get("/lawyer/detail", verifyAccessToken, verifyLawyer, getLawyerDetailController);
router.get("/lawyer/schedule", verifyAccessToken, verifyLawyer, getMyScheduleController);
router.get("/lawyer/bookings", verifyAccessToken, verifyLawyer, getLawyerBookingsController);
router.get("/lawyer/booking-detail/:bookingId", verifyAccessToken, verifyLawyer, getLawyerBookingDetailController);
router.put("/lawyer/booking/confirm-payment/:bookingId", verifyAccessToken, verifyLawyer, confirmBookingPaymentController);
router.put("/lawyer/profile", verifyAccessToken, verifyLawyer, updateLawyerProfileController);

// lawyer legal forms management
router.post("/lawyer/forms/create", verifyAccessToken, verifyLawyer, createLawyerFormController);
router.get("/lawyer/forms/my-forms", verifyAccessToken, verifyLawyer, getMyFormsController);
router.put("/lawyer/forms/update/:id", verifyAccessToken, verifyLawyer, updateMyFormController);
router.delete("/lawyer/forms/delete/:id", verifyAccessToken, verifyLawyer, deleteMyFormController);

// admin routes
router.post("/approve-lawyer/*lawyerId", verifyAccessToken, verifyAdmin, authLimiter, aprroveLawyerController);
router.get("/admin/lawyer-detail/:lawyerId", verifyAccessToken, verifyAdmin, getLawyerDetailForAdminController);

// Admin Legal Resource Management
router.post("/admin/legal-resources", verifyAccessToken, verifyAdmin, createResourceController);
router.put("/admin/legal-resources/:id", verifyAccessToken, verifyAdmin, updateResourceController);
router.delete("/admin/legal-resources/:id", verifyAccessToken, verifyAdmin, deleteResourceController);

// Admin Legal Form Management
router.post("/admin/legal-forms", verifyAccessToken, verifyAdmin, createFormController);
router.put("/admin/legal-forms/:id", verifyAccessToken, verifyAdmin, updateFormController);
router.delete("/admin/legal-forms/:id", verifyAccessToken, verifyAdmin, deleteFormController);

// payment routes
router.post("/payment/sepay-webhook", handleSePayWebhookController);
router.post("/payment/create-url", verifyAccessToken, paymentLimiter, createPaymentLinkController);

// Chat Consultation routes
router.post("/chat/start", verifyAccessToken, startChatController);
router.get("/chat/conversations", verifyAccessToken, getConversationsController);
router.get("/chat/history/:conversationID", verifyAccessToken, getMessagesController);
router.post("/chat/send", verifyAccessToken, sendMessageController);
router.post("/chat/broadcast", verifyAccessToken, createBroadcastController);
router.get("/chat/broadcasts", verifyAccessToken, getBroadcastsController);

// Legal AI Chat - Form Generation routes
router.get("/legal/ai-chat/form-types", getFormTypesController);
router.post("/legal/ai-chat", legalAiChatController);
router.post("/legal/ai-chat/download", downloadLegalFormController);
router.get("/legal/ai-chat/history", verifyAccessToken, getAiHistoryController);

module.exports = router;