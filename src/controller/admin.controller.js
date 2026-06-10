const { default: Expo } = require("expo-server-sdk");
const { approveLawyer, getLawyerDetailForAdmin, getAllLawyersService, deleteUserAccount, lockUserAccount, unlockUserAccount, approveArticle, getAllArticlesForAdmin, getAllUsersService, deleteArticleForAdmin, getArticleDetailForAdmin } = require("../services/admin.services");

let expo = new Expo();

const getLawyerDetailForAdminController = async (req, res) => {
  const { lawyerId } = req.params;
  try {
    const lawyerProfile = await getLawyerDetailForAdmin(lawyerId);
    if (!lawyerProfile) {
      return res.status(404).json({
        success: false,
        message: "KhÃ´ng tÃ¬m tháº¥y thÃ´ng tin luáº­t sÆ°",
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
      message: error.message || "Lá»—i server ná»™i bá»™",
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
        .json({ message: "KhÃ´ng tÃ¬m tháº¥y luáº­t sÆ° Ä‘á»ƒ phÃª duyá»‡t" });
    }
    const user = approvedLawyer.userID;
    const pushToken = user.expoPushToken;
    if (pushToken && Expo.isExpoPushToken(pushToken)) {
      // Gá»­i thÃ´ng bÃ¡o Ä‘áº©y
      const messages = [
        {
          to: pushToken,
          sound: "default",
          title: "ðŸŽ‰ ChÃºc má»«ng! Há»“ sÆ¡ Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t",
          body: `ChÃ o Luáº­t sÆ° ${user.fullname}, há»“ sÆ¡ cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c phÃª duyá»‡t thÃ nh cÃ´ng. vul lÃ²ng thoÃ¡t á»©ng dá»¥ng vÃ  vÃ o láº¡i Ä‘á»ƒ cáº­p nháº­t tráº¡ng thÃ¡i`,
          data: { screen: "HomeScreen" }, // Dá»¯ liá»‡u Ä‘á»ƒ App xá»­ lÃ½ khi nháº¥n vÃ o
        },
      ];
      // Expo yÃªu cáº§u gá»­i theo "chunks" Ä‘á»ƒ tá»‘i Æ°u hiá»‡u suáº¥t
      let chunks = expo.chunkPushNotifications(messages);
      for (let chunk of chunks) {
        try {  
          await expo.sendPushNotificationsAsync(chunk);
        } catch (error) {
          console.error("Lá»—i khi gá»­i chunk thÃ´ng bÃ¡o:", error);
        }
      }
      return res.status(200).json({
        message: "Luáº­t sÆ° Ä‘Ã£ Ä‘Æ°á»£c phÃª duyá»‡t vÃ  thÃ´ng bÃ¡o Ä‘Ã£ Ä‘Æ°á»£c gá»­i",
        success: true,
      });
    } else {
      console.log("====================================");
      console.log("user chÆ°a cÃ³ push token há»£p lá»‡, khÃ´ng thá»ƒ gá»­i thÃ´ng bÃ¡o");
      console.log("====================================");
      return res.status(200).json({
        message: "Luáº­t sÆ° Ä‘Ã£ Ä‘Æ°á»£c phÃª duyá»‡t (khÃ´ng gá»­i Ä‘Æ°á»£c thÃ´ng bÃ¡o do chÆ°a cÃ³ push token)",
        success: true,
      });
    }
  } catch (error) {
    return res.status(400).json({ message: error.message });
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lá»—i server ná»™i bá»™",
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lỗi server nội bộ",
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
      message: error.message || "Lỗi server nội bộ",
    });
  }
};

module.exports = { aprroveLawyerController, getLawyerDetailForAdminController, getAllLawyers: getAllLawyersController, deleteUserAccountController, lockUserAccountController, unlockUserAccountController, approveArticleController, getAllArticlesController, getAllUsersController, deleteArticleAdminController, getArticleDetailAdminController };

