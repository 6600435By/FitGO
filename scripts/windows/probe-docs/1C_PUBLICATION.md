# Публикация 1С «fitgo» (порт 445)

**Не изменяйте** публикацию `forma` на порту 444.

## Конфигуратор → Администрирование → Публикация на веб-сервере

### Создать новую публикацию

| Поле | Значение |
|------|----------|
| Имя | `fitgo` |
| Каталог веб-сервера | `C:\Apache24\htdocs\` |
| Тип | Apache 2.4 |
| Порт | **445** |

### Вкладка HTTP-сервисы

| Сервис | Корневой URL | Публиковать |
|--------|--------------|-------------|
| API | `api` | **Да** |
| FitGOIntegration | `fitgo` | **Да** (после создания расширения) |
| Lead | `lead` | Нет |
| ОСМИ_ИсточникСобытий | `osmievent` | Нет |

### Вкладка Web-сервисы

- **«Публиковать Web-сервисы»** — **выключено**
- SOAP не используем в Фазе A

### Пользователь и ключи

1. Создайте пользователя **`FitGOUserAPI`** (отдельно от `WordpressUserAPI`)
2. Минимальные права: HTTP-сервисы, чтение клиентов/абонементов
3. Сгенерируйте **новый apikey** для FitGO (Настройки интеграции / API)
4. Обновите `C:\fitgo-probe\.env.probe`:
   ```env
   FORMA_API_KEY=<новый>
   FORMA_BASIC_AUTH=<base64 FitGOUserAPI:пароль>
   ```

До создания FitGOUserAPI можно тестировать со старыми ключами WordpressUserAPI (как в `.env.probe.example`).

### Опубликовать

1. Кнопка **«Опубликовать»**
2. Перезапуск Apache
3. Проверка файлов:

```powershell
Get-ChildItem C:\Apache24\htdocs\fitgo -Recurse | Select-Object FullName
Get-Content C:\Apache24\htdocs\fitgo\default.vrd -ErrorAction SilentlyContinue | Select-Object -First 40
```

### Проверка REST до расширения

```powershell
cd C:\fitgo-probe
.\probe-rest.ps1
```

Ожидание: `01_classes` и `02_auth_client` → HTTP 200.
