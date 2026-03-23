const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    AlignmentType, BorderStyle, WidthType, TableRow, TableCell, Table
} = require('docx');
const legalFormModel = require('../model/legalForm.model');
const legalAiHistoryModel = require('../model/legalAiHistory.model');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
 * Kết hợp Web Search (Grounding): Sử dụng Google Search để tìm kiếm mẫu đơn mới nhất trên mạng
 */
const generateFormContent = async (userPrompt, userID = null) => {
    // Sử dụng model gemini-1.5-flash hỗ trợ grounding
    const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        tools: [
            {
                googleSearch: {},
            },
        ],
    });

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

    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text().trim();

    // Bỏ code block markdown nếu có
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
