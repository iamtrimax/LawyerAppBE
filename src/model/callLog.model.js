const mongoose = require('mongoose');

const callLogSchema = new mongoose.Schema({
    callerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['audio', 'video'],
        default: 'audio'
    },
    status: {
        type: String,
        enum: ['missed', 'connected', 'rejected', 'no-answer', 'ended'],
        default: 'missed'
    },
    startTime: {
        type: Date,
        default: null
    },
    endTime: {
        type: Date,
        default: null
    },
    duration: {
        type: Number, // tính bằng giây
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('CallLog', callLogSchema);
