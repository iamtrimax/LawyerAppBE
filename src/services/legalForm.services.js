const legalFormModel = require("../model/legalForm.model");
const client = require("../config/redis");

/**
 * Lấy danh sách văn bản mẫu
 */
const getForms = async ({ category, page = 1, limit = 10, search }) => {
    const skip = (page - 1) * limit;
    const query = {};
    if (category) query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };

    const cacheKey = `legal_forms:${category || 'all'}:${page}:${limit}:${search || 'none'}`;
    const cached = await client.get(cacheKey);
    if (cached) return JSON.parse(cached);

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
        data,
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
    return await legalFormModel.findById(id)
        .populate({
            path: 'lawyerID',
            populate: {
                path: 'userID',
                select: 'fullname email'
            },
            select: 'userID avatar'
        })
        .lean();
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
    const form = await legalFormModel.create(data);
    await invalidateFormCache(data.category);
    return form;
};

/**
 * Admin: Cập nhật văn bản mẫu
 */
const updateForm = async (id, data) => {
    const form = await legalFormModel.findByIdAndUpdate(id, data, { new: true });
    if (form) {
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
    return await legalFormModel.find({ lawyerID }).sort({ createdAt: -1 }).lean();
};

/**
 * Lawyer: Cập nhật văn bản mẫu của tôi
 */
const updateLawyerForm = async (id, data, lawyerID) => {
    const form = await legalFormModel.findOne({ _id: id, lawyerID });
    if (!form) throw new Error("Không tìm thấy văn bản mẫu hoặc bạn không có quyền chỉnh sửa");

    Object.assign(form, data);
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
    const keys = [
        `legal_forms:${category}:1:10`,
        `legal_forms:all:1:10`
    ];
    for (const key of keys) {
        await client.del(key);
    }
};

/**
 * Tìm kiếm văn bản mẫu bằng text index
 */
const searchForms = async (textQuery) => {
    if (!textQuery) return [];
    return await legalFormModel.find({
        $text: { $search: textQuery }
    }).sort({ score: { $meta: "textScore" } }).limit(20).lean();
};

module.exports = {
    getForms,
    getFormDetail,
    incrementDownload,
    createForm,
    updateForm,
    deleteForm,
    getLawyerForms,
    updateLawyerForm,
    deleteLawyerForm,
    searchForms
};
