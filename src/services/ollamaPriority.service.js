let activeRequest = null;
let waitingInteractiveRequests = 0;
let waiters = [];

const waitUntil = (predicate) => {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => waiters.push(resolve));
};

const notifyWaiters = () => {
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve());
};

const runInteractiveRequest = async (task) => {
    const waitedForBackground = activeRequest === 'background';
    waitingInteractiveRequests++;
    let waitingForPriority = true;
    if (waitedForBackground) {
        console.log('[Ollama] Chat đang chờ embedding nền hiện tại hoàn tất để tránh tranh CPU.');
    }

    try {
        while (activeRequest !== null) {
            await waitUntil(() => activeRequest === null);
        }
        waitingInteractiveRequests--;
        waitingForPriority = false;
        activeRequest = 'interactive';
        try {
            return await task();
        } finally {
            activeRequest = null;
            notifyWaiters();
        }
    } finally {
        // If this request was cancelled while waiting, release its priority slot.
        if (waitingForPriority) {
            waitingInteractiveRequests--;
            notifyWaiters();
        }
    }
};

const runBackgroundRequest = async (task) => {
    let loggedPause = false;
    while (activeRequest !== null || waitingInteractiveRequests > 0) {
        if (!loggedPause && (activeRequest === 'interactive' || waitingInteractiveRequests > 0)) {
            console.log('[RAG] Tạm dừng embedding nền để ưu tiên chat AI.');
            loggedPause = true;
        }
        await waitUntil(() => activeRequest === null && waitingInteractiveRequests === 0);
    }

    activeRequest = 'background';
    if (loggedPause) console.log('[RAG] Tiếp tục đồng bộ embeddings nền.');
    try {
        return await task();
    } finally {
        activeRequest = null;
        notifyWaiters();
    }
};

const isInteractiveRequestActive = () => activeRequest === 'interactive' || waitingInteractiveRequests > 0;

module.exports = { runInteractiveRequest, runBackgroundRequest, isInteractiveRequestActive };
