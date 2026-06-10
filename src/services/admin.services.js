const mongoose = require("mongoose");
const lawyerModel = require("../model/lawyer.model");
const userModel = require("../model/user.model");
const articleModel = require("../model/article.model");
const client = require("../config/redis");

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
    // XÃ³a thÃªm cache danh sÃ¡ch tÃ¬m kiáº¿m Ä‘á»ƒ luáº­t sÆ° xuáº¥t hiá»‡n ngay
    const keys = await client.keys("lawyers_list:*");
    if (keys.length > 0) {
      await Promise.all(keys.map(key => client.del(key)));
    }
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
  const article = await articleModel.findByIdAndUpdate(
    articleId,
    { isPublished: true, status: 'Published' },
    { new: true }
  );
  if (!article) {
    const error = new Error("Không tìm thấy bài viết");
    error.statusCode = 404;
    throw error;
  }
  
  // Xóa cache danh sách bài viết
  const keys = await client.keys('articles_list_*');
  if (keys.length > 0) {
      await Promise.all(keys.map(key => client.del(key)));
  }
  return article;
};

const getAllArticlesForAdmin = async ({ page = 1, limit = 10, filter }) => {
  const skip = (page - 1) * limit;
  const query = {};

  if (filter === 'published') query.isPublished = true;
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

module.exports = { approveLawyer, getLawyerDetailForAdmin, getAllLawyersService, deleteUserAccount, lockUserAccount, unlockUserAccount, approveArticle, getAllArticlesForAdmin, getAllUsersService };
