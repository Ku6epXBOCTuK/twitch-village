# Roadmap: twitch-village

**Статус:** Draft **Дата:** 2026-10-21 **Связанный документ:**
`docs/ARCHITECTURE.md`

Пошаговый план реализации v1 «деревня зрителей». Каждый шаг — самостоятельная
единица работы: файлы, команды, критерий готовности. Шаги выполняются строго по
порядку внутри фазы; фазы заканчиваются чекпоинтом.

Соглашения:

- Пакеты: `@tv/protocol`, `@tv/core`, `@tv/widget-village`, `@tv/event-mock`,
  `@tv/config`, приложение `@tv/overlay`.
- Версии фиксируются на шаге 8; примерные мейджоры: `pixi.js@8`, `effect@4`,
  `@assetpack/core@1`, `turbo@2`, `vite@8`, `vitest@5`, `typescript@5.9`.
- `pnpm` — единственный пакетный менеджер, `pnpm -F <pkg> <cmd>` для адресных
  команд.

---

## Фаза 0. Каркас монорепо

**Статус: выполнено.** Итоговые версии и отличия от плана см. в конце фазы.

### Шаг 1. Workspace

Файлы: `pnpm-workspace.yaml`, `package.json` (правка), `.npmrc`, `.gitignore`.

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

```ini
# .npmrc
auto-install-peers=true
strict-peer-dependencies=false
```

`.gitignore`: `node_modules`, `dist`, `dist-assets`, `.turbo`, `*.log`,
`.DS_Store`.

Готово: `pnpm -v` отвечает, `pnpm install` проходит без ошибок.

### Шаг 2. Корневой package.json

Файл: `package.json`.

- `"private": true`, `"type": "module"`.
- `packageManager` оставить как есть (`pnpm@12.14.0`), `devEngines` сохранить.
- Скрипты (все через turbo):

```json
{
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "lint": "turbo lint",
    "assets": "turbo assets",
    "format": "prettier --write . --log-level=warn"
  }
}
```

Готово: `pnpm typecheck` падает только из-за отсутствия пакетов (ожидаемо, шаг
3+).

### Шаг 3. Турбо

Файлы: `turbo.json`, `.turbo/.gitkeep` (не нужен, создастся сам).

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true },
    "assets": { "outputs": ["dist-assets/**"] }
  }
}
```

Готово: `pnpm turbo --version` и `pnpm turbo run --dry` работают.

### Шаг 4. Общий конфиг TS

Пакет `packages/config`.

Файлы:

- `packages/config/package.json` — `"@tv/config"`, `"private": true`,
  `"exports": { "./tsconfig.base.json": "./tsconfig.base.json" }`.
- `packages/config/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "noEmit": false
  }
}
```

Готово: файл на месте, `packages/config/tsconfig.json` extends базовый с
`"files": []`.

### Шаг 5. Скелет пакетов

Создать папки и `package.json` (одинаковая форма, различия — в `name` и
`dependencies`):

- `packages/protocol`
- `packages/core`
- `packages/widget-village`
- `packages/event-mock`
- `apps/overlay`

Шаблон:

```json
{
  "name": "@tv/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --noEmit false",
    "test": "vitest run",
    "lint": "eslint src"
  }
}
```

На v1 пакеты используют `src/index.ts` как `main` (без отдельной сборки) — Vite
транспилирует TS напрямую. Шаг «настоящий build» добавим, только если
понадобится публикация.

Готово: `pnpm install` связывает workspace-пакеты, `node -e` видит их в
`node_modules/@tv`.

### Шаг 6. TS-проекты и ссылки

Для каждого пакета — `tsconfig.json`:

```json
{
  "extends": "@tv/config/tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "lib": ["ES2022"] },
  "include": ["src"]
}
```

Особые случаи:

- `packages/core` — `lib: ["ES2022", "DOM"]`.
- `packages/widget-village` — `lib: ["ES2022", "WebWorker"]`, без `DOM`.
- `apps/overlay` — `lib: ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]`.
- Корневой `tsconfig.json` — `"references"` на все пакеты, `"files": []`.

Готово: `pnpm typecheck` проходит на пустых `src/index.ts`.

### Шаг 7. Линт, boundaries, prettier

Файлы: `eslint.config.js` (flat config в корне),
`packages/config/eslint.base.js`.

Запреты (правилами `no-restricted-imports` достаточно для v1):

- `packages/protocol` → `pixi.js`.
- `packages/widget-village` → `pixi.js`, `@tv/core`.
- `packages/core` → `@tv/widget-*`.
- `packages/event-mock` → `@tv/core`, `pixi.js`.
- В `widget-village` запрет глобалов `document`, `window` (правило
  `no-restricted-globals`).

Готово: `pnpm lint` зелёный; проверочный фейковый импорт `pixi.js` в
`widget-village` даёт ошибку линтера.

### Шаг 8. Установка зависимостей и фиксация версий

Команды:

```bash
pnpm -F @tv/protocol add effect
pnpm -F @tv/core add pixi.js effect
pnpm -F @tv/widget-village add effect
pnpm -F @tv/event-mock add effect
pnpm add -Dw turbo typescript vitest eslint @typescript-eslint/parser \
  @typescript-eslint/eslint-plugin @tv/config
pnpm -F @tv/widget-village add -D @assetpack/core sharp
```

После установки — зафиксировать точные версии (`pnpm-lock.yaml` коммитится).
Записать фактические версии PixiJS/Effect в `ARCHITECTURE.md`, раздел 12.

Готово: все пакеты ставятся, `pnpm install --frozen-lockfile` проходит.

**Чекпоинт фазы 0:** `pnpm install && pnpm typecheck && pnpm lint` — зелёные,
`pnpm turbo run --dry` показывает 5 пакетов.

### Что фактически сделано (отличия от плана)

- Версии: `pixi.js` 8.22, `effect` 4.0, `vite` 8.3, `typescript` 5.9, `vitest`
  5.0, `eslint` 10.13, `turbo` 2.11, `@assetpack/core` 1.7.
- **TypeScript 5.9, а не 7.x**: `typescript-eslint` 8.x падает на TS 7.0
  (`typescript-eslint does not support TS 7.0`). Вернуться к TS 7, когда
  появится поддержка.
- **Effect 4, а не 3**: v4 — актуальный релиз, `Schema` доступна из `effect`. В
  фазе 1 использовать `Data` и `Schema` из `effect`, а не из старых подпутей v3.
- **Project references не используются**: `noEmit` несовместим с `composite`.
  Вместо `tsc -b` каждый пакет делает `tsc --noEmit -p tsconfig.json`; типы
  между пакетами разрешаются через `package.json` (`"types": "./src/index.ts"`)
  и symlink pnpm. `turbo typecheck` запускает их параллельно.
- **`@tv/config` без собственных скриптов** — только `tsconfig.base.json` и
  `eslint.base.js`.
- **Настройки pnpm живут в `pnpm-workspace.yaml`**, а не в `package.json`: поле
  `pnpm` в `package.json` pnpm 12 игнорирует. Там же
  `allowBuilds: { sharp: true, cpu-features: false }` — `cpu-features` не
  собирается на Windows + Python 3 и не нужен.
- `eslint.config.js` — flat config с `typescript-eslint`; запреты на импорты и
  глобалы по пакетам (проверено: импорт `pixi.js` и обращение к `window` в
  `widget-village` дают ошибки линтера).
- Скрипт `assets` в `widget-village` уже есть (`assetpack`), но конфиг
  `.assetpack.js` создаётся в фазе 4 — до этого `pnpm assets` падает, это
  ожидаемо.
- `test` использует `vitest run --passWithNoTests`, чтобы пустые пакеты не
  валили `pnpm test` до появления тестов.

---

## Фаза 1. Протокол

### Шаг 9. Версия протокола

Файл: `packages/protocol/src/version.ts`.

```ts
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MAJOR = 1;
export const isCompatible = (remote: number): boolean =>
  remote === PROTOCOL_MAJOR;
```

Готово: экспорт доступен из `@tv/protocol`.

### Шаг 10. Идентификаторы

Файл: `packages/protocol/src/ids.ts`.

- Брендированные типы через `Schema`: `WidgetId`, `NodeId`, `AssetId`,
  `EffectId`, `ViewerId`.
- `nodeId` — строка до 128 символов, `[a-zA-Z0-9:_-]`.

Готово: `Schema.decodeUnknownSync(NodeId)` отбрасывает мусор, тест на это — в
шаге 16.

### Шаг 11. Команды рендера

Файл: `packages/protocol/src/commands.ts`.

`Data.TaggedEnum` для всех вариантов из раздела 4.2 архитектуры + `Schema` для
каждого варианта и объединённая `RenderCommandSchema`.

Требования:

- только plain-поля (числа, строки, булевы, массивы);
- `SetTransform` — все поля опциональные, кроме `nodeId`;
- `Batch.commands` — массив `RenderCommand`, максимальная глубина вложенности 1;
- лимиты: `nodeId` ≤ 128 символов, `commands` ≤ 2048, `fps` 1..60, `alpha` 0..1.

Готово: `RenderCommand.match` покрывает все варианты (проверяется типом на шаге
16).

### Шаг 12. События

Файл: `packages/protocol/src/events.ts`.

- `WidgetEvent`: `Init`, `ViewerEvent`, `Viewport`, `Pause`, `Resume`,
  `Dispose`.
- `ViewerEvent`: `ViewerJoined`, `ViewerMessage`, `ViewerGift`, `ViewerLeft`.
- `CoreToWidget` / `WidgetToCore` — объединения сообщений с полем
  `protocolVersion`.

Готово: схемы валидируют примеры из архитектуры, лишние поля отбрасываются
(`onExcessProperty: "error"`).

### Шаг 13. Ошибки

Файл: `packages/protocol/src/errors.ts`.

`Data.TaggedError` для всех записей из раздела 6 архитектуры +
`ProtocolMismatch`. Каждая ошибка несёт `widgetId`, человекочитаемое `message` и
поле-контекст (`nodeId`, `assetId`, `effectId`, `param` — что применимо).

Готово: `Effect.catchTag` компилируется на каждую ошибку, тесты — шаг 16.

### Шаг 14. Транспорт

Файлы: `packages/protocol/src/transport.ts`,
`packages/protocol/src/transport-direct.ts`.

- `interface Transport { send, subscribe, dispose }` (см. раздел 4.5).
- `createDirectTransportPair(): [coreSide, widgetSide]` — синхронная реализация
  для тестов, с возможностью включить асинхронную доставку через
  `queueMicrotask`.

Готово: пара транспортов передаёт сообщение в обе стороны, `dispose` отписывает
обработчики.

### Шаг 15. Публичный API пакета

Файл: `packages/protocol/src/index.ts`.

Экспорты: `PROTOCOL_VERSION`, типы и схемы, `Transport`,
`createDirectTransportPair`.

Готово: `import { ... } from "@tv/protocol"` работает в `core` и
`widget-village`.

### Шаг 16. Тесты протокола

Файлы: `packages/protocol/src/__tests__/commands.test.ts`, `events.test.ts`,
`errors.test.ts`, `transport.test.ts`, `compile-exhaustive.test.ts`.

Что проверяется:

1. Round-trip через `structuredClone` для каждого варианта команд и событий.
2. Валидные/невалидные примеры по таблице (неизвестный тег, `alpha: 2`,
   `fps: 0`, `nodeId: ""`, лишнее поле).
3. Вложенный `Batch` глубже одного уровня — отклоняется.
4. `DirectTransport` доставляет в обе стороны, после `dispose` — нет.
5. Exhaustive: функция-заглушка `match` без `default`, компилируется.
6. `PROTOCOL_VERSION` совпадает с мажором в `isCompatible`.

Готово: `pnpm -F @tv/protocol test` — зелёный, покрытие `commands.ts` ≥ 90%.

**Чекпоинт фазы 1:** контракт стабилен, `pnpm typecheck` и `pnpm test` зелёные;
ничего из `pixi.js` в графе зависимостей `protocol` нет
(`pnpm why pixi.js -F @tv/protocol` — пусто).

---

## Фаза 2. Render Core

### Шаг 17. Бутстрап Pixi

Файлы: `packages/core/src/pixi/create-app.ts`,
`packages/core/src/pixi/types.ts`.

- `createCoreApp({ width, height, backgroundAlpha })` → `PIXI.Application` с
  `resizeTo: window` (в браузере) и `resolution: window.devicePixelRatio`.
- В тестах — фабрика подменяется на фейк, поэтому создание приложения
  инжектируется, а не импортируется внутри модулей.

Готово: модуль компилируется; в `overlay` вызывается вручную (шаг 43), пока не
проверяем визуально.

### Шаг 18. Абстракция рендер-цели

Файл: `packages/core/src/nodes/render-target.ts`.

Интерфейс, за которым скрыт Pixi (нужен для тестов без GPU):

```ts
interface RenderTarget {
  createContainer(): RenderHandle;
  createSprite(assetId: AssetId): RenderHandle;
  createText(text: string, style: TextStyle): RenderHandle;
  setTransform(handle: RenderHandle, t: TransformPatch): void;
  setSpriteAsset(handle: RenderHandle, assetId: AssetId): void;
  setAnimation(
    handle: RenderHandle,
    frames: Texture[],
    fps: number,
    loop: boolean,
  ): void;
  addFilter(handle: RenderHandle, filter: Filter): void;
  removeFilter(handle: RenderHandle, effectId: EffectId): void;
  remove(handle: RenderHandle): void;
  attach(
    parent: RenderHandle | null,
    handle: RenderHandle,
    order: number,
  ): void;
}
```

`packages/core/src/nodes/pixi-render-target.ts` — реализация поверх Pixi;
`packages/core/src/nodes/fake-render-target.ts` — реализация для тестов
(записывает вызовы в массив).

Готово: обе реализации проходят общий contract-тест (шаг 30).

### Шаг 19. NodeRegistry

Файл: `packages/core/src/nodes/node-registry.ts`.

- `Map<NodeId, { handle, kind, parentId, filters }>` с префиксом экземпляра
  виджета.
- Операции: `create`, `get`, `remove`, `removeAll`, `list`.
- Ошибки: `UnknownNode`, дубликат `CreateNode`.
- Родитель по умолчанию — корневой контейнер виджета.

Готово: юнит-тесты на дубликат, неизвестный `nodeId`, `removeAll` чистит всё.

### Шаг 20. Применение команд

Файл: `packages/core/src/nodes/apply-command.ts`.

`applyCommand(ctx, command: RenderCommand): Effect<void, RenderError>`:

- маппинг `RenderCommand` → операции `RenderTarget`/`NodeRegistry`;
- каждый вариант обработан явно, `match` без `default`;
- `Batch` — рекурсивный вызов с ограничением глубины;
- `SetParent` переставляет узел в дереве;
- `AddFilter` берёт `Filter` из `EffectRegistry` (шаг 22);
- любое исключение Pixi ловится и превращается в `RenderFailed`.

Готово: таблица тестов «команда → вызовы рендер-таргета» на фейке, 1 тест на
вариант.

### Шаг 21. CommandBus

Файл: `packages/core/src/queue/command-bus.ts`.

```ts
createCommandBus(config: {
  maxQueueLength: number;      // 4096
  maxCommandsPerFrame: number; // 512
  maxDrainMs: number;          // 4
}): {
  push(widgetId: WidgetId, commands: RenderCommand[]): void;
  drain(widgetId: WidgetId, now: number): RenderCommand[];
  stats(widgetId: WidgetId): { queued: number; dropped: number; processed: number };
  clear(widgetId: WidgetId): void;
};
```

- Переполнение → `QueueOverflow`, очередь сбрасывается.
- `drain` уважает лимиты команд и миллисекунд.

Готово: тесты на лимит команд, лимит времени (мок `now`), переполнение,
счётчики.

### Шаг 22. AssetRegistry

Файлы: `packages/core/src/assets/asset-registry.ts`, `manifest.ts`.

- `init(globalManifest)` → `Assets.init`.
- `loadBundle(bundleId)`, `unloadBundle(bundleId)`, `isLoaded(bundleId)`.
- `getTexture(assetId)`: не загружен → `AssetNotFound`.
- `assetId` = путь внутри бандла, как в манифесте PixiJS v8.

Готово: тесты на двойную загрузку (идемпотентна), выгрузку, промах по ID (с
моком `Assets`).

### Шаг 23. EffectRegistry

Файлы: `packages/core/src/effects/effect-manifest.ts`,
`packages/core/src/effects/effect-registry.ts`.

- `EffectManifestSchema`: массив
  `{ effectId, vertex, fragment, params: { name, min, max, default } }`.
- `register(manifest)` — валидация схемы, без компиляции.
- `get(effectId, nodeKey)` — ленивая компиляция через `Filter.from`/`GlProgram`,
  кэш по `(effectId, nodeKey)`.
- `setParam(instance, name, value)` — проверка по диапазону из манифеста →
  `InvalidEffectParam`.
- Ошибка компиляции → `EffectCompileFailed`, эффект помечен и больше не
  компилируется.

Готово: тесты на неизвестный `effectId`, значение вне диапазона, кэш возвращает
один и тот же экземпляр. Компиляция в тестах мокается.

### Шаг 24. Статус и счётчики

Файл: `packages/core/src/status.ts`.

```ts
type WidgetState = "loading" | "active" | "paused" | "degraded" | "crashed";
interface WidgetStatus {
  widgetId: WidgetId;
  state: WidgetState;
  counters: Record<RenderErrorTag | "heartbeat", number>;
  lastError?: { tag: string; message: string; at: number };
}
```

`StatusStore` — подписка на изменения (для debug-панели).

Готово: тест на инкремент и на уведомление подписчика.

### Шаг 25. WorkerTransport

Файл: `packages/core/src/widget/worker-transport.ts`.

- Обёртка над `Worker` + `Transport`, установка `onmessage`/`onerror`.
- `worker.onerror` и `messageerror` → колбэк `onFailure(WidgetCrashed)`.
- Версионирование: первое сообщение от воркера обязано быть `Ready` с
  `protocolVersion`; несовпадение → `ProtocolMismatch`, воркер терминируется.

Готово: тест с фейковым `Worker` (объект с `postMessage`/`terminate`).

### Шаг 26. WidgetHost

Файл: `packages/core/src/widget/widget-host.ts`.

Собирает всё вместе:

```js
createWidgetHost(descriptor, deps) → {
  start(): Effect<void, WidgetError>;
  stop(): Effect<void, never>;
  onCoreEvent(event: WidgetEvent): void;
  status(): WidgetStatus;
}
```

- `start`: загрузка бандла → регистрация эффектов → создание воркера → ожидание
  `Ready` с таймаутом 5 с → `active`.
- `stop`: `Dispose` → `terminate()` → `unloadBundle` → удаление всех узлов.
- Подписка на сообщения: валидация → очередь → счётчики.
- `onCoreEvent` — отправка событий зрителей/вьюпорта в воркер.

Готово: тест на полный цикл на фейковом воркере и `DirectTransport`.

### Шаг 27. Watchdog

Файл: `packages/core/src/widget/watchdog.ts`.

- Ожидание `Heartbeat` каждые `intervalMs` (500), таймаут `timeoutMs` (2000).
- `check(now)` вызывается из тикера; просрочка → `WidgetTimeout`.
- Флаг «на паузе» отключает таймаут.

Готово: тест с мок-временем: пропуск heartbeat → таймаут; `Pause` → нет
таймаута.

### Шаг 28. SceneManager

Файл: `packages/core/src/scene/scene-manager.ts`.

- `activate(descriptor)`, `deactivate(widgetId)`, `status()`, `list()`.
- Держит корневой контейнер на виджет (`stage.addChild`), `zIndex` по порядку
  активации.
- Идемпотентность: повторная активация без `restart` — no-op.
- Публичный API Core — `packages/core/src/index.ts`:

```ts
createRenderCore({ app, width, height }) → {
  scene: SceneManager;
  status: StatusStore;
  dispose(): Promise<void>;
}
```

Готово: тест «активировать два виджета → два контейнера, деактивировать один →
один контейнер, бандл выгружен».

### Шаг 29. Дренаж в тикере

Файл: `packages/core/src/loop/ticker.ts`.

- `app.ticker.add(() => { for each widget: bus.drain(); apply; watchdog.check() })`.
- Всё в `try/catch`: исключение → `RenderFailed` в статус, кадр продолжается.
- Пустой кадр не должен создавать мусор (никаких аллокаций массивов при пустых
  очередях).

Готово: тест «исключение в applyCommand не ломает обработку следующего виджета».

### Шаг 30. Contract-тест рендер-цели и чекпоинт

Файлы: `packages/core/src/nodes/__tests__/render-target.contract.ts`,
`apply-command.test.ts`, `command-bus.test.ts`, `node-registry.test.ts`,
`effect-registry.test.ts`, `widget-host.test.ts`.

Готово: `pnpm -F @tv/core test` зелёный; ни один тест не требует GPU.

**Чекпоинт фазы 2:** Core компилируется и покрыт тестами; на фейковом воркере
можно активировать виджет, отправить `CreateNode`/`SetTransform` и увидеть
вызовы рендер-таргета.

---

## Фаза 3. Виджет «деревня»

### Шаг 31. Мир и сущности

Файлы: `packages/widget-village/src/world/types.ts`,
`packages/widget-village/src/world/viewer.ts`.

- `Viewer`: `id`, `displayName`, `color`, `avatarIndex`, `x`, `y`, `vx`, `vy`,
  `state`, `celebrateUntil`, `nodeIds`.
- Состояния: `idle`, `walk`, `celebrate`, `leaving`.

Готово: типы экспортируются, юнит-тест на переходы состояний.

### Шаг 32. Фиксированный тик

Файл: `packages/widget-village/src/world/clock.ts`.

- Накопитель времени: `advance(now) → steps`, шаг 100 мс, максимум 5 шагов за
  вызов (защита от спирали смерти после лага).
- Инжектируемое время (`now`) для детерминизма в тестах.

Готово: тест «1 секунда = 10 шагов; 10 секунд лага = 5 шагов максимум».

### Шаг 33. Шаги мира

Файл: `packages/widget-village/src/world/step.ts`.

- Движение к цели, отражение от границ viewport'а, смена цели по таймеру.
- `ViewerMessage` → `celebrate` на 1.5 с.
- `ViewerGift` → `celebrate` дольше + флаг вспышки.
- `ViewerLeft` → `leaving`, затухание 500 мс, затем удаление.

Готово: тест «зритель не выходит за границы», «подарок продлевает celebrate»,
«leaving удаляется через 500 мс».

### Шаг 34. Генерация команд (dirty-check)

Файл: `packages/widget-village/src/world/emit.ts`.

- Сравнение предыдущего и текущего снимка сущности; команды только на дельту.
- Новый зритель → `CreateNode` × 3 (контейнер/спрайт/текст) + `SetParent` +
  `SetSprite`/`SetText` + `SetTransform`.
- Изменение позиции → `SetTransform`; смена состояния → `SetAnimation`/`alpha`.
- Удаление → `RemoveNode` для контейнера (дети удаляются узлом-владельцем —
  добавить это поведение в `NodeRegistry`, шаг 19).
- Всё упаковывается в `Batch`.

Готово: тест «нет изменений → нет команд», «сдвиг на 5 px → одна
`SetTransform`», «спавн → ровно 7 команд».

### Шаг 35. Определение виджета и воркер-энтри

Файлы: `packages/widget-village/src/widget.ts`,
`packages/widget-village/src/worker.ts`.

```ts
export const villageWidget: WidgetDefinition = {
  id: "village",
  assetBundle: "village",
  create(transport, ctx) { ... },
};
```

`worker.ts` — единственная точка входа воркера: `self.onmessage` ↔ `Transport`,
тик через `setInterval` 100 мс, `Heartbeat` каждые 500 мс, `Ready` при старте,
обработка `Pause/Resume/Dispose`.

Готово: воркер запускается в браузере вручную (проверка — фаза 5), в Node-тестах
используется `DirectTransport` без `self`.

### Шаг 36. Слой рендера виджета

Файл: `packages/widget-village/src/render/layout.ts`.

- Раскладка: аватар 32×32, имя под ним, `zIndex` по `y`.
- Имена nodeID: `avatar-<viewerId>`, `avatar-<viewerId>-sprite`,
  `avatar-<viewerId>-name`.
- Цвета имени из `ViewerEvent.color` (fallback — палитра из 8 цветов по хешу
  `viewerId`).

Готово: тест на стабильность `nodeId` для одного `viewerId` и уникальность между
зрителями.

### Шаг 37. Подключение события

Файл: `packages/widget-village/src/village-widget.ts`.

- `Init` → сохранить viewport и конфиг, поставить мир на паузу до `Ready`.
- `ViewerEvent` → в мир; затем на ближайшем тике — команды.
- `Viewport` → пересчёт границ, команды только при изменении.
- `Pause/Resume` → остановка/запуск тика и heartbeat.

Готово: интеграционный тест на `DirectTransport`: 3 события → ожидаемые команды
в правильном порядке.

### Шаг 38. Тесты мира

Файлы: `packages/widget-village/src/__tests__/world.test.ts`, `emit.test.ts`,
`widget.test.ts`, `clock.test.ts`.

- Детерминизм: одинаковый seed и одинаковые события → байт-в-байт одинаковый
  список команд.
- Нагрузка: 200 зрителей, 100 тиков — число команд на тик ≤ 3 × число
  изменившихся сущностей; ни одного кадра дольше 5 мс (замер `performance.now`).
- Пауза: за 5 с паузы — 0 команд.

Готово: `pnpm -F @tv/widget-village test` зелёный.

**Чекпоинт фазы 3:** мир живёт в тестах без Pixi и без DOM; команды валидны по
схемам из `protocol` (проверить `Schema.decodeUnknownSync` на каждом
сгенерированном сообщении).

---

## Фаза 4. Ассеты и эффекты

### Шаг 39. Плейсхолдер-арт

Файл: `packages/widget-village/scripts/gen-placeholder-assets.mjs`.

- Генерирует 4 аватара × 4 кадра (32×32 PNG) и `name-plate` через `sharp`:
  простые фигуры (круг/квадрат/треугольник) с разными цветами и смещением кадра.
- Кладёт в `packages/widget-village/assets/`.
- Скрипт идемпотентен: перезапись без изменения mtime при совпадении
  содержимого.

Готово:
`pnpm -F @tv/widget-village exec node scripts/gen-placeholder-assets.mjs`
создаёт 17 файлов, которые открываются как PNG.

### Шаг 40. Конфиг assetpack

Файл: `packages/widget-village/.assetpack.js`.

- `entry: "./assets"`, `output: "./dist-assets"`, `cache: false`.
- `pipes: [pixiPipes({ manifest: { name: "village", version: "1.0.0" } })]`.
- Сборка кладёт `manifest.json` (формат PixiJS v8) и атлас.

Готово: `pnpm -F @tv/widget-village assets` создаёт `dist-assets/manifest.json`
с бандлом `village`.

### Шаг 41. Манифест эффектов

Файлы: `packages/widget-village/effects/effects.manifest.json`,
`packages/widget-village/src/effects/glow.ts` (если нужен TS-источник вместо
JSON-строки).

- Один эффект `glow_pulse`: uniform `uTime` (0..1000, авто), `uIntensity` (0..1,
  default 0.5), `uColor` (vec3, default `[1, 0.8, 0.3]`).
- Вершинный шейдер — стандартный из PixiJS v8, фрагментный — тонирование +
  пульсация по `uTime`.

Готово: манифест проходит `EffectManifestSchema` из шага 23 (тест в `core`).

### Шаг 42. Подключение ассетов к виджету

Файлы: `packages/widget-village/src/assets.ts`, правка `render/layout.ts`.

- Список `assetId`, которые использует виджет, — константы
  (`avatar/<index>/<frame>`, `name-plate`).
- В `SetAnimation` уходят только `assetId`; никаких текстур в воркере нет.

Готово: набор `assetId` сверяется тестом с реальными ключами `manifest.json`
(тест читает сгенерированный манифест — защита от рассинхрона).

### Шаг 43. Эффект в деревне

Файл: правка `packages/widget-village/src/village-widget.ts`.

- `ViewerGift` → `AddFilter(effectId: "glow_pulse")` на контейнер зрителя,
  `SetFilterParam(uIntensity)` по величине подарка; снятие через `RemoveFilter`
  по окончании `celebrate`.

Готово: интеграционный тест «подарок → 2 команды фильтра, по истечении →
`RemoveFilter`».

**Чекпоинт фазы 4:** `pnpm assets` собирает атлас и манифест; тест на
соответствие `assetId` проходит; эффект валиден по схеме.

---

## Фаза 5. Приложение и debug-панель

### Шаг 44. Мок-источник событий

Файлы: `packages/event-mock/src/index.ts`, `packages/event-mock/src/prng.ts`,
`packages/event-mock/src/mock-source.ts`.

- `interface ViewerEventSource { subscribe(handler); start(config); stop(); }`.
- `MockEventSource`: детерминированный PRNG (mulberry32) с seed, режимы `manual`
  и `auto` (интервал 1–3 с, случайное событие по весам).
- Библиотека имён и палитра — константы.

Готово: тест «seed 42 → одинаковая последовательность событий», «stop → нет
событий».

### Шаг 45. Bootstrap оверлея

Файлы: `apps/overlay/index.html`, `apps/overlay/src/main.ts`,
`apps/overlay/src/config.ts`.

- Парсинг query: `?widgets=village&debug=1&seed=42&mode=manual`.
- Создание `PIXI.Application`, `createRenderCore`, регистрация дескриптора
  деревни:

```ts
const worker = new Worker(
  new URL("@tv/widget-village/worker", import.meta.url),
  { type: "module" },
);
```

- `event-mock` → `core.scene.dispatch(ViewerEvent)`.
- Обработка `visibilitychange` → `Pause/Resume`.

Готово: `pnpm dev` открывает страницу, в консоли — активация виджета и
`Hello from worker`.

### Шаг 46. Vite-конфиг и сборка воркера

Файл: `apps/overlay/vite.config.ts`.

- `worker: { format: "es" }`, `build.target: "es2022"`.
- `optimizeDeps.exclude: ["@tv/*"]`, alias на `src` пакетов.
- Ассеты: `publicDir` указывает на `dist-assets` через `viteStaticCopy` или
  symlink/копирование в `assets` — выбрать копирование (проще, предсказуемо).
- `server.port: 5173`, `server.host: true` (нужно для OBS).

Готово: `pnpm -F @tv/overlay build` создаёт `dist` с отдельным чанком воркера и
`manifest.json` ассетов.

### Шаг 47. Debug-панель

Файлы: `apps/overlay/src/debug/panel.ts`, `apps/overlay/src/debug/panel.css`.

- Правый верхний угол, `pointer-events: auto`, тёмная плашка, моно-шрифт.
- Секции: статус виджетов (state + счётчики), кнопки действий (спавн, сообщение,
  подарок, уволить всех, деактивировать/активировать, убить воркер), ползунок
  seed.
- Обновление по подписке `StatusStore`, не по таймеру.
- В OBS панель скрыта (`debug=1` только для разработки).

Готово: панель показывает `active` и нулевые счётчики; кнопки генерируют
события.

### Шаг 48. Смоук в браузере

Действия:

1. `pnpm dev`, открыть `http://localhost:5173/?debug=1`.
2. Debug: «спавн зрителя» × 5 → пять аватаров с именами.
3. «подарок» → пульсация (эффект) и `celebrate`.
4. «убить воркер» → статус `crashed`, контейнеры исчезли, страница жива.
5. Реактивация → деревня пустая, счётчики сброшены, рендер работает.
6. В OBS: Browser Source на тот же URL, 1920×1080, проверка позиционирования и
   `devicePixelRatio`.

Готово: все шесть пунктов проходят без ошибок в консоли; зафиксировать
скриншот/заметку в PR.

**Чекпоинт фазы 5:** продукт виден в OBS, деревня реагирует на мок-события,
debug-панель управляет жизненным циклом.

---

## Фаза 6. Надёжность и финализация

### Шаг 49. Полный цикл ошибок

Файл: `packages/core/src/__tests__/resilience.test.ts`.

- Сценарий 1: воркер шлёт поток в 100 000 команд → `QueueOverflow`, виджет
  `degraded`, остальные живы.
- Сценарий 2: воркер молчит → `WidgetTimeout` через 2 с, контейнер скрыт.
- Сценарий 3: `worker.onerror` → `WidgetCrashed`, `terminate()` вызван ровно
  один раз.
- Сценарий 4: несовпадение версии → `ProtocolMismatch`, воркер не активирован.

Готово: 4 теста зелёные.

### Шаг 50. Утечки при переключении

Файл: `packages/core/src/__tests__/lifecycle.test.ts`.

- 20 циклов activate/deactivate: число контейнеров на `stage` = 0, число
  воркеров = 0, `Assets` не держит бандл, `EffectRegistry` не держит экземпляры.

Готово: тест зелёный, `scene.list()` пуст после цикла.

### Шаг 51. Ограничения транспорта и размер сообщений

Файл: `packages/protocol/src/__tests__/budget.test.ts`.

- Проверка, что сериализованный `Batch` для 200 зрителей укладывается в 256 КБ и
  не содержит запрещённых типов (функции, классы, `undefined` в значениях).

Готово: тест зелёный; при превышении — план действий (уменьшить частоту
`SetTransform` до каждого второго тика).

### Шаг 52. Документация запуска

Файл: `README.md`.

- Требования (Node, pnpm), команды (`install`, `dev`, `build`, `test`,
  `assets`).
- Как подключить в OBS (Browser Source, URL, размер, `?debug=1`).
- Как добавить свой виджет: 6 пунктов (пакет, дескриптор, бандл, манифест
  эффектов, регистрация в `overlay`, лимиты).
- Ссылки на `docs/ARCHITECTURE.md` и `docs/ROADMAP.md`.

Готово: новый человек по README поднимает проект с нуля.

### Шаг 53. Финальная проверка v1

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm assets
pnpm build
```

Плюс смоук из шага 48 в собранном `dist` (не в dev-режиме), в OBS.

Готово: все команды зелёные, смоук пройден, `docs/` соответствует реальному
коду.

---

## Definition of done для v1

1. Деревня живёт в OBS: аватары появляются по событиям, двигаются, реагируют на
   сообщения и подарки.
2. Вся логика виджета — в отдельном Worker'е; `pixi.js` физически недоступен из
   пакета виджета (линт + граф зависимостей).
3. Падение/зависание воркера: контейнер скрыт, статус `crashed`, рендер и
   страница живы, реактивация работает.
4. Горячее переключение виджета не пересоздаёт `PIXI.Application` и не течёт.
5. События приходят из `event-mock`; замена на реальный Twitch — работа только
   над `event-mock`, контракт `ViewerEvent` не меняется.
6. Сборка, типы, линт и тесты — по одной команде каждое.

## Что после v1 (не входит в этот план)

1. Реальный Twitch: EventSub-клиент (сервер) или IRC в браузере.
2. Отдельная страница-пульт + транспорт до OBS-источника (WebSocket).
3. `Scope`/`acquireRelease` из Effect на ресурсы, `@effect/rpc` при росте
   протокола.
4. Второй виджет (например, алерты) — проверка, что Core действительно
   виджет-агностичен.
5. WASM-виджет на том же протоколе.
6. Персистентность деревни между перезапусками.
