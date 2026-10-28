import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { CONFIG } from "../config";
import { emailConfigured, type EmailConfig } from "./policy";
import { ExternalNotificationsService } from "./service";
@Injectable()
export class ExternalNotificationsWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly log = new Logger("ExternalNotifications");
  constructor(
    @Inject(CONFIG) private readonly config: EmailConfig,
    @Inject(ExternalNotificationsService)
    private readonly service: ExternalNotificationsService,
  ) {}
  onApplicationBootstrap() {
    if (
      this.config.NODE_ENV === "test" ||
      !this.config.DATABASE_URL ||
      !emailConfigured(this.config)
    )
      return;
    // Startup never immediately calls provider/enqueues historical handoffs.
    this.timer = setInterval(() => this.tick(), 30000);
    this.timer.unref();
  }
  private tick() {
    if (this.running) return;
    this.running = this.service
      .runJobs()
      .catch(() => {
        // No error object: provider errors may contain a token or address.
        this.log.warn(
          "Email notification processing failed; a later bounded run will retry.",
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
