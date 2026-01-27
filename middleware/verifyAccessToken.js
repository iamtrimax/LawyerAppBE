const jwt = require("jsonwebtoken");
const userModel = require("../src/model/user.model");
require("dotenv").config();

const verifyAccessToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        // Nếu access token hết hạn
        if (err.name === "TokenExpiredError") {
          const refreshToken = req.headers["x-refresh-token"];
          if (!refreshToken) {
            return res.status(401).json({ message: "Refresh token is missing" });
          }

          // Verify refresh token
          jwt.verify(refreshToken, process.env.JWT_SECRET, async (err, decode) => {
            if (err) {
              return res.status(403).json({
                message: "Invalid or expired refresh token",
              });
            }

            // Check user trong DB
            const user = await userModel.findById(decode.id);
            if (!user) {
              return res.status(404).json({ message: "User not found" });
            }
            if (!user.isActive) {
              return res.status(403).json({ message: "Tài khoản đã bị khóa" });
            }

            // Tạo access token mới
            const newAccessToken = jwt.sign(
              { id: user._id, email: user.email, role: user.role },
              process.env.JWT_SECRET,
              { expiresIn: "7d" }
            );

            const newRefreshToken = jwt.sign(
              { id: user._id, email: user.email, role: user.role },
              process.env.JWT_SECRET,
              { expiresIn: "14d" }
            );

            return res.status(200).json({
              message: "Token refreshed",
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
            });
          });
        } else {
          return res.status(403).json({ message: "Invalid token" });
        }
      } else {
        // Token hợp lệ
        const user = await userModel.findById(decoded.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Kiểm tra xem password có thay đổi sau khi token được phát hành không
        if (user.passwordChangedAt) {
          const changedTimestamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
          if (decoded.iat < changedTimestamp) {
            return res.status(401).json({ message: "Token đã bị thu hồi do đổi mật khẩu. Vui lòng đăng nhập lại." });
          }
        }

        req.userId = user._id; // gắn userId vào req để controller dùng
        req.user = user;
        next();
      }
    });
  } catch (error) {
    console.error("verifyAccessToken error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = verifyAccessToken;