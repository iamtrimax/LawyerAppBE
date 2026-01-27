const lawyerModel = require("../model/lawyer.model");
const scheduleModel = require("../model/schedule.model");
const userModel = require("../model/user.model");
const bookingModel = require("../model/booking.model");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/sendEmail");
const bcrypt = require("bcryptjs");
const client = require("../config/redis");
const userRegister = async (userData) => {
  const { email, fullname, password, phone } = userData;
  const userExists = await userModel.findOne({ email });

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  if (userExists) {
    if (userExists.isVerified) {
      throw new Error("Tài khoản đã tồn tại");
    }
    userExists.fullname = fullname;
    userExists.password = hashedPassword;
    userExists.phone = phone;
    userExists.otp = otp;
    await userExists.save();
    sendEmail(email, "Xác minh tài khoản", `Mã OTP của bạn là: ${otp}`);
    return userExists;
  }

  const newUser = await userModel.create({
    email,
    fullname,
    password: hashedPassword,
    phone,
    otp,
  });

  sendEmail(email, "Xác minh tài khoản", `Mã OTP của bạn là: ${otp}`);

  return newUser;
};

const verifyEmail = async (email, otp) => {
  // Tìm user trong bảng User (vì cả customer và lawyer đều lưu ở đây)
  const user = await userModel.findOne({ email });

  if (!user) {
    throw new Error("Tài khoản không tồn tại");
  }

  // 1. Kiểm tra OTP
  if (!user.otp || user.otp !== otp) {
    throw new Error("Mã OTP không chính xác hoặc đã hết hạn");
  }

  // 2. Cập nhật trạng thái xác thực
  user.isVerified = true;
  user.otp = ""; // Xóa OTP sau khi dùng xong

  await user.save();

  // 3. Nếu là luật sư, bạn có thể lấy thêm thông tin profile nếu cần
  if (user.role === "lawyer") {
    const lawyerProfile = await lawyerModel.findOne({ userID: user._id });
    return {
      user,
      lawyerProfile,
      message:
        "Xác minh tài khoản luật sư thành công. Vui lòng đợi Admin phê duyệt hồ sơ.",
    };
  }

  return {
    user,
    message: "Xác minh tài khoản thành công.",
  };
};
const userLogin = async (userData) => {
  const { email, password, role } = userData;

  // 1. Tìm User theo email trước (áp dụng cho cả lawyer và customer)
  const user = await userModel.findOne({ email });
  if (!user) throw new Error("Email hoặc mật khẩu không đúng");

  // 2. Kiểm tra mật khẩu ngay
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new Error("Email hoặc mật khẩu không đúng");

  // 3. Xử lý riêng cho Lawyer
  if (role === "lawyer") {
    if (user.role !== "lawyer") throw new Error("Tài khoản không có quyền truy cập này");

    // Tìm profile luật sư dựa trên ID của user vừa tìm được
    const lawyerProfile = await lawyerModel.findOne({ userID: user._id });

    if (!lawyerProfile) throw new Error("Không tìm thấy hồ sơ luật sư");

    // Tạo Token
    const accessToken = generateToken(user, "7d");
    const refreshToken = generateToken(user, "14d");
    user.refreshTokens = refreshToken;
    await user.save();

    // PHẲNG HÓA DỮ LIỆU
    const userRes = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      role: "lawyer",
      isApproved: lawyerProfile.isApproved, // Chắc chắn sẽ có vì tìm đúng lawyerProfile của user này
      profileId: lawyerProfile._id,
      avatar: lawyerProfile.avatar // Thêm avatar nếu cần
    };

    return { userRes, accessToken, refreshToken };

  } else {
    // 4. Đối với Customer
    if (user.role !== "customer") throw new Error("Email hoặc mật khẩu không đúng");

    const accessToken = generateToken(user, "7d");
    const refreshToken = generateToken(user, "14d");

    const userRes = user.toObject();
    delete userRes.password;
    delete userRes.refreshTokens;

    return { userRes, accessToken, refreshToken };
  }
};
const searchLawyerByCategory = async (query) => {
  const key = `lawyer_search:${JSON.stringify(query)}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);

  const lawyers = await lawyerModel.find(query).populate('userID', '-password -otp -__v');
  await client.set(key, JSON.stringify(lawyers), { EX: 300 });
  return lawyers;
}
const getLawyerScheduleByLawyerId = async (lawyerId) => {
  const key = `lawyer_schedule_id:${lawyerId}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);

  const schedule = await scheduleModel.findOne({ lawyerID: lawyerId });
  await client.set(key, JSON.stringify(schedule), { EX: 3600 });
  return schedule;
}

const createBooking = async ({ userId, lawyerId, date, timeSlot, price, paymentStatus, addressMeeting, documents, actualPhone }) => {
  // 1. Kiểm tra tính hợp lệ (cơ bản)
  if (!userId || !lawyerId || !date || !timeSlot || !actualPhone) {
    throw new Error("Thiếu thông tin đặt lịch (Số điện thoại liên hệ là bắt buộc)");
  }

  // 2. Validate time slot
  if (!timeSlot.start || !timeSlot.end) {
    throw new Error("Thông tin time slot không hợp lệ");
  }

  // 3. Kiểm tra xem slot đã được đặt chưa (application-level check)
  // Chỉ kiểm tra các booking chưa bị hủy
  const existingSlotBooking = await bookingModel.findOne({
    lawyerID: lawyerId,
    date: date,
    'timeSlot.start': timeSlot.start,
    'timeSlot.end': timeSlot.end,
    status: { $ne: 'Cancelled' } // Không tính các booking đã hủy
  });

  if (existingSlotBooking) {
    throw new Error("Slot thời gian này đã được đặt. Vui lòng chọn slot khác.");
  }

  // 3.1 Kiểm tra xem user đã đặt luật sư này trong ngày này chưa
  const existingUserBookingForDay = await bookingModel.findOne({
    userID: userId,
    lawyerID: lawyerId,
    date: date,
    status: { $ne: 'Cancelled' }
  });

  if (existingUserBookingForDay) {
    throw new Error("Bạn đã đặt lịch với luật sư này trong ngày hôm nay rồi. Vui lòng chọn ngày khác hoặc luật sư khác.");
  }

  try {
    // 4. Tạo Booking mới
    const newBooking = await bookingModel.create({
      userID: userId,
      lawyerID: lawyerId,
      date: date,
      timeSlot: timeSlot,
      price: price || 0,
      paymentStatus: paymentStatus || 'Unpaid',
      status: 'Pending',
      addressMeeting: addressMeeting || '',
      documents: documents || [],
      actualPhone: actualPhone
    });

    // Xóa cache danh sách cuộc hẹn của user
    await client.del(`user_bookings:${userId}`);

    // Gửi email thông báo (Placeholder)
    // await sendEmail(userEmail, "Đặt lịch thành công", "...");

    return newBooking;
  } catch (error) {
    // 5. Xử lý lỗi duplicate key (race condition)
    // Khi 2 request đồng thời vượt qua bước check, database sẽ reject request thứ 2
    if (error.code === 11000) {
      throw new Error("Slot thời gian này đã được đặt. Vui lòng chọn slot khác.");
    }
    throw error;
  }
};

const getUserBookings = async (userId) => {
  try {
    const key = `user_bookings:${userId}`;
    const cached = await client.get(key);
    if (cached) return JSON.parse(cached);

    const bookings = await bookingModel.find({ userID: userId })
      .populate({
        path: 'lawyerID',
        populate: {
          path: 'userID',
          select: 'fullname email phone'
        }
      })
      .sort({ createdAt: -1 });

    await client.set(key, JSON.stringify(bookings), { EX: 600 }); // Cache trong 10 phút
    return bookings;
  } catch (error) {
    throw new Error("Không thể lấy danh sách cuộc hẹn: " + error.message);
  }
};

const getBookingDetail = async (bookingId, userId) => {
  try {
    const key = `booking_detail:${bookingId}`;
    const cached = await client.get(key);
    if (cached) {
      const booking = JSON.parse(cached);
      // Kiểm tra quyền sở hữu từ cache
      if (booking.userID !== userId && booking.userID._id !== userId) {
        // Nếu không khớp userId, xóa cache và fetch lại từ DB để đảm bảo bảo mật
        await client.del(key);
      } else {
        return booking;
      }
    }

    const booking = await bookingModel.findOne({ _id: bookingId, userID: userId })
      .populate({
        path: 'lawyerID',
        populate: {
          path: 'userID',
          select: 'fullname email phone'
        }
      });

    if (!booking) {
      throw new Error("Không tìm thấy thông tin cuộc hẹn hoặc bạn không có quyền truy cập");
    }

    await client.set(key, JSON.stringify(booking), { EX: 3600 }); // Cache trong 1 giờ
    return booking;
  } catch (error) {
    throw new Error("Không thể lấy chi tiết cuộc hẹn: " + error.message);
  }
};

const updateUserProfile = async (userId, updateData) => {
  const { fullname, phone } = updateData;
  const updatedUser = await userModel.findByIdAndUpdate(
    userId,
    { fullname, phone },
    { new: true, runValidators: true }
  ).select('fullname email phone role');

  if (!updatedUser) {
    throw new Error("Người dùng không tồn tại");
  }
  return updatedUser;
};

const changePassword = async (userId, oldPassword, newPassword, confirmPassword) => {
  if (newPassword !== confirmPassword) {
    throw new Error("Mật khẩu mới và xác nhận mật khẩu không khớp");
  }

  const user = await userModel.findById(userId);
  if (!user) {
    throw new Error("Người dùng không tồn tại");
  }

  const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
  if (!isPasswordValid) {
    throw new Error("Mật khẩu cũ không chính xác");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  user.password = hashedPassword;
  user.passwordChangedAt = Date.now();
  user.refreshTokens = ""; // Revoke refresh token
  await user.save();

  return user;
};

const checkAccountExists = async (email, role) => {
  const user = await userModel.findOne({ email, role });
  if (!user || !user.isVerified) {
    throw new Error("Tài khoản không tồn tại hoặc chưa được xác minh");
  }

  // Tạo OTP ngẫu nhiên 6 chữ số
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Lưu OTP vào user model
  user.otp = otp;
  await user.save();

  // Gửi email chứa OTP
  try {
    await sendEmail(email, "Mã OTP đặt lại mật khẩu", `Mã OTP của bạn là: ${otp}. Mã này dùng để xác nhận việc đặt lại mật khẩu.`);
  } catch (error) {
    console.error("Lỗi khi gửi email OTP:", error);
    throw new Error("Không thể gửi email OTP. Vui lòng thử lại sau.");
  }

  return user;
};

const verifyForgotPasswordOTP = async (email, otp, role) => {
  const user = await userModel.findOne({ email, role });
  if (!user || !user.isVerified) {
    throw new Error("Tài khoản không tồn tại");
  }

  if (!user.otp || user.otp !== otp) {
    throw new Error("Mã OTP không chính xác hoặc đã hết hạn");
  }

  return true; // Không xóa OTP ở đây để bước Reset dùng tiếp
};

const resetPassword = async (email, otp, newPassword, confirmPassword, role) => {
  if (newPassword !== confirmPassword) {
    throw new Error("Mật khẩu mới và xác nhận mật khẩu không khớp");
  }

  const user = await userModel.findOne({ email, role });
  if (!user || !user.isVerified) {
    throw new Error("Tài khoản không tồn tại");
  }

  // Xác thực OTP
  if (!user.otp || user.otp !== otp) {
    throw new Error("Mã OTP không chính xác hoặc đã hết hạn");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  user.password = hashedPassword;
  user.passwordChangedAt = Date.now();
  user.refreshTokens = ""; // Revoke all refresh tokens
  user.otp = ""; // Xóa OTP sau khi dùng xong
  await user.save();

  return true;
};

/**
 * Huỷ lịch hẹn với chính sách hoàn tiền
 * - Huỷ >= 2 ngày trước: hoàn 100%
 * - Huỷ 1-2 ngày trước: hoàn 50%
 * - Huỷ < 1 ngày trước: không hoàn tiền
 */
const refundModel = require("../model/refund.model");

const cancelBooking = async (bookingId, userId, cancelReason, bankAccount = '', bankName = '') => {
  try {
    // 1. Tìm booking và kiểm tra quyền sở hữu
    const booking = await bookingModel.findById(bookingId);

    if (!booking) {
      throw new Error("Không tìm thấy lịch hẹn");
    }

    if (booking.userID.toString() !== userId.toString()) {
      throw new Error("Bạn không có quyền huỷ lịch hẹn này");
    }

    if (booking.status === 'Cancelled') {
      throw new Error("Lịch hẹn này đã được huỷ trước đó");
    }

    if (booking.status === 'Completed') {
      throw new Error("Không thể huỷ lịch hẹn đã hoàn thành");
    }

    // 2. Tính số ngày còn lại đến cuộc hẹn
    const appointmentDate = new Date(`${booking.date}T${booking.timeSlot.start}:00`);
    const now = new Date();
    const timeDifference = appointmentDate.getTime() - now.getTime();
    const daysUntilAppointment = timeDifference / (1000 * 60 * 60 * 24);

    // 3. Xác định phần trăm hoàn tiền theo chính sách
    let refundPercentage = 0;
    let refundReason = '';

    if (daysUntilAppointment >= 2) {
      refundPercentage = 100;
      refundReason = 'Huỷ trước 2 ngày - hoàn 100%';
    } else if (daysUntilAppointment >= 1) {
      refundPercentage = 50;
      refundReason = 'Huỷ trước 1 ngày - hoàn 50%';
    } else {
      refundPercentage = 0;
      refundReason = 'Huỷ muộn - không hoàn tiền';
    }

    // 4. Tính số tiền hoàn lại
    const originalAmount = booking.price || 0;
    const refundAmount = (originalAmount * refundPercentage) / 100;

    // 5. Tự động lấy thông tin ngân hàng nếu chưa có
    let finalBankAccount = bankAccount;
    let finalBankName = bankName;

    if (!finalBankAccount && booking.paymentInfo) {
      // Ưu tiên lấy từ trường đã lưu (nếu SePay có phân tích sẵn)
      finalBankAccount = booking.paymentInfo.senderAccount;
      finalBankName = booking.paymentInfo.senderName || booking.paymentInfo.gateway;

      // Fallback: Nếu không có senderAccount, thử tìm trong description bằng Regex
      if (!finalBankAccount && booking.paymentInfo.description) {
        const accRegex = /\b\d{8,15}\b/g; // Tìm tất cả các chuỗi số từ 8-15 chữ số
        const matches = booking.paymentInfo.description.match(accRegex);

        if (matches) {
          // Lấy số tài khoản nhận tiền (của mình) để so sánh
          const merchantAccount = booking.paymentInfo.fullWebhookData?.accountNumber;

          // Tìm số tài khoản nào KHÁC với số tài khoản của merchant
          const possibleSenderAcc = matches.find(acc => acc !== merchantAccount);

          if (possibleSenderAcc) {
            finalBankAccount = possibleSenderAcc;
            console.log("Extracted potential sender account:", finalBankAccount);
          }
        }
      }
    }

    // 6. Cập nhật trạng thái booking
    booking.status = 'Cancelled';
    booking.cancelReason = cancelReason;

    // Chỉ cập nhật paymentStatus nếu đã thanh toán và có hoàn tiền
    if (booking.paymentStatus === 'Paid' && refundAmount > 0) {
      booking.paymentStatus = 'Refunded';
    }

    await booking.save();

    // 7. Tạo refund record nếu có hoàn tiền (và đã thanh toán)
    let refundRecord = null;
    if (booking.paymentStatus === 'Refunded' && refundAmount > 0) {
      refundRecord = await refundModel.create({
        bookingID: bookingId,
        userID: userId,
        originalAmount: originalAmount,
        refundAmount: refundAmount,
        refundPercentage: refundPercentage,
        refundReason: refundReason,
        bankAccount: finalBankAccount,
        bankName: finalBankName,
        status: 'Pending'
      });
    }

    // 8. Xóa cache Redis
    await Promise.all([
      client.del(`user_bookings:${userId}`),
      client.del(`booking_detail:${bookingId}`),
      client.del(`lawyer_bookings:${booking.lawyerID}`),
      client.del(`lawyer_booking_detail:${bookingId}`)
    ]);

    return {
      booking,
      refundInfo: {
        originalAmount,
        refundAmount,
        refundPercentage,
        refundReason,
        refundRecord: refundRecord ? refundRecord._id : null
      }
    };
  } catch (error) {
    throw new Error("Không thể huỷ lịch hẹn: " + error.message);
  }
};

module.exports = {
  userRegister,
  verifyEmail,
  userLogin,
  searchLawyerByCategory,
  getLawyerScheduleByLawyerId,
  createBooking,
  getUserBookings,
  getBookingDetail,
  updateUserProfile,
  changePassword,
  checkAccountExists,
  verifyForgotPasswordOTP,
  resetPassword,
  cancelBooking
};