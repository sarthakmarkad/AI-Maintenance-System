import "reflect-metadata";
import { Module, ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import { json } from "express";
import { ProductionController } from "./production/controller";
import { ProductionService } from "./production/service";
import { ReadingsController } from "./readings/controller";
import { ReadingsService } from "./readings/service";
import { WorkOrdersController } from "./work-orders/controller";
import { WorkOrdersService } from "./work-orders/service";
import { CalendarController } from "./calendar/controller";
import { CalendarService } from "./calendar/service";
import { CalendarWorker } from "./calendar/worker";
import { CONFIG, parseConfig, type Config } from "./config";
import { Database } from "./database";
import { REPOSITORY, PrismaRepository } from "./repository";
import { VERIFIER, SupabaseVerifier, AuthGuard, RolesGuard } from "./auth";
import {
  HealthController,
  MeController,
  MachinesController,
} from "./controllers";
import { correlation, Errors } from "./http";
export function appModule(config: Config) {
  @Module({
    controllers: [
      HealthController,
      MeController,
      MachinesController,
      ProductionController,
      ReadingsController,
      WorkOrdersController,
      CalendarController,
    ],
    providers: [
      { provide: CONFIG, useValue: config },
      Database,
      { provide: REPOSITORY, useClass: PrismaRepository },
      { provide: VERIFIER, useClass: SupabaseVerifier },
      AuthGuard,
      RolesGuard,
      ProductionService,
      ReadingsService,
      WorkOrdersService,
      CalendarService,
      CalendarWorker,
    ],
  })
  class AppModule {}
  return AppModule;
}
export function configure(
  app: import("@nestjs/common").INestApplication,
  config: Config,
) {
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use(correlation);
  app.use(json({ limit: "64kb" }));
  app.useGlobalFilters(new Errors());
  app.enableCors({
    origin: config.WEB_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Request-Id",
      "X-Workspace-Role",
    ],
    exposedHeaders: ["X-Request-Id"],
  });
  app.enableShutdownHooks();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Supreme Maintenance API")
      .setDescription(
        "Milestones 1–5. Scoped registry, imports/trends, maintenance work orders and fixed-date planned maintenance with in-app reminders.",
      )
      .setVersion("0.5.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/docs", app, doc, {
    jsonDocumentUrl: "api/openapi.json",
    swaggerOptions: { persistAuthorization: false },
  });
  return doc;
}
export async function createApp(config = parseConfig(process.env)) {
  const app = await NestFactory.create(appModule(config), {
    logger: new ConsoleLogger("API", { json: true }),
    bodyParser: false,
  });
  configure(app, config);
  return app;
}
