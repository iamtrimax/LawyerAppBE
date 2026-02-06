const axios = require('axios');
const cheerio = require('cheerio');
const articleModel = require('../model/article.model');
const { generateEmbedding } = require('./embedding.service');

// Base URL for constructing absolute links
const BASE_URL = 'https://vbpl.vn';

/**
 * Helper to fetch HTML
 */
const fetchHtml = async (url) => {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 15000
        });
        return response.data.toString('utf-8');
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error.message);
        return null;
    }
};

/**
 * Sanitize HTML Content
 */
const sanitizeHtml = (html) => {
    if (!html) return '';
    const $ = cheerio.load(html, { decodeEntities: false });

    $('script, style, link, meta, iframe, form, input, button').remove();

    $('*').each((i, el) => {
        $(el).removeAttr('style');
        $(el).removeAttr('class');
        $(el).removeAttr('width');
        $(el).removeAttr('height');
        $(el).removeAttr('align');
        $(el).removeAttr('face');
    });

    $('img').each((i, el) => {
        let src = $(el).attr('src');
        if (!src || src.startsWith('file:///')) {
            $(el).remove();
        } else if (!src.startsWith('http')) {
            const fullSrc = src.startsWith('/') ? `${BASE_URL}${src}` : `${BASE_URL}/${src}`;
            $(el).attr('src', fullSrc);
        }
        $(el).attr('style', 'max-width: 100%; height: auto; display: block; margin: 10px auto;');
    });

    $('p, div, h1, h2, h3').each((i, el) => {
        if ($(el).text().trim().length === 0 && $(el).find('img').length === 0) {
            $(el).remove();
        }
    });

    return $('body').html() || '';
};

/**
 * Parse document details from detail page
 */
const parseDocumentDetails = async (url, listingTitle, categoryName) => {
    const html = await fetchHtml(url);
    if (!html) return null;

    const $ = cheerio.load(html);

    // Use listing title as primary title
    let title = listingTitle || '';

    // Content Extraction & Cleaning
    let rawContent = $('#toanvancontent').html();
    if (!rawContent || rawContent.length < 50) {
        rawContent = $('.content-body').html() || $('.fulltext').html();
    }
    let cleanContent = sanitizeHtml(rawContent);

    // Attachments
    const attachments = [];
    const cleanUrl = (href) => {
        if (href.includes('WopiFrame.aspx')) {
            const match = href.match(/sourcedoc=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        }
        return href;
    };

    $('a').each((i, el) => {
        let href = $(el).attr('href');
        const text = $(el).text().trim();
        if (!href) return;

        const isFile = href.endsWith('.doc') || href.endsWith('.docx') || href.endsWith('.pdf') || href.endsWith('.zip');
        const isViewer = href.includes('WopiFrame.aspx') || href.includes('WordViewer.aspx');

        if (isFile || isViewer) {
            let fullUrl = href.startsWith('http') ? href : (href.startsWith('/') ? `${BASE_URL}${href}` : `${BASE_URL}/${href}`);
            if (isViewer) {
                const rawPath = cleanUrl(href);
                if (rawPath.startsWith('/')) fullUrl = `${BASE_URL}${rawPath}`;
            }
            if (!attachments.some(a => a.url === fullUrl)) {
                attachments.push({ name: text && text.length < 50 ? text : 'Tải về văn bản', url: fullUrl });
            }
        }
    });

    // STRICT FILTER
    const textContent = $(cleanContent).text().trim();
    const hasEnoughText = textContent.length > 50;
    const hasAttachments = attachments.length > 0;

    if (!hasEnoughText && !hasAttachments) {
        return null;
    }

    if (!hasEnoughText && hasAttachments) {
        cleanContent = `<p><em>Văn bản này không có nội dung hiển thị trực tiếp. Vui lòng xem tài liệu đính kèm bên dưới.</em></p>`;
    }

    // Thumbnail
    let thumbnail = '';
    const firstImg = $(cleanContent).find('img').first();
    if (firstImg.length) {
        thumbnail = firstImg.attr('src');
    }

    // Published Date
    let publishedDate = new Date();
    let dateStr = '';
    $('.vbInfo li').each((i, el) => {
        const text = $(el).text();
        if (text.includes('Ngày ban hành') || text.includes('Ban hành')) {
            dateStr = text.replace('Ngày ban hành:', '').replace('Ban hành:', '').trim();
        } else if (!dateStr && (text.includes('Ngày có hiệu lực') || text.includes('Hiệu lực'))) {
            dateStr = text.replace('Ngày có hiệu lực:', '').replace('Hiệu lực:', '').replace('Còn hiệu lực', '').trim();
        }
    });
    if (dateStr && dateStr.length >= 8) {
        const parts = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (parts) publishedDate = new Date(`${parts[3]}-${parts[2]}-${parts[1]}`);
    }

    // Category - now based on document type passed from listing
    const category = categoryName || 'Khác';

    const urlObj = new URL(url);
    const externalId = urlObj.searchParams.get('ItemID');

    // Generate Embedding for semantic search
    const embedding = await generateEmbedding(title + " " + $(cleanContent).text().substring(0, 2000));

    return {
        title,
        content: cleanContent,
        category,
        externalId,
        sourceUrl: url,
        status: 'Published',
        crawledAt: new Date(),
        publishedDate,
        thumbnail,
        attachments,
        embedding
    };
};

/**
 * Get total pages for a document type
 */
const getTotalPages = ($) => {
    // Look for "Cuối »" link which contains the last page number
    let maxPage = 1;
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && (text.includes('Cuối') || text.includes('»'))) {
            const match = href.match(/Page=(\d+)/);
            if (match) {
                maxPage = Math.max(maxPage, parseInt(match[1]));
            }
        }
    });
    return maxPage;
};

/**
 * Main Sync Function - Category-Based Scraper with Pagination
 */
const syncVbplData = async () => {
    console.log('--- Bắt đầu đồng bộ dữ liệu VBPL (Optimized | Status Filtered) ---');

    const DOCUMENT_TYPES = [15, 16, 17, 18, 19, 20, 21, 22, 23]; // idLoaiVanBan
    const TYPE_MAPPING = {
        15: 'Hiến pháp',
        16: 'Bộ luật',
        17: 'Luật',
        18: 'Pháp lệnh',
        19: 'Nghị quyết',
        20: 'Nghị định',
        21: 'Quyết định',
        22: 'Thông tư',
        23: 'Thông tư liên tịch'
    };
    const STATUSES = [2, 1]; // 2: Còn hiệu lực, 1: Chưa có hiệu lực
    const DVID = 13;
    const MAX_PAGES_PER_TYPE = 100; // Can increase this now as it's much faster
    let totalSaved = 0;

    for (const docType of DOCUMENT_TYPES) {
        const categoryName = TYPE_MAPPING[docType] || 'Khác';

        for (const statusId of STATUSES) {
            const statusLabel = statusId === 2 ? 'Còn hiệu lực' : 'Chưa có hiệu lực';
            console.log(`\n=== Loại văn bản: ${categoryName} | Trạng thái: ${statusLabel} ===`);

            const firstPageUrl = `${BASE_URL}/TW/Pages/vanban.aspx?idLoaiVanBan=${docType}&idTrangThai=${statusId}&dvid=${DVID}`;
            const firstPageHtml = await fetchHtml(firstPageUrl);
            if (!firstPageHtml) continue;

            const $first = cheerio.load(firstPageHtml);
            const totalPages = getTotalPages($first);
            const pagesToScrape = Math.min(totalPages, MAX_PAGES_PER_TYPE);

            if (totalPages > 0) {
                console.log(`Tìm thấy ${totalPages} trang, sẽ cào: ${pagesToScrape} trang`);
            } else {
                const hasDocs = $first('.des').length > 0;
                if (!hasDocs) {
                    console.log(`Không có văn bản nào.`);
                    continue;
                }
            }

            for (let page = 1; page <= pagesToScrape; page++) {
                const listUrl = page === 1 ? firstPageUrl : `${firstPageUrl}&Page=${page}`;
                console.log(`\n  Trang ${page}/${pagesToScrape}: ${listUrl}`);

                const html = page === 1 ? firstPageHtml : await fetchHtml(listUrl);
                if (!html) continue;

                const $ = cheerio.load(html);
                const documents = [];

                $('.des').each((i, el) => {
                    const titleText = $(el).find('p').text().trim();
                    if (!titleText) return;

                    const parent = $(el).closest('tr, .item, .document-item');
                    let docLink = parent.find('a[href*="vbpq-toanvan.aspx"]').first().attr('href');
                    if (!docLink) docLink = parent.find('a[href*="ItemID"]').first().attr('href');
                    if (!docLink) return;

                    const fullUrl = docLink.startsWith('http') ? docLink : (docLink.startsWith('/') ? `${BASE_URL}${docLink}` : `${BASE_URL}/${docLink}`);
                    documents.push({ title: titleText, url: fullUrl });
                });

                console.log(`  Phân tích ${documents.length} văn bản...`);

                for (const doc of documents) {
                    try {
                        const details = await parseDocumentDetails(doc.url, doc.title, categoryName);
                        if (details) {
                            await articleModel.findOneAndUpdate(
                                { sourceUrl: doc.url },
                                { $set: details },
                                { upsert: true, new: true }
                            );
                            totalSaved++;
                        }
                        await new Promise(r => setTimeout(r, 200));
                    } catch (err) {
                        console.error(`  Lỗi xử lý ${doc.url}:`, err.message);
                    }
                }

                // Progress heartbeat
                console.log(`  ✓ Đã lưu tổng cộng ${totalSaved} văn bản.`);
            }
        }
    }

    console.log(`\n--- Hoàn tất đồng bộ. Tổng cộng đã lưu ${totalSaved} văn bản hợp lệ. ---`);
};

module.exports = {
    syncVbplData
};
