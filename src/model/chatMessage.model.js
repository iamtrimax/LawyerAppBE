const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
    conversationID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatConversation',
        required: true
    },
    senderID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    text: {
        type: String,
        required: true
    },
    attachments: [{
        name: String,
        url: String,
        fileType: String
    }],
    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

chatMessageSchema.index({ conversationID: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
