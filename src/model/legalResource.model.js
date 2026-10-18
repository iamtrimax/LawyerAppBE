const mongoose = require('mongoose');
const { generateLegalResourceSlug } = require('../utils/legalResourceSlug');

const legalResourceSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    slug: { type: String, unique: true, sparse: true, immutable: true },
    description: {
        type: String,
        trim: true
    },
    content: {
        type: String, // Rich text (HTML/Markdown)
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Corporate', 'Commercial', 'Tax', 'Accounting']
    },
    language: {
        type: String,
        default: 'English'
    },
    attachments: [{
        name: { type: String },
        url: { type: String }
    }],
    thumbnail: {
        type: String
    },
    views: {
        type: Number,
        default: 0
    },
    isPublished: {
        type: Boolean,
        default: true
    },
    sourceUrl: {
        type: String
    },
    publishedDate: {
        type: Date
    }
}, { timestamps: true });

legalResourceSchema.pre('validate', function () {
    if (!this.slug) this.set('slug', generateLegalResourceSlug(this.title, this._id), undefined, { overwriteImmutable: true });
});

// Trải chỉ mục văn bản để tìm kiếm nhanh
legalResourceSchema.index({ title: 'text', content: 'text', description: 'text' });
legalResourceSchema.index({ category: 1, language: 1 });

module.exports = mongoose.model('LegalResource', legalResourceSchema);
