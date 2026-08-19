/**
 * Production entry for the Space: the faqarati Express API (schedules,
 * exercises, Einstein suggestions) behind nginx. Static files are nginx's
 * job; clinical /api routes are uvicorn's. See deploy/hf-space/nginx.conf.
 * @license SPDX-License-Identifier: Apache-2.0
 */
import { createApp } from "./createApp";

const PORT = Number(process.env.FAQARATI_PORT) || 3000;
createApp("production").listen(PORT, "127.0.0.1", () => {
  console.log(`[faqarati-api] listening on 127.0.0.1:${PORT}`);
});
