const legalFormModel = require("../model/legalForm.model");
const client = require("../config/redis");
const { withLegalFormSlug } = require("../utils/legalFormSlug");

// Ép kiểu chuỗi an toàn: chặn NoSQL injection khi client gửi object qua query params
const toStr = (value) => (typeof value === 'string' ? value : '');

/**
 * Lấy danh sách văn bản mẫu
 */
const getForms = async ({ category, page = 1, limit = 10, search }) => {
    category = toStr(category);
    search = toStr(search);
    const skip = (page - 1) * limit;
    const query = {};
    if (category) query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };

    const cacheKey = `legal_forms:${category || 'all'}:${page}:${limit}:${search || 'none'}`;
    const cached = await client.get(cacheKey);
    if (cached) {
        const result = JSON.parse(cached);
        return { ...result, data: result.data.map(withLegalFormSlug) };
    }

    const [data, total] = await Promise.all([
        legalFormModel.find(query)
            .populate({
                path: 'lawyerID',
                populate: {
                    path: 'userID',
                    select: 'fullname email'
                },
                select: 'userID avatar'
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        legalFormModel.countDocuments(query)
    ]);

    const result = {
        data: data.map(withLegalFormSlug),
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };

    await client.set(cacheKey, JSON.stringify(result), { EX: 600 });
    return result;
};

/**
 * Lấy chi tiết văn bản mẫu
 */
const getFormDetail = async (id) => {
    const form = await legalFormModel.findById(id)
        .populate({
            path: 'lawyerID',
            populate: {
                path: 'userID',
                select: 'fullname email'
            },
            select: 'userID avatar'
        })
        .lean();
    return ensureFormSlug(form);
};

// Fill old records lazily so existing forms need no manual migration.
const ensureFormSlug = async (form) => {
    if (!form || form.slug) return form;
    const result = withLegalFormSlug(form);
    await legalFormModel.updateOne(
        { _id: form._id, $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] },
        { $set: { slug: result.slug } },
        { overwriteImmutable: true }
    );
    return result;
};

const getFormBySlug = async (slug) => {
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return null;
    const existing = await legalFormModel.findOne({ slug }).select('_id').lean();
    if (existing) return getFormDetail(existing._id);

    // A cached list can share a form before its slug has been saved.
    const id = slug.match(/-([a-f0-9]{24})$/)?.[1];
    if (!id) return null;
    const form = await getFormDetail(id);
    return form?.slug === slug ? form : null;
};

/**
 * Tăng số lượt tải
 */
const incrementDownload = async (id) => {
    return await legalFormModel.findByIdAndUpdate(id, { $inc: { downloadCount: 1 } }, { new: true });
};

/**
 * Admin: Thêm văn bản mẫu mới
 */
const createForm = async (data) => {
    const formData = { ...data };
    delete formData.slug;
    const form = await legalFormModel.create(formData);
    await invalidateFormCache(data.category);
    return form;
};

/**
 * Admin: Cập nhật văn bản mẫu
 */
const updateForm = async (id, data) => {
    const form = await legalFormModel.findById(id);
    if (form) {
        const formData = { ...data };
        delete formData.slug;
        if (!form.slug) {
            form.set('slug', withLegalFormSlug(form.toObject()).slug, undefined, { overwriteImmutable: true });
        }
        Object.assign(form, formData);
        await form.save();
        await invalidateFormCache(form.category);
    }
    return form;
};

/**
 * Admin: Xóa văn bản mẫu
 */
const deleteForm = async (id) => {
    const form = await legalFormModel.findByIdAndDelete(id);
    if (form) {
        await invalidateFormCache(form.category);
    }
    return form;
};

/**
 * Lawyer: Lấy danh sách văn bản mẫu của tôi
 */
const getLawyerForms = async (lawyerID) => {
    const forms = await legalFormModel.find({ lawyerID }).sort({ createdAt: -1 }).lean();
    return forms.map(withLegalFormSlug);
};

/**
 * Lawyer: Cập nhật văn bản mẫu của tôi
 */
const updateLawyerForm = async (id, data, lawyerID) => {
    const form = await legalFormModel.findOne({ _id: id, lawyerID });
    if (!form) throw new Error("Không tìm thấy văn bản mẫu hoặc bạn không có quyền chỉnh sửa");

    const formData = { ...data };
    delete formData.slug;
    if (!form.slug) {
        form.set('slug', withLegalFormSlug(form.toObject()).slug, undefined, { overwriteImmutable: true });
    }
    Object.assign(form, formData);
    await form.save();

    await invalidateFormCache(form.category);
    return form;
};

/**
 * Lawyer: Xóa văn bản mẫu của tôi
 */
const deleteLawyerForm = async (id, lawyerID) => {
    const form = await legalFormModel.findOneAndDelete({ _id: id, lawyerID });
    if (!form) throw new Error("Không tìm thấy văn bản mẫu hoặc bạn không có quyền xóa");

    await invalidateFormCache(form.category);
    return form;
};

/**
 * Helper: Xóa cache danh sách
 */
const invalidateFormCache = async (category) => {
    // Xóa tất cả cache liên quan đến danh sách (tất cả các page, search, category)
    const keys = await client.keys('legal_forms:*');
    if (keys.length > 0) {
        await client.del(keys);
    }
};

/**
 * Tìm kiếm văn bản mẫu bằng text index
 */
const searchForms = async (textQuery) => {
    textQuery = toStr(textQuery);
    if (!textQuery.trim()) return [];
    const forms = await legalFormModel.find({
        $text: { $search: textQuery }
    }).sort({ score: { $meta: "textScore" } }).limit(20).lean();
    return forms.map(withLegalFormSlug);
};

module.exports = {
    getForms,
    getFormDetail,
    getFormBySlug,
    incrementDownload,
    createForm,
    updateForm,
    deleteForm,
    getLawyerForms,
    updateLawyerForm,
    deleteLawyerForm,
    searchForms
};
