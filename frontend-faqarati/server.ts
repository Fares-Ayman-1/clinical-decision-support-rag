/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer as createViteServer } from "vite";
import { createApp } from "./server/createApp";

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === "production";
  const app = createApp(isProd ? "production" : "development");

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
