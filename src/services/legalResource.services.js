const legalResourceModel = require("../model/legalResource.model");
const client = require("../config/redis");
const { withLegalResourceSlug } = require("../utils/legalResourceSlug");

// Ép kiểu chuỗi an toàn: chặn NoSQL injection khi client gửi object qua query params
const toStr = (value) => (typeof value === 'string' ? value : '');

/**
 * Lấy danh sách tài liệu tiếng Anh theo chuyên mục
 */
const getResources = async ({ category, language = 'English', page = 1, limit = 10, search }) => {
    category = toStr(category);
    language = toStr(language) || 'English';
    search = toStr(search);
    const skip = (page - 1) * limit;
    const query = { language, isPublished: true };
    if (category) query.category = category;
    if (search) query.title = { $regex: search, $options: 'i' };

    const cacheKey = `legal_resources:${language}:${category || 'all'}:${page}:${limit}:${search || 'none'}`;
    const cached = await client.get(cacheKey);
    if (cached) {
        const result = JSON.parse(cached);
        return { ...result, data: result.data.map(withLegalResourceSlug) };
    }

    const [data, total] = await Promise.all([
        legalResourceModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        legalResourceModel.countDocuments(query)
    ]);

    const result = {
        data: data.map(withLegalResourceSlug),
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
        return ensureResourceSlug(JSON.parse(cached));
    }

    const resource = await ensureResourceSlug(await legalResourceModel.findById(id).lean());
    if (!resource) throw new Error("Không tìm thấy tài liệu");

    await client.set(cacheKey, JSON.stringify(resource), { EX: 3600 }); // Cache 1 giờ

    // Tăng view
    await legalResourceModel.findByIdAndUpdate(id, { $inc: { views: 1 } });

    return resource;
};

// Persist slugs for old records, including records still present in the detail cache.
const ensureResourceSlug = async (resource) => {
    if (!resource || resource.slug) return resource;
    const result = withLegalResourceSlug(resource);
    await legalResourceModel.updateOne(
        { _id: resource._id, $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] },
        { $set: { slug: result.slug } },
        { overwriteImmutable: true }
    );
    return result;
};

const getResourceBySlug = async (slug) => {
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return null;
    const existing = await legalResourceModel.findOne({ slug, isPublished: true }).select('_id').lean();
    if (existing) return getResourceDetail(existing._id);
    const id = slug.match(/-([a-f0-9]{24})$/)?.[1];
    if (!id) return null;
    const legacy = await legalResourceModel.findOne({ _id: id, isPublished: true }).lean();
    if (!legacy || withLegalResourceSlug(legacy).slug !== slug) return null;
    return getResourceDetail(id);
};

const searchResources = async (textQuery, language = 'English') => {
    textQuery = toStr(textQuery);
    language = toStr(language) || 'English';
    if (!textQuery.trim()) return [];

    const resources = await legalResourceModel.find({
        $text: { $search: textQuery },
        language,
        isPublished: true
    }).sort({ score: { $meta: "textScore" } }).limit(20).lean();
    return resources.map(withLegalResourceSlug);
};

/**
 * Admin: Tạo tài liệu mới
 */
const createResource = async (data) => {
    const resourceData = { ...data };
    delete resourceData.slug;
    const resource = await legalResourceModel.create(resourceData);
    // Xóa cache danh sách
    await invalidateResourceCache(data.language, data.category);
    return resource;
};

/**
 * Admin: Cập nhật tài liệu
 */
const updateResource = async (id, data) => {
    const resource = await legalResourceModel.findById(id);
    if (!resource) throw new Error("Không tìm thấy tài liệu để cập nhật");
    if (!resource.slug) {
        resource.set('slug', withLegalResourceSlug(resource.toObject()).slug, undefined, { overwriteImmutable: true });
    }
    const resourceData = { ...data };
    delete resourceData.slug;
    Object.assign(resource, resourceData);
    await resource.save();

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
    // Xóa tất cả cache liên quan đến danh sách (tất cả các page, search, category)
    const keys = await client.keys('legal_resources:*');
    if (keys.length > 0) {
        await client.del(keys);
    }
};

module.exports = {
    getResources,
    getResourceDetail,
    getResourceBySlug,
    searchResources,
    createResource,
    updateResource,
    deleteResource,
    invalidateResourceCache
};
