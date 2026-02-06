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
    server.listen(process.env.PORT || 3000, '::', () => {
        console.log(`Server đang chạy `);
    });
}).catch((error) => {
    console.error('Không thể kết nối đến cơ sở dữ liệu:', error);
});
