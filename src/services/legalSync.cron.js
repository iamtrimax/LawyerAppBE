const cron = require("node-cron");
const Parser = require("rss-parser");
const legalResourceModel = require("../model/legalResource.model");
const { invalidateResourceCache } = require("./legalResource.services");
const { syncVbplData } = require("./vbpl.service");

const parser = new Parser();

// Danh sách các nguồn tin thật (Real Sources)
const RSS_SOURCES = [
    "https://vietnamnews.vn/rss/politics-laws.rss",
    "https://vietnam-business-law.info/blog?format=RSS"
];

/**
 * Hàm phân loại category dựa trên từ khóa trong tiêu đề
 */
const categorizeTitle = (title) => {
    const t = title.toLowerCase();
    if (t.includes("tax") || t.includes("invoice") || t.includes("customs")) return "Tax";
    if (t.includes("enterprise") || t.includes("investment") || t.includes("corporate") || t.includes("business registration")) return "Corporate";
    if (t.includes("accounting") || t.includes("financial reporting") || t.includes("audit")) return "Accounting";
    if (t.includes("commerce") || t.includes("trade") || t.includes("contract") || t.includes("import") || t.includes("export")) return "Commercial";
    return "Corporate"; // Mặc định
};

/**
 * Lấy ảnh Thumbnail mặc định theo category nếu không tìm thấy ảnh trong tin
 */
const getCategoryThumbnail = (category) => {
    const images = {
        "Corporate": "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=500&auto=format&fit=crop",
        "Commercial": "https://images.unsplash.com/photo-1578575437130-527eed3abbec?q=80&w=500&auto=format&fit=crop",
        "Tax": "https://images.unsplash.com/photo-1554224155-1697216efe9c?q=80&w=500&auto=format&fit=crop",
        "Accounting": "https://images.unsplash.com/photo-1454165833762-0105b007ea08?q=80&w=500&auto=format&fit=crop"
    };
    return images[category] || images["Corporate"];
};

/**
 * Trích xuất link ảnh đầu tiên từ nội dung HTML
 */
const extractThumbnail = (content) => {
    if (!content) return null;
    const match = content.match(/<img[^>]+src="([^">]+)"/);
    return match ? match[1] : null;
};

/**
 * Lấy dữ liệu thật từ các nguồn RSS
 */
const fetchRealLegalUpdates = async () => {
    console.log("Đang bắt đầu lấy dữ liệu pháp luật thật từ các nguồn RSS...");
    let allUpdates = [];

    for (const url of RSS_SOURCES) {
        try {
            const feed = await parser.parseURL(url);
            console.log(`Đã đọc xong nguồn: ${feed.title}`);

            const items = feed.items.map(item => {
                const category = categorizeTitle(item.title);
                const extractedImg = extractThumbnail(item.content || item.description);

                return {
                    title: item.title,
                    description: item.contentSnippet || item.description || "",
                    content: item.content || item.contentSnippet || "",
                    category,
                    language: "English",
                    sourceUrl: item.link,
                    publishedDate: new Date(item.pubDate),
                    thumbnail: extractedImg || getCategoryThumbnail(category)
                };
            });

            allUpdates = [...allUpdates, ...items];
        } catch (error) {
            console.error(`Lỗi khi lấy dữ liệu từ nguồn ${url}:`, error);
        }
    }

    return allUpdates;
};

const syncEnglishLaws = async () => {
    try {
        const newUpdates = await fetchRealLegalUpdates();
        console.log(`Đã tìm thấy ${newUpdates.length} bản tin từ các nguồn.`);

        let updateCount = 0;
        for (const data of newUpdates) {
            // Cập nhật nếu đã tồn tại tiêu đề, hoặc thêm mới nếu chưa có
            const updated = await legalResourceModel.findOneAndUpdate(
                { title: data.title },
                { $set: data },
                { upsert: true, new: true }
            );

            if (updated) {
                updateCount++;
                // Xóa cache danh mục tương ứng
                await invalidateResourceCache(data.language, data.category);
            }
        }
        console.log(`Đã đồng bộ xong ${updateCount} bản tin vào Database.`);
    } catch (error) {
        console.error("Lỗi trong quá trình đồng bộ dữ liệu thật:", error);
    }
};

/**
 * Khởi chạy Cron Job: Chạy vào lúc 01:00 sáng mỗi ngày
 */
const initLegalSyncCron = () => {
    // ... (Cleaned up)

    // Chạy hàng ngày lúc 1 giờ sáng
    cron.schedule("0 1 * * *", async () => {
        console.log("-----------------------------------------");
        console.log("Bắt đầu tiến trình cập nhật dữ liệu pháp luật THẬT hàng ngày...");
        await syncEnglishLaws();
        await syncVbplData(); // Add VBPL sync
        console.log("-----------------------------------------");
    });

    console.log("Hệ thống cập nhật dữ liệu THẬT (RSS) đã kích hoạt (01:00 AM daily)");
};

module.exports = { initLegalSyncCron, syncEnglishLaws };
