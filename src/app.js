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


app.use(cors());
app.use(express.json()); // Cho phép nhận JSON body

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
