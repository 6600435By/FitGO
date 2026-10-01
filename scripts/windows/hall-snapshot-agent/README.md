# Снимки групповых залов (Dahua D6 / D12)

На клубе FFS проверено: **CGI `snapshot.cgi` пустой**, рабочие снимки — **RTSP + ffmpeg**.

| Канал | Зал в 1С |
|-------|----------|
| D12 | Групповой зал большой |
| D6 | Групповой зал малый |

NVR: `192.168.1.108` · HTTP веб `:8080` · RTSP `:554`  
Снимки занятия: **+20 и +40 мин** от начала. Хранение: **60 дней**.

Требования на сервере `192.168.1.20`: Node 20+, **ffmpeg в PATH**, учётка NVR `fitgo-snap` с Monitor на 6 и 12.

---

## Уже сделано (проверка)

```powershell
cd C:\FitGO\FitGO\scripts\windows\hall-snapshot-agent
node Prove-Snapshot.mjs --pass '***' --port 8080
```

Ожидаемо: `Done: 2/2`, файлы в `D:\fitgo-hall-probe\`. Глазами: d12 = большой, d6 = малый.  
Потом удалить пробы: `Remove-Item D:\fitgo-hall-probe\*.jpg -Force`

---

## Дальше: конфиг → API → агент

### 1. `C:\FitGO\hall-cameras.json` (не в git)

```powershell
copy C:\FitGO\FitGO\scripts\windows\hall-snapshot-agent\hall-cameras.example.json C:\FitGO\hall-cameras.json
notepad C:\FitGO\hall-cameras.json
```

Заполнить:

| Поле | Пример |
|------|--------|
| `apiBase` | `http://127.0.0.1:3001` (если API на этой же машине) |
| `agentToken` | длинный секрет = `HALL_SNAPSHOT_AGENT_TOKEN` в `.env` |
| `clubId` | UUID клуба из FitGO |
| `password` / пароль в `url` | пароль `fitgo-snap` (в rtsp:// URL тоже) |

`mode` оставить `"rtsp"`. URL уже с channel 12 и 6.

### 2. API `.env`

Файл: `C:\FitGO\FitGO\apps\api\.env`

```env
HALL_SNAPSHOT_AGENT_TOKEN=тот_же_секрет_что_в_json
HALL_SNAPSHOT_DIR=C:\FitGO\hall-snapshots
ENABLE_HALL_SNAPSHOT_CRON=true
```

API должен быть с модулем hall-snapshot (обновлённый код). Затем:

```powershell
Restart-Service FitGO-API
```

### 3. Запуск агента

Разово:

```powershell
cd C:\FitGO\FitGO\scripts\windows\hall-snapshot-agent
node agent.mjs C:\FitGO\hall-cameras.json
```

Служба:

```powershell
.\Install-HallAgent.ps1
```

В логе при занятии ГП: `[ok] Групповой зал … +20m`.

### 4. FitGO UI

Админ / управляющий / супер-админ → **Контроль занятий** → ГП → **Фото**.

---

## Файлы в этой папке

| Файл | Зачем |
|------|--------|
| `agent.mjs` | служба съёмки |
| `hall-cameras.example.json` | образец конфига (RTSP) |
| `Prove-Snapshot.mjs` | разовая проверка JPEG |
| `Test-NvrReach.ps1` | ping + порты 8080/554 |
| `Install-HallAgent.ps1` | NSSM |
| `README.md` | эта инструкция |

`Prove-Snapshot.ps1` убран — на Server 2016 / этой прошивке Dahua не нужен.
