const mongoose = require('mongoose');

const articleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String, // Full content (HTML if requested)
        required: true
    },
    textContent: {
        type: String, // Plain text for AI/Search
        required: false
    },
    htmlContent: {
        type: String, // HTML content
        required: false
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lawyer',
        required: false // Optional for auto-crawled articles
    },
    sourceUrl: {
        type: String,
        unique: true, // Prevent duplicates
        sparse: true
    },
    externalId: {
        type: String
    },
    crawledAt: {
        type: Date
    },
    publishedDate: {
        type: Date
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
        enum: [
            'Dân sự', 'Hình sự', 'Hôn nhân gia đình', 'Đất đai', 'Kinh doanh thương mại', 'Hành chính', 'Lao động', 'Sở hữu trí tuệ', 'Thuế', 'Khác'
        ]
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
    embedding: {
        type: [Number],
        index: false // We will use Atlas Vector Search or a manual comparison for now
    },
    views: {
        type: Number,
        default: 0
    },
    downloadCount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Index for searching and filtering
articleSchema.index({ title: 'text', content: 'text' });
articleSchema.index({ status: 1 });
articleSchema.index({ category: 1 });
articleSchema.index({ tags: 1 });
articleSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Article', articleSchema);
