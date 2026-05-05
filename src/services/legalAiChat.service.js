const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, BorderStyle, WidthType, TableRow, TableCell, Table
} = require('docx');
const legalFormModel = require('../model/legalForm.model');
const legalAiHistoryModel = require('../model/legalAiHistory.model');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Danh sách model hỗ trợ Google Search Grounding
const AVAILABLE_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-pro", 
    "gemini-2.0-flash",
    "gemini-flash-latest",
    "gemini-pro-latest"
];

/**
 * Danh sách mẫu đơn phổ biến
 */
const COMMON_FORM_TYPES = [
    { key: 'don_khieu_nai', label: 'Đơn khiếu nại' },
    { key: 'don_to_cao', label: 'Đơn tố cáo' },
    { key: 'don_ly_hon', label: 'Đơn xin ly hôn' },
    { key: 'hop_dong_lao_dong', label: 'Hợp đồng lao động' },
    { key: 'hop_dong_mua_ban', label: 'Hợp đồng mua bán' },
    { key: 'don_xin_bao_lanh', label: 'Đơn xin bảo lãnh' },
    { key: 'don_xin_viec', label: 'Đơn xin việc' },
    { key: 'bien_ban_hop', label: 'Biên bản họp' },
    { key: 'giay_uy_quyen', label: 'Giấy ủy quyền' },
    { key: 'don_de_nghi', label: 'Đơn đề nghị' }
];

/**
 * Kết hợp Web Search (Grounding) + Multi-Key + Multi-Model Fallback
 */
const generateFormContent = async (userPrompt, userID = null) => {
    const systemPrompt = `
Bạn là chuyên gia pháp lý Việt Nam. Người dùng yêu cầu tạo một mẫu đơn / tài liệu pháp luật.
NHIỆM VỤ QUAN TRỌNG: 
1. Sử dụng công cụ Google Search để tìm kiếm các mẫu đơn/văn bản pháp luật cập nhật mới nhất từ các nguồn uy tín trên mạng (như maudon.vn, thuvienphapluat.vn, luatvietnam.vn).
2. Dựa trên các mẫu tìm được, hãy sinh ra nội dung mẫu đầy đủ, chuẩn xác theo quy định pháp luật Việt Nam hiện hành.

Trả về dữ liệu JSON CHÍNH XÁC theo format sau:
{
  "title": "Tiêu đề của mẫu đơn",
  "formType": "Tên loại mẫu đơn",
  "sourceUrl": "Link nguồn bạn đã tham khảo từ Google Search",
  "sections": [
    {
      "type": "heading",
      "text": "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
    },
    {
      "type": "subheading",
      "text": "Độc lập - Tự do - Hạnh phúc"
    },
    {
      "type": "paragraph",
      "text": "Nội dung đoạn văn..."
    },
    {
      "type": "field",
      "label": "Họ và tên:",
      "value": "[Họ tên người làm đơn]"
    },
    {
      "type": "signature",
      "text": "Xác nhận và ký tên"
    }
  ],
  "notes": "Hướng dẫn điền và nộp mẫu đơn này"
}

YÊU CẦU CỦA NGƯỜI DÙNG:
${userPrompt}

CHỈ trả về JSON thuần túy:`;

    // MULTI-KEY & MULTI-MODEL FALLBACK
    const API_KEYS = process.env.GEMINI_API_KEY.split(',').map(k => k.trim());
    let responseText = "";
    let keyIndex = 0;
    let modelIndex = 0;
    let retryCount = 0;
    const MAX_RETRIES_PER_MODEL = 1;

    while (keyIndex < API_KEYS.length && !responseText) {
        const currentKey = API_KEYS[keyIndex];
        const genAIInstance = new GoogleGenerativeAI(currentKey);
        modelIndex = 0;

        while (modelIndex < AVAILABLE_MODELS.length) {
            const currentModelName = AVAILABLE_MODELS[modelIndex];
            const model = genAIInstance.getGenerativeModel({
                model: currentModelName,
                tools: [{ googleSearch: {} }]
            });

            try {
                console.log(`📝 PencilLaw AI: Key ${keyIndex + 1}/${API_KEYS.length} - Model ${currentModelName}`);
                const result = await model.generateContent(systemPrompt);
                const response = await result.response;
                responseText = response.text().trim();
                if (responseText) break;
            } catch (err) {
                const errorMessage = err.message || "";
                const isQuotaError = errorMessage.includes('429') ||
                                     errorMessage.includes('Quota exceeded') ||
                                     errorMessage.includes('rate limit');
                const isRetryableError = errorMessage.includes('503') ||
                                         errorMessage.includes('high demand');

                if (isQuotaError) {
                    console.warn(`⚠️ PencilLaw AI: Key ${keyIndex + 1} - Model ${currentModelName} hết quota, chuyển model...`);
                    modelIndex++;
                    continue;
                }

                if (isRetryableError && retryCount < MAX_RETRIES_PER_MODEL) {
                    retryCount++;
                    console.warn(`🔄 PencilLaw AI: Model ${currentModelName} lỗi tạm thời, thử lại...`);
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                console.error(`❌ PencilLaw AI: Model ${currentModelName} lỗi: ${errorMessage}`);
                modelIndex++;
                retryCount = 0;
            }
        }

        if (!responseText) {
            keyIndex++;
            console.warn(`🔑 PencilLaw AI: Chuyển sang API Key ${keyIndex + 1}...`);
        }
    }

    if (!responseText) {
        throw new Error('Tất cả API Key và Model đều hết quota. Vui lòng thử lại sau.');
    }

    // Parse JSON response
    const cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

    const parsedData = JSON.parse(cleaned);

    // Lưu vào lịch sử nếu có userID
    if (userID) {
        await legalAiHistoryModel.create({
            userID,
            prompt: userPrompt,
            generatedContent: parsedData,
            title: parsedData.title,
            formType: parsedData.formType
        }).catch(err => console.error("Save AI history failed:", err.message));
    }

    return parsedData;
};

/**
 * Lấy lịch sử sinh đơn AI của người dùng
 */
const getAiGenerationHistory = async (userID) => {
    return await legalAiHistoryModel.find({ userID })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
};


/**
 * Tạo file DOCX từ nội dung được Gemini sinh ra
 */
const buildDocxFromContent = async (formData) => {
    const children = [];

    for (const section of formData.sections) {
        switch (section.type) {
            case 'heading':
                children.push(new Paragraph({
                    text: section.text,
                    heading: HeadingLevel.HEADING_1,
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 100 }
                }));
                break;

            case 'subheading':
                children.push(new Paragraph({
                    text: section.text,
                    heading: HeadingLevel.HEADING_2,
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 200 }
                }));
                break;

            case 'paragraph':
                children.push(new Paragraph({
                    children: [new TextRun({ text: section.text, size: 24 })],
                    spacing: { after: 200 },
                    indent: { firstLine: 720 }
                }));
                break;

            case 'field':
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: `${section.label} `, bold: true, size: 24 }),
                        new TextRun({ text: section.value || '', size: 24 })
                    ],
                    spacing: { after: 150 }
                }));
                break;

            case 'list':
                if (Array.isArray(section.items)) {
                    section.items.forEach(item => {
                        children.push(new Paragraph({
                            children: [new TextRun({ text: `• ${item}`, size: 24 })],
                            indent: { left: 720 },
                            spacing: { after: 100 }
                        }));
                    });
                }
                break;

            case 'signature':
                children.push(new Paragraph({ text: '', spacing: { after: 400 } }));
                children.push(new Paragraph({
                    children: [new TextRun({ text: section.text || 'Ký và ghi rõ họ tên', italics: true, size: 22 })],
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 100 }
                }));
                children.push(new Paragraph({
                    children: [new TextRun({ text: '(Chữ ký)', size: 22 })],
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 600 }
                }));
                break;

            default:
                children.push(new Paragraph({
                    children: [new TextRun({ text: section.text || '', size: 24 })],
                    spacing: { after: 150 }
                }));
        }
    }

    // Notes section
    if (formData.notes) {
        children.push(new Paragraph({ text: '', spacing: { after: 400 } }));
        children.push(new Paragraph({
            children: [new TextRun({ text: 'Ghi chú hướng dẫn:', bold: true, size: 22 })],
            spacing: { after: 100 }
        }));
        children.push(new Paragraph({
            children: [new TextRun({ text: formData.notes, italics: true, size: 22, color: '666666' })],
            spacing: { after: 100 }
        }));
    }

    const doc = new Document({
        creator: 'LegalAI Assistant',
        title: formData.title || 'Mẫu đơn pháp lý',
        description: formData.formType || '',
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: 1440,
                        right: 1080,
                        bottom: 1440,
                        left: 1440
                    }
                }
            },
            children
        }]
    });

    return await Packer.toBuffer(doc);
};

module.exports = {
    generateFormContent,
    buildDocxFromContent,
    COMMON_FORM_TYPES,
    getAiGenerationHistory
};
