const mongoose = require('mongoose');
const { syncEnglishLaws } = require('./src/services/legalSync.cron');
require('dotenv').config();

const runManualSync = async () => {
    try {
        console.log("Đang kết nối Database để chạy đồng bộ THẬT...");
        await mongoose.connect(process.env.URL_DB || 'mongodb://localhost:27017/lawyerDB');

        console.log("Bắt đầu gọi hàm sync từ RSS sources (Vietnam News, Vietnam Business Law)...");
        await syncEnglishLaws();

        console.log("Đồng bộ hoàn tất!");
        process.exit(0);
    } catch (error) {
        console.error("Lỗi khi chạy sync thủ công:", error);
        process.exit(1);
    }
};

runManualSync();
