import "dotenv/config";
import { spawn } from "node:child_process";
const setup = process.argv.includes("--setup");
const needed =
  setup ||
  (process.env.DOCUMENT_AI_ENABLED !== "false" &&
    Boolean(process.env.COMMANDCODE_API_KEY) &&
    (!process.env.DOCUMENT_AI_PROVIDER ||
      process.env.DOCUMENT_AI_PROVIDER === "commandcode"));
let child;
let stopping = false;
const healthy = async () => {
  try {
    return (
      await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      })
    ).ok;
  } catch {
    return false;
  }
};
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  child?.kill("SIGTERM");
  process.exitCode = code;
}
const timer = setInterval(() => {}, 60000);
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
if (needed) {
  if (!(await healthy())) {
    child = spawn("ollama", ["serve"], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_NO_CLOUD: "1",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", () => {
      console.error(
        "Local embeddings require Ollama. Install it, then run: ollama pull nomic-embed-text:v1.5",
      );
      void stop(1);
    });
    child.on("exit", () => {
      if (!stopping) {
        console.error(
          "The local embedding service stopped. Restart the project.",
        );
        void stop(1);
      }
    });
    for (let i = 0; i < 30 && !stopping && !(await healthy()); i++)
      await new Promise((r) => setTimeout(r, 300));
  }
  if (!stopping) {
    if (!(await healthy())) {
      console.error("Local embedding service did not become ready.");
      await stop(1);
    } else {
      const tags = await (
        await fetch("http://127.0.0.1:11434/api/tags")
      ).json();
      if (
        setup &&
        !tags.models?.some((m) => m.name === "nomic-embed-text:v1.5")
      ) {
        const code = await new Promise((resolve) => {
          const pull = spawn("ollama", ["pull", "nomic-embed-text:v1.5"], {
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              OLLAMA_HOST: "127.0.0.1:11434",
              OLLAMA_NO_CLOUD: "1",
            },
            stdio: "inherit",
          });
          pull.on("error", () => resolve(1));
          pull.on("exit", (code) => resolve(code ?? 1));
        });
        await stop(code);
        if (code !== 0) console.error("Embedding model download failed.");
      } else if (
        !tags.models?.some((m) => m.name === "nomic-embed-text:v1.5")
      ) {
        console.error("Download the embedding model first: npm run ai:setup");
        await stop(1);
      } else {
        console.log("Local embeddings ready on 127.0.0.1:11434.");
        if (setup) await stop();
      }
    }
  }
}
