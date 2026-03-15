const redisClient = require('../src/config/redis');

/**
 * Middleware Rate Limiter sử dụng thuật toán Sliding Window (Cửa sổ trượt)
 * @param {Object} options - Cấu hình tùy chỉnh (windowMs, max, prefix)
 */
const rateLimiter = (options = {}) => {
    return async (req, res, next) => {
        // Sử dụng IP address hoặc userId (nếu đã login) để làm key
        const identifier = req.userId || req.ip;

        // Window và Max mặc định từ env hoặc tham số
        const windowMs = options.windowMs || parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
        const maxRequests = options.max || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;
        const prefix = options.prefix || "global";

        const key = `rate_limit:${prefix}:${identifier}`;
        const now = Date.now();

        try {
            // 1. Loại bỏ các request đã quá thời gian cửa sổ
            await redisClient.zRemRangeByScore(key, 0, now - windowMs);

            // 2. Đếm số lượng request hiện tại trong cửa sổ
            const requestCount = await redisClient.zCard(key);

            if (requestCount >= maxRequests) {
                return res.status(429).json({
                    success: false,
                    message: `Bạn đã thực hiện quá nhiều yêu cầu vào chức năng ${prefix}. Vui lòng thử lại sau.`,
                    retryAfter: Math.ceil(windowMs / 1000) + "s"
                });
            }

            // 3. Thêm request hiện tại vào set
            await redisClient.zAdd(key, {
                score: now,
                value: now.toString()
            });

            // 4. Thiết lập thời gian sống cho key
            await redisClient.expire(key, Math.ceil(windowMs / 1000));

            next();
        } catch (error) {
            console.error(`Lỗi Middleware Rate Limiter (${prefix}):`, error);
            next();
        }
    };
};

module.exports = rateLimiter;
