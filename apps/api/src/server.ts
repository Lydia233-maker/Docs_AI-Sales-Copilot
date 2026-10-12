import { buildApp } from './app.ts';

const app = await buildApp();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
await app.listen({ port, host });
console.log(`api listening on http://${host}:${port}`);
