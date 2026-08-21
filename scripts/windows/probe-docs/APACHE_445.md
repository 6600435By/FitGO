# Apache :445 — инструкция (WS2016)

**Перед началом:** скопируйте конфиги Apache в бэкап.

```powershell
$ts = Get-Date -Format yyyyMMdd-HHmm
Copy-Item C:\Apache24\conf\httpd.conf "C:\Apache24\conf\httpd.conf.bak-$ts"
Copy-Item C:\Apache24\conf\extra\httpd-ssl.conf "C:\Apache24\conf\extra\httpd-ssl.conf.bak-$ts" -ErrorAction SilentlyContinue
```

## 1. Найти конфиг порта 444

```powershell
Select-String -Path C:\Apache24\conf\*.conf -Pattern "444" -Recurse
```

Откройте файл с `VirtualHost *:444` (часто `extra\httpd-ssl.conf`).

## 2. Добавить Listen 445

В `httpd.conf` или рядом с `Listen 444`:

```apache
Listen 445
```

## 3. Скопировать VirtualHost 444 → 445

Создайте блок **копией** `:444`, замените:

- `*:444` → `*:445`
- пути `forma` → `fitgo` (после публикации 1С появится `C:\Apache24\htdocs\fitgo\`)

Пример (адаптируйте под ваш реальный vhost 444):

```apache
<VirtualHost *:445>
    ServerName localhost
    DocumentRoot "C:/Apache24/htdocs"
    SSLEngine on
    SSLCertificateFile "C:/Apache24/conf/server.crt"
    SSLCertificateKeyFile "C:/Apache24/conf/server.key"
    # Скопируйте сюда все директивы 1С/wsisapi из vhost :444
</VirtualHost>
```

**Важно:** скопируйте **все** обработчики для 1С (`/hs/`), как на `:444`. Web-сервисы (`/ws/`) для Фазы A **не нужны**.

## 4. Проверка синтаксиса и перезапуск

```powershell
C:\Apache24\bin\httpd.exe -t
Restart-Service Apache2.4
# или: C:\Apache24\bin\httpd.exe -k restart
netstat -an | findstr ":445"
```

## 5. Firewall (опционально, для внешнего FitGO)

```powershell
New-NetFirewallRule -DisplayName "1C FitGO HTTPS 445" -Direction Inbound -Protocol TCP -LocalPort 445 -Action Allow
```

## 6. Проверка до публикации 1С

```powershell
$CURL = "C:\curl-8.20.0_3-win64-mingw\bin\curl.exe"
& $CURL -sk -w "`nHTTP %{http_code}`n" https://127.0.0.1:445/
```

Ожидание: ответ Apache (не «connection refused»). 404 на `/fitgo/` до публикации — нормально.

## Откат

- Удалить `Listen 445` и VirtualHost `:445`
- Восстановить `.bak` файлы
- `httpd -t` → restart
