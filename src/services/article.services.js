const articleModel = require('../model/article.model');
const lawyerModel = require('../model/lawyer.model');
const client = require('../config/redis');

const createArticle = async ({ lawyerId, title, content, category, images, tags, status, thumbnail, attachments }) => {
    try {
     const newArticle = await articleModel.create({
        title,
        content,
        author: lawyerId,
        category,
        images: images || [],
        attachments: attachments || [],
        tags: tags || [],
        status: status || 'Published',
        isPublished: false,
        thumbnail: thumbnail || (images && images.length > 0 ? images[0] : '')
    });

    // Clear list cache
    const keys = await client.keys('articles_list_*');
    if (keys.length > 0) {
        await client.del(keys);
    }

    return newArticle;   
    } catch (error) {
        console.log("lỗi server: ", error);
        throw new Error(error);
    }
};

const getArticles = async ({ category, tag, page = 1, limit = 10, search }) => {
    const skip = (page - 1) * limit;
    const query = { status: 'Published', isPublished: { $ne: false } };

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
    const keys = await client.keys('articles_list_*');
    if (keys.length > 0) {
        await client.del(keys);
    }

    return updatedArticle;
};

const deleteArticle = async (lawyerId, articleId) => {
    const article = await articleModel.findOne({ _id: articleId, author: lawyerId });
    if (!article) throw new Error("Không tìm thấy bài viết hoặc bạn không phải là tác giả");

    await articleModel.findByIdAndDelete(articleId);

    // Clear cache
    const keys = await client.keys('articles_list_*');
    if (keys.length > 0) {
        await client.del(keys);
    }

    return { message: "Xóa bài viết thành công" };
};

const incrementArticleDownload = async (id) => {
    return await articleModel.findByIdAndUpdate(id, { $inc: { downloadCount: 1 } }, { new: true });
};

/**
 * Chuyển title thành slug (giống hàm bên frontend)
 * Dùng để so sánh slug từ URL với title trong DB
 */
const slugifyTitle = (title = '') => {
    const VIETNAMESE_MAP = {
        'à':'a','á':'a','ả':'a','ã':'a','ạ':'a',
        'ă':'a','ắ':'a','ặ':'a','ằ':'a','ẳ':'a','ẵ':'a',
        'â':'a','ấ':'a','ầ':'a','ẩ':'a','ẫ':'a','ậ':'a',
        'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e',
        'ê':'e','ế':'e','ề':'e','ể':'e','ễ':'e','ệ':'e',
        'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
        'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o',
        'ô':'o','ố':'o','ồ':'o','ổ':'o','ỗ':'o','ộ':'o',
        'ơ':'o','ớ':'o','ờ':'o','ở':'o','ỡ':'o','ợ':'o',
        'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u',
        'ư':'u','ứ':'u','ừ':'u','ử':'u','ữ':'u','ự':'u',
        'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
        'đ':'d',
        'À':'a','Á':'a','Ả':'a','Ã':'a','Ạ':'a',
        'Ă':'a','Ắ':'a','Ặ':'a','Ằ':'a','Ẳ':'a','Ẵ':'a',
        'Â':'a','Ấ':'a','Ầ':'a','Ẩ':'a','Ẫ':'a','Ậ':'a',
        'È':'e','É':'e','Ẻ':'e','Ẽ':'e','Ẹ':'e',
        'Ê':'e','Ế':'e','Ề':'e','Ể':'e','Ễ':'e','Ệ':'e',
        'Ì':'i','Í':'i','Ỉ':'i','Ĩ':'i','Ị':'i',
        'Ò':'o','Ó':'o','Ỏ':'o','Õ':'o','Ọ':'o',
        'Ô':'o','Ố':'o','Ồ':'o','Ổ':'o','Ỗ':'o','Ộ':'o',
        'Ơ':'o','Ớ':'o','Ờ':'o','Ở':'o','Ỡ':'o','Ợ':'o',
        'Ù':'u','Ú':'u','Ủ':'u','Ũ':'u','Ụ':'u',
        'Ư':'u','Ứ':'u','Ừ':'u','Ử':'u','Ữ':'u','Ự':'u',
        'Ỳ':'y','Ý':'y','Ỷ':'y','Ỹ':'y','Ỵ':'y',
        'Đ':'d',
    };
    return title
        .split('').map(c => VIETNAMESE_MAP[c] ?? c).join('')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 100);
};

/**
 * Tìm bài viết theo slug (từ URL /article/ten-bai-viet)
 * So sánh slug với title đã được slug-hóa của từng bài
 */
const getArticleBySlug = async (slug) => {
    if (!slug) throw new Error('Slug không hợp lệ');

    // Tìm tất cả bài đã publish, chỉ lấy _id và title để so sánh slug (tiết kiệm bộ nhớ)
    const articles = await articleModel.find(
        { status: 'Published' },
        { _id: 1, title: 1 }
    ).lean();

    const matched = articles.find(a => slugifyTitle(a.title) === slug.toLowerCase());
    if (!matched) throw new Error('Không tìm thấy bài viết');

    // Fetch đầy đủ và tăng views
    const article = await articleModel.findByIdAndUpdate(
        matched._id,
        { $inc: { views: 1 } },
        { new: true }
    )
        .populate({
            path: 'author',
            populate: { path: 'userID', select: 'fullname avatar' }
        })
        .lean();

    if (!article) throw new Error('Không tìm thấy bài viết');
    return article;
};

module.exports = {
    createArticle,
    getArticles,
    getArticleDetail,
    getArticleBySlug,
    getArticleByLawyer,
    updateArticle,
    deleteArticle,
    incrementArticleDownload
};
