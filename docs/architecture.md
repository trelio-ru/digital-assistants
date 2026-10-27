# Пакет цифрового ассистента

## Границы

`ivaschru/Trelio` владеет identity, company/task ACL, устройствами, enrollment,
делегированными MCP grants, вопросами владельцу и domain mutations.
`trelio-ru/agent-workspaces-runtime` владеет общим подписанным runtime, private
storage, hooks/admission, очередью, scheduler, native Codex и OS-service.
Этот репозиторий содержит устанавливаемую композицию и короткие инструкции.
Исправления обычных ACL, Workspace, Secret engine и runtime сохраняются общими.

## Долгие задачи

Каждый task worker ведёт в canonical task Workspace один текущий
`assistants/<assistantUserId>/WORK.md`. UUID берётся из live pass identity;
переименование, новая машина или другой company display name не меняют путь.
Это обычные task data с прежним Workspace ACL/encryption/Run/CAS, не новый
authority layer. Содержимое не попадает в SQLite или global owner profile.

Файл сохраняет цель человека и источник, критерии результата, прогресс,
ожидаемые ответы/вопросы, неопределённые действия, следующий шаг и read-back
расписания. Ожидание ответа завершает проход, но не цель: runtime продолжает
циклы и может раньше разбудить тот же чат по разрешённому событию.
Завершение части одного ассистента не закрывает задачу или работу другого.
Подробный формат и порядок продолжения входят в task-worker reference в пакете.
Task worker использует live dedicated catalog и returned typed Workspace actions.
Fresh Run имеет сохраняемый UUID intent, exact recovery – прежний runId; accepted
read не создаёт writable Run. Отсутствие нужного read/write/pass/owner capability
остаётся явным blocker, а не разрешением имитировать dispatcher или human MCP.
Без смыслового изменения state не создаёт timestamp-only Workspace Run: повторная
проверка и фактический следующий wake фиксируются структурным runtime protocol.
Task-worker reference также описывает own-error flow: retire accepted evidence,
safe native restore либо selective reversal с сохранением поздних правок,
проверка accepted файлов и запись correction. Encrypted repair использует тот же
structural retract и обычный encrypted correction Run, без direct restore. Ошибка и её исправление не
закрывают человеческую цель; live dedicated capability и общий ACL обязательны.

## Формат и shared shell

Основной source использует portable `plugin.json` + `mcp.json` для metadata,
MCP и skills. Отдельный hook-only source имеет собственный неизменяемый manifest.
Оба устанавливаемых пакета используют `.codex-plugin/plugin.json`. Исторический
combined package 0.1.3 понадобился потому, что Codex 0.164 пропускает hooks формата
Agent Plugins даже при наличии hooks.json; это не повод обходить native trust.

Тот же builder переводит presentation/paths основного manifest и отдельно
упаковывает три прежних hooks с exact Git-pinned общей оболочкой. Source
`${PLUGIN_ROOT}` становится native `cwd: "."`. Root `plugin.json` в generated
inventory не остаётся. Ни второй MCP server, ни новый executor не появляются.

Native Windows gate использует официальный `rust-v0.164.0` и pinned hashes,
изолированные HOME/USERPROFILE/CODEX_HOME и synthetic Git fixture marketplace. Он
проверяет три `untrusted` hooks без входа, model turn, Trelio MCP или trust writes.
Main version/instruction update обязан сохранять реальные `currentHash`; изменение
hook или loader bytes обязано менять их. Запись trusted_hash/approval migration
и обход trust агентом запрещены.

`command: "./scripts/launch-trelio-node"` сохраняется общим с pinned shell.
Native Codex Windows MCP launcher разрешает исполняемый файл через общий
`program_resolver`/`which` и `PATHEXT`, включая соседний `.cmd`; hook отдельно
использует свой `commandWindows`. Другой executable/OS selector в plugin не
добавляется. Наличие обоих exact pinned launcher files проверяется при сборке;
фактический запуск Windows MCP и tools остаётся отдельным read-back на устройстве.
[Официальный local MCP пример](https://developers.openai.com/plugins/deploy/desktop-only#configure-a-local-mcp-server)
использует тот же root placeholder.

Стабильный shell из `agent-workspaces` закреплён в `shared-shell.lock.json`
для main и независимо в `hook-shell.lock.json` для hook-компонента.
Builder читает exact Git blobs, а не потенциально dirty checkout. Семь shell
файлов копируются без изменения в generated output; source shell не форкается.
Версия shell 3.2.3 обозначает совместимость общей проверки подписи и не является
версией нового плагина. Runtime packages, токены и локальные caches не включаются.

Общий [контракт проверки влияния релиза](https://github.com/trelio-ru/agent-workspaces/blob/main/docs/plugin-setup-and-policies.md#совместимость-общей-оболочки)
живёт у канонического human shell. Его технические исправления проверяются и
для ассистента: exact source diff → candidate lock → штатные compatibility
проверки и воспроизводимая сборка → согласованный выпуск либо явное обоснование
«не применимо». Impact receipt сохраняет обе exact revisions и результат
проверок. Floating `main` и локальная правка скопированного shell не допускаются;
human-specific OAuth, manifests и инструкции автоматически не переносятся.
Impact review рассматривает оба pins. Main-only metadata/lock changes не
переписывают неизменённый hook-компонент и его provenance.
Compatible signed runtime update не меняет этот pin и не требует plugin release.

Private-credential flow находится в существующем task-worker reference.
Он маршрутизирует live native owner intent, empty-card либо NEW password
generation, encrypted neutral metadata и protected browser/signed-skill use.
Указания не реализуют генератор, vault,
provider или второй executable: всё выполняет общий signed host и Secret engine.
Corporate cards and signed local account login use those same engines with
independent exact owner intents. A login handoff is not verified login; a consumed
attempt receipt never reopens input. Before waiting on correspondence, the worker
may retain native conversation correlation history after a confirmed send.
This history is nonexclusive and never assigns future incoming messages to one
task. Every incoming conversation batch is classified once into exact original
message groups; different groups may target different accepted tasks. A task
worker handles only its selected originals and needs no whole-chat bind before
material completion. Provider read, committed material and ACK remain independent.
First-send hints never permit send replay or replace per-original route receipts.
Нет human approval flags/OAuth, импорта corporate values или разрешения signup
по созданию карточки. Отсутствующая capability остаётся конкретным blocker.

MCP и hooks запускают общий loader с `bridge assistant mcp|hook`. Явный `assistant`
profile должен поддерживаться signed runtime. Старый runtime обязан отвергать
неизвестную команду, без перехода к human MCP. Hooks требуют самостоятельного
review/trust пользователем; пакет не меняет config или доверие за него.

## Сборка и проверка

OpenAI interface явно объявляет `composerIcon`, `logo` и `logoDark` из `assets/`.
Иконка сохраняет геометрию трёх полос человеческого плагина и добавляет синий
курсор внизу справа. Светлый и тёмный listing logo имеют прозрачный фон;
composer, как у человеческого плагина, использует собственную белую подложку.
Это presentation assets ассистента: они входят в явный список builder и
integrity inventory, не меняют общий shell или его pin.

`npm run build -- --shell-repo /absolute/agent-workspaces --output /new/directory`
собирает standalone plugin folder. Выходной путь должен отсутствовать. В нём
`package-integrity.json` фиксирует точные источники и SHA-256 каждого payload file.
Две сборки одного source и lock дают одинаковые bytes/modes, независимо от dirty
рабочего дерева shell. Builder не обращается к сети и не запускает source shell.
Tests используют отдельный fixture Git repository: изменение checkout, symlink,
недостающий blob и попытка подменить shell выявляются до создания пакета.

## Готовность

Локальный вход Telegram/email/MAX выполняется в setup-чате без активной задачи.
После `session_authorized` setup связывает подтверждение с exact sourceId и
показывает ту же подпись `Telegram · <последние восемь символов>`, что owner UI.
Статус существующей регистрации читается штатным source-list, без новой
резервации или чтения переписки. Для `available` следующий шаг – профиль владельца
→ ассистент → «Источники сообщений» → компания → точная строка →
«Использовать для автопроверки». Login не включает polling, а `active` подтверждает
настройку, не фактическую проверку. Task-pass нужен независимо для business body/
processing/ACK, но его отказ не блокирует включение model-free автопроверки.

Сборка проверяет устанавливаемую структуру. Реальный enrollment/live contact и
background install/start/status подтверждают настройку компьютера в своём scope;
они не являются business receipt. Setup chat не обязан получить task tools:
при уже доступных шести setup tools новый chat/reload/reinstall не заменяет
проверку фонового runtime. Его проход требует native company/model/task admission,
действующего pass и observed hook в постоянном чате принятой задачи.
Source → очередь → тот же native chat → business receipt → фактическое следующее
пробуждение проверяются отдельно после нужных настроек/разрешений. Обычная
публикация компонентов и acceptance на production Windows – разные шаги;
зелёный package gate не подтверждает business acceptance.

<a id="marketplace-release"></a>

## Marketplace release

Marketplace `.agents/plugins/marketplace.json` на main ссылается на поддерживаемый
Git source `url` этого же repository с immutable ref `plugin-v0.1.10`. В этом ref
native `.codex-plugin/plugin.json` находится рядом с готовыми skills/MCP и семью
неизменёнными shell файлами. Это generated installable tree, а не editable fork
shell. Source tag `v0.1.10` остаётся на проверенном source commit в main.
ZIP/artifact URL не используется как новый marketplace source.
Generated `.gitattributes` сохраняет exact payload bytes также при Windows
`core.autocrlf=true`; hashes не пересчитываются после локального преобразования.

После exact successful source package gate на Linux/macOS/Windows оператор
создаёт source tag `v0.1.10` и отправляет его guarded
`npm run git:push-main -- --tag v0.1.10`. Штатный `plugin-tests.yml` для tag:

1. Проверяет stable tag, достижимость source SHA из main и successful three-OS
   package jobs этого exact SHA. Source/codex/PR gates не повторяются на tag.
2. Берёт human shell только из exact `shared-shell.lock.json` Git revision и
   вызывает существующий builder. Native release helpers того же builder
   сверяют payload с tagged source и pinned shell. Нет credentials, runtime
   cache, installer, нового executor или изменённого human implementation.
3. Сохраняет main/hook installable files, `distribution.json`, `hook-distribution.json`
   и `source-gate.json` одним
   hosted artifact. `distribution.json` связывает source SHA/tag, exact orphan
   commit/tree, pinned shell SHA и SHA-256 `package-integrity.json`; inventory
   связывает каждый payload file/mode/size/SHA. Artifact ID/digest входят в
   workflow summary вместе с exact source и Git ref.
4. Сначала публикует или проверяет exact hook dependency, затем создаёт
   `refs/tags/plugin-v0.1.10` одним native push и перечитывает
   exact remote commit. Existing equal ref означает уже опубликованный результат;
   mismatch не перезаписывается. Lost reply разрешает только read-back, без
   автоматического force/replay. Generated tag исключён из release triggers.

После workflow read-back обязан подтвердить remote `plugin-v0.1.10` commit,
`.codex-plugin/plugin.json` version, весь `package-integrity.json` и наличие declared MCP/hook
launchers в clone этого ref, а также отдельный immutable hook ref. Marketplace refresh должен разрешить ту же запись;
до этого нельзя объявлять distribution доступной. Следующая plugin version
получает новый source tag и новый generated ref; прежние tags остаются immutable.

Официальный source contract – [OpenAI marketplace metadata](https://developers.openai.com/plugins/build/plugins#marketplace-metadata).
Публикация не устанавливает plugin, не выполняет enrollment/login/Hook trust и не
поднимает runtime/plugin minimum. Shared shell component остаётся `3.2.3`, plugin
version – `0.1.10`; signed runtime `3.18.0` выпускается независимо в общем контуре.


Remote MCP reuses the common resolver/protected setup/vault/doctor/call engine
under the genuine pass and assistant/device namespace. A native exact skill read
selects the bounded `remote_mcp` presentation; status returns the task view. The
same session-fixed profile/notification seam also supports `skill_setup`; views
never grant authority. External writes consume a sealed full-argument owner
intent before one request; the receipt admits an attempt, not delivery or replay.
Encrypted declarations/arguments stay in the native-selected common payload flow.
PAT/OAuth enrollment needs a human in the existing protected local UI. These
runtime/DB/crypto checks do not assert Windows pilot or business readiness.

## Независимый hook-компонент

Codex 0.164 вычисляет `plugin_content_hash` по всему hook-owning bundle, включая
metadata, Markdown и служебный Git index/reflog root checkout, и проверяет
`trusted_content_hash` при исполнении. Простое
сохранение hooks.json при bump основного manifest поэтому не сохраняет trust.
Причина проверена в native `hooks/list`, а не выведена из Windows/CLI интерфейса.

Основной пакет с 0.1.5 не объявляет hooks. Его `package-integrity.json` содержит
закрытый `hookComponent` descriptor: exact pluginId, независимую версию и SHA-256
inventory требуемого `trelio-digital-assistant-hooks`. Второй пакет содержит только
native manifest, три hooks, семь exact Git-pinned общих shell files и integrity
metadata. В нём нет main version, skills/MCP, контекста, credentials или source SHA
текущего main release. Общая оболочка не форкается.

Первый source tag публикует `hooks-v0.1.0` перед `plugin-v0.1.5`. Оба результата
используют прежние builder, source gate, native immutable-ref push и read-back.
После публикации structural receipt hook release фиксируется в tracked
`hook-component.lock.json`. Следующий main release сверяет полный component tree,
исходный tag/commit, provenance и remote ref; совпавший hook ref не пересоздаётся
и не получает новую фиктивную provenance. Изменение executable bytes или native
source contract компонента требует отдельной
версии/публикации и native human review. Не делайте metadata-only bump hook версии.

Runtime использует третий закрытый профиль SAME immutable-tree/retention/native
installer engine. Он проверяет официальный marketplace, version/ref, regular
files, полный inventory и все executable bytes. Missing dependency может быть
установлена; human-disabled, newer или same-version altered dependency не
перезаписывается. Перед одним native add сохраняется intent в существующем
identity-bound updater journal. Потерянный ответ допускает только exact read-back;
unknown не повторяет add. Dependency-changing failure не откатывается в combined
legacy main с дублирующими hooks. Initial explicit background install использует
тот же intent, включая opt-out из последующих обновлений.

Native preflight требует ровно три trusted hooks единственного выбранного
источника. Mixed legacy+companion, wrong version/path, отсутствующие/изменённые
bytes, untrusted/modified native statuses блокируют запуск. Codex доверие остаётся
неизменяемым для runtime: нет hash copying, auto-approval, managed-source spoof,
bypass flags, symlink indirection или размещения меняющихся файлов в исключениях
fingerprint scanner. Одобрение нового компонента при первой миграции – реальное
изменение hook identity; после него main-only updates не требуют нового review.


Hook source с 0.1.1 использует официальный `git-subdir` с fixed `./plugin` и
immutable `hooks-vX.Y.Z`. Generated transport tree содержит полный payload внутри
`plugin/` и root `.gitattributes` для byte-exact Windows checkout. Installed
inventory описывает прежние относительные paths, а native Codex помещает только
выбранный payload в свой обычный versioned cache, без `.git`. Это штатная source
projection, а не удаление metadata из установленного cache. Старый URL-root
`hooks-v0.1.0` сохраняется и проверяется в исходном формате для migration.
Native gate использует main URL refs и fixed hook subdirectory из одного Git
репозитория: установка и обновление main сохраняют native hashes; изменение
hook/loader их меняет. Никакие fixture approvals/trusted hashes не записываются.
