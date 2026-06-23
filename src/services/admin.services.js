const mongoose = require("mongoose");
const lawyerModel = require("../model/lawyer.model");
const userModel = require("../model/user.model");
const articleModel = require("../model/article.model");
const bookingModel = require("../model/booking.model");
const refundModel = require("../model/refund.model");
const client = require("../config/redis");
const bcrypt = require("bcryptjs");

const addLawyerForAdmin = async (userData) => {
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
    yearsOfExperience,
  } = userData;

  let user = await userModel.findOne({ email });
  if (user) {
    const error = new Error("Tài khoản email này đã tồn tại trong hệ thống.");
    error.statusCode = 400;
    throw error;
  }

  let lawyerProfile = await lawyerModel.findOne({ lawyerId });
  if (lawyerProfile) {
    const error = new Error("Mã thẻ luật sư này đã tồn tại.");
    error.statusCode = 400;
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  user = await userModel.create({
    fullname,
    email,
    phone,
    password: hashedPassword,
    role: "lawyer",
    isVerified: true,
    isActived: true,
  });

  await lawyerModel.create({
    userID: user._id,
    lawyerId,
    specialty: Array.isArray(specialty) ? specialty : [specialty],
    firmName,
    lawyerCardImage,
    avatar,
    yearsOfExperience: yearsOfExperience || 0,
    isApproved: true,
    isCollaborator: false,
    commissionRate: 20,
  });

  const keys = await client.keys("lawyers_list:*");
  if (keys.length > 0) {
    await Promise.all(keys.map(key => client.del(key)));
  }
  await client.del("admin_dashboard_stats");

  return user;
};

const approveLawyer = async (lawyerId) => {
  const lawyerProfile = await lawyerModel
    .findOne({ lawyerId: lawyerId })
    .populate("userID");
  if (!lawyerProfile) {
    return;
  }
  // Trim specialty Ä‘á»ƒ trÃ¡nh lá»—i enum validation do dá»¯ liá»‡u cÃ³ khoáº£ng tráº¯ng thá»«a
  if (Array.isArray(lawyerProfile.specialty)) {
    lawyerProfile.specialty = lawyerProfile.specialty.map(s => s.trim());
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
    // Xóa cache dashboard
    await client.del("admin_dashboard_stats");
  }
  return lawyerProfile;
};

const findUserByIdOrLawyerId = async (targetId) => {
  let user = null;
  let lawyerProfile = null;

  if (mongoose.Types.ObjectId.isValid(targetId)) {
    user = await userModel.findById(targetId);
    if (!user) {
      lawyerProfile = await lawyerModel.findById(targetId).populate("userID");
      user = lawyerProfile?.userID || null;
    }
  }

  if (!user) {
    lawyerProfile = await lawyerModel.findOne({ lawyerId: targetId }).populate("userID");
    user = lawyerProfile?.userID || null;
  }

  if (user && !lawyerProfile && user.role === "lawyer") {
    lawyerProfile = await lawyerModel.findOne({ userID: user._id });
  }

  return { user, lawyerProfile };
};

const revokeUserTokens = (user) => {
  user.refreshTokens = "";
  user.passwordChangedAt = new Date(Date.now() + 1000);
};

const clearAccountCaches = async (userId, lawyerProfile) => {
  const tasks = [client.del(`lawyer_detail:${userId}`), client.del(`user_bookings:${userId}`)];

  if (lawyerProfile?._id) {
    tasks.push(client.del(`lawyer_bookings:${lawyerProfile._id}`));
  }

  const patterns = ["lawyers_list:*", "lawyer_search:*"];
  for (const pattern of patterns) {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      tasks.push(...keys.map((key) => client.del(key)));
    }
  }

  await Promise.all(tasks);
};

const deleteUserAccount = async (targetId) => {
  const { user, lawyerProfile } = await findUserByIdOrLawyerId(targetId);
  if (!user) {
    const error = new Error("Không tìm thấy tài khoản cần xoá");
    error.statusCode = 404;
    throw error;
  }

  if (user.role === "admin") {
    const error = new Error("Không thể xoá tài khoản admin");
    error.statusCode = 403;
    throw error;
  }

  revokeUserTokens(user);
  await user.save();

  if (user.role === "lawyer") {
    await lawyerModel.deleteMany({ userID: user._id });
  }

  await userModel.findByIdAndDelete(user._id);
  await clearAccountCaches(user._id, lawyerProfile);

  return {
    _id: user._id,
    fullname: user.fullname,
    email: user.email,
    role: user.role,
    lawyerId: lawyerProfile?.lawyerId,
    expoPushToken: user.expoPushToken,
  };
};

const lockUserAccount = async (targetId) => {
  const { user, lawyerProfile } = await findUserByIdOrLawyerId(targetId);
  if (!user) {
    const error = new Error("Không tìm thấy tài khoản cần khoá");
    error.statusCode = 404;
    throw error;
  }

  if (user.role === "admin") {
    const error = new Error("Không thể khoá tài khoản admin");
    error.statusCode = 403;
    throw error;
  }

  user.isActived = false;
  revokeUserTokens(user);
  await user.save();
  await clearAccountCaches(user._id, lawyerProfile);

  return {
    _id: user._id,
    fullname: user.fullname,
    email: user.email,
    role: user.role,
    lawyerId: lawyerProfile?.lawyerId,
    expoPushToken: user.expoPushToken,
  };
};
const getLawyerDetailForAdmin = async (lawyerId) => {
  const lawyerProfile = await lawyerModel
    .findOne({ lawyerId: lawyerId })
    .populate("userID", "-password -otp -refreshTokens");
  return lawyerProfile;
};
const getAllLawyersService = async ({ page = 1, limit = 10, filter}) => {
    const skip = (page - 1) * limit;
    const query = {};

    if (filter === 'approved') query.isApproved = true;
    if (filter === 'pending') query.isApproved = false;

    const [lawyers, total] = await Promise.all([
        lawyerModel.find(query)
            .populate({
                path: 'userID',
                select:'fullname avatar email phone isActived'
            }).skip(skip)
            .limit(parseInt(limit, 10))
            .lean(),
        lawyerModel.countDocuments(query)
    ]);

    const result = { lawyers, total, page: parseInt(page, 10), totalPages: Math.ceil(total / limit) };

    return result;
};
const unlockUserAccount = async (targetId) => {
  const { user, lawyerProfile } = await findUserByIdOrLawyerId(targetId);
  if (!user) {
    const error = new Error("Không tìm thấy tài khoản cần mở khoá");
    error.statusCode = 404;
    throw error;
  }

  user.isActived = true;
  await user.save();
  await clearAccountCaches(user._id, lawyerProfile);

  return {
    _id: user._id,
    fullname: user.fullname,
    email: user.email,
    role: user.role,
    lawyerId: lawyerProfile?.lawyerId,
    expoPushToken: user.expoPushToken,
  };
};

const approveArticle = async (articleId) => {
  // 1. TỐI ƯU PAYLOAD: Chỉ cập nhật và lấy ra các trường cần thiết
  // Dùng .select() để loại bỏ các trường nội dung nặng, giảm từ 115kB xuống vài byte
  const article = await articleModel.findByIdAndUpdate(
    articleId,
    { isPublished: true, status: 'Published' },
    { new: true }
  ).select('_id isPublished status'); 

  if (!article) {
    const error = new Error("Không tìm thấy bài viết");
    error.statusCode = 404;
    throw error;
  }
  
  // 2. TỐI ƯU CƠ CHẾ: Đẩy việc xóa cache vào hậu trường (Background Task)
  // Tuyệt đối KHÔNG DÙNG 'await' ở đây để API được giải phóng và trả về lập tức
  setImmediate(async () => {
    try {
      let cursor = '0';
      const keysToDelete = [];
      do {
        // Tăng COUNT từ 100 lên 1000 để giảm số lần phải gọi lên Redis
        const reply = await client.scan(cursor, { MATCH: 'articles_list_*', COUNT: 1000 });
        cursor = reply.cursor;
        keysToDelete.push(...reply.keys);
      } while (cursor !== '0');

      if (keysToDelete.length > 0) {
          // Dùng unlink thay vì del để Redis xóa ngầm, không block hệ thống
          await Promise.all(keysToDelete.map(key => client.unlink(key)));
      }
    } catch (cacheError) {
      console.error("Lỗi xóa cache ngầm:", cacheError);
    }
  });

  // Trình duyệt sẽ nhận được phản hồi ngay tại đây mà không cần đợi Redis quét xong
  return article;
};

const getAllArticlesForAdmin = async ({ page = 1, limit = 10, filter }) => {
  const skip = (page - 1) * limit;
  const query = {};

  if (filter === 'published') query.isPublished = { $ne: false };
  if (filter === 'pending') query.isPublished = false;

  const [articles, total] = await Promise.all([
      articleModel.find(query)
          .populate({
              path: 'author',
              populate: {
                  path: 'userID',
                  select: 'fullname avatar email'
              }
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit, 10))
          .lean(),
      articleModel.countDocuments(query)
  ]);

  const result = { articles, total, page: parseInt(page, 10), totalPages: Math.ceil(total / limit) };

  return result;
};

const getAllUsersService = async ({ page = 1, limit = 10, roleFilter, search }) => {
  const skip = (page - 1) * limit;
  const query = { role: { $in: ['customer', 'member'] } };

  if (roleFilter === 'customer') query.role = 'customer';
  if (roleFilter === 'member') query.role = 'member';
  
  if (search) {
    query.$or = [
      { fullname: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  const [users, total] = await Promise.all([
    userModel.find(query)
      .select('-password -refreshTokens -otp')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(),
    userModel.countDocuments(query)
  ]);

  return { users, total, page: parseInt(page, 10), totalPages: Math.ceil(total / limit) };
};

const deleteArticleForAdmin = async (articleId) => {
  const article = await articleModel.findByIdAndDelete(articleId);
  if (!article) {
    const error = new Error("Không tìm thấy bài viết để xoá");
    error.statusCode = 404;
    throw error;
  }
  
  // Xóa cache danh sách bài viết
  const keys = await client.keys('articles_list_*');
  if (keys.length > 0) {
      await Promise.all(keys.map(key => client.del(key)));
  }
  return { message: "Xóa bài viết thành công" };
};

const getArticleDetailForAdmin = async (articleId) => {
  const article = await articleModel.findById(articleId)
    .populate({
      path: 'author',
      populate: {
        path: 'userID',
        select: 'fullname avatar email phone'
      }
    })
    .lean();

  if (!article) {
    const error = new Error("Không tìm thấy bài viết");
    error.statusCode = 404;
    throw error;
  }

  return article;
};

const getAllBookingsForAdmin = async ({ page = 1, limit = 10, status, paymentStatus, payoutStatus, search, dateFrom, dateTo }) => {
  const skip = (page - 1) * limit;
  const query = {};

  // Filter by booking status
  if (status && ['Pending', 'Confirmed', 'Cancelled', 'Completed'].includes(status)) {
    query.status = status;
  }

  // Filter by payment status
  if (paymentStatus && ['Unpaid', 'Paid', 'Failed', 'Refunded'].includes(paymentStatus)) {
    query.paymentStatus = paymentStatus;
  }

  // Filter by payout status
  if (payoutStatus && ['Pending', 'Paid', 'N/A'].includes(payoutStatus)) {
    query.payoutStatus = payoutStatus;
  }

  // Filter by date range
  if (dateFrom || dateTo) {
    query.date = {};
    if (dateFrom) query.date.$gte = dateFrom;
    if (dateTo) query.date.$lte = dateTo;
  }

  // Search by user name/email or lawyer name – need to find matching IDs first
  if (search) {
    const searchRegex = { $regex: search, $options: 'i' };

    const [matchingUsers, matchingLawyers] = await Promise.all([
      userModel.find({
        $or: [
          { fullname: searchRegex },
          { email: searchRegex },
          { phone: searchRegex }
        ]
      }).select('_id').lean(),
      lawyerModel.find({})
        .populate({ path: 'userID', select: 'fullname', match: { fullname: searchRegex } })
        .lean()
        .then(lawyers => lawyers.filter(l => l.userID !== null))
    ]);

    const userIds = matchingUsers.map(u => u._id);
    const lawyerIds = matchingLawyers.map(l => l._id);

    query.$or = [];
    if (userIds.length > 0) query.$or.push({ userID: { $in: userIds } });
    if (lawyerIds.length > 0) query.$or.push({ lawyerID: { $in: lawyerIds } });
    
    // If search term provided but no matches, return empty result
    if (query.$or.length === 0) {
      return { bookings: [], total: 0, page: parseInt(page, 10), totalPages: 0 };
    }
  }

  const [bookings, total] = await Promise.all([
    bookingModel.find(query)
      .populate({
        path: 'userID',
        select: 'fullname email phone avatar'
      })
      .populate({
        path: 'lawyerID',
        populate: {
          path: 'userID',
          select: 'fullname email phone avatar'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(),
    bookingModel.countDocuments(query)
  ]);

  return {
    bookings,
    total,
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / limit)
  };
};

const getBookingDetailForAdmin = async (bookingId) => {
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    const error = new Error("ID booking không hợp lệ");
    error.statusCode = 400;
    throw error;
  }

  const booking = await bookingModel.findById(bookingId)
    .populate({
      path: 'userID',
      select: '-password -otp -refreshTokens'
    })
    .populate({
      path: 'lawyerID',
      populate: {
        path: 'userID',
        select: 'fullname email phone avatar'
      }
    })
    .lean();

  if (!booking) {
    const error = new Error("Không tìm thấy booking");
    error.statusCode = 404;
    throw error;
  }

  return booking;
};

const getAllRefundsForAdmin = async ({ page = 1, limit = 10, status, search }) => {
  const skip = (page - 1) * limit;
  const query = {};

  if (status && ['Pending', 'Processed', 'Rejected'].includes(status)) {
    query.status = status;
  }

  if (search) {
    const searchRegex = { $regex: search, $options: 'i' };
    const matchingUsers = await userModel.find({
      $or: [
        { fullname: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ]
    }).select('_id').lean();

    const userIds = matchingUsers.map(u => u._id);
    query.userID = { $in: userIds };
  }

  const [refunds, total] = await Promise.all([
    refundModel.find(query)
      .populate({
        path: 'userID',
        select: 'fullname email phone avatar'
      })
      .populate({
        path: 'bookingID',
        populate: {
          path: 'lawyerID',
          populate: {
            path: 'userID',
            select: 'fullname'
          }
        }
      })
      .populate({
        path: 'processedBy',
        select: 'fullname email'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean(),
    refundModel.countDocuments(query)
  ]);

  return {
    refunds,
    total,
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / limit)
  };
};

const processRefundForAdmin = async ({ refundId, adminId, status, adminNote }) => {
  if (!mongoose.Types.ObjectId.isValid(refundId)) {
    const error = new Error("ID yêu cầu hoàn tiền không hợp lệ");
    error.statusCode = 400;
    throw error;
  }

  if (!['Processed', 'Rejected'].includes(status)) {
    const error = new Error("Trạng thái phê duyệt hoàn tiền không hợp lệ");
    error.statusCode = 400;
    throw error;
  }

  const refund = await refundModel.findById(refundId);
  if (!refund) {
    const error = new Error("Không tìm thấy yêu cầu hoàn tiền");
    error.statusCode = 404;
    throw error;
  }

  if (refund.status !== 'Pending') {
    const error = new Error("Yêu cầu hoàn tiền này đã được xử lý từ trước");
    error.statusCode = 400;
    throw error;
  }

  refund.status = status;
  refund.processedAt = new Date();
  refund.processedBy = adminId;
  refund.adminNote = adminNote || '';
  await refund.save();

  const booking = await bookingModel.findById(refund.bookingID);
  if (booking) {
    if (status === 'Processed') {
      // Khi admin xác nhận đã hoàn tiền, đổi trạng thái thanh toán thành 'Refunded'
      booking.paymentStatus = 'Refunded';
      await booking.save();
    } else if (status === 'Rejected') {
      // Nếu từ chối hoàn tiền, giữ nguyên trạng thái thanh toán là 'Paid'
      booking.paymentStatus = 'Paid';
      await booking.save();
    }
    
    // Clear Redis caches
    await Promise.all([
      client.del(`booking_detail:${booking._id}`),
      client.del(`user_bookings:${booking.userID}`),
      client.del(`lawyer_bookings:${booking.lawyerID}`),
      client.del(`lawyer_booking_detail:${booking._id}`),
      client.del("admin_dashboard_stats")
    ]);
  }

  return refund;
};

const getDashboardStatsForAdmin = async () => {
  const cacheKey = "admin_dashboard_stats";
  try {
    const cachedStats = await client.get(cacheKey);
    if (cachedStats) {
      return JSON.parse(cachedStats);
    }
  } catch (err) {
    console.error("Redis error in getDashboardStatsForAdmin:", err);
  }

  // Aggregate stats from DB
  const [totalLawyers, approvedLawyers, totalBookings, revenueResult, recentBookings] = await Promise.all([
    lawyerModel.countDocuments(),
    lawyerModel.countDocuments({ isApproved: true }),
    bookingModel.countDocuments(),
    bookingModel.aggregate([
      { $match: { paymentStatus: 'Paid' } },
      { $group: { _id: null, total: { $sum: '$price' } } }
    ]),
    bookingModel.find()
      .populate({
        path: 'userID',
        select: 'fullname email avatar'
      })
      .populate({
        path: 'lawyerID',
        populate: {
          path: 'userID',
          select: 'fullname'
        }
      })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()
  ]);

  const totalRevenue = revenueResult[0]?.total || 0;

  const statsData = {
    stats: [
      { id: 1, title: 'Tổng Luật Sư', value: totalLawyers.toLocaleString('vi-VN'), trend: `Đã duyệt: ${approvedLawyers}`, rawValue: totalLawyers },
      { id: 2, title: 'Lượt Tư Vấn', value: totalBookings.toLocaleString('vi-VN'), trend: '+8%', rawValue: totalBookings },
      { id: 3, title: 'Doanh Thu', value: totalRevenue >= 1000000 ? `${(totalRevenue / 1000000).toFixed(1)} Tr` : `${totalRevenue.toLocaleString('vi-VN')} đ`, trend: '+25%', rawValue: totalRevenue },
      { id: 4, title: 'Đánh Giá', value: '4.8/5', trend: 'Mới', rawValue: 4.8 }
    ],
    recentRequests: recentBookings.map(b => ({
      id: `#${b._id.toString().substring(18).toUpperCase()}`,
      bookingId: b._id,
      user: b.userID?.fullname || 'Ẩn danh',
      lawyer: b.lawyerID?.userID?.fullname ? `LS ${b.lawyerID.userID.fullname}` : 'Chưa phân công',
      field: b.lawyerID?.specialty?.[0] || 'Tư vấn',
      status: b.status === 'Completed' ? 'Hoàn thành' :
              b.status === 'Pending' ? 'Đang chờ' :
              b.status === 'Cancelled' ? 'Hủy' : 'Đang tư vấn',
      date: `${b.timeSlot?.start} ${formatDate(b.date)}`
    }))
  };

  try {
    // Cache for 60 seconds (1 minute) to ensure database performance stability
    await client.set(cacheKey, JSON.stringify(statsData), { EX: 60 });
  } catch (err) {
    console.error("Failed to write dashboard cache to Redis:", err);
  }

  return statsData;
};

// Helper function to format date (copied from frontend logic)
const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

module.exports = { addLawyerForAdmin, approveLawyer, getLawyerDetailForAdmin, getAllLawyersService, deleteUserAccount, lockUserAccount, unlockUserAccount, approveArticle, getAllArticlesForAdmin, getAllUsersService, deleteArticleForAdmin, getArticleDetailForAdmin, getAllBookingsForAdmin, getBookingDetailForAdmin, getAllRefundsForAdmin, processRefundForAdmin, getDashboardStatsForAdmin };
