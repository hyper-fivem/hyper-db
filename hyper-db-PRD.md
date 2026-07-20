# hyper-db — Product Requirements Document (PRD)

**Org:** hyper-framework (açık kaynak)
**Tarih:** 2026-07-20
**Durum:** Taslak v1.0 — ekip incelemesine hazır
**Sahip:** Mustafa Ata Çağlayan

---

## 1. Özet

hyper-db, FiveM için **PostgreSQL + Redis hibrit, tip güvenli, Drizzle-benzeri driver + ORM**'dir. Tek TypeScript (Node 22) core resource'u tüm veritabanı bağlantılarını sahiplenir; Lua, C# (Mono v2) ve TypeScript tüketicileri **şema-merkezli codegen** ile üretilmiş typed API'ler üzerinden, minimum runtime-sınırı maliyetiyle sorgu çalıştırır. hyper-framework org'unun ilk projesidir ve hyper-framework PvP sunucusunun resmi DB katmanı olacaktır.

## 2. Problem

FiveM ekosisteminde DB erişimi fiilen oxmysql'e (MariaDB, string SQL, tip güvenliği yok) mahkûmdur:

- **Tip güvenliği yok:** SQL string'leri elle yazılır; şema ile kod arasında derleme zamanı bağ yoktur. Hatalar runtime'da, oyuncular sunucudayken patlar.
- **Cache katmanı yok:** Her script kendi ad-hoc cache'ini yazar veya hiç yazmaz; sıcak veriler (session, canlı maç durumu) için Redis kullanımı standartlaşmamıştır.
- **Cross-runtime tutarsızlık:** Lua, JS ve C# tarafında aynı veriye erişim üç farklı, birbirinden habersiz yolla yapılır.
- **PostgreSQL desteği fiilen yok:** JSONB, RETURNING, partial index gibi modern özellikler ekosistemde kullanılamıyor.

## 3. Hedefler ve Başarı Kriterleri

### Hedefler
1. **Performans:** Runtime sınırından geçen payload minimum (queryId + düz param dizisi). Statik sorgular derleme zamanında SQL'e iner; PG prepared statement reuse. Hot-store okuma/yazmaları sub-ms.
2. **Tip güvenliği:** Tek şema tanımından (TS) üç dilde typed API üretimi. Şema ↔ DB tutarlılığı migration aracıyla garanti.
3. **Modülerlik:** Her paket bağımsız anlaşılır/test edilir; cache, hot-store, lock gibi özellikler opt-in.
4. **Açık kaynak kalitesi:** Benchmark suite (oxmysql karşılaştırmalı), dokümantasyon, docker-compose ile tek komut test ortamı.

### Başarı kriterleri (v1)
- [ ] Aynı sorgu için oxmysql'e kıyasla eşit veya daha iyi p50/p99 latency (benchmark suite ile kanıtlı).
- [ ] Lua/C#/TS'te derleme/analiz zamanında yakalanan şema uyumsuzluğu hataları (demo ile gösterilebilir).
- [ ] hyper PvP sunucusunun tüm DB trafiği hyper-db üzerinden akıyor.
- [ ] Cross-runtime çağrı başına serialize edilen payload ≤ queryId + params (ölçülebilir).

## 4. Hedef Kullanıcılar

- **Birincil:** hyper-framework PvP sunucusu geliştirme ekibi (Lua client, TS server, C# Mono v2 hot-path modülleri).
- **İkincil:** Performans ve tip güvenliği isteyen açık kaynak FiveM geliştiricileri (PG veya MariaDB kullanıcıları).

## 5. Kapsam

### 5.1 v1 Kapsamı (Var)

| # | Özellik | Açıklama |
|---|---|---|
| F1 | Core resource (TS/Node 22) | PG (postgres.js) + Redis (ioredis) + MariaDB (mariadb) bağlantı sahipliği; tek FiveM resource'u, esbuild ile tek dosya bundle |
| F2 | Şema DSL + Query AST | Drizzle modeli: `pg-core` ve `mysql-core` **ayrı typed modüller** — ortak payda vergisi yok; PG tarafında JSONB, RETURNING, partial index, advisory lock birinci sınıf |
| F3 | Codegen CLI | Şemadan → Lua repo modülleri + lua-language-server (EmmyLua) annotation'ları, C# DTO + kolon-bazlı typed builder, TS tipleri; statik sorgulara stabil **queryId** ataması |
| F4 | Query pipeline | `execute(queryId, params[])` exportu; dinamik sorgularda shape-hash'li AST→SQL cache; PG prepared statement reuse |
| F5 | Deklaratif cache | Repo/sorgu seviyesinde TTL + tag tabanlı invalidation; yazmalar ilgili tag'leri Redis pub/sub ile düşürür |
| F6 | Hot-store | Şemada `redisTable(...)` — tamamen Redis'te yaşayan typed yapılar (session, canlı maç, ELO oturumu); opsiyonel batch **write-behind** ile PG'ye kalıcılaştırma |
| F7 | Pub/Sub katmanı | Cache invalidation broadcast'i + gelecekteki multi-server dağıtımı için typed event API |
| F8 | Lock / rate-limit | `withLock()`, `rateLimit()`, atomic counter — Redis EVAL ile atomik (double-spend koruması) |
| F9 | Migrations | drizzle-kit benzeri: snapshot → diff → SQL üretimi → `migrate` runner + dev için `push`; dialect başına |
| F10 | Async ergonomi | Lua: coroutine tabanlı `:await()` (callback opsiyonel); C#: Mono v2 `Coroutine<T>` (Task yasak); TS: native async |
| F11 | Hata modeli | Sınırdan hata kodu + yapılandırılmış detay geçer; her dilde typed exception'a dönüşür |
| F12 | Gözlemlenebilirlik | Slow-query log, sorgu başına timing histogramı, cache hit/miss sayaçları; `hyperdb_stats` export/komutu; resmon-dostu |
| F13 | Test + benchmark | AST→SQL golden testleri, codegen snapshot testleri, docker-compose (PG+MariaDB+Redis) integration, FiveM e2e resource, oxmysql karşılaştırmalı benchmark suite |

### 5.2 Kapsam Dışı (v2+)
- Multi-server sharding / cluster koordinasyonu (pub/sub temeli hazır bırakılır)
- Admin / dashboard UI
- LISTEN/NOTIFY tabanlı reaktif sorgular
- RedM desteği
- Otomatik ("sihirli") cache — tüm cache davranışı açık ve deklaratiftir

## 6. Mimari

### 6.1 Repo yapısı (monorepo, bun workspaces)

```
hyper-db/
├─ packages/
│  ├─ core/        # TS: bağlantı yönetimi, query engine, cache, pub/sub, lock
│  ├─ schema/      # Şema DSL + Query AST (pg-core, mysql-core)
│  ├─ codegen/     # CLI: Lua/C#/TS üretimi + migrations
│  ├─ client-lua/  # Lua runtime kütüphanesi
│  └─ client-cs/   # C# Mono v2 runtime kütüphanesi
└─ resource/       # FiveM resource (fxmanifest + bundle)
```

### 6.2 Runtime topolojisi

- **Tek sahip prensibi:** Yalnızca `hyper-db` resource'u DB/Redis bağlantısı açar. Tüketici resource'lar asla doğrudan bağlanmaz.
- **Sınır disiplini:** Hot loop asla runtime sınırı geçmez. Sınırdan geçen tek şey: `queryId + düz parametre dizisi` (msgpack). Nested/karmaşık payload yasak.
- **Fallback ilkesi:** C# client (Mono v2 beta olduğundan) izole tutulur; C# tüketicisi olan her modülün Lua/TS fallback yolu olmalıdır.

### 6.3 Veri akışı (örnek: hit-validation sonrası ELO yazımı)

```
C# combat-core ──(1 export: queryId+params)──▶ hyper-db core (TS)
                                                │── Redis hot-store: canlı ELO güncelle (sub-ms)
                                                │── tag invalidation yayınla (pub/sub)
                                                └── write-behind kuyruğu → batch → PostgreSQL
```

## 7. API Örnekleri (hedef ergonomi)

```ts
// schema.ts — tek kaynak (pg-core)
export const players = hyperTable('players', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  elo: integer().default(1000),
});
export const sessions = redisTable('sessions', { /* typed, hot-store */ });
```

```lua
-- Lua (üretilmiş, EmmyLua tipli)
local top = Players.where('elo', '>', 2000):orderBy('elo', 'desc'):limit(10):await()
```

```csharp
// C# Mono v2 (üretilmiş DTO + typed builder)
var top = await Db.Players.Where(Players.Elo.Gt(2000)).OrderByDesc(Players.Elo).Limit(10);
```

## 8. Teknik Kararlar ve Gerekçeleri

| Karar | Gerekçe |
|---|---|
| Core dili TS/Node 22 (`node_version '22'`) | V8 JIT + async I/O modeli DB katmanı için ideal; Node 16 dönemi kapandı |
| postgres.js + ioredis + mariadb | Sınıflarının en hızlı/olgun Node sürücüleri |
| Şema-merkezli codegen (3 dilde tam ORM değil) | 3x bakım yükü ve dialect drift riski yerine tek kaynak; tip güvenliği codegen'le taşınır |
| Ayrı dialect modülleri (Drizzle modeli) | PG tam özellik kaybetmez, MariaDB ortak paydaya hapsolmaz |
| C#'ta LINQ expression yerine üretilmiş metod zinciri | Expression tree çevirisi yavaş ve sürprizli; üretilmiş builder hızlı ve öngörülebilir |
| Cache tamamen opt-in/deklaratif | Stale-data sürprizi PvP'de kabul edilemez; sihir yok |
| esbuild ile bundle | FiveM'in otomatik webpack/yarn build'i deprecated |

## 9. Riskler ve Önlemler

| Risk | Etki | Önlem |
|---|---|---|
| Mono v2 beta/durgun (son commit 2024-05) | C# client kırılabilir | C# client'ı izole paket; her C# tüketicisine Lua/TS fallback zorunluluğu; convar ile devre dışı bırakılabilir |
| Write-behind sırasında crash → veri kaybı | Sıcak veri PG'ye ulaşmadan kaybolur | Redis AOF everysec + flusher'da at-least-once teslim; kritik yazmalar için sync-write opsiyonu |
| Cache invalidation hataları → stale data | Yanlış ELO/ekonomi verisi | Tag modeli basit tutulur; invalidation golden testleri; TTL her zaman üst sınır |
| İki dialect'in test matrisi | Bakım yükü | Golden test + docker-compose CI matrisi ilk günden kurulur |
| FiveM export sınırında beklenmeyen serialize maliyeti | Latency hedefi kaçar | Benchmark suite ilk milestone'da; payload boyutu CI'da assert edilir |

## 10. Milestone'lar

| M | Teslimat | İçerik |
|---|---|---|
| M0 | İskelet + kanıt | Monorepo, core resource, PG bağlantısı, `execute()` exportu, Lua'dan ilk typed sorgu; **sınır maliyeti benchmark'ı** |
| M1 | ORM çekirdeği | pg-core şema DSL, AST→SQL, prepared statement pipeline, codegen (TS+Lua) |
| M2 | Redis katmanı | Deklaratif cache + tags + pub/sub invalidation; lock/rate-limit |
| M3 | Hot-store | redisTable + write-behind; PvP sunucusunda session/maç durumu ile gerçek kullanım |
| M4 | C# + MariaDB | Mono v2 client + mysql-core dialect |
| M5 | Migrations + yayın | drizzle-kit benzeri CLI, dokümantasyon, benchmark raporu, v1.0 açık kaynak yayını |

## 11. Açık Sorular

1. Lisans seçimi (MIT / Apache-2.0 / LGPL) — org kurulurken kararlaştırılacak.
2. Codegen'in Lua annotation formatı: lua-language-server sürüm hedefi.
3. Write-behind flush politikasının varsayılanları (interval / batch boyutu) — M3 benchmark'larıyla belirlenecek.
4. PvP sunucusunun mevcut MariaDB (XAMPP) verisinin PG'ye taşınma planı — hyper-db kapsamı dışında, ayrı bir migration projesi.
