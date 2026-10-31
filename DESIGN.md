# FitGO design

Текущая визуальная система. Это ограничение для новых экранов, не задание на редизайн.

Пока идёт функционал и настройки клуба, внешний вид не менять: не подменять цвета, шрифты, радиусы и компоновку «более современным» стилем и не подмешивать чужой `DESIGN.md` (Refero, Linear, Stripe и остальные). Существующие компоненты и классы важнее внешнего референса.

Когда дизайн откроют отдельно, выбрать один референс и положить его поверх этих токенов. Несколько стилей сразу не смешивать.

## Три поверхности

Они не унифицированы. Не переносить вид одной на другую без отдельной задачи.

| Приложение | Кто | Характер |
|---|---|---|
| `apps/client-web` | клиент Forma (`lk.ffs.by`) | тёмный бренд Forma: графит + жёлтый `#FFD000`, Unbounded + Manrope, плавающий док |
| `apps/web` | тренер, админ, суперадмин (`app.ffs.by`) | тёмная операционная оболочка FitGO teal, телефон `max-w-lg`, широкие столы админа на `md+` |
| `apps/specialist-web` | SPA-специалист | светлая и тёмная тема, узкая колонка `max-w-3xl`, нижний док |

## apps/client-web (Forma)

Источник: `apps/client-web/src/app/globals.css`, `tailwind.config.ts`, `src/components/forma/`.

Фон `#0B0B0C` (`ink`), поверхности `#141416` / `#1C1C1F`, линии `white/8%`. Акцент Forma `#FFD000` (`forma-500`); шкала `fitgo-*` в этом приложении алиасится на жёлтый, чтобы старые классы не ломали вид. Текст на акценте — чёрный (`ink`). Шрифты: `font-display` = Unbounded, `font-sans` = Manrope.

Классы: `.card`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input`, `.stat-value`, `.stat-label`, `.glass`. UI-kit: `src/components/forma/*` (Button, Sheet/vaul, SegmentedControl, Chip, DateStrip, Toast, SeatsMeter, OtpInput, …).

Оболочка: `ClientShell` (`src/components/client/client-shell.tsx`) — шапка с вордмарком, док из 5 вкладок с центральным «Пропуском». Экран `/client/card` без шапки.

Профиль: аватар + `ProgressRing`, iOS-группы ссылок (визиты / достижения / абонементы / реферал), push, горизонтальные `Chip`-вкладки анкеты, выход. Без выбора клуба — клиент Forma. Онбординг и PWA-tip — бренд Forma, без «Выберите клуб».

## apps/web

Источник: `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`.

Фон `slate-950`, текст `slate-100`. Карточки `slate-900/80`, граница `slate-800`, радиус `rounded-2xl`. Кнопки и поля `rounded-xl`. Акцент `fitgo-500` `#14b88a`, hover `fitgo-400`. Шкала `fitgo-50`…`fitgo-900` в Tailwind. Системный sans, иконки `lucide-react`.

Классы, которые уже есть: `.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.date-field` (только для `type="time"`), `.stat-value`, `.stat-label`. Новый экран собирается из них.

Выбор даты: только `DateField` из `apps/web/src/components/ui/date-field.tsx` (эталон — супер-админ «Нестыковки» → «Свой»). Нативные `type="date"` не добавлять.

Шапка и нижняя навигация — `AppShell`. Экран карты клиента (`/client/card`) без шапки: его не оборачивать лишним хромом.

`ClubTheme` (`primaryColor`, `logoUrl`, имя, адрес, телефон, сайт) приходит с API и пишет `--fitgo-primary`. Кнопки по-прежнему на `fitgo-500`. Пока настройка клуба не проведена через компоненты, акцентный цвет не перекрашивать вручную в каждом экране.

## apps/specialist-web

Источник: `apps/specialist-web/src/app/globals.css`, `tailwind.config.js`. Тема: класс `dark` на `html`, ключ `fitgo_spec_theme`.

| Токен | Светлая | Тёмная |
|---|---|---|
| `--bg` | `#f3f1ec` | `#121816` |
| `--bg-elevated` | `#fffcf7` | `#1c2421` |
| `--fg` | `#1a2421` | `#eef3f0` |
| `--muted` | `#5c6b64` | `#9aaba5` |
| `--line` | `#d9d3c8` | `#2f3c37` |
| `--accent` | `#1f9a7a` | `#3dba9a` |
| `--accent-fg` | `#ffffff` | `#0b1512` |
| `--danger` | `#b42318` | `#f97066` |
| `--radius` | `14px` | `14px` |

Текст: DM Sans. Заголовок «FitGO SPA»: Fraunces, класс `font-display`. Классы: `.shell`, `.panel`, `.btn`, `.btn-primary`, `.btn-ghost`, `.field`, `.nav-dock`.

## Когда внешний референс уместен

Только в задаче на дизайн, и только если в проекте ещё нет своего компонента.

1. Один `DESIGN.md`-референс с [styles.refero.design](https://styles.refero.design) или [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md), подогнанный под токены выше.
2. Компонент на React и Tailwind с [21st.dev](https://21st.dev), если своего нет.
3. Сверка с [component.gallery](https://component.gallery) перед новым паттерном.

Анимации Kinetics и промо-ролики whatships / HyperFrames к продукту не подключать, пока об этом не попросят.
