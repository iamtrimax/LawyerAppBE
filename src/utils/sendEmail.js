const nodemailer = require("nodemailer");
require('dotenv').config();
const sendEmail = async (email, subject, text) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // Email của bạn
        pass: process.env.EMAIL_PASS, // App password từ Google
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      text: text,
    });
    console.log("Email đã được gửi thành công");
  } catch (error) {
    console.log("Email gửi thất bại:", error);
  }
};

module.exports = sendEmail;