const mongoose = require("mongoose");
const lawyerSchema = new mongoose.Schema({
  userID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  avatar: {
    type: String,
    required: true,
  },
  lawyerId: {
    type: String,
    required: true,
    unique: true,
  },
  specialty: {
    type: String,
    required: true,
  },
  firmName: {
    type: String,
    required: true,
  },
  lawyerCardImage: {
    type: String,
    required: true,
  },
  isApproved: {
    type: Boolean,
    default: false,
  },
  isCollaborator: {
    type: Boolean,
    default: false,
  },
  commissionRate: {
    type: Number,
    default: 0, // % nền tảng giữ lại
  },
  bankInfo: {
    bankName: String,
    accountNumber: String,
    accountName: String,
  },
});
module.exports = mongoose.model("Lawyer", lawyerSchema);
