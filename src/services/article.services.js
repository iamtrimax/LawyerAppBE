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

const getArticles = async ({ category, tag, page = 1, limit = 10 }) => {
    const skip = (page - 1) * limit;
    const query = { status: 'Published' };

    if (category) query.category = category;
    if (tag) query.tags = tag;

    const cacheKey = `articles_list_${category || 'all'}_${tag || 'all'}_${page}_${limit}`;
    const cached = await client.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const articles = await articleModel.find(query)
        .populate({
            path: 'author',
            populate: {
                path: 'userID',
                select: 'fullname avatar'
            }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const total = await articleModel.countDocuments(query);

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
        });

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

module.exports = {
    createArticle,
    getArticles,
    getArticleDetail,
    getArticleByLawyer,
    updateArticle,
    deleteArticle
};
