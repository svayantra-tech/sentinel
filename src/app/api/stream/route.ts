// GET /api/stream — Server-Sent Events feed of REAL pipeline events (stage
// transitions + trace events), straight off the in-process event bus. This is
// the visualizer's low-latency channel; the UI keeps /api/runs polling as its
// fallback (serverless instances each stream their own process's events).
//
// Auth: same JWT as every other route. EventSource can't set headers, but the
// login flow already sets the httpOnly sentinel_token cookie — requireAuth
// accepts either. Optional ?runId= filters to one run. Last-Event-ID (or
// ?after=) replays buffered events missed during a reconnect.
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { subscribe, replaySince, type LiveEvent } from '@/lib/event-bus';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const runFilter = url.searchParams.get('runId') ?? undefined;
  const lastId = req.headers.get('last-event-id') ?? url.searchParams.get('after');
  const afterSeq = lastId && /^\d+$/.test(lastId) ? Number(lastId) : 0;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LiveEvent) => {
        if (runFilter && e.runId !== runFilter) return;
        try {
          controller.enqueue(encoder.encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch { /* controller already closed */ }
      };

      // Replay anything the client missed, then go live.
      for (const e of replaySince(afterSeq)) send(e);
      unsubscribe = subscribe(send);

      // Heartbeat comment keeps proxies/browsers from timing the stream out.
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`)); }
        catch { /* closed */ }
      }, 15_000);

      req.signal.addEventListener('abort', () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
