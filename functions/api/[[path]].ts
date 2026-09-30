import worker, { type Env } from '../../worker/src/index.js';
export const onRequest = (context: { request: Request; env: Env }) => worker.fetch(context.request, context.env);
