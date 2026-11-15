const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024;
const ALLOWED_FILES = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

let client;

const getR2Config = () => {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
        const error = new Error('Thiếu cấu hình Cloudflare R2 ở backend.');
        error.statusCode = 503;
        throw error;
    }
    return { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL };
};

const getR2Client = ({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY }) => {
    if (!client) {
        client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
        });
    }
    return client;
};

const createUploadUrl = async ({ ownerId, folder, filename, contentType, size }) => {
    const config = getR2Config();
    const extension = String(filename || '').split('.').pop().toLowerCase();
    const expectedContentType = ALLOWED_FILES[extension];
    if (!expectedContentType || (contentType && contentType !== expectedContentType)) {
        const error = new Error('Chỉ chấp nhận tệp PDF, DOC hoặc DOCX hợp lệ.');
        error.statusCode = 400;
        throw error;
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_SIZE) {
        const error = new Error('Tệp phải có dung lượng lớn hơn 0 và không vượt quá 5 GB.');
        error.statusCode = 400;
        throw error;
    }

    const key = `${folder}/${ownerId}/${randomUUID()}.${extension}`;
    const command = new PutObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: key,
        ContentType: expectedContentType,
    });
    const uploadUrl = await getSignedUrl(getR2Client(config), command, { expiresIn: 600 });
    const publicBaseUrl = config.R2_PUBLIC_BASE_URL.replace(/\/+$/, '');

    return {
        uploadUrl,
        fileUrl: `${publicBaseUrl}/${key}`,
    };
};

const createLegalFormUploadUrl = options => createUploadUrl({
    ...options,
    ownerId: options.lawyerId,
    folder: 'legal-forms',
});

const createArticleAttachmentUploadUrl = options => createUploadUrl({
    ...options,
    ownerId: options.lawyerId,
    folder: 'article-attachments',
});

module.exports = { createLegalFormUploadUrl, createArticleAttachmentUploadUrl, MAX_UPLOAD_SIZE };
