import { Controller, Get, Header } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { metricsRegistry } from "../common/metrics/metrics.registry";

type HealthResponse = {
  status: "ok";
  service: string;
};

type ReadyResponse = HealthResponse & {
  version: string;
};

@ApiTags("platform")
@Controller()
export class HealthController {
  constructor(private readonly configService: ConfigService) {}

  @Get("health")
  @Public()
  @ApiOkResponse({ description: "Liveness probe response." })
  health(): HealthResponse {
    return {
      status: "ok",
      service: this.configService.get<string>("SERVICE_NAME", "os-service"),
    };
  }

  @Get("ready")
  @Public()
  @ApiOkResponse({ description: "Readiness probe response." })
  ready(): ReadyResponse {
    return {
      status: "ok",
      service: this.configService.get<string>("SERVICE_NAME", "os-service"),
      version: this.configService.get<string>("SERVICE_VERSION", "0.1.0"),
    };
  }

  @Get("metrics")
  @Public()
  @Header("Content-Type", metricsRegistry.contentType)
  @ApiOkResponse({ description: "Prometheus metrics response." })
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
