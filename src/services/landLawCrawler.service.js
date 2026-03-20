const axios = require('axios');
const cheerio = require('cheerio');
const articleModel = require('../model/article.model');
const { generateEmbedding } = require('./embedding.service');
const { updateVectorCache } = require('./aiSearch.service');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Headers để bypass anti-bot của LuatVietnam
const CRAWL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.google.com/',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
};

const ALLOWED_CATEGORIES = [
    'Chính sách & Quy định chung',
    'Bồi thường & Giải phóng mặt bằng',
    'Giá đất & Nghĩa vụ tài chính',
    'Thủ tục hành chính & Cấp sổ đỏ',
    'Quy hoạch & Kế hoạch sử dụng đất',
    'Xử phạt & Thanh tra',
    'Khác'
];

/**
 * Lấy toàn bộ nội dung HTML từ div#noidung sau đó convert sang text
 */
const fetchFullContent = async (url) => {
    try {
        const response = await axios.get(url, {
            headers: CRAWL_HEADERS,
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024 // 50MB
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Lấy tiêu đề từ h1
        const title = $('h1').first().text().trim() || $('title').text().trim();

        // Lấy toàn bộ nội dung div#noidung
        const noidungHtml = $('#noidung').html();
        
        if (!noidungHtml || noidungHtml.trim().length < 100) {
            console.log(`  ⚠️ #noidung quá ngắn hoặc trống tại: ${url}`);
            // Thử lấy nội dung từ article chính
            const articleHtml = $('article.the-document').html() || $('.content-detail').html();
            if (!articleHtml) return null;
            return { title, html: articleHtml, text: $(articleHtml).text().replace(/\s+/g, ' ').trim() };
        }

        // Convert HTML sang text thuần
        const $noidung = cheerio.load(noidungHtml);
        
        // Loại bỏ các thành phần UI không mong muốn (CSS selectors cụ thể)
        $noidung('script, style, link, meta, iframe, .breadcrumb, .box-monitoring, .monitor-doc, .monitor-doc-item, .breadcrumb-item, .monitor-link').remove();
        
        // Chỉ loại bỏ các thẻ a hoặc span chứa text "đang theo dõi" (tránh xóa các thẻ div to)
        $noidung('a, span, p').each((i, el) => {
            const text = $noidung(el).text().toLowerCase();
            if (text.includes('đang theo dõi') || text.includes('phần đang xem')) {
                $noidung(el).remove();
            }
        });

        const text = $noidung.text().replace(/\s+/g, ' ').trim();

        return { title, html: $noidung.html(), text };
    } catch (err) {
        console.error(`  ❌ Error fetching ${url}:`, err.message);
        return null;
    }
};

/**
 * Phân loại văn bản bằng AI
 */
const classifyWithAI = async (title, textSnippet) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
        const prompt = `Bạn là chuyên gia pháp lý Việt Nam. Phân loại văn bản luật sau vào MỘT nhóm:
${ALLOWED_CATEGORIES.join(', ')}.

Tiêu đề: ${title}
Nội dung: ${textSnippet.substring(0, 1000)}

Chỉ trả về tên nhóm chính xác.`;
        const result = await model.generateContent(prompt);
        const category = (await result.response).text().trim();
        
        // Validate category
        const matched = ALLOWED_CATEGORIES.find(c => category.includes(c));
        return matched || 'Khác';
    } catch (err) {
        console.error("  AI Classification failed:", err.message);
        return "Khác";
    }
};

/**
 * Crawl và lưu một văn bản
 */
const crawlAndSaveDocument = async (url, customTitle = null) => {
    console.log(`\n📄 Đang crawl: ${url}`);
    
    const fetched = await fetchFullContent(url);
    if (!fetched) {
        console.log(`  ❌ Không lấy được nội dung`);
        return null;
    }

    const title = customTitle || fetched.title;
    console.log(`  📝 Tiêu đề: ${title}`);
    console.log(`  📊 Độ dài nội dung: ${fetched.text.length} ký tự`);

    // Kiểm tra xem đã có category trong DB chưa để tránh gọi AI lãng phí
    const existingDoc = await articleModel.findOne({ sourceUrl: url });
    let category = existingDoc ? existingDoc.category : null;

    if (!category || category === 'Khác') {
        category = await classifyWithAI(title, fetched.text);
        console.log(`  🏷️  Danh mục (AI): ${category}`);
    } else {
        console.log(`  🏷️  Danh mục (Reuse): ${category}`);
    }

    // Tạo embedding từ tiêu đề + 8000 ký tự đầu nội dung
    const embeddingText = title + "\n" + fetched.text.substring(0, 8000);
    const embedding = await generateEmbedding(embeddingText);

    const docData = {
        title,
        content: fetched.html,       // Lưu HTML vào trường content chính theo yêu cầu người dùng
        textContent: fetched.text,    // Lưu text thuần vào trường phụ để search/AI (tùy chọn)
        htmlContent: fetched.html,    // Vẫn giữ htmlContent cho đồng bộ schema
        category,
        sourceUrl: url,
        status: 'Published',
        crawledAt: new Date(),
        embedding
    };

    const updated = await articleModel.findOneAndUpdate(
        { sourceUrl: url },
        { $set: docData },
        { upsert: true, new: true }
    );

    if (updated && updated._id) {
        if (embedding) updateVectorCache(updated._id, embedding);
        console.log(`  ✅ Đã lưu thành công (với HTML)!`);
    }

    return updated;
};

/**
 * Crawl danh sách văn bản từ URL trang tổng hợp
 */
const crawlDocumentList = async (listUrl) => {
    try {
        const response = await axios.get(listUrl, { headers: CRAWL_HEADERS, timeout: 30000 });
        const $ = cheerio.load(response.data);
        const links = new Set();

        // Tìm tất cả links có dạng luatvietnam.vn/dat-dai/**-d1.html
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('luatvietnam.vn') && href.match(/-d1\.html$/)) {
                links.add(href);
            } else if (href && href.match(/^\/dat-dai\/.+-d1\.html$/) ) {
                links.add(`https://luatvietnam.vn${href}`);
            }
        });

        return [...links];
    } catch (err) {
        console.error("Lỗi lấy danh sách:", err.message);
        return [];
    }
};

/**
 * Hàm chính - crawl toàn bộ văn bản đất đai
 */
const runLandLawCrawl = async (urls = []) => {
    console.log('\n🚀 === BẮT ĐẦU CRAWL VĂN BẢN ĐẤT ĐAI ===\n');
    
    // Danh sách URLs cần crawl (nếu không truyền vào)
    if (urls.length === 0) {
        urls = [
            'https://luatvietnam.vn/dat-dai/luat-dat-dai-2024-so-31-2024-qh15-296638-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-102-2024-nd-cp-cua-chinh-phu-quy-dinh-chi-tiet-thi-hanh-mot-so-dieu-cua-luat-dat-dai-361911-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-101-2024-nd-cp-ve-dieu-tra-co-ban-dat-dai-dang-ky-cap-so-do-361766-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-88-2024-nd-cp-quy-dinh-boi-thuong-ho-tro-tai-dinh-cu-khi-nha-nuoc-thu-hoi-dat-360348-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-71-2024-nd-cp-cua-chinh-phu-quy-dinh-ve-gia-dat-358151-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-123-2024-nd-cp-xu-phat-vi-pham-hanh-chinh-trong-linh-vuc-dat-dai-367497-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-103-2024-nd-cp-quy-dinh-tien-su-dung-dat-tien-thue-dat-361937-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-104-2024-nd-cp-quy-dinh-quy-phat-trien-dat-362123-d1.html',
            'https://luatvietnam.vn/xay-dung/nghi-dinh-42-2024-nd-cp-ve-hoat-dong-lan-bien-315413-d1.html',
            'https://luatvietnam.vn/dat-dai/nghi-dinh-112-2024-nd-cp-cua-chinh-phu-quy-dinh-chi-tiet-ve-dat-trong-lua-364245-d1.html',
            'https://luatvietnam.vn/dau-tu/nghi-dinh-115-2024-nd-cp-huong-dan-luat-dat-dai-ve-lua-chon-nha-dau-tu-du-an-co-su-dung-dat-366030-d1.html',
            'https://luatvietnam.vn/dat-dai/thong-tu-08-2024-tt-btnmt-ve-lap-ban-do-dia-chinh-361914-d1.html',
            'https://luatvietnam.vn/dat-dai/thong-tu-09-2024-tt-btnmt-ve-giay-chung-nhan-quyen-su-dung-dat-361917-d1.html',
            'https://luatvietnam.vn/dat-dai/thong-tu-10-2024-tt-btnmt-ve-he-thong-thong-tin-dat-dai-361919-d1.html',
            'https://luatvietnam.vn/dat-dai/thong-tu-11-2024-tt-btnmt-ve-dieu-tra-co-ban-dat-dai-361921-d1.html',
        ];
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n[${i + 1}/${urls.length}]`);
        
        const result = await crawlAndSaveDocument(url);
        if (result) success++;
        else failed++;

        // Rate limiting - tránh bị block
        if (i < urls.length - 1) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log(`\n✅ Hoàn thành: ${success} thành công, ${failed} thất bại`);
    return { success, failed };
};

module.exports = { runLandLawCrawl, crawlAndSaveDocument, fetchFullContent };
