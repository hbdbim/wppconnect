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

import { Whatsapp } from '../api/whatsapp';
import { create, CreateOptions } from './initializer';
import { CreateConfig, defaultOptions } from '../config/create-config';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { Session } from 'node:inspector';

export let sessionArray: Array<Whatsapp> = new Array<Whatsapp>();

const readdir = util.promisify(fs.readdir);

export async function getSessionNames(options?: CreateOptions) {
  const mergedOptions = { ...defaultOptions, ...options };

  const logger = mergedOptions.logger;
  try {
    let sessions = await readdir(
      path.resolve(__dirname, '..', '..', defaultOptions.folderNameToken)
    );

    return sessions.map((m) => {
      return m.replace('.data.json', '');
    });
  } catch (e) {
    logger.error('Error getAllTokens() -> ', e);
  }
}

export async function initAllSessions(options?: CreateOptions) {
  const mergedOptions = { ...defaultOptions, ...options };
  const allSessionsNames = await getSessionNames(mergedOptions);

  const promises = await allSessionsNames.map(async (session) => {
    mergedOptions.session = session;
    sessionArray[session] = await create(mergedOptions);
  });

  await Promise.all(promises);
  return sessionArray;
}

export async function createSession(
  createOption: CreateOptions
): Promise<Whatsapp> {
  return (sessionArray[createOption.session] = await create(createOption));
}
