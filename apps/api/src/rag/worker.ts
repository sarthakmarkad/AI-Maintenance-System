import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { CONFIG, type Config } from "../config";
import { settings } from "./policy";
import { DocumentIndexer } from "./indexer";
@Injectable()
export class DocumentAiWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly log = new Logger("DocumentIndexing");
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DocumentIndexer) private readonly indexer: DocumentIndexer,
  ) {}
  onApplicationBootstrap() {
    if (
      this.config.NODE_ENV === "test" ||
      !settings(this.config).configured ||
      !this.config.DATABASE_URL
    )
      return;
    this.timer = setInterval(() => this.tick(), 30000);
    this.timer.unref();
    this.tick();
  }
  private tick() {
    if (this.running) return;
    this.running = this.indexer
      .runOnce()
      .catch(() => {
        this.log.warn(
          "Document indexing could not complete; a later run will retry.",
        );
      })
      .finally(() => {
        this.running = undefined;
      });
  }
  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
