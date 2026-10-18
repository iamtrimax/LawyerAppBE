const { getIceServers } = require('../services/iceServers.services');
const getIceServersController = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.user?.isActived !== true) {
        return res.status(403).json({ data: { message: 'Tài khoản không được phép sử dụng cuộc gọi.' } });
    }
    try {
        return res.status(200).json({ data: await getIceServers() });
    } catch {
        return res.status(503).json({ data: { message: 'Chưa thể tải cấu hình cuộc gọi. Vui lòng thử lại sau.' } });
    }
};
module.exports = { getIceServersController };
