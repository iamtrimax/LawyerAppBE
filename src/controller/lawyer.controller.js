const { lawyerRegister, getUserDetail, updateSchedule, getMySchedule, getLawyerBookings, getLawyerBookingDetail, confirmBookingPayment } = require("../services/lawyer.services");
const client = require("../config/redis");

const lawyerRegisterController = async (req, res) => {
  const {
    fullname,
    email,
    phone,
    password,
    lawyerId,
    specialty,
    firmName,
    lawyerCardImage,
    avatar
  } = req.body;

  const requiredFields = {
    fullname: "Họ và tên",
    email: "Email",
    phone: "Số điện thoại",
    password: "Mật khẩu",
    lawyerId: "Số thẻ hành nghề",
    specialty: "Chuyên môn",
    firmName: "Văn phòng luật",
    lawyerCardImage: "Ảnh thẻ hành nghề",
    avatar: "Ảnh đại diện"
  };

  const missingFields = [];
  Object.keys(requiredFields).forEach((field) => {
    if (!req.body[field] || req.body[field].toString().trim() === "") {
      missingFields.push(requiredFields[field]);
    }
  });

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Thiếu thông tin: ${missingFields.join(", ")}`,
      missingFields: missingFields
    });
  }

  try {
    const newLawyer = await lawyerRegister({
      fullname,
      email,
      phone,
      password,
      lawyerId,
      specialty,
      firmName,
      lawyerCardImage,
      avatar
    });

    res.status(201).json({
      message: "Đăng ký thành công. Vui lòng đợi admin xét duyệt tài khoản",
      userId: newLawyer._id,
      success: true,
    });
  } catch (error) {
    console.error("Lỗi tại lawyerRegisterController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Lỗi server nội bộ"
    });
  }
};

const getLawyerDetailController = async (req, res) => {
  try {
    // 1. Kiểm tra cache trước (dùng userId để mapping với cache detail)
    const key = `lawyer_detail:${req.userId}`;
    const cached = await client.get(key);
    if (cached) {
      return res.status(200).json({
        success: true,
        lawyer: JSON.parse(cached)
      });
    }

    // 2. Nếu không có cache, dùng dữ liệu từ middleware (req.lawyer)
    // Nhưng req.lawyer chỉ là profile lawyer, ta cần detail đầy đủ (bao gồm User data)
    // Do đó vẫn gọi service nhưng truyền dữ liệu đã fetch nếu cần, hoặc đơn giản là gọi lại service sạch sẽ
    const lawyer = await getUserDetail(req.userId);
    res.status(200).json({
      success: true,
      lawyer
    });
  } catch (error) {
    console.error("Lỗi tại getLawyerDetailController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Lỗi server nội bộ"
    });
  }
}

const updateScheduleController = async (req, res) => {
  const { availability } = req.body;
  try {
    const updatedSchedule = await updateSchedule(req.lawyer._id, req.userId, availability);
    res.status(200).json({
      success: true,
      message: "Cập nhật lịch làm việc thành công",
      schedule: updatedSchedule
    });
  } catch (error) {
    console.error("Lỗi tại updateScheduleController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Lỗi server nội bộ"
    });
  }
};

const getMyScheduleController = async (req, res) => {
  try {
    const schedule = await getMySchedule(req.lawyer._id, req.userId);
    res.status(200).json({
      success: true,
      data: schedule ? schedule.workingDays : []
    });
  } catch (error) {
    console.error("Lỗi tại getMyScheduleController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Lỗi server nội bộ"
    });
  }
};

const getLawyerBookingsController = async (req, res) => {
  try {
    const bookings = await getLawyerBookings(req.lawyer._id);
    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    console.error("Lỗi tại getLawyerBookingsController:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const getLawyerBookingDetailController = async (req, res) => {
  try {
    const { bookingId } = req.params;

    // Kiểm tra định dạng ObjectId
    if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "ID cuộc hẹn không hợp lệ."
      });
    }

    const booking = await getLawyerBookingDetail(req.lawyer._id, bookingId);
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    console.error("Lỗi tại getLawyerBookingDetailController:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const confirmBookingPaymentController = async (req, res) => {
  try {
    const { bookingId } = req.params;

    // Kiểm tra định dạng ObjectId
    if (!bookingId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: "ID cuộc hẹn không hợp lệ. Vui lòng kiểm tra lại URL."
      });
    }

    const booking = await confirmBookingPayment(req.lawyer._id, bookingId);
    res.status(200).json({
      success: true,
      message: "Xác nhận thanh toán thành công",
      data: booking
    });
  } catch (error) {
    console.error("Lỗi tại confirmBookingPaymentController:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  lawyerRegisterController,
  getLawyerDetailController,
  updateScheduleController,
  getMyScheduleController,
  getLawyerBookingsController,
  getLawyerBookingDetailController,
  confirmBookingPaymentController
};
