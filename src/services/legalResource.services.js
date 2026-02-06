const legalResourceModel = require("../model/legalResource.model");
const client = require("../config/redis");

/**
 * Lấy danh sách tài liệu tiếng Anh theo chuyên mục
 */
const getResources = async ({ category, language = 'English', page = 1, limit = 10, search }) => {
    const skip = (page - 1) * limit;
    const query = { language, isPublished: true };
    if (category) query.category = category;
    if (search) query.title = { $regex: search, $options: 'i' };

    const cacheKey = `legal_resources:${language}:${category || 'all'}:${page}:${limit}:${search || 'none'}`;
    const cached = await client.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const [data, total] = await Promise.all([
        legalResourceModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        legalResourceModel.countDocuments(query)
    ]);

    const result = {
        data,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };

    await client.set(cacheKey, JSON.stringify(result), { EX: 600 }); // Cache 10 phút
    return result;
};

/**
 * Lấy chi tiết tài liệu
 */
const getResourceDetail = async (id) => {
    const cacheKey = `legal_resource_detail:${id}`;
    const cached = await client.get(cacheKey);
    if (cached) {
        // Tăng view bất đồng bộ (không chờ)
        legalResourceModel.findByIdAndUpdate(id, { $inc: { views: 1 } }).exec();
        return JSON.parse(cached);
    }

    const resource = await legalResourceModel.findById(id).lean();
    if (!resource) throw new Error("Không tìm thấy tài liệu");

    await client.set(cacheKey, JSON.stringify(resource), { EX: 3600 }); // Cache 1 giờ

    // Tăng view
    await legalResourceModel.findByIdAndUpdate(id, { $inc: { views: 1 } });

    return resource;
};

/**
 * Tìm kiếm tài liệu bằng text index
 */
const searchResources = async (textQuery, language = 'English') => {
    if (!textQuery) return [];

    return await legalResourceModel.find({
        $text: { $search: textQuery },
        language,
        isPublished: true
    }).sort({ score: { $meta: "textScore" } }).limit(20).lean();
};

/**
 * Admin: Tạo tài liệu mới
 */
const createResource = async (data) => {
    const resource = await legalResourceModel.create(data);
    // Xóa cache danh sách
    await invalidateResourceCache(data.language, data.category);
    return resource;
};

/**
 * Admin: Cập nhật tài liệu
 */
const updateResource = async (id, data) => {
    const resource = await legalResourceModel.findByIdAndUpdate(id, data, { new: true });
    if (!resource) throw new Error("Không tìm thấy tài liệu để cập nhật");

    // Xóa cache chi tiết và danh sách
    await client.del(`legal_resource_detail:${id}`);
    await invalidateResourceCache(resource.language, resource.category);

    return resource;
};

/**
 * Admin: Xóa tài liệu
 */
const deleteResource = async (id) => {
    const resource = await legalResourceModel.findByIdAndDelete(id);
    if (resource) {
        await client.del(`legal_resource_detail:${id}`);
        await invalidateResourceCache(resource.language, resource.category);
    }
    return resource;
};

/**
 * Helper: Xóa cache danh sách liên quan
 */
const invalidateResourceCache = async (language, category) => {
    // Xóa cache trang 1 cho category cụ thể và 'all'
    const keys = [
        `legal_resources:${language}:${category}:1:10`,
        `legal_resources:${language}:all:1:10`
    ];
    for (const key of keys) {
        await client.del(key);
    }
};

module.exports = {
    getResources,
    getResourceDetail,
    searchResources,
    createResource,
    updateResource,
    deleteResource,
    invalidateResourceCache
};
