import "reflect-metadata";
import { registerAvatarHttp } from "./profiles/avatar-http";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { ProblemExceptionFilter } from "./common/problem.filter";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  registerAvatarHttp(app.getHttpAdapter().getInstance());
  await app.register(cookie);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new ProblemExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  console.log(
    JSON.stringify({
      event: "api_started",
      host: env.HOST,
      port: env.PORT,
      appEnv: env.APP_ENV,
      publicOrigin: env.PUBLIC_API_ORIGIN,
      gitSha: env.GIT_SHA,
    }),
  );
}

bootstrap().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await AppModule.close().catch(() => undefined);
  process.exitCode = 1;
});
