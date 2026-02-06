const lawyerModel = require("../model/lawyer.model");
const scheduleModel = require("../model/schedule.model");
const userModel = require("../model/user.model");
const bookingModel = require("../model/booking.model");
const sendEmail = require("../utils/sendEmail");
const bcrypt = require("bcryptjs");
const client = require("../config/redis");

const lawyerRegister = async (userData) => {
  const {
    fullname,
    email,
    phone,
    password,
    lawyerId,
    specialty,
    firmName,
    lawyerCardImage,
    avatar,
    bankInfo
  } = userData;

  // 1. Kiểm tra User tồn tại hay chưa
  let user = await userModel.findOne({ email });

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  if (user) {
    if (user.isVerified) {
      if (user.role === 'lawyer') {
        throw new Error("Tài khoản email này đã được sử dụng và xác minh là luật sư.");
      }
      if (user.role === 'customer') {
        throw new Error("Vui lòng đăng ký tài khoản thành viên (member) trước khi tham gia cộng tác luật sư.");
      }
      // If user is 'member', we allow them to proceed to upgrade
      console.log("Upgrading member to collaborator lawyer:", email);
    } else {
      // Nếu user đã tồn tại nhưng chưa verified, cập nhật lại thông tin
      user.fullname = fullname;
      user.password = hashedPassword;
      user.phone = phone;
      user.otp = otp;
      user.role = "lawyer"; // Đảm bảo role đúng
      await user.save();
    }
  } else {
    // Nếu chưa có user, tạo mới User trước
    user = await userModel.create({
      fullname,
      email,
      phone,
      password: hashedPassword,
      role: "lawyer",
      otp,
    });
  }

  // 2. Xử lý phần thông tin Luật sư (Lawyer Model)
  // Kiểm tra xem đã có profile lawyer gắn với user này chưa
  let lawyerProfile = await lawyerModel.findOne({ userID: user._id });

  if (lawyerProfile) {
    // Cập nhật profile cũ
    lawyerProfile.lawyerId = lawyerId;
    lawyerProfile.specialty = specialty;
    lawyerProfile.firmName = firmName;
    lawyerProfile.lawyerCardImage = lawyerCardImage;
    lawyerProfile.avatar = avatar;
    if (bankInfo) lawyerProfile.bankInfo = bankInfo;
    await lawyerProfile.save();
    await client.del(`lawyer_detail:${user._id}`);
  } else {
    // Tạo profile mới gắn với userID của user vừa tạo/cập nhật
    await lawyerModel.create({
      userID: user._id,
      lawyerId,
      specialty,
      firmName,
      lawyerCardImage,
      avatar,
      isCollaborator: user.isVerified && user.role === 'member', // Set collaborated if upgrading from member
      commissionRate: (user.isVerified && user.role === 'member') ? 20 : 0, // Default 20% commission for platform
      bankInfo
    });

    // Nếu đang upgrade từ member, cập nhật role User sang lawyer ngay
    if (user.isVerified && user.role === 'member') {
      user.role = 'lawyer';
      user.isApproved = false;
      await user.save();
    }
  }

  // 3. Gửi Email
  try {
    await sendEmail(email, "Xác minh tài khoản Luật sư", `Mã OTP của bạn là: ${otp}`);
  } catch (error) {
    console.log("Lỗi gửi email:", error);
    // Vẫn cho return user vì bản ghi đã lưu, có thể cho user bấm gửi lại OTP sau
    return user
  }

  return user;
};

const getUserDetail = async (userId) => {
  const key = `lawyer_detail:${userId}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);

  // 1. Tìm profile luật sư và populate bảng User
  const lawyer = await lawyerModel
    .findOne({ userID: userId })
    .populate("userID", "-otp -password -__v") // Chỉ lấy các trường sạch từ User
    .lean(); // Dùng .lean() để trả về object JS thuần, giúp dễ dàng chỉnh sửa

  if (!lawyer) throw new Error("Luật sư không tồn tại");

  // 2. Phẳng hóa dữ liệu: Đưa mọi thứ trong userID ra ngoài cấp 1
  const flatLawyer = {
    ...lawyer.userID,        // Lấy fullname, email, role, _id từ User
    ...lawyer,               // Lấy isApproved, specialization... từ LawyerProfile
    _id: lawyer.userID._id,  // Đảm bảo _id là ID của User (để dùng cho updateToken)
    profileId: lawyer._id    // Giữ lại ID của profile nếu cần
  };

  // Xóa bỏ trường userID bị thừa sau khi đã trải phẳng
  delete flatLawyer.userID;

  await client.set(key, JSON.stringify(flatLawyer), { EX: 3600 });
  return flatLawyer;
};

const updateSchedule = async (lawyerId, userId, availability) => {
  const savedSchedule = await scheduleModel.findOneAndUpdate(
    { lawyerID: lawyerId },
    { $set: { workingDays: availability } },
    { new: true, upsert: true, runValidators: true }
  );
  await client.del(`my_schedule:${userId}`);
  await client.del(`lawyer_schedule_id:${lawyerId}`);
  return savedSchedule;
}

const getMySchedule = async (lawyerId, userId) => {
  const key = `my_schedule:${userId}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);

  const schedule = await scheduleModel.findOne({ lawyerID: lawyerId });
  await client.set(key, JSON.stringify(schedule), { EX: 3600 });
  return schedule;
}

const getLawyerBookings = async (lawyerId) => {
  const key = `lawyer_bookings:${lawyerId}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);

  const bookings = await bookingModel.find({ lawyerID: lawyerId })
    .populate('userID', 'fullname email phone avatar')
    .sort({ createdAt: -1 });

  await client.set(key, JSON.stringify(bookings), { EX: 600 });
  return bookings;
}

const getLawyerBookingDetail = async (lawyerId, bookingId) => {
  const key = `lawyer_booking_detail:${bookingId}`;
  const cached = await client.get(key);
  if (cached) {
    const booking = JSON.parse(cached);
    if (booking.lawyerID.toString() === lawyerId.toString()) {
      return booking;
    }
  }

  const booking = await bookingModel.findOne({ _id: bookingId, lawyerID: lawyerId })
    .populate('userID', 'fullname email phone avatar');

  if (!booking) throw new Error("Không tìm thấy cuộc hẹn hoặc bạn không có quyền truy cập");

  await client.set(key, JSON.stringify(booking), { EX: 3600 });
  return booking;
}

const confirmBookingPayment = async (lawyerId, bookingId) => {
  const booking = await bookingModel.findOne({ _id: bookingId, lawyerID: lawyerId });
  if (!booking) {
    throw new Error("Không tìm thấy cuộc hẹn hoặc bạn không có quyền cập nhật");
  }

  if (booking.paymentStatus === 'Paid') {
    throw new Error("Cuộc hẹn này đã được thanh toán rồi");
  }

  // Cập nhật trạng thái
  booking.paymentStatus = 'Paid';
  booking.status = 'Confirmed';
  await booking.save();

  // Invalidate caches
  const userId = booking.userID;
  await Promise.all([
    client.del(`lawyer_bookings:${lawyerId}`),
    client.del(`lawyer_booking_detail:${bookingId}`),
    client.del(`user_bookings:${userId}`),
    client.del(`booking_detail:${bookingId}`)
  ]);

  return booking;
}

module.exports = {
  lawyerRegister,
  getUserDetail,
  updateSchedule,
  getMySchedule,
  getLawyerBookings,
  getLawyerBookingDetail,
  confirmBookingPayment
};