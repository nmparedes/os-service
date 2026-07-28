import { Injectable } from "@nestjs/common";
import { OrderFlowMetrics } from "../../saga/application/ports/order-flow-metrics.port";
import {
  incrementOrderCreatedMetric,
  incrementOrderProcessingFailureMetric,
} from "./metrics.registry";

@Injectable()
export class PrometheusOrderFlowMetrics implements OrderFlowMetrics {
  recordOrderCreated(): void {
    incrementOrderCreatedMetric();
  }

  recordTerminalProcessingFailure(): void {
    incrementOrderProcessingFailureMetric();
  }
}
