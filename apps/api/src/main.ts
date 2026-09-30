import "reflect-metadata";
import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import express from "express";
import helmet from "helmet";
import { AuthController } from "./auth.controller.js";
import { Database } from "./db.js";
import { ContextController } from "./context.controller.js";
import { ContextService } from "./context.service.js";
import { ConflictsController } from "./conflicts.controller.js";
import { ConflictsService } from "./conflicts.service.js";
import { DevelopmentController } from "./development.controller.js";
import { DevelopmentService } from "./development.service.js";
import { DiscussionController } from "./discussion.controller.js";
import { DiscussionService } from "./discussion.service.js";
import { FeedbackController } from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";
import { GoalsController } from "./goals.controller.js";
import { GoalsService } from "./goals.service.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";
import { ImprovementController } from "./improvement.controller.js";
import { ImprovementService } from "./improvement.service.js";
import { OrganizationController } from "./organization.controller.js";
import { OrganizationService } from "./organization.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { PrivacyController } from "./privacy.controller.js";
import { PrivacyService } from "./privacy.service.js";
import { QualityController } from "./quality.controller.js";
import { QualityService } from "./quality.service.js";
import { SessionGuard } from "./security.js";
import { TrendController } from "./trend.controller.js";
import { TrendService } from "./trend.service.js";
import { requestTelemetry } from "./telemetry.js";
import { ValidationController } from "./validation.controller.js";
import { ValidationService } from "./validation.service.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller("health")
class HealthController {
  constructor(private readonly db: Database) {}
  @Get("live") live(): { status: string } {
    return { status: "ok" };
  }
  @Get("ready") async ready(): Promise<{ status: string }> {
    try {
      if (await this.db.ready()) return { status: "ok" };
    } catch {
      /* A failed database probe means this instance cannot accept traffic. */
    }
    throw new ServiceUnavailableException("Database unavailable");
  }
}

@Module({
  controllers: [
    AuthController,
    WorkspaceController,
    FeedbackController,
    GoalsController,
    PrivacyController,
    ValidationController,
    DevelopmentController,
    DiscussionController,
    ImprovementController,
    GovernanceController,
    ContextController,
    ConflictsController,
    TrendController,
    OrganizationController,
    NotificationsController,
    QualityController,
    HealthController,
  ],
  providers: [
    Database,
    SessionGuard,
    WorkspaceService,
    FeedbackService,
    GoalsService,
    PrivacyService,
    ValidationService,
    DevelopmentService,
    DiscussionService,
    ImprovementService,
    GovernanceService,
    ContextService,
    ConflictsService,
    TrendService,
    OrganizationService,
    NotificationsService,
    QualityService,
  ],
})
class AppModule {}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["error", "warn", "log"],
  });
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestTelemetry);
  app.use(
    (
      request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.headers.origin !== process.env.PUBLIC_ORIGIN
      ) {
        response.status(403).json({ message: "Invalid request origin" });
        return;
      }
      next();
    },
  );
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Human Performance Intelligence API")
      .setVersion("1.0")
      .build(),
  );
  SwaggerModule.setup("docs", app, document);
  await app.listen(Number(process.env.PORT ?? 4000), "0.0.0.0");
}

void main();
