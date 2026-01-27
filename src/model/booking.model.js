const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    lawyerID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lawyer',
        required: true
    },
    date: {
        type: String, // Định dạng YYYY-MM-DD
        required: true
    },
    timeSlot: {
        start: { type: String, required: true },
        end: { type: String, required: true }
    },
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed'],
        default: 'Pending'
    },
    paymentStatus: {
        type: String,
        enum: ['Unpaid', 'Paid', 'Failed', 'Refunded'],
        default: 'Unpaid'
    },
    price: {
        type: Number,
        default: 0
    },
    addressMeeting: {
        type: String,
        default: ''
    },
    documents: [
        { type: String }
    ],
    actualPhone: {
        type: String,
        required: true
    },
    reminderSent: {
        type: Boolean,
        default: false
    },
    paymentInfo: {
        // Lưu thông tin từ SePay webhook để sau này hoàn tiền
        transactionID: String,
        gateway: String,
        content: String,
        description: String,
        senderAccount: String, // Nếu SePay phân tích được
        senderName: String,    // Nếu SePay phân tích được
        fullWebhookData: Object // Lưu toàn bộ data để dự phòng
    },
    cancelReason: {
        type: String,
        default: ''
    }
}, { timestamps: true });

// Compound unique index để ngăn chặn double booking
// Đảm bảo không có 2 booking cùng lawyerID, date, và timeSlot
bookingSchema.index(
    {
        lawyerID: 1,
        date: 1,
        'timeSlot.start': 1,
        'timeSlot.end': 1
    },
    {
        unique: true,
        name: 'unique_lawyer_timeslot'
    }
);

module.exports = mongoose.model('Booking', bookingSchema);
