const { Expo } = require("expo-server-sdk");
const sendEmail = require("../utils/sendEmail");

let expo = new Expo();

/**
 * Gửi thông báo đẩy qua Expo
 * @param {string} pushToken 
 * @param {string} title 
 * @param {string} body 
 * @param {object} data 
 */
const sendPushNotification = async (pushToken, title, body, data = {}) => {
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
        console.log("Token không hợp lệ, không thể gửi push notification");
        return;
    }

    const messages = [{
        to: pushToken,
        sound: "default",
        title: title,
        body: body,
        data: data,
    }];

    let chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
        try {
            await expo.sendPushNotificationsAsync(chunk);
        } catch (error) {
            console.error("Lỗi khi gửi push notification chunk:", error);
        }
    }
};

/**
 * Gửi thông báo kép (Email + Push)
  * @param {object} user - Đối tượng User (có email và expoPushToken)
 * @param {string} title 
 * @param {string} body
 */
const sendUnifiedNotification = async (user, title, body, data = {}) => {
    const tasks = [];

    // Gửi email
    if (user.email) {
        tasks.push(sendEmail(user.email, title, body));
    }

    // Gửi push notification
    if (user.expoPushToken) {
        tasks.push(sendPushNotification(user.expoPushToken, title, body, data));
    }

    try {
        await Promise.allSettled(tasks);
    } catch (error) {
        console.error("Lỗi khi gửi thông báo hợp nhất:", error);
    }
};

module.exports = {
    sendPushNotification,
    sendUnifiedNotification
};
