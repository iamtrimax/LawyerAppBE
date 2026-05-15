const lawyerModel = require("../model/lawyer.model");
const client = require("../config/redis");

const approveLawyer = async (lawyerId) => {
  const lawyerProfile = await lawyerModel
    .findOne({ lawyerId: lawyerId })
    .populate("userID");
  if (!lawyerProfile) {
    return;
  }
  lawyerProfile.isApproved = true;
  await lawyerProfile.save();
  if (lawyerProfile.userID) {
    await client.del(`lawyer_detail:${lawyerProfile.userID._id}`);
    // Xóa thêm cache danh sách tìm kiếm để luật sư xuất hiện ngay
    const keys = await client.keys("lawyers_list:*");
    if (keys.length > 0) {
      await Promise.all(keys.map(key => client.del(key)));
    }
  }
  return lawyerProfile;
};
const getLawyerDetailForAdmin = async (lawyerId) => {
  const lawyerProfile = await lawyerModel
    .findOne({ lawyerId: lawyerId })
    .populate("userID", "-password -otp -refreshTokens");
  return lawyerProfile;
};

module.exports = { approveLawyer, getLawyerDetailForAdmin };
