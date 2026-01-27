const mongoose = require('mongoose');

const chatConversationSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    lastMessage: {
        text: String,
        senderID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }
}, { timestamps: true });

// Ensure unique conversation between two users
chatConversationSchema.index({ participants: 1 });

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
