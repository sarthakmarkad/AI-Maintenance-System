import { z } from "zod";
import "dotenv/config";
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z
      .string()
      .url()
      .refine(
        (v) => new URL(v).origin === v,
        "Use an origin without a path or trailing slash.",
      )
      .default("http://localhost:3000"),
    DATABASE_URL: optional(
      z
        .string()
        .url()
        .refine((v) => {
          const url = new URL(v);
          return (
            ["postgres:", "postgresql:"].includes(url.protocol) &&
            Boolean(url.hostname) &&
            url.pathname.length > 1
          );
        }, "Use a PostgreSQL connection URL with a host and database name."),
    ),
    SUPABASE_URL: optional(z.string().url()),
    SUPABASE_PUBLISHABLE_KEY: optional(z.string().min(10)),
    DOCUMENT_AI_PROVIDER: z.enum(["commandcode", "openai"]).optional(),
    COMMANDCODE_API_KEY: optional(z.string().trim().min(20)),
    COMMANDCODE_MODEL: z.literal("z-ai/glm-5.3-flash").optional(),
    COMMANDCODE_BASE_URL: z
      .literal("https://api.commandcode.ai/provider/v1")
      .optional(),
    LOCAL_EMBEDDING_DIGEST: optional(z.string().regex(/^[a-f0-9]{64}$/)),
    OPENAI_API_KEY: optional(z.string().trim().min(20)),
    OPENAI_EMBEDDING_MODEL: z
      .enum(["text-embedding-3-small", "text-embedding-3-large"])
      .optional(),
    OPENAI_ANSWER_MODEL: optional(z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/)),
    DOCUMENT_AI_ENABLED: z.enum(["true", "false"]).optional(),
    ENABLE_DEMO_AUTH: z.enum(["false"]).optional(),
  })
  .superRefine((v, ctx) => {
    const auth = [v.SUPABASE_URL, v.SUPABASE_PUBLISHABLE_KEY];
    if (auth.some(Boolean) && !auth.every(Boolean))
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_URL"],
        message: "Set both Supabase URL and publishable key.",
      });
    if (
      v.SUPABASE_URL &&
      !v.SUPABASE_URL.startsWith("https://") &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(v.SUPABASE_URL)
    )
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_URL"],
        message: "Use HTTPS except for local Supabase.",
      });
    if (v.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_secret_"))
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_PUBLISHABLE_KEY"],
        message: "Use a public publishable key, not a secret key.",
      });
    if (
      v.NODE_ENV === "production" &&
      (!v.DATABASE_URL ||
        !auth.every(Boolean) ||
        !v.WEB_ORIGIN.startsWith("https://"))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Production requires database, Supabase auth and an HTTPS frontend origin.",
      });
  });
export type Config = z.infer<typeof schema>;
export function parseConfig(input: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      "Invalid configuration: " +
        result.error.issues
          .map((x) => `${x.path.join(".") || "environment"}: ${x.message}`)
          .join("; "),
    );
  return result.data;
}
export const CONFIG = Symbol("CONFIG");
