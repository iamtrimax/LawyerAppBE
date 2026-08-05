const express = require('express');
const connectMongoDb = require('./config/dbConfig');
const cors = require('cors');
const router = require('./route/routes');
const app = express();
require('dotenv').config();

const http = require('http');
const { initSocket } = require('./config/socket');
const { initReminderCron } = require('./services/reminder.cron');
const { initLegalSyncCron } = require('./services/legalSync.cron');
const { initializeVectorCache } = require('./services/aiSearch.service');
const { initNeo4j, closeNeo4j } = require('./config/neo4j');

// Khởi tạo Neo4j connection pool
initNeo4j();

// Shutdown hook để dọn dẹp kết nối
process.on('SIGINT', async () => {
    await closeNeo4j();
    process.exit(0);
});


// Ẩn header X-Powered-By: Express (giảm lộ thông tin stack)
app.disable('x-powered-by');

// CORS: chỉ cho phép origin của chính dự án + request không có Origin (app mobile, webhook)
// Có thể ghi đè qua biến môi trường CORS_ORIGINS (vd: "https://a.com,https://b.com")
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://pencillaw.com,https://www.pencillaw.com,https://api.pencillaw.com')
  .split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Không có Origin (curl, app mobile, webhook SePay...) => cho phép
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400
}));

// Security headers chung cho API
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Khởi chạy các tiến trình chạy ngầm
initReminderCron();
initLegalSyncCron();

// Định nghĩa một route cơ bản
app.use('/api', router);

const server = http.createServer(app);
initSocket(server);

connectMongoDb().then(() => {
    const port = process.env.PORT || 3000;
    server.listen(port, '0.0.0.0', () => {
        console.log(`Server đang chạy tại port ${port}`);
        // Tải Vector Cache sau khi kết nối DB và server đã lắng nghe
        initializeVectorCache().catch(err => console.error("Initial Cache Load Failed:", err));
    });
}).catch((error) => {
    console.error('Không thể kết nối đến cơ sở dữ liệu:', error);
});
