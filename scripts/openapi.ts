import { writeFile } from "node:fs/promises";
import { createApp } from "../apps/api/dist/app";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
async function main() {
  const app = await createApp({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
  });
  try {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Supreme Maintenance API")
        .setVersion("0.6.0")
        .addBearerAuth()
        .build(),
    );
    await writeFile("docs/openapi.json", JSON.stringify(doc, null, 2) + "\n");
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
