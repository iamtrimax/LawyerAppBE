const { Expo } = require("expo-server-sdk");
const { approveLawyer } = require("../services/admin.services");

let expo = new Expo();
const aprroveLawyerController = async (req, res) => {
  const { lawyerId } = req.params;
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
    }
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
module.exports = { aprroveLawyerController };
