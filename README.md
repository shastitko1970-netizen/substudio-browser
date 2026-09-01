# SubStudio Browser 0.1.0

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

Version scheme: `0.1.0` … `0.1.9` → `0.2.0` (patch is a single digit). Tag `v0.1.0`.

Auto-update: **Windows launcher** reads public GitHub Releases. Extension `update_url` is secondary and only persists on Firefox Release if the XPI is AMO-signed.

---

## Установка

1. Поставьте Firefox (лучше **ESR** или **Developer Edition** — тогда unsigned companion держится).
2. Запустите `setup\Install.cmd`. Скрипт **копирует** Firefox в `%LOCALAPPDATA%\SubStudioBrowser\runtime`. Program Files не пишет.
3. Ярлык **SubStudio Browser** → `Launch-SubStudioBrowser.ps1`.

Если установлен только Release и companion сразу исчезает:

```powershell
setup\Install-SubStudioBrowser.ps1 -FetchEsr
```

Это качает официальный ESR в ту же частную папку (не поверх повседневного Firefox).

Снять продукт (повседневный Firefox не удаляется):

```powershell
setup\Uninstall-SubStudioBrowser.ps1
```

## Что внутри 0.1.0

| Кусок | Зачем |
| --- | --- |
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

**Главный путь:** `setup\Update-SubStudioBrowser.ps1` и «Проверить обновления» в настройках. Лаунчер ходит в GitHub Releases API публичного репозитория, качает zip, сверяет SHA256, переустанавливает overlay, **не** трогает Program Files.

**Вторичный путь:** `browser_specific_settings.gecko.update_url` → `updates.json` (HTTPS + `update_hash` sha512). На **Firefox Release** unsigned XPI не встанет и не обновится. Нужна unlisted-подпись AMO (`web-ext sign`) или канал ESR/Dev.

Релизы должны быть **public** и не draft — иначе 404, как у закрытого atom-фида.

Репозиторий: https://github.com/shastitko1970-netizen/substudio-browser

## Сборка / тесты

```bash
python tests/test_overlay.py
python scripts/build_release.py
```

GitHub Actions на теге `v0.*` публикует `SubStudioBrowser-0.1.0.zip`, `.xpi`, `updates.json`, `.sha256`.

## Товарные знаки и лицензии

Не связан с Mozilla. Firefox — знак Mozilla Foundation. Arc / Dia / Comet — чужие бренды; от них только *ощущение*, не ассеты.

MIT — скрипты и расширение. MPL-2.0 — AutoConfig и шаблоны политик.
