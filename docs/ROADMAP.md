# Roadmap: twitch-village

**Статус:** в работе: фазы 0-1 закрыты, в фазе 2 закрыты шаги 17-24, следующий —
шаг 25. **Обновлено:** 2026-10-28.

Этот файл отвечает только на вопрос «что ещё не сделано». Как устроено —
`docs/ARCHITECTURE.md`, почему отказались от других вариантов —
`docs/DECISIONS.md`, сборка и грабли — `README.md`.

Направление, а не истина: если по коду задача решается иначе, делается
правильное решение, а шаг переписывается под него. Номера шагов не меняются — на
них ссылаются архитектура и история задач. Закрытый шаг сжимается до строки в
таблице итогов: решения уходят в `ARCHITECTURE.md` и `DECISIONS.md`, инструкции
и код — в репозиторий. Пересказ сделанного в роадмапе не живёт.

Соглашения: `pnpm` — единственный пакетный менеджер (`pnpm -F <pkg> <cmd>`),
пакеты `@tv/protocol`, `@tv/core`, `@tv/widget-village`, `@tv/event-mock`,
`@tv/config`, приложение `@tv/overlay`.

---

## Фаза 0. Каркас монорепо

**Статус: выполнено (шаги 1-8).** pnpm-workspace + Turborepo, корневые скрипты,
типы между пакетами через `package.json`, фиксированные версии и линт границ.
Команды, версии и локальные грабли — `README.md`.

---

## Фаза 1. Протокол

**Статус: выполнено (шаги 9-16).** `@tv/protocol` — единственный источник правды
по контракту:

- `version.ts` — `PROTOCOL_VERSION` и `isCompatible` по мажорной версии;
- `ids.ts` — брендированные `NodeId`, `AssetId`, `EffectId`, `ViewerId`,
  `WidgetId` (до 128 символов, `[A-Za-z0-9:_-]`); `AssetId` — исключение: это
  путь внутри бандла (`avatar/cat/0`), ему разрешён `/`;
- `commands.ts` — все `RenderCommand`, листовой `Batch` (≤ 2048), лимиты в
  схемах (`alpha` 0..1, `fps` 1..60);
- `events.ts` — `WidgetEvent`, `ViewerEvent`, конверты `CoreToWidget` /
  `WidgetToCore` с `protocolVersion`;
- `errors.ts` — 12 `Data.TaggedError` из раздела 6 архитектуры;
- `transport.ts` — `Transport<Outgoing, Incoming>` и `createDirectTransportPair`
  для тестов.

Тесты покрывают round-trip через `structuredClone`, невалидные примеры (лишние
поля, границы, неизвестный тег), доставку через транспорт, `dispose` и
исчерпывающий `Match`.

---

## Фаза 2. Render Core

**Статус: в работе. Закрыты шаги 17-24, дальше шаг 25.**

Закрытые шаги. Что получилось — `ARCHITECTURE.md`, почему так, а не иначе —
`DECISIONS.md`:

| Шаг | Итог                                                                                    | Задача | Решение    |
| --- | --------------------------------------------------------------------------------------- | ------ | ---------- |
| 17  | бутстрап Pixi, `createPixiApp`                                                          | TV-12  | —          |
| 18  | `RenderTarget` и общий контракт на двух реализациях, без GPU                            | TV-13  | —          |
| 19  | `NodeRegistry` заведён и позже убран: индекс узлов один, в `RenderState`                | TV-14  | D-07       |
| 20  | `applyCommand`: `Match` по всем вариантам, `ApplyCommandResult`, 16 ошибок — потолок    | TV-15  | D-08, D-12 |
| 21  | `CommandBus`: FIFO на виджет, лимиты на кадр, `QueueOverflow` через `onOverflow`        | TV-16  | D-09       |
| 22  | `AssetRegistry`: бандлы, дедупликация загрузок, `AssetBackend` за Promise-границей      | TV-17  | D-06, D-10 |
| 23  | `EffectRegistry`: ленивая компиляция, кэш `(effectId, nodeId)`, `register` меняет набор | TV-18  | D-06, D-11 |
| 24  | `WidgetStatus` и `StatusStore` с уведомлением подписчиков раз в кадр                    | TV-19  | —          |

Доработки после этих шагов: TV-26 (пачка не обрывается на первой ошибке), TV-33
(правило `throw`), TV-34 (порты отдают значения вместо броска), TV-30 и TV-31
(типизированные ошибки и чистка рендер-цели).

### Шаг 25. WorkerTransport

Файл: `packages/core/src/widget/worker-transport.ts`.

- Обёртка над `Worker` + `Transport`, `onmessage`/`onerror`.
- `worker.onerror` и `messageerror` → `onFailure(WidgetCrashed)`.
- Первое сообщение от воркера обязано быть `Ready` с `protocolVersion`;
  несовпадение → `ProtocolMismatch`, воркер терминируется.
- Каждое входящее сообщение проходит `decodeWidgetToCore` из `@tv/protocol`
  (строгий декод: лишние поля — ошибка). Провал декода — нарушение протокола,
  как и несовпадение версии.

Готово: тест с фейковым `Worker`.

### Шаг 26. WidgetHost

Файл: `packages/core/src/widget/widget-host.ts`.

- `start`: загрузка бандла → регистрация эффектов → создание воркера → ожидание
  `Ready` с таймаутом 5 с → `active`.
- `stop`: `Dispose` → `terminate()` → `unloadBundle` → удаление всех узлов.
- Подписка на сообщения: валидация → очередь → счётчики.
- `onCoreEvent` — отправка событий зрителей и вьюпорта в воркер.
- Зависимости берутся из `Context` внутри `Effect.gen`; `start`/`stop` —
  `Effect` со `Scope` и таймаутом (`ARCHITECTURE.md` §9.1).

Готово: тест на полный цикл на фейковом воркере и `DirectTransport`.

### Шаг 27. Watchdog

Файл: `packages/core/src/widget/watchdog.ts`.

- `Heartbeat` каждые `intervalMs` (500), таймаут `timeoutMs` (2000).
- `check(now)` вызывается из тикера; просрочка → `WidgetTimeout`.
- Флаг «на паузе» отключает таймаут.

Готово: тест с мок-временем: пропуск heartbeat → таймаут; `Pause` → нет
таймаута.

### Шаг 28. SceneManager

Файл: `packages/core/src/scene/scene-manager.ts`.

- `activate(descriptor)`, `deactivate(widgetId)`, `status()`, `list()`.
- Корневой контейнер на виджет (`stage.addChild`), `zIndex` по порядку
  активации; повторная активация без `restart` — no-op.
- Публичный API Core (`packages/core/src/index.ts`) — `createRenderCore`,
  который принимает `CoreServices` из `live.ts` и остаётся plain-объектом;
  `activate`/`deactivate` возвращают `Effect<void, WidgetError>` и выполняются
  приложением через `ManagedRuntime`.

Готово: тест «активировать два виджета → два контейнера, деактивировать один →
один контейнер, бандл выгружен».

### Шаг 29. Дренаж в тикере

Файлы: `packages/core/src/loop/ticker.ts`, мост —
`packages/core/src/effect-adapter.ts`.

- `app.ticker.add(() => adapter.frame())`; `adapter` — единственное место с
  `runSync` (линт это держит).
- Кадр: `bus.drain()` по виджетам → `applyCommand` → `watchdog.check()` в одну
  Effect-программу.
- Результат `applyCommand` (`errors`, `skipped`) уходит в счётчики статуса;
  ошибки не отменяют ни кадр, ни остальные виджеты, поэтому кадр обрабатывает
  значения, а не ловит исключения.
- Пустой кадр не аллоцирует.

Готово: тест «исключение в applyCommand не ломает обработку следующего виджета».

### Шаг 30. Contract-тест рендер-цели и чекпоинт

Файлы: `packages/core/src/nodes/render-target.contract.ts` и тесты
`apply-command`, `command-bus`, `effect-registry`, `widget-host`.

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
- Удаление → `RemoveNode` для контейнера: поддерево уносит
  `RenderTarget.removeNode`, фильтры освобождает `EffectRegistry.release`.
- Всё упаковывается в один `Batch` на тик. Команды внутри независимы и не
  опираются на побочный эффект соседних (`ARCHITECTURE.md` §4.2): пачка
  продолжается после сбоя одной команды.

Готово: тест «нет изменений → нет команд», «сдвиг на 5 px → одна
`SetTransform`», «спавн → ровно 7 команд».

### Шаг 35. Определение виджета и воркер-энтри

Файлы: `packages/widget-village/src/widget.ts`,
`packages/widget-village/src/worker.ts`.

- `villageWidget: WidgetDefinition` с `id: "village"`, `assetBundle: "village"`,
  `create(transport, ctx)`.
- `worker.ts` — единственная точка входа воркера: `self.onmessage` ↔
  `Transport`, тик через `setInterval` 100 мс, `Heartbeat` каждые 500 мс,
  `Ready` при старте, обработка `Pause`/`Resume`/`Dispose`.

Готово: воркер запускается в браузере вручную (проверка — фаза 5), в Node-тестах
используется `DirectTransport` без `self`.

### Шаг 36. Слой рендера виджета

Файл: `packages/widget-village/src/render/layout.ts`.

- Раскладка: аватар 32×32, имя под ним, `zIndex` по `y`.
- Имена `nodeId`: `avatar-<viewerId>`, `avatar-<viewerId>-sprite`,
  `avatar-<viewerId>-name`.
- Цвет имени из `ViewerEvent.color` (fallback — палитра из 8 цветов по хешу
  `viewerId`).

Готово: тест на стабильность `nodeId` для одного `viewerId` и уникальность между
зрителями.

### Шаг 37. Подключение события

Файл: `packages/widget-village/src/village-widget.ts`.

- `Init` → сохранить viewport и конфиг, поставить мир на паузу до `Ready`.
- `ViewerEvent` → в мир; затем на ближайшем тике — команды.
- `Viewport` → пересчёт границ, команды только при изменении.
- `Pause`/`Resume` → остановка/запуск тика и heartbeat.

Готово: интеграционный тест на `DirectTransport`: 3 события → ожидаемые команды
в правильном порядке.

### Шаг 38. Тесты мира

Файлы: `packages/widget-village/src/__tests__/world.test.ts`, `emit.test.ts`,
`widget.test.ts`, `clock.test.ts`.

- Детерминизм: одинаковый seed и одинаковые события → байт-в-байт одинаковый
  список команд.
- Нагрузка: 200 зрителей, 100 тиков — число команд на тик ≤ 3 × число
  изменившихся сущностей; ни одного кадра дольше 5 мс (`performance.now`).
- Пауза: за 5 с паузы — 0 команд.

Готово: `pnpm -F @tv/widget-village test` зелёный.

**Чекпоинт фазы 3:** мир живёт в тестах без Pixi и без DOM; команды валидны по
схемам из `protocol` (`Schema.decodeUnknownSync` на каждом сгенерированном
сообщении).

---

## Фаза 4. Ассеты и эффекты

### Шаг 39. Плейсхолдер-арт

Файл: `packages/widget-village/scripts/gen-placeholder-assets.mjs`.

- 4 аватара × 4 кадра (32×32 PNG) и `name-plate` через `sharp`: простые фигуры
  (круг/квадрат/треугольник) с разными цветами и смещением кадра.
- Кладёт в `packages/widget-village/assets/`.
- Скрипт идемпотентен: перезапись без изменения mtime при совпадении
  содержимого.

Готово: `node scripts/gen-placeholder-assets.mjs` создаёт 17 файлов, которые
открываются как PNG.

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
- В `SetAnimation` уходят только `assetId`; текстур в воркере нет.

Готово: набор `assetId` сверяется тестом с реальными ключами `manifest.json`
(защита от рассинхрона).

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
  и `auto` (интервал 1-3 с, случайное событие по весам).
- Библиотека имён и палитра — константы.

Готово: тест «seed 42 → одинаковая последовательность событий», «stop → нет
событий».

### Шаг 45. Bootstrap оверлея

Файлы: `apps/overlay/index.html`, `apps/overlay/src/main.ts`,
`apps/overlay/src/config.ts`.

- Парсинг query: `?widgets=village&debug=1&seed=42&mode=manual`.
- Создание `PIXI.Application`, `createRenderCore`, регистрация дескриптора
  деревни с воркером
  (`new Worker(new URL("@tv/widget-village/worker", import.meta.url), { type: "module" })`).
- `event-mock` → `core.scene.dispatch(ViewerEvent)`.
- Обработка `visibilitychange` → `Pause`/`Resume`.

Готово: `pnpm dev` открывает страницу, в консоли — активация виджета и
`Hello from worker`.

### Шаг 46. Vite-конфиг и сборка воркера

Файл: `apps/overlay/vite.config.ts`.

- `worker: { format: "es" }`, `build.target: "es2022"`.
- `optimizeDeps.exclude: ["@tv/*"]`, alias на `src` пакетов.
- Ассеты: копирование `dist-assets` в `assets` (проще и предсказуемее symlink).
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

1. `pnpm dev`, открыть `http://localhost:5173/?debug=1`.
2. Debug: «спавн зрителя» × 5 → пять аватаров с именами.
3. «подарок» → пульсация (эффект) и `celebrate`.
4. «убить воркер» → статус `crashed`, контейнеры исчезли, страница жива.
5. Реактивация → деревня пустая, счётчики сброшены, рендер работает.
6. В OBS: Browser Source на тот же URL, 1920×1080, проверка позиционирования и
   `devicePixelRatio`.

Готово: все шесть пунктов проходят без ошибок в консоли; скриншот или заметка
приложены к PR.

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

- 20 циклов activate/deactivate: контейнеров на `stage` = 0, воркеров = 0,
  `Assets` не держит бандл, `EffectRegistry` не держит экземпляры.

Готово: тест зелёный, `scene.list()` пуст после цикла.

### Шаг 51. Ограничения транспорта и размер сообщений

Файл: `packages/protocol/src/__tests__/budget.test.ts`.

- Сериализованный `Batch` для 200 зрителей укладывается в 256 КБ и не содержит
  запрещённых типов (функции, классы, `undefined` в значениях).

Готово: тест зелёный; при превышении — уменьшить частоту `SetTransform` до
каждого второго тика.

### Шаг 52. Документация запуска

Файл: `README.md`.

Требования, команды, версии и локальные грабли уже в `README.md` — они переехали
туда из архитектуры и роадмапа. В шаге остаётся то, чего там нет:

- как подключить в OBS (Browser Source, URL, размер, `?debug=1`);
- как добавить свой виджет: 6 пунктов (пакет, дескриптор, бандл, манифест
  эффектов, регистрация в `overlay`, лимиты).

Готово: новый человек по README поднимает проект с нуля и знает, куда смотреть
за устройством, планом и историей решений.

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
3. Падение или зависание воркера: контейнер скрыт, статус `crashed`, рендер и
   страница живы, реактивация работает.
4. Горячее переключение виджета не пересоздаёт `PIXI.Application` и не течёт.
5. События приходят из `event-mock`; замена на реальный Twitch — работа только
   над `event-mock`, контракт `ViewerEvent` не меняется.
6. Сборка, типы, линт и тесты — по одной команде каждое.

## Что после v1 (не входит в этот план)

1. Реальный Twitch: EventSub-клиент (сервер) или IRC в браузере.
2. Отдельная страница-пульт + транспорт до OBS-источника (WebSocket).
3. `@effect/rpc` при росте протокола.
4. Второй виджет (например, алерты). Вместе с ним появляются per-widget слои
   (`Layer.fresh` + `Effect.provide` на активацию) и widget-scoped
   `RenderTarget`/`CommandBus`/`WidgetHost` (`ARCHITECTURE.md` §9.1).
5. WASM-виджет на том же протоколе.
6. Персистентность деревни между перезапусками.
