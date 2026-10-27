import { createSignalingServer, optionsFromEnv } from './server.js';

const server = createSignalingServer(optionsFromEnv());
const address = await server.listen();
// Only listener address; never rooms, peer identifiers, frames or credentials.
console.info(`Signaling listener: ${address.url}`);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server.close();
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
