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
  }
  return lawyerProfile;
};
module.exports = { approveLawyer };
