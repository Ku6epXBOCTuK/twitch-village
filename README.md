# twitch-village

Виджет для OBS «деревня зрителей»: аватары зрителей живут в сцене, появляются по
событиям чата, ходят и реагируют на сообщения и подарки.

Архитектура — Render Core + командный протокол: `@tv/core` единолично владеет
PixiJS и GPU, каждый виджет работает в своём Web Worker и присылает
декларативные команды рендера.

## Документация

| Файл                   | Отвечает на вопрос                    |
| ---------------------- | ------------------------------------- |
| `docs/ARCHITECTURE.md` | как устроено и почему именно так      |
| `docs/ROADMAP.md`      | что сделано и что впереди             |
| `docs/DECISIONS.md`    | почему отказались от другого варианта |
| `AGENTS.md`            | правила работы над репозиторием       |

## Требования

- Node.js LTS.
- pnpm 12 (`packageManager` в корневом `package.json`, pnpm ставится сам через
  `corepack` или `devEngines`).
- GPU и браузер не нужны ни для сборки, ни для тестов: Pixi живёт только в
  браузере, тесты гоняются на фейковом рендер-таргете.

## Команды

Всё запускается из корня монорепо.

```sh
pnpm install
pnpm typecheck          # turbo typecheck по всем пакетам
pnpm lint
pnpm test               # turbo test, без браузера и GPU
pnpm test:watch
pnpm dev                # apps/overlay на Vite
pnpm assets             # сборка атласов @assetpack/core, до фазы 4 падает
pnpm format             # prettier --write по репозиторию
```

Корневой `pnpm test` идёт с `--passWithNoTests`: пустые пакеты не должны валить
общий прогон.

Адресно — `pnpm -F @tv/core test`, `pnpm -F @tv/protocol typecheck` и так же для
остальных пакетов.

## Раскладка

```txt
apps/overlay/           OBS browser source: страница, bootstrap Core, debug-панель
packages/protocol/      контракт Core ↔ Widget: команды, события, ошибки, схемы
packages/core/          Render Core: Pixi, реестры, WidgetHost, CommandBus, SceneManager
packages/widget-village/ виджет «деревня»: воркер-энтри, мир, тик, ассеты, эффекты
packages/event-mock/    мок-источник событий зрителей
packages/config/        общие tsconfig, eslint, vitest-пресеты
docs/                   архитектура, план, журнал решений
```

Правила импортов между пакетами и зоны Effect — `docs/ARCHITECTURE.md` §3.1 и
§9.1, проверяются линтером в `eslint.config.js`.

## Версии

| Пакет               | Версия  |
| ------------------- | ------- |
| `pixi.js`           | 8.22.x  |
| `effect`            | 4.0.x   |
| `vite`              | 8.x     |
| `typescript`        | 5.9.x   |
| `vitest`            | 5.0.x   |
| `eslint`            | 10.13.x |
| `typescript-eslint` | 8.71.x  |
| `turbo`             | 2.11.x  |
| `@assetpack/core`   | 1.7.x   |
| `sharp`             | 0.35.x  |

Версии держатся фиксированными, апгрейд — отдельный шаг. TypeScript остаётся на
5.9: `typescript-eslint` 8.x не поддерживает TS 7.

## Грабли

- **Project references не используются.** `noEmit` несовместим с `composite`.
  Типы между пакетами идут через `package.json` (`"types": "./src/index.ts"`) и
  symlink pnpm.
- **Настройки pnpm — в `pnpm-workspace.yaml`,** не в поле `pnpm` у
  `package.json`: pnpm 12 его игнорирует. Там же `allowBuilds`: `sharp: true`,
  `cpu-features: false` (`cpu-features` не собирается на Windows + Python 3).
- **`pnpm assets` падает до появления `.assetpack.js`** — это ожидаемо до
  фазы 4.
- **Тест, которому нужен реальный GPU, воркер или OBS,** допустим только как
  ручной смоук. Контракт рендер-цели гоняется на двух реализациях
  (`pixi-render-target` и `fake-render-target`), поэтому ядро проверяется без
  браузера.
- **`performance.now` передаётся замыканием,** а не голой ссылкой на метод:
  `const now = () => performance.now()`. Голая ссылка падает с
  `Illegal invocation`.
