const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema({
    bookingID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true
    },
    userID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    originalAmount: {
        type: Number,
        required: true
    },
    refundAmount: {
        type: Number,
        required: true
    },
    refundPercentage: {
        type: Number,
        enum: [0, 50, 100],
        required: true
    },
    refundReason: {
        type: String,
        required: true
    },
    bankAccount: {
        type: String,
        default: ''
    },
    bankName: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['Pending', 'Processed', 'Rejected'],
        default: 'Pending'
    },
    processedAt: {
        type: Date
    },
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    adminNote: {
        type: String,
        default: ''
    }
}, { timestamps: true });

module.exports = mongoose.model('Refund', refundSchema);
