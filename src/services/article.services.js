const articleModel = require('../model/article.model');
const lawyerModel = require('../model/lawyer.model');
const client = require('../config/redis');

const createArticle = async ({ lawyerId, title, content, category, images, tags, status, thumbnail, attachments }) => {
    const newArticle = await articleModel.create({
        title,
        content,
        author: lawyerId,
        category,
        images: images || [],
        attachments: attachments || [],
        tags: tags || [],
        status: status || 'Published',
        thumbnail: thumbnail || (images && images.length > 0 ? images[0] : '')
    });

    // Clear list cache
    await client.del('articles_list_*');

    return newArticle;
};

const getArticles = async ({ category, tag, page = 1, limit = 10, search }) => {
    const skip = (page - 1) * limit;
    const query = { status: 'Published' };

    if (category) query.category = category;
    if (tag) query.tags = tag;

    // Tối ưu tìm kiếm bằng text index nếu có từ khóa
    if (search) {
        query.$text = { $search: search };
    }

    const cacheKey = `articles_list_${category || 'all'}_${tag || 'all'}_${page}_${limit}_${search || 'none'}`;
    const cached = await client.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Chạy song song truy vấn lấy data và đếm tổng số bản ghi
    const [articles, total] = await Promise.all([
        articleModel.find(query)
            .select('-content') // Không lấy nội dung bài viết ở trang danh sách để giảm tải
            .populate({
                path: 'author',
                populate: {
                    path: 'userID',
                    select: 'fullname avatar'
                }
            })
            .sort(search ? { score: { $meta: "textScore" } } : { createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(), // Trả về POJO để tăng tốc độ truy cập
        articleModel.countDocuments(query)
    ]);

    const result = { articles, total, page, totalPages: Math.ceil(total / limit) };

    await client.set(cacheKey, JSON.stringify(result), { EX: 600 });

    return result;
};

const getArticleByLawyer = async (lawyerId) => {
    return await articleModel.find({ author: lawyerId }).sort({ createdAt: -1 });
};

const getArticleDetail = async (id) => {
    const article = await articleModel.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true })
        .populate({
            path: 'author',
            populate: {
                path: 'userID',
                select: 'fullname avatar'
            }
        })
        .lean();

    if (!article) throw new Error("Không tìm thấy bài viết");

    return article;
};

const updateArticle = async (lawyerId, articleId, updateData) => {
    const article = await articleModel.findOne({ _id: articleId, author: lawyerId });
    if (!article) throw new Error("Không tìm thấy bài viết hoặc bạn không phải là tác giả");

    const updatedArticle = await articleModel.findByIdAndUpdate(articleId, updateData, { new: true });

    // Clear cache
    await client.del('articles_list_*');

    return updatedArticle;
};

const deleteArticle = async (lawyerId, articleId) => {
    const article = await articleModel.findOne({ _id: articleId, author: lawyerId });
    if (!article) throw new Error("Không tìm thấy bài viết hoặc bạn không phải là tác giả");

    await articleModel.findByIdAndDelete(articleId);

    // Clear cache
    await client.del('articles_list_*');

    return { message: "Xóa bài viết thành công" };
};

const incrementArticleDownload = async (id) => {
    return await articleModel.findByIdAndUpdate(id, { $inc: { downloadCount: 1 } }, { new: true });
};

module.exports = {
    createArticle,
    getArticles,
    getArticleDetail,
    getArticleByLawyer,
    updateArticle,
    deleteArticle,
    incrementArticleDownload
};
