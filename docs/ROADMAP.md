# Roadmap: twitch-village

**Статус:** в работе: фазы 0-1 закрыты, в фазе 2 закрыты шаги 17-23, следующий —
шаг 24. **Обновлено:** 2026-10-28. **Связанный документ:**
`docs/ARCHITECTURE.md`.

Направление, а не истина: если по коду задача решается иначе, делается
правильное решение, а шаг переписывается под него. Номера шагов не меняются — на
них ссылаются архитектура и история задач. Выполненный шаг описан итогом и
решениями; инструкции и код из него удаляются, код — источник правды.

Соглашения: `pnpm` — единственный пакетный менеджер (`pnpm -F <pkg> <cmd>`),
пакеты `@tv/protocol`, `@tv/core`, `@tv/widget-village`, `@tv/event-mock`,
`@tv/config`, приложение `@tv/overlay`.

---

## Фаза 0. Каркас монорепо

**Статус: выполнено (шаги 1-8).** pnpm-workspace + Turborepo 2.11, корневые
скрипты `build`/`dev`/`typecheck`/`test`/`lint`/`assets`/`format`. У пакетов
`main`/`types` указывают на `src/index.ts`; `@tv/config` — только
`tsconfig.base.json`. Версии зафиксированы: pixi.js 8.22, effect 4.0, vite 8.3,
typescript 5.9, vitest 5.0, eslint 10.13, @assetpack/core 1.7. Линт границ
(flat-конфиг) запрещает `pixi.js` и `@tv/core` в виджете, глобалы
`window`/`document` в воркере, `@tv/widget-*` в Core и держит зоны Effect
(`ARCHITECTURE.md` §11.1).

Факты, которые нужно помнить:

- TypeScript 5.9, не 7.x: `typescript-eslint` 8.x не поддерживает TS 7.
- Project references не используются: `noEmit` несовместим с `composite`. Типы
  между пакетами идут через `package.json` и symlink pnpm.
- Настройки pnpm — в `pnpm-workspace.yaml` (поле `pnpm` в `package.json` pnpm 12
  игнорирует). Там же `allowBuilds: { sharp: true, cpu-features: false }`:
  `cpu-features` не собирается на Windows + Python 3.
- `test` идёт с `--passWithNoTests`, чтобы пустые пакеты не валили корневой
  прогон. `pnpm assets` падает до появления `.assetpack.js` в фазе 4.

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

**Статус: в работе. Закрыты шаги 17-23.**

### Закрытые шаги 17-23: решения

- `RenderTarget` скрывает Pixi; `RenderState` держит снимок дерева и общий для
  обеих реализаций. `createPixiRenderTarget` и `createFakeRenderTarget` проходят
  один контракт `render-target.contract.ts` без GPU, включая `has` и возврат
  удалённых id из `removeNode`.
- `live.ts` — композиционный корень: сервисы `CoreApp`, `Clock`,
  `RenderTargets`, слои и `ManagedRuntime`. DI только через `Layer`,
  `deps`-объектов нет.
- Индекс узлов один — в `RenderState`. Отдельный `NodeRegistry` убран: вторая
  `Map` дублировала состояние, а `remove` пересобирал поддерево на каждое
  удаление (O(n²) на пачке). `RenderTarget.has` отвечает на «узел жив», а
  `removeNode` возвращает удалённые `NodeId[]` — их получает `EffectRegistry`,
  чтобы уничтожить фильтры.
- `applyCommand` — явный `Match` по всем вариантам. `Ready`/`Heartbeat` в
  `RenderCommand` больше не входят: это служебные сообщения своего union, и
  мёртвых веток в разборе нет. Порты возвращают `Effect`, поэтому отказ идёт в
  `E`-канал обычным `yield*`; `attemptForeign` остаётся единственной границей
  броска синхронных модулей: `InvalidCommand`/`UnknownNode` проходят с исходным
  тегом, чужое исключение становится `RenderFailed`. `fromPort` и ручной
  `isRenderError` удалены.
- `applyCommand` не падает: возвращает `ApplyCommandResult { errors, skipped }`,
  пачка продолжается после сбоя, 16 ошибок — потолок на пачку (`ARCHITECTURE.md`
  §4.2, §6.1). Defect сюда не относится: это ошибка разработчика.
- `CommandBus` — FIFO на виджет, `maxQueueLength`/`maxCommandsPerFrame`/
  `maxDrainMs`, бюджет проверяется после каждой команды. Переполнение роняет
  очередь и отдаёт `QueueOverflow` через `onOverflow`; решение «виджет
  деградирует» принимает вызывающий. `drain` ничего не считает: счётчик
  `processed` двигает `commit(widgetId, applied)` после применения, иначе сбой
  команды завышает статистику. Пустая очередь возвращает общий пустой массив —
  пустой кадр не аллоцирует. Конфиг проверяется при создании.
- `AssetRegistry`: Pixi за портом `AssetBackend`, манифест разбирается в карту
  `assetId → bundleId`, текстуры реестр не держит. Публичные методы — `Effect`;
  `AssetBackend` остаётся Promise-границей и оборачивается `Effect.tryPromise`.
  `loadBundle` дедуплицирует параллельные вызовы через in-flight `Map`,
  `unloadBundle` ждёт текущую загрузку, снимает бандл и отдаёт типизированную
  ошибку. `init` — one-shot: сбой уходит в defect, ретрая внутри реестра нет,
  повтор — перезапуск приложения.
- `EffectRegistry`: `register` ничего не компилирует, `get` компилирует лениво и
  кэширует по `(effectId, nodeId)`, сломанным считается эффект целиком до
  реактивации, `setParam` проверяет имя параметра и границы. Методы возвращают
  `Effect`; `release(nodeId)` и `clear()` вызывают `Filter.destroy()`, иначе кэш
  фильтров переживает удаление узла. `register` заменяет карту определений
  целиком, чтобы эффект, убранный из манифеста, не оставался жить. Ошибки
  манифеста — обычный `Error`: это ошибка разработчика, а не событие виджета.

Почему иначе, чем в первой редакции шагов 17-23: порты возвращали
`Texture | AssetNotFound` и `RenderError | null` (где `null` — успех), а вызов
порта шёл через `Effect.sync`, из-за чего бросок становился defect и обрывал
пачку. Теперь отказ — значение в `E`-канале, `null`-как-успех и `fromPort`
удалены, а defect остался только за ошибками разработчика.

Отказ загрузки бандла — `BundleLoadFailed`: бандл остаётся снятым, повтор при
следующей активации (TV-30).

### Шаг 24. Статус и счётчики

Файл: `packages/core/src/status.ts`.

`WidgetStatus`: `widgetId`, `state` (`loading` | `active` | `paused` |
`degraded` | `crashed`), `counters` по тегам `RenderError` плюс `heartbeat`,
`dropped` (переполнение очереди) и `skipped` (потолок ошибок в пачке),
`lastError`. `StatusStore` — подписка на изменения для debug-панели.

`count` принимает только не-ошибочные счётчики, ошибки идут через `recordError`:
двойного счёта нет. `get` возвращает `WidgetStatus | undefined` — панель не
падает на уже удалённом виджете. Подписчик уведомляется `flush` раз в кадр, а не
на каждый инкремент (до 512 копий счётчиков за кадр). `now` по умолчанию —
`() => performance.now()`, привязка важна: голая ссылка на метод падала с
`Illegal invocation`.

Готово: тесты на инкремент, на `flush`, на `get` неизвестного виджета и
регрессия на `now` без инъекции.

### Шаг 25. WorkerTransport

Файл: `packages/core/src/widget/worker-transport.ts`.

- Обёртка над `Worker` + `Transport`, `onmessage`/`onerror`.
- `worker.onerror` и `messageerror` → `onFailure(WidgetCrashed)`.
- Первое сообщение от воркера обязано быть `Ready` с `protocolVersion`;
  несовпадение → `ProtocolMismatch`, воркер терминируется.

Готово: тест с фейковым `Worker`.

### Шаг 26. WidgetHost

Файл: `packages/core/src/widget/widget-host.ts`.

- `start`: загрузка бандла → регистрация эффектов → создание воркера → ожидание
  `Ready` с таймаутом 5 с → `active`.
- `stop`: `Dispose` → `terminate()` → `unloadBundle` → удаление всех узлов.
- Подписка на сообщения: валидация → очередь → счётчики.
- `onCoreEvent` — отправка событий зрителей и вьюпорта в воркер.
- Зависимости берутся из `Context` внутри `Effect.gen`; `start`/`stop` —
  `Effect` со `Scope` и таймаутом (`ARCHITECTURE.md` §11.1).

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
`apply-command`, `command-bus`, `node-registry`, `effect-registry`,
`widget-host`.

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
- Удаление → `RemoveNode` для контейнера: поддерево уносит `NodeRegistry`.
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
   `NodeRegistry`/`CommandBus`/`WidgetHost` (`ARCHITECTURE.md` §11.1).
5. WASM-виджет на том же протоколе.
6. Персистентность деревни между перезапусками.
