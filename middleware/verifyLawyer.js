const lawyerModel = require("../src/model/lawyer.model");

const verifyLawyer = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role !== "lawyer") {
      return res.status(403).send("Forbidden");
    }

    const lawyer = await lawyerModel.findOne({ userID: user._id });
    if (!lawyer) {
      return res.status(403).json({ message: "Không tìm thấy hồ sơ luật sư" });
    }

    req.lawyer = lawyer;
    next();
  } catch (error) {
    console.error("verifyLawyer error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
module.exports = verifyLawyer;