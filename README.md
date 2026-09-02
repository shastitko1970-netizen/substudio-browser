# SubStudio Browser 0.1.3

Личный браузер в духе Arc / Dia / Comet на **stock Firefox**, без форка Gecko. Левая колонка — companion WebExtension (как Sidebery): живые вкладки, 3×3 pins, Spaces Work/Home. Нативный tab strip скрыт userChrome. Ассистент — **Grok (официальный xAI) или Hermes** справа. Прокси — SOCKS5 с логином в движке Firefox (у Chrome этого нет).

Это **не Firefox** в названии и не лиса на знаке.

---

## English (short)

Not a Firefox fork. Setup **copies** Firefox into `%LOCALAPPDATA%\SubStudioBrowser\runtime` and launches:

```text
runtime\firefox.exe -profile %LOCALAPPDATA%\SubStudioBrowser\profile -no-remote
```

Daily Firefox in Program Files is never patched. Policies/AutoConfig live only on the copy.

Grok sidecar: SubStudio gateway at `127.0.0.1:1234` if it is up; else official `auth.x.ai` device-code or a console.x.ai API key. Mozilla’s built-in chatbot panel is pointed at **grok.com** (website + `?q=`). The *agent* is our sidecar.

Version scheme: `0.1.0` … `0.1.9` → `0.2.0` (patch is a single digit). Tag `v0.1.3`.

Auto-update: **Windows launcher** reads public GitHub Releases. Extension `update_url` is secondary and only persists on Firefox Release if the XPI is AMO-signed.

---

## Скачать и проверить (Windows)

Прямая ссылка на установщик (после публикации тега `v0.1.3`):

**[SubStudioBrowser-Setup-0.1.3.exe](https://github.com/shastitko1970-netizen/substudio-browser/releases/download/v0.1.3/SubStudioBrowser-Setup-0.1.3.exe)**

Релиз целиком: [v0.1.3](https://github.com/shastitko1970-netizen/substudio-browser/releases/tag/v0.1.3) · SHA256 рядом, файл `SubStudioBrowser-Setup-0.1.3.exe.sha256`.

Не качай zip, если хочешь GUI-установщик. Zip — payload для автообновления уже установленной копии.

### Перед запуском

1. Закрой SubStudio Browser, если он открыт.
2. Закрой зависший Setup.exe / PowerShell от 0.1.2 (Диспетчер задач → снять задачу). Иначе снова словите lock на файле.
3. SmartScreen на неподписанный exe — «Подробнее → Выполнить в любом случае». Это ожидаемо.

### Чеклист 0.1.3

1. Запусти `SubStudioBrowser-Setup-0.1.3.exe`.
2. **Рамка:** одно окно, только наша шапка (название + свернуть + ×). Фиолетовой Windows-рамки и второго ряда кнопок быть не должно.
3. Continue → **Fetch Firefox ESR** (рекомендуем) → Install SubStudio.
4. Прогресс не должен упасть на `setup-progress.jsonl … used by another process`.
5. It’s yours → **Launch SubStudio**.
6. Справа sidecar: переключатель **Grok | Hermes**. Grok — как раньше. Hermes — «не запущен», пока не поднят `hermes gateway` / Desktop / proxy на этой машине.

Повседневный Firefox в Program Files не патчится. Политики только в копии. Админ не нужен.

Консоль без GUI: `setup\Install.cmd` или `setup\Install-SubStudioBrowser.ps1 -FetchEsr`.

Снять продукт (повседневный Firefox не удаляется):

```powershell
setup\Uninstall-SubStudioBrowser.ps1
```

## Что внутри 0.1.3

Frameless Setup.exe (HTML caption only), `setup-progress.jsonl` в `%TEMP%`, sidecar **Grok | Hermes**.

| Кусок | Зачем |
| --- | --- |
| Setup.exe | Frameless WebView2 + HTML caption. Тот же `Install-SubStudioBrowser.ps1` |
| Space bar | Companion владеет левой колонкой: 3×3 pins, Work/Home, папки, + New Tab. Цвет Space настраивается. Палитра cream/coral/plum, не Arc navy. |
| Частная копия Firefox | Политики не протекают в ежедневный профиль |
| Grok справа | Складная панель (по умолчанию закрыта). Ctrl+\\ / Ctrl+Shift+G, кнопка у адреса и в футере Space bar. Левый rail сворачивается отдельно. |
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

### Hermes: не встраиваем агента

В sidecar переключатель **Grok | Hermes**. Hermes **не** стартует из браузера. Если на машине уже крутится агент — подключаемся:

1. API server `http://127.0.0.1:8642` (полный агент + tools)
2. Subscription proxy `http://127.0.0.1:8645` (только inference)
3. Свой URL + `API_SERVER_KEY` в настройках

SSH и удалённые шлюзы живут в Hermes Desktop → Gateways. Браузер говорит только с локальным HTTP.

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

GitHub Actions на теге `v0.*` публикует `SubStudioBrowser-0.1.3.zip`, `SubStudioBrowser-Setup-0.1.3.exe`, `.xpi`, `updates.json`, `.sha256`.

## Товарные знаки и лицензии

Не связан с Mozilla. Firefox — знак Mozilla Foundation. Arc / Dia / Comet — чужие бренды; от них только *ощущение*, не ассеты.

MIT — скрипты и расширение. MPL-2.0 — AutoConfig и шаблоны политик. OFL — Inter и Instrument Serif в установщике.
