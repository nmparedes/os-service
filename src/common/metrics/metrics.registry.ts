import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from "prom-client";

export const metricsRegistry = new Registry();

collectDefaultMetrics({
  register: metricsRegistry,
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

const SERVICE_NAME = "os-service";

export const orderCreatedTotal = new Counter({
  name: "order_created_total",
  help: "Total number of service orders created successfully.",
  registers: [metricsRegistry],
});

export const orderProcessingFailuresTotal = new Counter({
  name: "order_processing_failures_total",
  help: "Total number of order flows that ended in failure or manual intervention.",
  registers: [metricsRegistry],
});

export const integrationFailuresTotal = new Counter({
  name: "integration_failures_total",
  help: "Total number of confirmed technical integration failures.",
  labelNames: ["service", "integration"],
  registers: [metricsRegistry],
});

export function incrementOrderCreatedMetric(): void {
  orderCreatedTotal.inc();
}

export function incrementOrderProcessingFailureMetric(): void {
  orderProcessingFailuresTotal.inc();
}

export function incrementIntegrationFailureMetric(integration: string): void {
  integrationFailuresTotal.inc({
    service: SERVICE_NAME,
    integration,
  });
}
