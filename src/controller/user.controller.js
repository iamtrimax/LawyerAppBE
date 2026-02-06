const userModel = require("../model/user.model");
const { userRegister, verifyEmail, userLogin, searchLawyerByCategory, getLawyerScheduleByLawyerId, createBooking, getUserBookings, getBookingDetail, updateUserProfile, changePassword, checkAccountExists, resetPassword, verifyForgotPasswordOTP, cancelBooking } = require("../services/user.services");
const generateToken = require("../utils/generateToken");

const userRegisterController = async (req, res) => {
  const { fullname, email, password, phone, role } = req.body;
  // Logic để đăng ký người dùng
  if (!fullname || !email || !password) {
    return res
      .status(400)
      .json({ error: "Vui lòng cung cấp đầy đủ thông tin" });
  }
  try {
    const newUser = await userRegister({ fullname, email, password, phone, role });
    res.status(201).json({
      message: "Người dùng đã được đăng ký thành công",
      userId: newUser._id,
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};
const verifyEmailController = async (req, res) => {
  const { email, otp, role } = req.body;
  const user = await verifyEmail(email, otp, role);
  res.status(200).json({
    message: "Xác minh email thành công",
    userId: user._id,
    success: true,
  });
};
const loginController = async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ thông tin" });
  }
  try {
    const user = await userLogin({ email, password, role });
    res.status(200).json({
      message: "Đăng nhập thành công",
      user: { ...user.userRes },
      success: true,
      accessToken: user.accessToken,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}
const updateToken = async (req, res) => {
  const { userId, token } = req.body;
  try {
    await userModel.findByIdAndUpdate(userId, { expoPushToken: token });
    res.status(200).json({ message: "Cập nhật Token thành công" });
  } catch (error) {
    res.status(500).json({ message: "Lỗi Server" });
  }
};
const searchLawyerByCategoryController = async (req, res) => {
  try {
    const { specialization } = req.query;
    let query = {}

    if (specialization && specialization !== 'Tất cả') {
      query.specialty = specialization;
      query.isApproved = true;
    } else {
      query.isApproved = true;
    }
    const lawyers = await searchLawyerByCategory(query);
    res.status(200).json({
      success: true,
      data: lawyers
    });
  } catch (error) {
    console.error("Lỗi tại searchLawyerByCategoryController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
    });
  }
};

const checkAccountExistsController = async (req, res) => {
  const { email, role } = req.body;
  if (!email || !role) {
    return res.status(400).json({ error: "Vui lòng cung cấp đầy đủ email và vai trò" });
  }

  try {
    await checkAccountExists(email, role);
    res.status(200).json({
      success: true,
      message: "Tài khoản tồn tại. Mã OTP đã được gửi về email của bạn."
    });
  } catch (error) {
    console.error("Lỗi tại checkAccountExistsController:", error);
    return res.status(404).json({
      success: false,
      message: error.message || "Lỗi server nội bộ"
    });
  }
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
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
      message: error.message || "Lỗi server nội bộ"
    });
  }
};

module.exports = {
  userRegisterController,
  verifyEmailController,
  loginController,
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
  cancelBookingController
};