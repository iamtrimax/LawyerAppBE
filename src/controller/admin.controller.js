const { default: Expo } = require("expo-server-sdk");
const { addLawyerForAdmin, approveLawyer, getLawyerDetailForAdmin, getAllLawyersService, deleteUserAccount, lockUserAccount, unlockUserAccount, approveArticle, getAllArticlesForAdmin, getAllUsersService, deleteArticleForAdmin, getArticleDetailForAdmin, getAllBookingsForAdmin, getBookingDetailForAdmin, getAllRefundsForAdmin, processRefundForAdmin, getDashboardStatsForAdmin } = require("../services/admin.services");
const sanitizeError = require("../utils/sanitizeError");

let expo = new Expo();

const getLawyerDetailForAdminController = async (req, res) => {
  const { lawyerId } = req.params;
  try {
    const lawyerProfile = await getLawyerDetailForAdmin(lawyerId);
    if (!lawyerProfile) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy thông tin luật sư",
      });
    }
    res.status(200).json({
      success: true,
      data: lawyerProfile,
    });
  } catch (error) {
    console.error("Lá»—i táº¡i getLawyerDetailForAdminController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const aprroveLawyerController = async (req, res) => {
  const { lawyerId } = req.body;
  try {
    const approvedLawyer = await approveLawyer(lawyerId);
    if (!approvedLawyer) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy luật sư để phê duyệt" });
    }
    const user = approvedLawyer.userID;
    const pushToken = user.expoPushToken;
    if (pushToken && Expo.isExpoPushToken(pushToken)) {
      // Gửi thông báo đẩy
      const messages = [
        {
          to: pushToken,
          sound: "default",
          title: "🎉 Chúc mừng! Hồ sơ đã được duyệt",
          body: `Chào Luật sư ${user.fullname}, hồ sơ của bạn đã được phê duyệt thành công. vul lòng thoát ứng dụng và vào lại để cập nhật trạng thái`,
          data: { screen: "HomeScreen" }, // Dữ liệu để App xử lý khi nhấn vào
        },
      ];
      // Expo yêu cầu gửi theo "chunks" để tối ưu hiệu suất
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        try {  
          await expo.sendPushNotificationsAsync(chunk);
        } catch (error) {
          console.error("Lỗi khi gửi chunk thông báo:", error);
        }
      }
      return res.status(200).json({
        message: "Luật sư đã được phê duyệt và thông báo đã được gửi",
        success: true,
      });
    } else {
      console.log("====================================");
      console.log("user chưa có push token hợp lệ, không thể gửi thông báo");
      console.log("====================================");
      return res.status(200).json({
        message: "Luật sư đã được phê duyệt (không gửi được thông báo do chưa có push token)",
        success: true,
      });
    }
  } catch (error) {
    return res.status(400).json({ message: sanitizeError(error) });
  }
};

const notifyForceLogout = (userId, reason) => {
  try {
    const { getIO } = require("../config/socket");
    const io = getIO();
    io.to(userId.toString()).emit("force_logout", { reason });
  } catch (socketError) {
    console.warn("Force logout socket notification failed:", socketError.message);
  }
};

const deleteUserAccountController = async (req, res) => {
  const { targetId } = req.params;
  try {
    const deletedUser = await deleteUserAccount(targetId);
    const message = "Tài khoản đã bị xoá khỏi hệ thống";
    notifyForceLogout(deletedUser._id, message);

    return res.status(200).json({
      success: true,
      message,
      data: deletedUser,
    });
  } catch (error) {
    console.error("Lỗi tại deleteUserAccountController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const lockUserAccountController = async (req, res) => {
  const { targetId } = req.params;
  try {
    const lockedUser = await lockUserAccount(targetId);
    const message = "Tài khoản đã bị khoá";
    notifyForceLogout(lockedUser._id, message);

    return res.status(200).json({
      success: true,
      message,
      data: lockedUser,
    });
  } catch (error) {
    console.error("Lỗi tại lockUserAccountController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};
const getAllLawyersController = async(req, res)=>{
  const {page = 1, limit = 10, filter} = req.query;
  try {
    const lawyers = await getAllLawyersService({ page: parseInt(page, 10), limit: parseInt(limit, 10), filter });
    res.status(200).json({
      success: true,
      data: lawyers
    });
  } catch (error) {
    console.error("Lá»—i táº¡i getAllLawyersController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
}
const unlockUserAccountController = async (req, res) => {
  const { targetId } = req.params;
  try {
    const unlockedUser = await unlockUserAccount(targetId);

    return res.status(200).json({
      success: true,
      message: "Tài khoản đã được mở khoá thành công",
      data: unlockedUser,
    });
  } catch (error) {
    console.error("Lỗi tại unlockUserAccountController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const approveArticleController = async (req, res) => {
  const { articleId } = req.params;
  try {
    const article = await approveArticle(articleId);
    return res.status(200).json({
      success: true,
      message: "Duyệt bài viết thành công",
      data: article,
    });
  } catch (error) {
    console.error("Lỗi tại approveArticleController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getAllArticlesController = async (req, res) => {
  const { page = 1, limit = 10, filter } = req.query;
  try {
    const articles = await getAllArticlesForAdmin({ page: parseInt(page, 10), limit: parseInt(limit, 10), filter });
    res.status(200).json({
      success: true,
      data: articles
    });
  } catch (error) {
    console.error("Lỗi tại getAllArticlesController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getAllUsersController = async (req, res) => {
  const { page = 1, limit = 10, roleFilter, search } = req.query;
  try {
    const data = await getAllUsersService({ page: parseInt(page, 10), limit: parseInt(limit, 10), roleFilter, search });
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("Lỗi tại getAllUsersController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const deleteArticleAdminController = async (req, res) => {
  try {
    const result = await deleteArticleForAdmin(req.params.articleId);
    res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error("Lỗi tại deleteArticleController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getArticleDetailAdminController = async (req, res) => {
  try {
    const article = await getArticleDetailForAdmin(req.params.articleId);
    res.status(200).json({
      success: true,
      data: article
    });
  } catch (error) {
    console.error("Lỗi tại getArticleDetailAdminController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getAllBookingsAdminController = async (req, res) => {
  const { page = 1, limit = 10, status, paymentStatus, payoutStatus, search, dateFrom, dateTo } = req.query;
  try {
    const data = await getAllBookingsForAdmin({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      paymentStatus,
      payoutStatus,
      search,
      dateFrom,
      dateTo
    });
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("Lỗi tại getAllBookingsAdminController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getBookingDetailAdminController = async (req, res) => {
  try {
    const booking = await getBookingDetailForAdmin(req.params.bookingId);
    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error("Lỗi tại getBookingDetailAdminController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getAllRefundsAdminController = async (req, res) => {
  const { page = 1, limit = 10, status, search } = req.query;
  try {
    const data = await getAllRefundsForAdmin({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      search
    });
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("Lỗi tại getAllRefundsAdminController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const processRefundAdminController = async (req, res) => {
  const { refundId } = req.params;
  const { status, adminNote } = req.body;
  const adminId = req.userId;

  try {
    const refund = await processRefundForAdmin({
      refundId,
      adminId,
      status,
      adminNote
    });
    res.status(200).json({
      success: true,
      message: status === 'Processed' ? "Phê duyệt và thực hiện hoàn tiền thành công" : "Từ chối yêu cầu hoàn tiền thành công",
      data: refund
    });
  } catch (error) {
    console.error("Lỗi tại processRefundAdminController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const getDashboardStatsAdminController = async (req, res) => {
  try {
    const data = await getDashboardStatsForAdmin();
    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error("Lỗi tại getDashboardStatsAdminController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

const addLawyerAdminController = async (req, res) => {
  try {
    const user = await addLawyerForAdmin(req.body);
    res.status(201).json({
      success: true,
      message: "Thêm luật sư thành công",
      data: user
    });
  } catch (error) {
    console.error("Lỗi tại addLawyerAdminController:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: sanitizeError(error),
    });
  }
};

module.exports = { addLawyerAdminController, aprroveLawyerController, getLawyerDetailForAdminController, getAllLawyers: getAllLawyersController, deleteUserAccountController, lockUserAccountController, unlockUserAccountController, approveArticleController, getAllArticlesController, getAllUsersController, deleteArticleAdminController, getArticleDetailAdminController, getAllBookingsAdminController, getBookingDetailAdminController, getAllRefundsAdminController, processRefundAdminController, getDashboardStatsAdminController };

