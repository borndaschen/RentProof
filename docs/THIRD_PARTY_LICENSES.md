# 第三方套件授權盤點

本文件只盤點RentProof所依賴的第三方軟體。RentProof repository本身依D-090採[Apache License 2.0](../LICENSE)，並提供根目錄[NOTICE](../NOTICE)；下列第三方發行物仍適用各自授權，官方來源快照與repository外Demo素材也不因專案授權而被重新授權。

## 直接Runtime Dependencies

| 套件                       |     鎖定版本 | 上游授權                                                             | 查核依據／Provenance                                              |
| -------------------------- | -----------: | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Next.js／`@next/env`       |       16.3.4 | MIT                                                                  | 已安裝套件的`package.json`與隨附License                           |
| React／React DOM           |       19.2.8 | MIT                                                                  | 已安裝套件的`package.json`與隨附License                           |
| `argon2`                   |       0.45.1 | MIT                                                                  | `node_modules/argon2/package.json`、根與vendored Argon2 `LICENSE` |
| Kysely                     |       0.29.5 | MIT                                                                  | `node_modules/kysely/package.json`與隨附`LICENSE`                 |
| node-postgres／`pg`        |       8.23.0 | MIT                                                                  | `node_modules/pg/package.json`與隨附`LICENSE`                     |
| OpenAI Node SDK            |        7.9.0 | Apache-2.0                                                           | 已安裝套件的`package.json`與隨附License                           |
| Mozilla `pdfjs-dist`       |      6.3.289 | Apache-2.0                                                           | 已安裝套件的`package.json`與隨附License                           |
| Sharp                      |       0.35.4 | Apache-2.0；Windows prebuilt另含Apache-2.0 AND LGPL-3.0-or-later標示 | 已安裝套件與prebuilt套件metadata／License                         |
| Radix Tabs                 |       1.1.21 | MIT                                                                  | 已安裝套件的`package.json`與隨附License                           |
| Zod                        |        4.5.4 | MIT                                                                  | 已安裝套件的`package.json`與隨附License                           |
| Lucide React               |       1.39.0 | ISC                                                                  | 已安裝套件的`package.json`與隨附License                           |
| Tailwind CSS／PostCSS      | 4.3.3／8.5.6 | MIT                                                                  | 已安裝套件的`package.json`與隨附License                           |
| `class-variance-authority` |        0.7.1 | Apache-2.0                                                           | 已安裝套件的`package.json`與隨附License                           |
| `clsx`／`tailwind-merge`   | 2.1.1／3.5.0 | MIT                                                                  | 已安裝套件的`package.json`與隨附License                           |
| `server-only`              |        0.0.1 | MIT                                                                  | 已安裝套件的`package.json`                                        |

## 開發與測試工具

Playwright採Apache-2.0；TypeScript、ESLint、Prettier、Vitest、Testing Library與Axe相關套件依各上游package所附授權使用。PostgreSQL型別套件`@types/pg`鎖定`8.23.1`，其已安裝`package.json`與`LICENSE`均標示MIT。這些工具不代表RentProof採用相同專案授權。

## Transitive License Categories

2026-09-03再次依鎖定的`package.json`、`pnpm-lock.yaml`與本機已安裝發行物核對新增的`argon2`、Kysely、`pg`及`@types/pg`；四者的package metadata與隨附License均標示MIT。`argon2`包含native prebuilt與vendored Argon2來源，安裝腳本及兩層License已人工核對。Production license inventory曾出現MIT、Apache-2.0、Apache-2.0 AND LGPL-3.0-or-later、ISC、BSD-3-Clause、0BSD與CC-BY-4.0等類別。部署或散布前仍須保留套件發行物中的原始License／Notice，並重新執行盤點以反映lockfile變更。

重跑指令：

```powershell
pnpm licenses list --prod --json
```

本盤點不是法律意見；若要對外散布binary、container或installer，需再依實際交付內容完成法務審閱，尤其確認Sharp／libvips prebuilt的LGPL條件及任何字型、影像或官方snapshot的個別使用條件。
