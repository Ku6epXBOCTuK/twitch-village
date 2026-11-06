# twitch-village

Виджеты для OBS: зрители живут в сцене, появляются по событиям чата, ходят и
реагируют на сообщения и подарки. Сейчас в репозитории два виджета: `pizdudes`
(повара) и `shooting-words` (корабли и слова).

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
pnpm dev                # apps/overlay на Vite, сначала собирает ассеты
pnpm assets             # атласы виджетов и общий manifest.json для overlay
pnpm build              # production-сборка
pnpm -F @tv/overlay preview  # раздача собранного dist
pnpm format             # biome format --write по репозиторию
pnpm format:check       # проверка форматирования без записи
```

Корневой `pnpm test` идёт с `--passWithNoTests`: пустые пакеты не должны валить
общий прогон.

Адресно — `pnpm -F @tv/core test`, `pnpm -F @tv/protocol typecheck` и так же для
остальных пакетов.

## Запуск в OBS

Источник — Browser Source. Ширина 1920, высота 1080, FPS 30 или 60, поле Custom
CSS пустое. Фон прозрачный: страница не рисует подложку, её добавляет только
предпросмотр вне OBS.

Для разработки:

```sh
pnpm dev
```

URL источника: `http://localhost:5173/?widgets=pizdudes`.

Для собранной версии:

```sh
pnpm build
pnpm -F @tv/overlay preview
```

URL источника: `http://localhost:4173/?widgets=pizdudes`.

Параметры страницы:

| Параметр  | Значение                     | Что делает                                    |
| --------- | ---------------------------- | --------------------------------------------- |
| `widgets` | `pizdudes`, `shooting-words` | список через запятую; по умолчанию `pizdudes` |
| `debug`   | `1`                          | debug-панель; в OBS не включать               |
| `seed`    | число                        | seed мок-событий; по умолчанию `42`           |
| `mode`    | `manual`                     | без автогенерации, события только из панели   |

Примеры: `?widgets=pizdudes,shooting-words`, `?debug=1&mode=manual`.

## Свой виджет

1. **Пакет.** Создать `packages/widget-<имя>`: `package.json` с exports `.`,
   `./constants`, `./worker`, `tsconfig.json` с `lib: ["ES2022", "WebWorker"]`,
   `src/{constants,assets,world,widget,worker,manifest,index}.ts`,
   `assets-src/`, `.assetpack.js`, `scripts/prepare-assets.mjs` и
   `scripts/fix-manifest.mjs`. Зависимость только `@tv/protocol`: `pixi.js`,
   `@tv/core`, DOM и рантайм Effect внутри виджета запрещены.

2. **Воркер и дескриптор.** `src/worker.ts` собирает `Transport` поверх
   `self.postMessage` и вызывает `create<Name>Widget`. `src/constants.ts` хранит
   `WidgetId` и имя бандла. В overlay для виджета собирается
   `WidgetDescriptor {id, workerUrl, assetBundle, effectsManifest?, config?}`;
   `workerUrl` берётся из импорта `?worker&url`, иначе Vite вставит исходник
   воркера как data URL вместо отдельного чанка.

3. **Бандл.** `prepare-assets.mjs` раскладывает файлы в `assets/<бандл>/`,
   `.assetpack.js` читает этот каталог и пишет `dist-assets/manifest.json`.
   `scripts/fix-manifest.mjs` задаёт имя бандла и оставляет только alias,
   подходящие под `AssetId`. Пакет добавляется в список
   `apps/overlay/scripts/prepare-assets.mjs`, иначе overlay не увидит его файлы.
   `ASSET_BUNDLE` в виджете должен совпадать с именем бандла.

4. **Эффекты.** Если нужны фильтры, добавить `effectsManifest` в дескриптор:
   JSON `{effects: [{effectId, vertex, fragment, params}]}`. Пустой `vertex`
   означает стандартный вершинный шейдер Pixi. Команды `AddFilter`,
   `SetFilterParam`, `RemoveFilter` ссылаются на `effectId`. Overlay копирует
   `effects.json` пакета в `public/`, рядом с общим `manifest.json`.

5. **Регистрация в overlay.** Добавить пакет в зависимости
   `apps/overlay/package.json`, импортировать константы и
   `worker.ts?worker&url`, добавить дескриптор в массив `descriptors` в
   `apps/overlay/src/main.ts`, добавить пакет в `optimizeDeps.exclude` в
   `apps/overlay/vite.config.ts`. После этого виджет включается через
   `?widgets=<id>`.

6. **Лимиты и проверки.** Один `Batch` — не больше 2048 команд; на 200 зрителей
   сериализованный пакет не должен превышать 256 КиБ. Команды отправляются
   только на изменение, тик около 33 мс, heartbeat каждые 500 мс, `Ready` — на
   `Init`. Сообщения — plain-объекты без функций, классов и `undefined`. Логику
   проверять на `DirectTransport`, без браузера и GPU, вместе с
   `pnpm typecheck`, `pnpm lint` и `pnpm test`.

## Раскладка

```txt
apps/overlay/           OBS browser source: страница, bootstrap Core, debug-панель
packages/protocol/      контракт Core ↔ Widget: команды, события, ошибки, схемы
packages/core/          Render Core: Pixi, реестры, WidgetHost, CommandBus, SceneManager
packages/widget-<имя>/  виджет: воркер-энтри, мир, тик, ассеты, эффекты
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
| `@biomejs/biome`    | 2.6.x   |
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
- **Assetpack добавляет alias с расширением** (`cook/east/0.png`), а `AssetId`
  не допускает точку. `fix-manifest.mjs` в каждом виджете оставляет только
  валидные alias, без него `loadAssetManifest` падает на схеме.
- **`public/` и `dist-assets/` — генерируемые каталоги.** Руками их не править:
  `prepare-assets.mjs` очищает и собирает их заново.
- **Тест, которому нужен реальный GPU, воркер или OBS,** допустим только как
  ручной смоук. Контракт рендер-цели гоняется на двух реализациях
  (`pixi-render-target` и `fake-render-target`), поэтому ядро проверяется без
  браузера.
- **`performance.now` передаётся замыканием,** а не голой ссылкой на метод:
  `const now = () => performance.now()`. Голая ссылка падает с
  `Illegal invocation`.
