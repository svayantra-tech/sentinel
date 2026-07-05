// Next.js instrumentation hook (NFR-01) — boots the OpenTelemetry NodeSDK so
// every span from src/lib/telemetry.ts exports via OTLP to Jaeger
// (docker compose up -d → http://localhost:16686). No endpoint configured →
// spans still feed the in-app TraceStore; nothing breaks.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'sentinel-agent' }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
  });
  provider.register();
  console.log(`[otel] exporting traces to ${endpoint}`);
}
