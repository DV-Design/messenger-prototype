import { defineConfig } from '@playwright/test';

const serverPort = process.env.PW_SERVER_PORT || '8799';
const probePort = process.env.PW_PROBE_PORT || '5174';
const baseURL = `http://127.0.0.1:${probePort}`;
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './.tmp/playwright-results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    permissions: ['microphone', 'camera'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:server',
      url: `http://127.0.0.1:${serverPort}/health`,
      env: { PORT: serverPort, HOST: '127.0.0.1', MAX_CONNECTIONS_PER_IP: '32', ALLOWED_ORIGINS: baseURL, TURN_URLS: process.env.PW_TEST_TURN === '1' ? process.env.TURN_URLS || '' : '', TURN_SHARED_SECRET: process.env.PW_TEST_TURN === '1' ? process.env.TURN_SHARED_SECRET || '' : '', STUN_URLS: '' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev --workspace @messenger/probe -- --port ${probePort}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
