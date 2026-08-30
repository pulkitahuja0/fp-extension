// Runs in the content script's isolated world: it can talk to the extension
// (chrome.runtime) but not see the page's `PS` global directly. Its only job
// is to relay a "get the current battle" request from the popup to
// page-bridge.js (which runs in the MAIN world) and hand the reply back.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'fp-get-snapshot') return false;

    const id = Math.random().toString(36).slice(2);
    const onMessage = (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== 'fp-snapshot-response' || event.data.id !== id) return;
        window.removeEventListener('message', onMessage);
        sendResponse(event.data.snapshot);
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'fp-request-snapshot', id }, '*');
    return true; // keep the message channel open for the async response
});
