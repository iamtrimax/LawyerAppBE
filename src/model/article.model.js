const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String, // Rich text (HTML) content
        required: true
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lawyer',
        required: true
    },
    images: [{
        type: String // URLs to images (Cloudinary)
    }],
    thumbnail: {
        type: String
    },
    category: {
        type: String,
        required: true,
        enum: ['Dân sự', 'Hình sự', 'Đất đai', 'Hôn nhân', 'Lao động', 'Kinh doanh', 'Khác']
    },
    tags: [{
        type: String
    }],
    status: {
        type: String,
        enum: ['Draft', 'Published'],
        default: 'Published'
    },
    attachments: [{
        name: { type: String },
        url: { type: String }
    }],
    views: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Index for searching
articleSchema.index({ title: 'text', content: 'text', category: 1 });

module.exports = mongoose.model('Article', articleSchema);
