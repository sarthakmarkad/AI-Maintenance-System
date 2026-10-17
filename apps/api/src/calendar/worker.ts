import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { CONFIG, type Config } from "../config";
import { CalendarService } from "./service";
@Injectable()
export class CalendarWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly log = new Logger("MaintenanceScheduler");
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CalendarService) private readonly calendar: CalendarService,
  ) {}
  onApplicationBootstrap() {
    if (this.config.NODE_ENV === "test" || !this.config.DATABASE_URL) return;
    this.timer = setInterval(() => this.tick(), 30000);
    this.timer.unref();
    this.tick();
  }
  private tick() {
    if (this.running) return;
    this.running = this.calendar
      .runJobs()
      .catch(() => {
        this.calendar.jobFailed = true;
        this.log.warn(
          "Maintenance schedule refresh failed; the next run will retry.",
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
