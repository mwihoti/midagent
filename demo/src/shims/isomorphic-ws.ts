// Browser stand-in for isomorphic-ws. The published browser entry only has a
// default export, but @midnight-ntwrk/midnight-js-indexer-public-data-provider
// reads the named WebSocket export (`import * as ws` then `ws.WebSocket`).
const Socket = globalThis.WebSocket;

export const WebSocket = Socket;
export default Socket;
