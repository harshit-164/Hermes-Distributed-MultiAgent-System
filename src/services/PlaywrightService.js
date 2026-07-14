import { chromium } from 'playwright';
import { logger } from '../utils/logger.js';
import { HermesError } from '../utils/HermesError.js';

/**
 * PlaywrightService
 * Provides browser automation, UI testing, screenshot capture, and raw
 * Chrome DevTools Protocol (CDP) debugging capabilities for the Builder Agent.
 */
export class PlaywrightService {
  /**
   * @param {object} [options={}]
   * @param {boolean} [options.headless=true]
   */
  constructor(options = {}) {
    this.headless = options.headless !== undefined ? options.headless : true;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdpSession = null;
  }

  /**
   * Launches browser and opens a fresh context and page.
   * @returns {Promise<import('playwright').Page>}
   */
  async init() {
    if (this.page) {
      return this.page;
    }

    try {
      logger.debug(`[PlaywrightService] Launching Chromium browser (headless: ${this.headless})...`);
      this.browser = await chromium.launch({ headless: this.headless });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Hermes-V2-Builder-Agent/Chromium'
      });
      this.page = await this.context.newPage();
      logger.info('Playwright Chromium browser context and page launched.');
      return this.page;
    } catch (error) {
      throw new HermesError(`Failed to launch Playwright browser: ${error.message}`, {
        code: 'BROWSER_INIT_ERROR',
        category: 'browser',
        isRecoverable: true,
        cause: error
      });
    }
  }

  /**
   * Navigates to a URL and waits for network idle or DOM load.
   * @param {string} url
   * @returns {Promise<{ status: number, url: string }>}
   */
  async goto(url) {
    await this.init();
    try {
      logger.debug(`[PlaywrightService] Navigating to URL: ${url}`);
      const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return {
        status: response ? response.status() : 0,
        url: this.page.url()
      };
    } catch (error) {
      throw new HermesError(`Browser navigation failed [${url}]: ${error.message}`, {
        code: 'BROWSER_GOTO_ERROR',
        category: 'browser',
        isRecoverable: true
      });
    }
  }

  /**
   * Captures a full-page screenshot and returns it as base64 string.
   * @returns {Promise<string>} Base64 encoded PNG
   */
  async captureScreenshot() {
    await this.init();
    try {
      const buffer = await this.page.screenshot({ fullPage: true, type: 'png' });
      return buffer.toString('base64');
    } catch (error) {
      logger.warn(`Screenshot capture failed: ${error.message}`);
      return '';
    }
  }

  /**
   * Establishes a Chrome DevTools Protocol (CDP) debugging session on the active page.
   * Allows raw console inspection, performance profiling, and network tracking.
   * @returns {Promise<import('playwright').CDPSession>}
   */
  async startCdpSession() {
    await this.init();
    if (this.cdpSession) {
      return this.cdpSession;
    }

    try {
      this.cdpSession = await this.context.newCDPSession(this.page);
      await this.cdpSession.send('Runtime.enable');
      await this.cdpSession.send('Network.enable');

      this.cdpSession.on('Runtime.consoleAPICalled', (event) => {
        logger.debug(`[CDP Console] ${event.type}: ${JSON.stringify(event.args.map(a => a.value || a.description))}`);
      });

      logger.info('Chrome DevTools Protocol (CDP) debugging session active.');
      return this.cdpSession;
    } catch (error) {
      throw new HermesError(`CDP session initialization failed: ${error.message}`, {
        code: 'CDP_INIT_ERROR',
        category: 'browser',
        isRecoverable: true
      });
    }
  }

  /**
   * Extracts text content or attribute from a CSS selector.
   * @param {string} selector
   * @returns {Promise<string>}
   */
  async getText(selector) {
    await this.init();
    try {
      return await this.page.textContent(selector) || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Closes browser sessions and cleans up resources.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.cdpSession) {
      await this.cdpSession.detach().catch(() => {});
      this.cdpSession = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
      logger.info('Playwright browser sessions closed cleanly.');
    }
  }
}
