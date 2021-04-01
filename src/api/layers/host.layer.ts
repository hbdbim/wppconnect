/*
 * This file is part of WPPConnect.
 *
 * WPPConnect is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * WPPConnect is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with WPPConnect.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Page } from 'puppeteer';
import { CreateConfig, defaultOptions } from '../../config/create-config';
import { SocketState } from '../model/enum';
import { injectApi } from '../../controllers/browser';
import { ScrapQrcode } from '../model/qrcode';
import { scrapeImg } from '../helpers';
import {
  asciiQr,
  getInterfaceStatus,
  isAuthenticated,
  isInsideChat,
  needsToScan,
  retrieveQR,
} from '../../controllers/auth';
import { sleep } from '../../utils/sleep';
import { defaultLogger, LogLevel } from '../../utils/logger';
import { Logger } from 'winston';

export class HostLayer {
  readonly session: string;
  readonly options: CreateConfig;
  readonly logger: Logger;

  protected autoCloseInterval = null;
  protected statusFind?: (statusGet: string, session: string) => void = null;

  constructor(public page: Page, session?: string, options?: CreateConfig) {
    this.session = session;
    this.options = { ...defaultOptions, ...options };

    this.logger = this.options.logger || defaultLogger;

    this.page.on('load', () => {
      this.log('verbose', 'Page loaded', { type: 'page' });
      this.initialize();
    });
    this.page.on('close', () => {
      this.cancelAutoClose();
      this.log('error', 'Page Closed', { type: 'page' });
    });
    this.log('info', 'Initializing...');
  }

  protected log(level: LogLevel, message: string, meta: object = {}) {
    this.logger.log({
      level,
      message,
      session: this.session,
      type: 'client',
      ...meta,
    });
  }

  protected async initialize() {
    this.log('verbose', 'Injecting wapi.js');
    await injectApi(this.page)
      .then(() => {
        this.log('verbose', 'wapi.js injected');
      })
      .catch((e) => {
        this.log('verbose', 'wapi.js failed');
      });
  }

  protected tryAutoClose() {
    if (this.autoCloseInterval) {
      this.cancelAutoClose();
    }

    if (
      this.options.autoClose > 0 &&
      !this.autoCloseInterval &&
      !this.page.isClosed()
    ) {
      this.log('info', 'Closing the page');
      this.statusFind && this.statusFind('autocloseCalled', this.session);
      try {
        this.page.close();
      } catch (error) {}
    }
  }

  protected startAutoClose() {
    if (this.options.autoClose > 0 && !this.autoCloseInterval) {
      const seconds = Math.round(this.options.autoClose / 1000);
      this.log('info', `Auto close configured to ${seconds}s`);

      let remain = seconds;
      this.autoCloseInterval = setInterval(() => {
        if (this.page.isClosed()) {
          this.cancelAutoClose();
          return;
        }
        remain -= 1;
        if (remain % 10 === 0 || remain <= 5) {
          this.log('http', `Auto close remain: ${remain}s`);
        }
        if (remain <= 0) {
          this.tryAutoClose();
        }
      }, 1000);
    }
  }

  protected cancelAutoClose() {
    clearInterval(this.autoCloseInterval);
    this.autoCloseInterval = null;
  }

  public async getQrCode() {
    let qrResult: ScrapQrcode | undefined;

    qrResult = await scrapeImg(this.page).catch(() => undefined);
    if (!qrResult || !qrResult.urlCode) {
      qrResult = await retrieveQR(this.page).catch(() => undefined);
    }

    return qrResult;
  }

  public async waitForQrCodeScan(
    catchQR?: (
      qrCode: string,
      asciiQR: string,
      attempt: number,
      urlCode?: string,
      session?: string
    ) => void
  ) {
    let urlCode = null;
    let attempt = 0;

    while (true) {
      let needsScan = await needsToScan(this.page).catch(() => null);
      if (!needsScan) {
        break;
      }

      const result = await this.getQrCode();
      if (!result?.urlCode) {
        break;
      }
      if (urlCode !== result.urlCode) {
        urlCode = result.urlCode;
        attempt++;

        let qr = '';

        if (this.options.logQR || catchQR) {
          qr = await asciiQr(urlCode);
        }

        if (this.options.logQR) {
          this.log(
            'info',
            `Waiting for QRCode Scan (Attempt ${attempt})...:\n${qr}`,
            { code: urlCode }
          );
        } else {
          this.log('verbose', `Waiting for QRCode Scan: Attempt ${attempt}`);
        }

        if (catchQR) {
          catchQR(
            result.base64Image,
            qr,
            attempt,
            result.urlCode,
            this.session
          );
        }
      }
      await sleep(200);
    }
  }

  public async waitForInChat() {
    let inChat = await isInsideChat(this.page);

    while (inChat === false) {
      await sleep(200);
      inChat = await isInsideChat(this.page);
    }
    return inChat;
  }

  public async waitForPageLoad() {
    await this.page
      .waitForFunction(`!document.querySelector('#initial_startup')`)
      .catch(() => {});
    await getInterfaceStatus(this.page).catch(() => null);
  }

  public async waitForLogin(
    catchQR?: (
      qrCode: string,
      asciiQR: string,
      attempt: number,
      urlCode?: string,
      session?: string
    ) => void,
    statusFind?: (statusGet: string, session: string) => void
  ) {
    this.statusFind = statusFind;

    this.log('http', 'Waiting page load');

    await this.waitForPageLoad();

    this.log('http', 'Checking is logged...');
    let authenticated = await isAuthenticated(this.page).catch(() => null);

    this.startAutoClose();

    if (authenticated === false) {
      this.log('http', 'Waiting for QRCode Scan...');
      statusFind && statusFind('notLogged', this.session);
      await this.waitForQrCodeScan(catchQR);

      this.log('http', 'Checking QRCode status...');
      // Wait for interface update
      await sleep(200);
      authenticated = await isAuthenticated(this.page).catch(() => null);

      if (authenticated === null) {
        this.log('warn', 'Failed to authenticate');
        statusFind && statusFind('qrReadError', this.session);
      } else if (authenticated) {
        this.log('http', 'QRCode Success');
        statusFind && statusFind('qrReadSuccess', this.session);
      } else {
        this.log('warn', 'QRCode Fail');
        statusFind && statusFind('qrReadFail', this.session);
        this.tryAutoClose();
        throw 'Failed to read the QRCode';
      }
    } else if (authenticated === true) {
      this.log('http', 'Authenticated');
      statusFind && statusFind('isLogged', this.session);
    }

    if (authenticated === true) {
      // Reinicia o contador do autoclose
      this.cancelAutoClose();
      this.startAutoClose();
      // Wait for interface update
      await sleep(200);
      this.log('http', 'Checking phone is connected...');
      const inChat = await this.waitForInChat();

      if (!inChat) {
        this.log('warn', 'Phone not connected');
        statusFind && statusFind('phoneNotConnected', this.session);
        this.tryAutoClose();
        throw 'Phone not connected';
      }
      this.cancelAutoClose();
      this.log('http', 'Connected');
      statusFind && statusFind('inChat', this.session);
      return true;
    }

    if (authenticated === false) {
      this.tryAutoClose();
      this.log('warn', 'Not logged');
      throw 'Not logged';
    }

    this.tryAutoClose();
    this.log('error', 'Unknow error');
    throw 'Unknow error';
  }

  /**
   * Delete the Service Workers
   */
  public async killServiceWorker() {
    return await this.page.evaluate(() => WAPI.killServiceWorker());
  }

  /**
   * Load the service again
   */
  public async restartService() {
    return await this.page.evaluate(() => WAPI.restartService());
  }

  /**
   * @returns Current host device details
   */
  public async getHostDevice() {
    return await this.page.evaluate(() => WAPI.getHost());
  }

  /**
   * Retrieves WA version
   */
  public async getWAVersion() {
    return await this.page.evaluate(() => WAPI.getWAVersion());
  }

  /**
   * Retrieves the connecction state
   */
  public async getConnectionState(): Promise<SocketState> {
    return await this.page.evaluate(() => {
      //@ts-ignore
      return Store.State.default.state;
    });
  }

  /**
   * Retrieves if the phone is online. Please note that this may not be real time.
   */
  public async isConnected() {
    return await this.page.evaluate(() => WAPI.isConnected());
  }

  /**
   * Retrieves if the phone is online. Please note that this may not be real time.
   */
  public async isLoggedIn() {
    return await this.page.evaluate(() => WAPI.isLoggedIn());
  }

  /**
   * Retrieves Battery Level
   */
  public async getBatteryLevel() {
    return await this.page.evaluate(() => WAPI.getBatteryLevel());
  }
}
