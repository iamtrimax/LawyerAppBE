const mongoose = require('mongoose');

const legalFormSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Civil', 'Criminal', 'Business', 'Labor', 'Family', 'Other']
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

// Index for search
legalFormSchema.index({ name: 'text', description: 'text' });
legalFormSchema.index({ category: 1 });

module.exports = mongoose.model('LegalForm', legalFormSchema);
