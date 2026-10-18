const mongoose = require('mongoose');
const { generateLegalFormSlug } = require('../utils/legalFormSlug');

const legalFormSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        unique: true,
        sparse: true,
        immutable: true
    },
    description: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: [
            'Dân sự', 'Hình sự','Hôn nhân gia đình', 'Đất đai', 'Kinh doanh thương mại', 'Hành chính', 'Lao động', 'Sở hữu trí tuệ', 'Thuế', 'Khác'
        ]
    },
    lawyerID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lawyer'
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'approved' // Defaulting to approved for now as per system trust
    },
    fileUrl: {
        type: String,
        required: true
    },
    fileType: {
        type: String, // e.g., 'DOCX', 'PDF'
        required: true
    },
    downloadCount: {
        type: Number,
        default: 0
    },
    isFree: {
        type: Boolean,
        default: true
    },
    thumbnail: {
        type: String
    }
}, { timestamps: true });

legalFormSchema.pre('validate', function () {
    if (!this.slug) {
        this.set('slug', generateLegalFormSlug(this.name, this._id), undefined, { overwriteImmutable: true });
    }
});

// Index for search
legalFormSchema.index({ name: 'text', description: 'text' });
legalFormSchema.index({ category: 1 });

module.exports = mongoose.model('LegalForm', legalFormSchema);
