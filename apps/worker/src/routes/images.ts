import { Hono } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 10 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 10MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const url = `${workerUrl}/images/${key}`;

    return c.json({
      success: true,
      data: { id, key, url, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };

// PDFはLINEで開ける推測困難なURLとして送付。アップロードは通常のAPI認証を通す。
images.post('/api/files', async (c) => {
  if ((c.req.header('Content-Type') || '').split(';')[0] !== 'application/pdf') {
    return c.json({ success: false, error: 'PDFのみ添付できます' }, 415);
  }
  const limit = 10 * 1024 * 1024;
  if (Number(c.req.header('Content-Length')) > limit) return c.json({ success: false, error: 'PDFは10MB以下にしてください' }, 413);
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ success: false, error: 'PDFが空です' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return c.json({ success: false, error: 'PDFは10MB以下にしてください' }, 413); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  if (new TextDecoder().decode(data.subarray(0, 5)) !== '%PDF-') return c.json({ success: false, error: 'PDF形式を確認できませんでした' }, 400);
  const key = `documents/${crypto.randomUUID()}.pdf`;
  await c.env.IMAGES.put(key, data, { httpMetadata: { contentType: 'application/pdf' } });
  const origin = c.env.WORKER_URL || new URL(c.req.url).origin;
  return c.json({ success: true, data: { key, url: `${origin}/files/${key.slice(10)}`, size } }, 201);
});
images.get('/files/:key', async (c) => {
  const key = c.req.param('key');
  if (!/^[0-9a-f-]{36}\.pdf$/.test(key)) return c.notFound();
  const object = await c.env.IMAGES.get(`documents/${key}`);
  if (!object) return c.notFound();
  return new Response(object.body, { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="document.pdf"',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } });
});
images.delete('/api/files/:key', async (c) => {
  const key = c.req.param('key'); if (!/^[0-9a-f-]{36}\.pdf$/.test(key)) return c.notFound();
  await c.env.IMAGES.delete(`documents/${key}`);
  return c.json({ success: true });
});
