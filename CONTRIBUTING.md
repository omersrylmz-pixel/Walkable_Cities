# Katkı Rehberi

## Geliştirme Akışı

1. `main` dalından anlamlı bir dal açın:
   - `feat/mobile-camera-capture`
   - `fix/duplicate-hash-collision`
   - `docs/architecture-adr`
2. Küçük, tek amaçlı değişiklikler yapın (faz bazlı).
3. Değişiklik sonrası `git status` ile kapsamı doğrulayın.
4. Conventional Commits formatında commit atın.
5. Push öncesi test / tip kontrolü çalıştırın.

## Commit Mesajları

```text
<tip>(<kapsam>): <kısa açıklama>

<gövde — ne/neden, opsiyonel>
```

İzinli tipler: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `infra`, `perf`, `ci`.

Örnekler:

- `feat(api): add report ingestion endpoint with playwright-free validation`
- `feat(ai): compute obstacle/walkway overlap ratio`
- `infra(db): add h3-pg extension to postgres image`
- `docs: document decision thresholds`

## Kod Standartları

| Alan | Kural |
| --- | --- |
| TypeScript | `strict: true`, ESM, `import ... from './x.js'` uzantıları |
| Python | PEP 8, type hint zorunlu, `ruff` + `black` uyumlu satır uzunluğu 100 |
| SQL | Şema/nesne adları `snake_case`, yorumlar Türkçe, enum değerleri ASCII |
| Docker | Multi-stage build, root olmayan kullanıcı, `HEALTHCHECK` |
| Dokümantasyon | Değişen davranış aynı PR'da README/docs içinde güncellenir |

## Gizlilik

- `.env` ve servis anahtarları commit edilmez.
- Model ağırlıkları (`*.pt`, `*.onnx`) ve veri setleri Git LFS'e değil, ayrı bir depolama alanına yüklenir.
- Gerçek kişi görselleri test fixture'ı olarak kullanılmaz.
