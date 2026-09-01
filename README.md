# SubStudio Browser 0.1.1

Личный браузер в духе Arc / Dia / Comet на **stock Firefox**, без форка Gecko. Вертикальные вкладки — встроенные Firefox (`sidebar.verticalTabs`). Ассистент — **Grok по официальному xAI API**. Прокси — SOCKS5 с логином в движке Firefox (у Chrome этого нет).

Это **не Firefox** в названии и не лиса на знаке.

---

## English (short)

Not a Firefox fork. Setup **copies** Firefox into `%LOCALAPPDATA%\SubStudioBrowser\runtime` and launches:

```text
runtime\firefox.exe -profile %LOCALAPPDATA%\SubStudioBrowser\profile -no-remote
```

Daily Firefox in Program Files is never patched. Policies/AutoConfig live only on the copy.

Grok sidecar: SubStudio gateway at `127.0.0.1:1234` if it is up; else official `auth.x.ai` device-code or a console.x.ai API key. Mozilla’s built-in chatbot panel is pointed at **grok.com** (website + `?q=`). The *agent* is our sidecar.

Version scheme: `0.1.0` … `0.1.9` → `0.2.0` (patch is a single digit). Tag `v0.1.1`.

Auto-update: **Windows launcher** reads public GitHub Releases. Extension `update_url` is secondary and only persists on Firefox Release if the XPI is AMO-signed.

---

## Установка (Windows)

1. Скачайте **`SubStudioBrowser-Setup-0.1.1.exe`** из [Releases](https://github.com/shastitko1970-netizen/substudio-browser/releases/tag/v0.1.1).
2. Откройте установщик — экран Welcome / runtime / progress / done. Не NSIS, не консоль.
3. **Fetch Firefox ESR** (рекомендуем): официальный ESR в `%LOCALAPPDATA%\SubStudioBrowser`. Unsigned Grok sidecar держится. Setup.exe ESR не содержит — качает при установке.
4. Или **Copy the Firefox I already have** — быстрее; на обычном Release сайдбар Grok может отвалиться.

Повседневный Firefox в Program Files не патчится. Политики только в копии. Админ не нужен.

Консольный путь по-прежнему: `setup\Install.cmd` или `setup\Install-SubStudioBrowser.ps1 -FetchEsr`.

Снять продукт (повседневный Firefox не удаляется):

```powershell
setup\Uninstall-SubStudioBrowser.ps1
```

## Что внутри 0.1.1

| Кусок | Зачем |
| --- | --- |
| Setup.exe | Свой UI (WebView2 + HTML), светлая и тёмная бумага. Тот же `Install-SubStudioBrowser.ps1` |
| Тема | Companion + userChrome: Instrument Serif / Inter, cream ↔ ink. Не форк Gecko, сайты не красим. |
| Частная копия Firefox | Политики не протекают в ежедневный профиль |
| Встроенные vertical tabs | `sidebar.revamp` + `sidebar.verticalTabs` (pref + policy `sidebar.*`, Firefox 151+) |
| Sidecar Grok | Треды, @вкладки, навыки, chip подтверждения на close/read/cross-site |
| Ctrl+K | Командная строка: вкладки + навыки + запрос Grok |
| SOCKS5 + контейнеры | Как раньше: companion `proxy.onRequest` или FoxyProxy. Нет TUN. |
| FoxyProxy + Multi-Account Containers | Force-install с AMO, ID живые |

### Grok: как логин

Порядок:

1. **SubStudio** `http://127.0.0.1:1234/v1/*` — если шлюз жив, используем его (там уже xAI/ChatGPT OAuth).
2. **Device-code** на `https://auth.x.ai` (OIDC, grant `device_code`). Публичный client_id Grok CLI, без cookie scrape grok.com и без неофициального клиента X.
3. **API key** с [console.x.ai](https://console.x.ai) — хранится только в `storage.local`.

Нативная память: xAI Responses `previous_response_id` (сервер, 30 дней) + локальный AES-GCM store, ключ от Grok user id. Очистка/экспорт в настройках.

Инструменты вкладок **не** тащат cookie и не читают HTML других логинов без chip «Разрешить».

Stock-панель Mozilla (`browser.ml.chat.provider` = `https://grok.com`) — это сайт. Агент API — sidecar.

## Обновления

Схема версий: `0.MINOR.PATCH`, PATCH = 0…9, дальше MINOR+1.

**Главный путь:** `setup\Update-SubStudioBrowser.ps1` и «Проверить обновления» в настройках. Лаунчер ходит в GitHub Releases API публичного репозитория, качает **zip**, сверяет SHA256, переустанавливает overlay, **не** трогает Program Files.

**Вторичный путь:** `browser_specific_settings.gecko.update_url` → `updates.json` (HTTPS + `update_hash` sha512). На **Firefox Release** unsigned XPI не встанет и не обновится. Нужна unlisted-подпись AMO (`web-ext sign`) или канал ESR/Dev.

Релизы должны быть **public** и не draft — иначе 404, как у закрытого atom-фида.

Репозиторий: https://github.com/shastitko1970-netizen/substudio-browser

## Сборка / тесты

```bash
python tests/test_overlay.py
python scripts/build_release.py
python scripts/build_setup.py
```

GitHub Actions на теге `v0.*` публикует `SubStudioBrowser-0.1.1.zip`, `SubStudioBrowser-Setup-0.1.1.exe`, `.xpi`, `updates.json`, `.sha256`.

## Товарные знаки и лицензии

Не связан с Mozilla. Firefox — знак Mozilla Foundation. Arc / Dia / Comet — чужие бренды; от них только *ощущение*, не ассеты.

MIT — скрипты и расширение. MPL-2.0 — AutoConfig и шаблоны политик. OFL — Inter и Instrument Serif в установщике.
