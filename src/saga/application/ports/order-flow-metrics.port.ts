export interface OrderFlowMetrics {
  recordOrderCreated(): void;
  recordTerminalProcessingFailure(): void;
}

export const ORDER_FLOW_METRICS = Symbol("ORDER_FLOW_METRICS");
