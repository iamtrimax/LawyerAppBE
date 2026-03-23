const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
    fullname: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    phone: {
        type: String,
        required: false,
        unique: true,
        sparse: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['customer', 'member', 'lawyer', 'admin'],
        default: "customer"
    },
    otp: {
        type: String,
        default: ""
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    refreshTokens: {
        type: String,
    },
    expoPushToken: { type: String, default: null },
    points: {
        type: Number,
        default: 0
    },
    rank: {
        type: String,
        enum: ['Bạc', 'Vàng', 'Bạch kim', 'Kim cương'],
        default: 'Bạc'
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    passwordChangedAt: { type: Date }
});

module.exports = mongoose.model('User', userSchema);