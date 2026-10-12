import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ProblemHttpException } from "../auth/problem";

@Catch(ProblemHttpException)
export class ProblemExceptionFilter implements ExceptionFilter {
  catch(exception: ProblemHttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    if (exception.retryAfterSeconds !== undefined) {
      response.header("Retry-After", String(exception.retryAfterSeconds));
    }
    response.header("Cache-Control","no-store").type("application/problem+json").status(exception.getStatus()).send(exception.getResponse());
  }
}
