import { describe, it, expect } from 'vitest';
import { images } from './images.js';
function env() {
 const files = new Map<string, Uint8Array>();
 return { IMAGES: { put: async (key: string, data: Uint8Array) => { files.set(key, data); }, get: async (key: string) => files.has(key) ? { body: files.get(key) } : null, delete: async (key: string) => { files.delete(key); } } };
}
describe('PDF attachments', () => {
 it('uploads a PDF and serves its exact bytes with safe headers', async () => {
  const e = env(); const pdf = '%PDF-1.4\nTest\n%%EOF';
  const r = await images.request('/api/files', {method:'POST',headers:{'Content-Type':'application/pdf'},body:pdf}, e as never);
  expect(r.status).toBe(201); const j=await r.json() as {data:{url:string}};
  const out=await images.request(j.data.url, {}, e as never);
  expect(await out.text()).toBe(pdf); expect(out.headers.get('Content-Type')).toBe('application/pdf');
  expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff');
 });
 it('rejects renamed HTML and oversized requests', async()=> {
  const e=env();
  expect((await images.request('/api/files',{method:'POST',headers:{'Content-Type':'application/pdf'},body:'<html>fake</html>'},e as never)).status).toBe(400);
  expect((await images.request('/api/files',{method:'POST',headers:{'Content-Type':'application/pdf','Content-Length':'10485761'},body:'%PDF-'},e as never)).status).toBe(413);
 });
 it('rejects other mime types and invalid download paths',async()=> {
  expect((await images.request('/api/files',{method:'POST',headers:{'Content-Type':'text/html'},body:'x'},env() as never)).status).toBe(415);
  expect((await images.request('/files/x.pdf',{},env() as never)).status).toBe(404);
 });
});
