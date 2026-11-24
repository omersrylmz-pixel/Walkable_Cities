import { afterEach, describe, expect, it } from 'vitest';

import { createSessionPayload, signSession, verifySession } from './session';

const originalSecret = process.env.WEB_SESSION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.WEB_SESSION_SECRET;
  } else {
    process.env.WEB_SESSION_SECRET = originalSecret;
  }
});

const input = {
  sub: '22222222-2222-4222-8222-222222222222',
  name: 'Mert Demir',
  email: 'mert.demir@belediye.example',
  role: 'moderator' as const,
};

describe('oturum imzalama', () => {
  it('imzalanan oturumu doğrular', async () => {
    process.env.WEB_SESSION_SECRET = 'test-secret-1';
    const payload = createSessionPayload(input);
    const token = await signSession(payload);

    const verified = await verifySession(token);
    expect(verified).toMatchObject({
      sub: input.sub,
      name: input.name,
      email: input.email,
      role: 'moderator',
    });
    expect(verified?.exp).toBeGreaterThan(verified?.iat ?? 0);
  });

  it('değiştirilmiş imzayı reddeder', async () => {
    process.env.WEB_SESSION_SECRET = 'test-secret-1';
    const token = await signSession(createSessionPayload(input));
    const [body, signature] = token.split('.');
    const tampered = `${body}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;

    await expect(verifySession(tampered)).resolves.toBeNull();
  });

  it('farklı sırla imzalanmış oturumu reddeder', async () => {
    process.env.WEB_SESSION_SECRET = 'secret-a';
    const token = await signSession(createSessionPayload(input));

    process.env.WEB_SESSION_SECRET = 'secret-b';
    await expect(verifySession(token)).resolves.toBeNull();
  });

  it('süresi dolmuş oturumu reddeder', async () => {
    process.env.WEB_SESSION_SECRET = 'test-secret-1';
    const expired = createSessionPayload({
      ...input,
      now: new Date(Date.now() - 9 * 60 * 60 * 1000),
    });
    const token = await signSession(expired);

    await expect(verifySession(token)).resolves.toBeNull();
  });

  it('bozuk veya eksik belirteci reddeder', async () => {
    process.env.WEB_SESSION_SECRET = 'test-secret-1';
    await expect(verifySession(undefined)).resolves.toBeNull();
    await expect(verifySession('')).resolves.toBeNull();
    await expect(verifySession('tek-parca')).resolves.toBeNull();
    await expect(verifySession('gövde.imza')).resolves.toBeNull();
  });
});
