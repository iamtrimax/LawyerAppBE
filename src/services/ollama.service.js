const axios = require('axios');
const { StringDecoder } = require('string_decoder');
require('dotenv').config();

const ollamaBaseUrl = () => (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');

const consumeChatStream = (stream, onToken, startedAt, model) => new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let content = '';
    let thinkingLength = 0;
    let firstTokenAt = null;
    let finalChunk = {};
    let settled = false;

    const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
    };

    const parseLine = (line) => {
        if (!line.trim() || settled) return;
        let chunk;
        try {
            chunk = JSON.parse(line);
        } catch (error) {
            fail(new Error(`Ollama trả về dữ liệu stream không hợp lệ: ${error.message}`));
            return;
        }
        if (chunk.error) {
            fail(new Error(chunk.error));
            return;
        }

        const thinking = chunk.message?.thinking || '';
        if (thinking) thinkingLength += thinking.length;
        const token = chunk.message?.content || '';
        if (token) {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            content += token;
            try {
                onToken(token);
            } catch (error) {
                fail(error);
                stream.destroy();
                return;
            }
        }
        if (chunk.done) finalChunk = chunk;
    };

    stream.on('data', (data) => {
        buffer += decoder.write(data);
        let lineEnd;
        while ((lineEnd = buffer.indexOf('\n')) !== -1) {
            parseLine(buffer.slice(0, lineEnd).replace(/\r$/, ''));
            buffer = buffer.slice(lineEnd + 1);
        }
    });
    stream.on('end', () => {
        buffer += decoder.end();
        if (buffer.trim()) parseLine(buffer);
        if (settled) return;
        const answer = content.trim();
        if (!answer) {
            fail(new Error(`Ollama không trả về nội dung; thinking chars=${thinkingLength}; tokens=${finalChunk.eval_count || 0}; done=${finalChunk.done_reason || 'unknown'}.`));
            return;
        }
        settled = true;
        console.log(`[Ollama] Chat stream model "${model}" hoàn tất sau ${Date.now() - startedAt} ms; token đầu tiên ${firstTokenAt ? firstTokenAt - startedAt : 'n/a'} ms; ${finalChunk.eval_count || 0} token.`);
        resolve(answer);
    });
    stream.on('error', fail);
    stream.on('close', () => {
        if (!settled && !stream.readableEnded) fail(new Error('Kết nối stream tới Ollama đã đóng trước khi hoàn tất.'));
    });
});

const generateChatCompletion = async (messages, options = {}) => {
    const model = options.model || process.env.OLLAMA_CHAT_MODEL;
    if (!model) throw new Error('OLLAMA_CHAT_MODEL chưa được cấu hình');
    const timeout = Number(options.timeout || process.env.OLLAMA_CHAT_TIMEOUT_MS) || 240000;
    const startedAt = Date.now();
    const streaming = typeof options.onToken === 'function';
    console.log(`[Ollama] Bắt đầu chat với model "${model}"; ${messages.length} messages; timeout ${timeout} ms.`);

    let response;
    try {
        response = await axios.post(`${ollamaBaseUrl()}/api/chat`, {
            model,
            messages,
            stream: streaming,
            options: { temperature: options.temperature ?? 0.2, ...(options.modelOptions || {}) },
            format: options.format,
            ...(options.think === undefined ? {} : { think: options.think })
        }, {
            timeout,
            ...(streaming ? { responseType: 'stream' } : {}),
            ...(options.signal ? { signal: options.signal } : {})
        });
    } catch (error) {
        console.error(`[Ollama] Chat lỗi sau ${Date.now() - startedAt} ms với model "${model}": ${error.message}`);
        throw error;
    }
    if (streaming) {
        try {
            return await consumeChatStream(response.data, options.onToken, startedAt, model);
        } catch (error) {
            console.error(`[Ollama] Chat stream lỗi sau ${Date.now() - startedAt} ms với model "${model}": ${error.message}`);
            throw error;
        }
    }
    const message = response.data?.message;
    const content = message?.content?.trim();
    if (message?.thinking?.trim()) {
        console.log(`[Ollama] Nhận được thinking riêng (${message.thinking.length} ký tự); chỉ gửi phần câu trả lời.`);
    }
    if (!content) {
        const thinkingLength = message?.thinking?.length || 0;
        console.error(`[Ollama] Phản hồi rỗng sau ${Date.now() - startedAt} ms; thinking chars=${thinkingLength}; tokens=${response.data?.eval_count || 0}; done=${response.data?.done_reason || 'unknown'}.`);
        throw new Error('Ollama không trả về nội dung; có thể model đã dùng hết giới hạn sinh trong chế độ suy luận');
    }
    console.log(`[Ollama] Chat hoàn tất trong ${Date.now() - startedAt} ms; ${response.data.eval_count || 0} token sinh ra.`);
    return content;
};

module.exports = { generateChatCompletion };
