const mongoose = require('mongoose');

const legalAiHistorySchema = new mongoose.Schema({
    userID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    prompt: {
        type: String,
        required: true
    },
    generatedContent: {
        type: Object, // Stores the JSON structure from Gemini
        required: true
    },
    title: String,
    formType: String
}, { timestamps: true });

module.exports = mongoose.model('LegalAiHistory', legalAiHistorySchema);
