const verifyAdmin = (req, res, next) => {
  try {
    const user = req.user;
    if (user.role !== "admin") {
        return res.status(403).send("Forbidden");
    }
    next();
  } catch (error) {
    console.error("verifyAdmin error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
module.exports = verifyAdmin; 