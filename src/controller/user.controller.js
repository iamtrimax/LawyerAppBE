const userModel = require("../model/user.model");
const { userRegister, verifyEmail, userLogin, googleLogin, searchLawyerByCategory, getLawyerScheduleByLawyerId, createBooking, getUserBookings, getBookingDetail, updateUserProfile, changePassword, checkAccountExists, resetPassword, verifyForgotPasswordOTP, cancelBooking, abortBookingPayment, getUserProfile, getReferralHistory } = require("../services/user.services");
const generateToken = require("../utils/generateToken");
const sanitizeError = require("../utils/sanitizeError");

const userRegisterController = async (req, res) => {
  const { fullname, email, password, phone, role, referralCode, legalInterest } = req.body;
  // Logic để đăng ký người dùng
  if (!fullname || !email || !password) {
    return res
      .status(400)
      .json({ error: "Vui lòng cung cấp đầy đủ thông tin" });
  }
  try {
    const newUser = await userRegister({ fullname, email, password, phone, role, referralCode, legalInterest });
    res.status(201).json({
      message: "Người dùng đã được đăng ký thành công",
      userId: newUser._id,
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ message: sanitizeError(error) });
  }
};
const verifyEmailController = async (req, res) => {
  const { email, otp, role } = req.body;
  try {
    const user = await verifyEmail(email, otp, role);
    res.status(200).json({
      message: "Xác minh email thành công",
      userId: user._id,
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ message: sanitizeError(error) });  
  }
};
const loginController = async (req, res) => {
  const { email, phone, password, role } = req.body;
  const identifier = email || phone;

  if (!identifier || !password || !role) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ thông tin (Email/Số điện thoại, mật khẩu và vai trò)" });
  }
  try {
    const user = await userLogin({ identifier, password, role });
    res.status(200).json({
      message: "Đăng nhập thành công",
      user: { ...user.userRes },
      success: true,
      accessToken: user.accessToken,
    });
  } catch (error) {
    return res.status(400).json({ message: sanitizeError(error) });
  }
}
const updateToken = async (req, res) => {
  // Chỉ cho phép cập nhật token của chính user đang đăng nhập (req.userId từ verifyAccessToken)
  const userId = req.userId;
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ message: "Token không hợp lệ" });
  }
  try {
    await userModel.findByIdAndUpdate(userId, { expoPushToken: token.trim() });
    res.status(200).json({ message: "Cập nhật Token thành công" });
  } catch (error) {
    console.error("Lỗi tại updateToken:", error);
    res.status(500).json({ message: "Lỗi Server" });
  }
};
const searchLawyerByCategoryController = async (req, res) => {
  try {
    // Ép kiểu chuỗi để chặn NoSQL injection qua query param dạng object ($ne, $regex...)
    const { specialization, province } = req.query;
    const spec = typeof specialization === 'string' ? specialization.trim() : undefined;
    const prov = typeof province === 'string' ? province.trim() : undefined;
    let query = {}

    if (spec && spec !== 'Tất cả') {
      query.specialty = spec;
    }
    
    if (prov && prov !== 'Tất cả') {
      query.operatingProvinces = prov;
    }

    query.isApproved = true;
    
    const lawyers = await searchLawyerByCategory(query);
    res.status(200).json({
      success: true,
      data: lawyers
    });
  } catch (error) {
    console.error("Lỗi tại searchLawyerByCategoryController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
}
const getLawyerScheduleByIdController = async (req, res) => {
  const { lawyerId } = req.params;
  try {
    const schedule = await getLawyerScheduleByLawyerId(lawyerId);
    res.status(200).json({
      success: true,
      data: schedule ? schedule.workingDays : []
    });
  } catch (error) {
    console.error("Lỗi tại getLawyerScheduleByIdController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
}

const createBookingController = async (req, res) => {
  const userId = req.userId; // Lấy từ middleware verifyAccessToken
  const { lawyerId, date, timeSlot, price, paymentStatus, addressMeeting, documents, actualPhone } = req.body;

  try {
    const booking = await createBooking({
      userId,
      lawyerId,
      date,
      timeSlot,
      price,
      paymentStatus,
      addressMeeting,
      documents,
      actualPhone
    });

    res.status(201).json({
      success: true,
      message: "Đặt lịch thành công",
      booking
    });
  } catch (error) {
    console.error("Lỗi tại createBookingController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const getUserBookingsController = async (req, res) => {
  const userId = req.userId;
  try {
    const bookings = await getUserBookings(userId);
    res.status(200).json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error("Lỗi tại getUserBookingsController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const getBookingDetailController = async (req, res) => {
  const userId = req.userId;
  const { bookingId } = req.params;
  try {
    const booking = await getBookingDetail(bookingId, userId);
    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error("Lỗi tại getBookingDetailController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const updateUserProfileController = async (req, res) => {
  const userId = req.userId;
  const { fullname, phone } = req.body;
  try {
    const updatedUser = await updateUserProfile(userId, { fullname, phone });
    res.status(200).json({
      success: true,
      message: "Cập nhật thông tin thành công",
      data: updatedUser
    });
  } catch (error) {
    console.error("Lỗi tại updateUserProfileController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const changePasswordController = async (req, res) => {
  const userId = req.userId;
  const { oldPassword, newPassword, confirmPassword } = req.body;

  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ thông tin" });
  }

  try {
    const user = await changePassword(userId, oldPassword, newPassword, confirmPassword);

    // Tạo token mới sau khi đổi mật khẩu để giữ login
    const accessToken = generateToken(user, "7d");
    const refreshToken = generateToken(user, "14d");

    // Lưu refresh token mới vào DB
    user.refreshTokens = refreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Đổi mật khẩu thành công",
      user: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error("Lỗi tại changePasswordController:", error);
    return res.status(400).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const checkAccountExistsController = async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ email và vai trò" });
  }

  // Luôn trả về 200 với thông báo giống nhau dù email có tồn tại hay không
  // để chống user enumeration (service checkAccountExists đã ép kiểu chuỗi chặn NoSQL)
  try {
    await checkAccountExists(email, role);
  } catch (error) {
    console.error("Lỗi tại checkAccountExistsController:", error);
  }

  res.status(200).json({
    success: true,
    message: "Nếu email tồn tại, mã OTP đã được gửi về email của bạn."
  });
};

const resetPasswordController = async (req, res) => {
  const { email, otp, newPassword, confirmPassword, role } = req.body;
  if (!email || !otp || !newPassword || !confirmPassword || !role) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ thông tin (bao gồm mã OTP và vai trò)" });
  }

  try {
    await resetPassword(email, otp, newPassword, confirmPassword, role);
    res.status(200).json({
      success: true,
      message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
    });
  } catch (error) {
    console.error("Lỗi tại resetPasswordController:", error);
    return res.status(400).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const verifyForgotPasswordOTPController = async (req, res) => {
  const { email, otp, role } = req.body;
  if (!email || !otp || !role) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ email, mã OTP và vai trò" });
  }

  try {
    await verifyForgotPasswordOTP(email, otp, role);
    res.status(200).json({
      success: true,
      message: "Xác thực mã OTP thành công"
    });
  } catch (error) {
    console.error("Lỗi tại verifyForgotPasswordOTPController:", error);
    return res.status(400).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const cancelBookingController = async (req, res) => {
  const userId = req.userId;
  const { bookingId } = req.params;
  const { cancelReason, bankAccount, bankName } = req.body;

  try {
    const result = await cancelBooking(bookingId, userId, cancelReason, bankAccount, bankName);

    res.status(200).json({
      success: true,
      message: "Huỷ lịch hẹn thành công",
      data: {
        booking: result.booking,
        refundInfo: result.refundInfo
      }
    });
  } catch (error) {
    console.error("Lỗi tại cancelBookingController:", error);

    // Xác định status code dựa trên loại lỗi
    let statusCode = 500;
    if (error.message.includes("không có quyền")) {
      statusCode = 403;
    } else if (error.message.includes("Không tìm thấy") ||
      error.message.includes("đã được huỷ") ||
      error.message.includes("đã hoàn thành")) {
      statusCode = 400;
    }

    return res.status(statusCode).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const getUserProfileController = async (req, res) => {
  const userId = req.userId;
  try {
    const user = await getUserProfile(userId);
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error("Lỗi tại getUserProfileController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

const getReferralHistoryController = async (req, res) => {
  const userId = req.userId;
  try {
    const referrals = await getReferralHistory(userId);
    res.status(200).json({
      success: true,
      data: referrals
    });
  } catch (error) {
    console.error("Lỗi tại getReferralHistoryController:", error);
    return res.status(500).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};


const googleLoginController = async (req, res) => {
  const { email, fullname, googleId, avatar, role } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email là bắt buộc" });
  }

  try {
    const result = await googleLogin({ email, fullname, googleId, avatar, role });
    
    if (result.isNewUser) {
      return res.status(200).json({
        success: true,
        isNewUser: true,
        message: "Vui lòng hoàn tất hồ sơ năng lực luật sư",
        user: { 
          email: result.email, 
          fullname: result.fullname, 
          googleId: result.googleId, 
          avatar: result.avatar,
          role: result.role
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Đăng nhập bằng Google thành công",
      user: result.userRes,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: sanitizeError(error),
      isNewUser: error.isNewUser || false
    });
  }
};

const abortBookingPaymentController = async (req, res) => {
  const userId = req.userId;
  const { bookingId } = req.params;

  try {
    await abortBookingPayment(bookingId, userId);
    res.status(200).json({
      success: true,
      message: "Đã huỷ giao dịch đặt lịch"
    });
  } catch (error) {
    console.error("Lỗi tại abortBookingPaymentController:", error);
    return res.status(400).json({
      success: false,
      message: sanitizeError(error)
    });
  }
};

module.exports = {
  userRegisterController,
  verifyEmailController,
  loginController,
  googleLoginController,
  updateToken,
  searchLawyerByCategoryController,
  getLawyerScheduleByIdController,
  createBookingController,
  getUserBookingsController,
  getBookingDetailController,
  updateUserProfileController,
  changePasswordController,
  checkAccountExistsController,
  resetPasswordController,
  verifyForgotPasswordOTPController,
  cancelBookingController,
  abortBookingPaymentController,
  getUserProfileController,
  getReferralHistoryController
};
