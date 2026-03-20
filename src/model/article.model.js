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
            'Hiến pháp', 'Bộ luật', 'Luật', 'Pháp lệnh', 'Lệnh',
            'Nghị quyết', 'Nghị quyết liên tịch', 'Nghị định',
            'Quyết định', 'Thông tư', 'Thông tư liên tịch', 'Khác',
            // Danh mục tùy chỉnh cho văn bản đất đai
            'Chính sách & Quy định chung',
            'Bồi thường & Giải phóng mặt bằng',
            'Giá đất & Nghĩa vụ tài chính',
            'Thủ tục hành chính & Cấp sổ đỏ',
            'Quy hoạch & Kế hoạch sử dụng đất',
            'Xử phạt & Thanh tra'
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
