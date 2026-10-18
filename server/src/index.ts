import { app } from './app';

// Neon Functions entry point: a module whose default export has `fetch`.
// The Request is passed through unchanged so WebSocket upgrades still work.
export default {
  fetch: (request: Request) => app.fetch(request),
};
