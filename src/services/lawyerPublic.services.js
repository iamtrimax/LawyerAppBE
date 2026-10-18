const lawyerModel = require('../model/lawyer.model');
const { generateLegalFormSlug } = require('../utils/legalFormSlug');
const generateLawyerSlug = fullname => generateLegalFormSlug(fullname, '', 'luat-su').replace(/-$/, '');
const PUBLIC_FIELDS = '_id userID slug avatar lawyerId specialty firmName yearsOfExperience titleDegree operatingProvinces introduction isApproved';

const publicQuery = query => lawyerModel.findOne({ ...query, isApproved: true })
    .select(PUBLIC_FIELDS)
    .populate({ path: 'userID', select: '_id fullname isActived', match: { isActived: true } });

// Existing profiles receive a stable name slug the first time they are discovered.
const withLawyerSlug = async lawyer => {
    if (!lawyer || lawyer.slug || !lawyer.userID?.fullname) return lawyer;
    const base = generateLawyerSlug(lawyer.userID.fullname);
    for (const candidate of [base, `${base}-${lawyer._id}`]) {
        try {
            const saved = await lawyerModel.findOneAndUpdate(
                { _id: lawyer._id, $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] },
                { $set: { slug: candidate } },
                { new: true, overwriteImmutable: true }
            ).select('slug').lean();
            // A simultaneous request may already have assigned this profile's slug.
            const current = saved || await lawyerModel.findById(lawyer._id).select('slug').lean();
            if (current?.slug) return { ...lawyer, slug: current.slug };
            return null;
        } catch (error) {
            if (error.code !== 11000 || candidate !== base) throw error;
        }
    }
    return null;
};

const asList = value => Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : []);

const toPublicLawyer = lawyer => {
    if (!lawyer?.isApproved || !lawyer.userID?.isActived) return null;
    return {
        _id: lawyer._id,
        slug: lawyer.slug,
        avatar: lawyer.avatar,
        lawyerId: lawyer.lawyerId,
        specialty: asList(lawyer.specialty),
        firmName: lawyer.firmName,
        yearsOfExperience: lawyer.yearsOfExperience,
        titleDegree: lawyer.titleDegree,
        operatingProvinces: asList(lawyer.operatingProvinces),
        introduction: lawyer.introduction || '',
        isApproved: true,
        userID: { _id: lawyer.userID._id, fullname: lawyer.userID.fullname },
    };
};

const getPublicLawyerById = async id => {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) return null;
    const lawyer = await publicQuery({ _id: id }).lean();
    if (!lawyer?.userID) return null;
    return toPublicLawyer(await withLawyerSlug(lawyer));
};

const getPublicLawyerBySlug = async slug => {
    if (typeof slug !== 'string' || !/^[a-z0-9-]{1,150}$/.test(slug)) return null;
    const lawyer = await publicQuery({ slug }).lean();
    if (lawyer?.userID) return toPublicLawyer(lawyer);
    // Direct name URLs also work before an older profile has appeared in Discovery.
    const legacy = await lawyerModel.find({ isApproved: true, $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] })
        .select(PUBLIC_FIELDS)
        .populate({ path: 'userID', select: '_id fullname isActived', match: { isActived: true } }).lean();
    for (const candidate of legacy) {
        if (!candidate.userID || generateLawyerSlug(candidate.userID.fullname) !== slug) continue;
        const saved = await withLawyerSlug(candidate);
        if (saved?.slug === slug) return toPublicLawyer(saved);
    }
    return null;
};

module.exports = { generateLawyerSlug, withLawyerSlug, toPublicLawyer, getPublicLawyerById, getPublicLawyerBySlug };
