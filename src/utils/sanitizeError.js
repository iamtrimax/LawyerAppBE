/**
 * Chuyển đổi lỗi từ hệ thống sang message an toàn để trả về client.
 * Chống lộ thông tin nội bộ (tên model, cấu trúc DB, stack trace...)
 */
const sanitizeError = (err, fallback = "Lỗi server nội bộ") => {
  if (!err) return fallback;

  if (err.name === "CastError") return "Dữ liệu không hợp lệ";
  if (err.name === "ValidationError") return "Dữ liệu không hợp lệ";
  if (err.code === 11000) return "Dữ liệu đã tồn tại trong hệ thống";

  // Giới hạn độ dài message để tránh leak thông tin dài (stack, query...)
  const message = typeof err.message === "string" ? err.message : fallback;
  return message.length > 300 ? fallback : message;
};

module.exports = sanitizeError;
