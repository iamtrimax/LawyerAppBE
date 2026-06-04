const mongoose = require('mongoose');

const memberUpgradeSchema = new mongoose.Schema({
    userID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'Cancelled'],
        default: 'Pending'
    },
    paymentCode: {
        type: String,
        required: true,
        unique: true
    },
    paymentInfo: {
        transactionID: String,
        gateway: String,
        content: String,
        description: String,
        senderAccount: String,
        senderName: String,
        fullWebhookData: Object
    },
    paidAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

memberUpgradeSchema.index({ userID: 1, status: 1 });

module.exports = mongoose.model('MemberUpgrade', memberUpgradeSchema);
