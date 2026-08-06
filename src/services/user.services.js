const lawyerModel = require("../model/lawyer.model");
const scheduleModel = require("../model/schedule.model");
const userModel = require("../model/user.model");
const bookingModel = require("../model/booking.model");
const generateToken = require("../utils/generateToken");
const sendEmail = require("../utils/sendEmail");
const bcrypt = require("bcryptjs");
const client = require("../config/redis");
const sanitizeError = require("../utils/sanitizeError");

// Ép kiểu an toàn: chặn NoSQL injection khi client gửi object (vd: { $ne: "" })
// thay cho chuỗi ở các trường email/phone/otp/password...
const toStr = (value) => (typeof value === 'string' ? value : '');
const toEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const userRegister = async (userData) => {
  const email = toEmail(userData.email);
  const fullname = toStr(userData.fullname).trim();
  const password = toStr(userData.password);
  const phone = toStr(userData.phone).trim();
  const role = toStr(userData.role);
  const referralCode = toStr(userData.referralCode).trim();
  const legalInterest = toStr(userData.legalInterest);

  if (!email || !fullname || !password) {
    throw new Error("Vui lòng cung cấp đầy đủ thông tin");
  }

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
    userExists.legalInterest = legalInterest || "";
    if (role) userExists.role = role;
    if (referralCode && !userExists.referredBy) {
      const referrer = await userModel.findOne({ phone: referralCode });
      if (referrer) {
        userExists.referredBy = referrer._id;
      }
    }
    await userExists.save();
    sendEmail(email, "Xác minh tài khoản", `Mã OTP của bạn là: ${otp}`);
    return userExists;
  }

  let referredBy = null;
  if (referralCode) {
    const referrer = await userModel.findOne({ phone: referralCode });
    if (referrer) {
      referredBy = referrer._id;
    }
  }

  const newUser = await userModel.create({
    email,
    fullname,
    password: hashedPassword,
    phone,
    otp,
    role: role || 'customer',
    legalInterest: legalInterest || "",
    referredBy
  });

  sendEmail(email, "Xác minh tài khoản", `Mã OTP của bạn là: ${otp}`);

  return newUser;
};

const verifyEmail = async (email, otp) => {
  // Ép kiểu chuỗi để chặn NoSQL injection (email dạng object như { $ne: "" })
  email = toEmail(email);
  otp = toStr(otp).trim();

  // Tìm user trong bảng User (vì cả customer và lawyer đều lưu ở đây)
  const user = await userModel.findOne({ email });

  // 1. Kiểm tra OTP - thông báo giống nhau cho cả user không tồn tại và OTP sai
  // để chống user enumeration
  if (!user || !user.otp || user.otp !== otp) {
    throw new Error("Mã OTP không chính xác hoặc đã hết hạn");
  }

  // 2. Cập nhật trạng thái xác thực
  user.isVerified = true;
  user.otp = ""; // Xóa OTP sau khi dùng xong

  await user.save();

  // 2.1 Cộng điểm cho người giới thiệu nếu có
  if (user.referredBy) {
    const referrer = await userModel.findById(user.referredBy);
    if (referrer) {
      referrer.points += 100; // Cộng 100 điểm cho người giới thiệu
      await referrer.save();
      await updateUserRank(referrer._id); // Cập nhật hạng sau khi cộng điểm
    }
  }

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
  // Ép kiểu chuỗi để chặn NoSQL injection (identifier/password/role dạng object)
  const identifier = toEmail(userData.identifier);
  const password = toStr(userData.password);
  const role = toStr(userData.role);

  if (!identifier || !password || !role) {
    throw new Error("Email/Số điện thoại hoặc mật khẩu không đúng hoặc vai trò không hợp lệ");
  }

  // 1. Tìm User theo email hoặc phone và role để đảm bảo đăng nhập đúng cổng
  const user = await userModel.findOne({
    $or: [{ email: identifier }, { phone: identifier }],
    role
  });
  if (!user) throw new Error("Email/Số điện thoại hoặc mật khẩu không đúng hoặc vai trò không hợp lệ");

  if (user.isActived === false) {
    const error = new Error("Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.");
    error.statusCode = 403;
    throw error;
  }

  // 2. Kiểm tra mật khẩu - thông báo giống hệt trường hợp không tìm thấy user
  // để chống user enumeration qua login
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new Error("Email/Số điện thoại hoặc mật khẩu không đúng hoặc vai trò không hợp lệ");

  // 3. Xử lý riêng cho Lawyer
  if (role === "lawyer") {
    // Tìm profile luật sư dựa trên ID của user vừa tìm được
    const lawyerProfile = await lawyerModel.findOne({ userID: user._id });

    if (!lawyerProfile) throw new Error("Không tìm thấy hồ sơ luật sư");

    // Tạo Token
    const accessToken = generateToken(user, "7d");
    const refreshToken = generateToken(user, "14d");
    user.refreshTokens = refreshToken;
    await user.save();

    // PHẲNG HÓA DỮ LIỆU: Trả về toàn bộ thông tin user và profile (trừ password, refreshTokens, otp)
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.refreshTokens;
    delete userObj.otp;

    const profileObj = lawyerProfile.toObject();

    const userRes = {
      ...userObj,
      ...profileObj,
      profileId: profileObj._id, // Giữ lại profileId cho tính tương thích
      _id: user._id // Đảm bảo _id là của User
    };

    return { userRes, accessToken, refreshToken };

  } else {
    // 4. Đối với các vai trò khác (customer, member, admin)
    // Đã lọc theo role ở bước findOne nên không cần kiểm tra lại user.role ở đây
    const accessToken = generateToken(user, "7d");
    const refreshToken = generateToken(user, "14d");

    const userRes = user.toObject();
    // Xóa dữ liệu nhạy cảm trước khi trả về client (tránh lộ password hash)
    delete userRes.password;
    delete userRes.refreshTokens;
    delete userRes.otp;

    return { userRes, accessToken, refreshToken };
  }
};
// CHỈ các trường công khai cần hiển thị.
// TUYỆT ĐỐI không trả refreshTokens, expoPushToken, googleId, referredBy, points...
const PUBLIC_USER_FIELDS = 'fullname email phone avatar role isVerified isActived';

const searchLawyerByCategory = async (query) => {
  const key = `lawyer_search:${JSON.stringify(query)}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);

  const lawyers = await lawyerModel
    .find(query)
    .select('-__v')
    .populate('userID', PUBLIC_USER_FIELDS)
    .lean();
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
  // Ép kiểu an toàn để chặn NoSQL injection (timeSlot dạng object chứa $ne/$regex...)
  date = toStr(date);
  actualPhone = toStr(actualPhone).trim();
  addressMeeting = toStr(addressMeeting);

  // 1. Kiểm tra tính hợp lệ (cơ bản)
  if (!userId || !lawyerId || !date || !timeSlot || !actualPhone) {
    throw new Error("Thiếu thông tin đặt lịch (Số điện thoại liên hệ là bắt buộc)");
  }

  // 2. Validate time slot: phải là object thường với start/end là chuỗi giờ
  if (typeof timeSlot !== 'object' || Array.isArray(timeSlot)) {
    throw new Error("Thông tin time slot không hợp lệ");
  }
  const safeSlot = {
    start: toStr(timeSlot.start),
    end: toStr(timeSlot.end)
  };
  if (!safeSlot.start || !safeSlot.end) {
    throw new Error("Thông tin time slot không hợp lệ");
  }

  // 3. Kiểm tra xem slot đã được đặt chưa (application-level check)
  // Chỉ kiểm tra các booking chưa bị hủy
  const existingSlotBooking = await bookingModel.findOne({
    lawyerID: lawyerId,
    date: date,
    'timeSlot.start': safeSlot.start,
    'timeSlot.end': safeSlot.end,
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
      timeSlot: safeSlot,
      price: price || 0,
      paymentStatus: paymentStatus || 'Unpaid',
      status: 'Pending',
      addressMeeting: addressMeeting || '',
      documents: documents || [],
      actualPhone: actualPhone
    });

    // Xóa cache danh sách cuộc hẹn của user
    await Promise.all([
      client.del(`user_bookings:${userId}`),
      client.del("admin_dashboard_stats")
    ]);

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
    // Không nối error.message trực tiếp (có thể chứa nội dung CastError/stack nội bộ)
    throw new Error("Không thể lấy danh sách cuộc hẹn: " + sanitizeError(error));
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
    // Không nối error.message trực tiếp (có thể chứa nội dung CastError/stack nội bộ)
    throw new Error("Không thể lấy chi tiết cuộc hẹn: " + sanitizeError(error));
  }
};

const updateUserProfile = async (userId, updateData) => {
  // Ép kiểu chuỗi để chặn NoSQL injection / mass-assignment qua body dạng object
  const fullname = toStr(updateData.fullname).trim();
  const phone = toStr(updateData.phone).trim();

  const updateFields = {};
  if (fullname) updateFields.fullname = fullname;
  if (phone) updateFields.phone = phone;

  const updatedUser = await userModel.findByIdAndUpdate(
    userId,
    updateFields,
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
  // Ép kiểu chuỗi để chặn NoSQL injection
  email = toEmail(email);
  role = toStr(role);

  const user = await userModel.findOne({ email, role });
  // KHÔNG throw khi tài khoản không tồn tại: trả về null để controller
  // phản hồi giống hệt trường hợp thành công => chống user enumeration
  if (!user || !user.isVerified) {
    return null;
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
  }

  return user;
};

const verifyForgotPasswordOTP = async (email, otp, role) => {
  // Ép kiểu chuỗi để chặn NoSQL injection
  email = toEmail(email);
  otp = toStr(otp).trim();
  role = toStr(role);

  const user = await userModel.findOne({ email, role });
  // Thông báo giống nhau cho mọi trường hợp để chống user enumeration
  if (!user || !user.isVerified || !user.otp || user.otp !== otp) {
    throw new Error("Mã OTP không chính xác hoặc đã hết hạn");
  }

  return true; // Không xóa OTP ở đây để bước Reset dùng tiếp
};

const resetPassword = async (email, otp, newPassword, confirmPassword, role) => {
  // Ép kiểu chuỗi để chặn NoSQL injection
  email = toEmail(email);
  otp = toStr(otp).trim();
  newPassword = toStr(newPassword);
  confirmPassword = toStr(confirmPassword);
  role = toStr(role);

  if (!email || !otp || !newPassword || !confirmPassword || !role) {
    throw new Error("Vui lòng cung cấp đầy đủ thông tin (bao gồm mã OTP và vai trò)");
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Mật khẩu mới và xác nhận mật khẩu không khớp");
  }

  const user = await userModel.findOne({ email, role });
  // Thông báo giống nhau cho mọi trường hợp để chống user enumeration
  if (!user || !user.isVerified || !user.otp || user.otp !== otp) {
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

    // Do NOT change paymentStatus to Refunded immediately.
    // It remains 'Paid' until the admin processes and confirms the refund.

    await booking.save();

    // 7. Tạo refund record nếu có hoàn tiền (và đã thanh toán)
    let refundRecord = null;
    if (booking.paymentStatus === 'Paid' && refundAmount > 0) {
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
      client.del(`lawyer_booking_detail:${bookingId}`),
      client.del("admin_dashboard_stats")
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
    throw new Error("Không thể huỷ lịch hẹn: " + sanitizeError(error));
  }
};

const updateUserRank = async (userId) => {
  const user = await userModel.findById(userId);
  if (!user) return;

  let newRank = 'Bạc';
  const points = user.points;

  if (points >= 20000) {
    newRank = 'Kim cương';
  } else if (points >= 5000) {
    newRank = 'Bạch kim';
  } else if (points >= 1000) {
    newRank = 'Vàng';
  } else {
    newRank = 'Bạc';
  }

  if (user.rank !== newRank) {
    user.rank = newRank;
    await user.save();
  }
};

const getUserProfile = async (userId) => {
  const user = await userModel.findById(userId).select('-password -otp -refreshTokens');
  if (!user) {
    throw new Error("Người dùng không tồn tại");
  }

  if (user.role === "lawyer") {
    const lawyerProfile = await lawyerModel.findOne({ userID: user._id });
    if (lawyerProfile) {
      const userObj = user.toObject();
      const profileObj = lawyerProfile.toObject();
      return {
        ...userObj,
        ...profileObj,
        profileId: profileObj._id,
        _id: user._id
      };
    }
  }

  return user;
};

const getReferralHistory = async (userId) => {
  // Tìm tất cả người dùng được giới thiệu bởi userId và đã xác thực
  const referrals = await userModel.find({ referredBy: userId, isVerified: true })
    .select('fullname email createdAt phone rank');
  return referrals;
};

const googleLogin = async (googleData) => {
  const { email, fullname, googleId, avatar, role } = googleData;

  // Ép kiểu chuỗi để chặn NoSQL injection / lỗi crash khi email là object
  const normalizedEmail = toEmail(email);
  const safeFullname = toStr(fullname).trim();
  const safeGoogleId = toStr(googleId);
  const safeAvatar = toStr(avatar);

  if (!normalizedEmail) {
    throw new Error("Email không được để trống");
  }

  // 1. Kiểm tra email đã tồn tại trong hệ thống chưa
  let user = await userModel.findOne({ email: normalizedEmail });

  if (user) {
    // 2. Kiểm tra role của tài khoản đã tồn tại
    if (user.role === "admin") {
      throw new Error(
        "Email này là tài khoản Quản trị viên. Không thể đăng nhập qua ứng dụng."
      );
    }

    // Nếu frontend yêu cầu đăng nhập với role cụ thể
    if (role) {
      console.log(`[Google Login] Requested role: ${role}, User role in DB: ${user.role}`);
      if (role !== user.role) {
        if (role === "lawyer") {
          throw new Error("Tài khoản của bạn không phải là tài khoản Luật sư.");
        } else if (role === "member") {
          throw new Error("Tài khoản của bạn không phải là tài khoản Thành viên.");
        } else if (role === "customer") {
          throw new Error("Tài khoản của bạn không phải là tài khoản Khách hàng.");
        } else {
          throw new Error("Vai trò không hợp lệ.");
        }
      }
    } else {
      // Logic cũ (tương thích ngược nếu không truyền role)
      console.log(`[Google Login] No role provided by frontend, User role in DB: ${user.role}`);
      if (user.role === "lawyer") {
        throw new Error(
          "Email này đã được đăng ký tài khoản Luật sư. Vui lòng đăng nhập bằng cổng Luật sư."
        );
      }
    }

    if (user.isActived === false) {
      const error = new Error("Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Admin.");
      error.statusCode = 403;
      throw error;
    }

    // Tự động xác thực email vì đã đăng nhập qua Google
    if (!user.isVerified) {
      user.isVerified = true;
    }

    if (googleId && !user.googleId) {
      user.googleId = googleId;
    }

    if (avatar && !user.avatar) {
      user.avatar = avatar;
    }
  } else {
    // 3. Nếu chưa tồn tại -> Báo cho Frontend biết để chuyển sang màn hình Đăng ký
    if (role === "lawyer") {
      return {
        isNewUser: true,
        email: normalizedEmail,
        fullname: safeFullname,
        googleId: safeGoogleId,
        avatar: safeAvatar,
        role: role
      };
    }
    const error = new Error("Tài khoản chưa tồn tại trong hệ thống.");
    error.isNewUser = true;
    error.statusCode = 404;
    throw error;
  }

  // 4. Tạo JWT Token
  const accessToken = generateToken(user, "7d");
  const refreshToken = generateToken(user, "14d");

  user.refreshTokens = refreshToken;
  await user.save();

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.refreshTokens;
  delete userObj.otp;

  let userRes = userObj;

  // Nếu là luật sư, cần lấy thêm lawyerProfile để trả về giống userLogin
  if (user.role === "lawyer") {
    const lawyerProfile = await lawyerModel.findOne({ userID: user._id });
    if (lawyerProfile) {
      const profileObj = lawyerProfile.toObject();
      userRes = {
        ...userObj,
        ...profileObj,
        profileId: profileObj._id,
        _id: user._id
      };
    }
  }

  return { userRes, accessToken, refreshToken };
};

  const abortBookingPayment = async (bookingId, userId) => {
  try {
    const booking = await bookingModel.findOne({ _id: bookingId, userID: userId });
    if (!booking) {
      throw new Error("Không tìm thấy lịch hẹn");
    }

    if (booking.status === 'Pending' && booking.paymentStatus === 'Unpaid') {
      await bookingModel.findByIdAndDelete(bookingId);
      await Promise.all([
        client.del(`user_bookings:${userId}`),
        client.del(`booking_detail:${bookingId}`),
        client.del(`lawyer_bookings:${booking.lawyerID}`),
        client.del(`lawyer_booking_detail:${bookingId}`),
        client.del("admin_dashboard_stats")
      ]);
      return true;
    } else {
      throw new Error("Không thể huỷ: Lịch hẹn đã được thanh toán hoặc xác nhận");
    }
  } catch (error) {
    throw new Error("Không thể huỷ lịch hẹn: " + sanitizeError(error));
  }
};

module.exports = {
  userRegister,
  verifyEmail,
  userLogin,
  googleLogin,
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
  cancelBooking,
  abortBookingPayment,
  updateUserRank,
  getUserProfile,
  getReferralHistory
};
