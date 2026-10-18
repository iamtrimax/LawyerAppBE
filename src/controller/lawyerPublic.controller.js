const { getPublicLawyerById, getPublicLawyerBySlug } = require('../services/lawyerPublic.services');
const sanitizeError = require('../utils/sanitizeError');
const detail = lookup => async (req, res) => {
    try {
        const lawyer = await lookup(req.params.slug || req.params.id);
        if (!lawyer) return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ luật sư.' });
        res.status(200).json({ success: true, data: lawyer });
    } catch (error) {
        console.error('Public lawyer profile error:', error);
        res.status(500).json({ success: false, message: sanitizeError(error) });
    }
};
module.exports = {
    getPublicLawyerByIdController: detail(getPublicLawyerById),
    getPublicLawyerBySlugController: detail(getPublicLawyerBySlug),
};
