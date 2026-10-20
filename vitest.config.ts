import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // Tests inject a fake AI binding, so never open a remote session.
        remoteBindings: false,
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, DEV_AUTH: "1", AI_MOCK: "0", GOOGLE_CLIENT_ID: "test-client", GOOGLE_API_KEY: "test-key", GOOGLE_APP_ID: "123" },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts"] },
  };
});
