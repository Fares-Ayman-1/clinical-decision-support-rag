/**
 * Vercel serverless entry — all /api/* routes are handled here.
 * @license SPDX-License-Identifier: Apache-2.0
 */

import { createApp } from "../server/createApp";

const app = createApp("serverless");

export default app;
