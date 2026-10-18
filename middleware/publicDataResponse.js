const { publicPayload } = require('../src/utils/publicPayload');

// Only explicitly selected public GET routes use this response contract.
module.exports = type => (req, res, next) => {
    const json = res.json.bind(res);
    res.json = body => {
        if (res.statusCode >= 400 || body?.success === false) {
            if (res.statusCode < 400) res.status(400);
            const messages = {
                400: 'Yêu cầu không hợp lệ.',
                403: 'Bạn không có quyền truy cập dữ liệu này.',
                404: 'Không tìm thấy dữ liệu.',
                429: 'Có quá nhiều yêu cầu. Vui lòng thử lại sau.',
            };
            return json({ data: { message: messages[res.statusCode] || 'Không thể tải dữ liệu. Vui lòng thử lại sau.' } });
        }
        return json({ data: publicPayload(type, body || {}) });
    };
    next();
};
