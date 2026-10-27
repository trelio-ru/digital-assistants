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

Source использует portable `plugin.json` + `mcp.json` для единственного описания
метаданных. Устанавливаемый пакет использует поддерживаемый Codex compatibility
manifest `.codex-plugin/plugin.json`, как человеческий плагин. Codex
`0.164.0-alpha.11.1` реально видел MCP/skills portable пакета, но возвращал ноль
hooks и в `hooks/list`, и в `/hooks`. В [native loader](https://github.com/openai/codex/blob/main/codex-rs/core-plugins/src/loader.rs)
формат `AgentPlugin` явно получает пустые hook sources. Наличие файла hooks и
корректного extension поэтому не является проверкой discovery.

Один builder переводит только metadata/paths: flat interface, skills/onboarding,
hooks и inline MCP. Source `${PLUGIN_ROOT}` становится native `cwd: "."` под
compatibility parser. Root `plugin.json` удаляется из generated inventory:
иначе он имеет приоритет и снова выбирает формат без hooks. Второго server,
executor, схемы авторизации или копии shell нет. Исходные hook bytes сохранены.
Native Windows gate использует официальный Codex `rust-v0.164.0`, pinned hashes,
изолированные HOME/USERPROFILE/CODEX_HOME и local fixture marketplace. Он требует
три обнаруженных `untrusted` hooks без входа, model turn, Trelio MCP execution
или изменения trust. После обновления пользователь один раз просматривает hooks
в штатном клиенте. Запись trusted_hash или обход trust агентом запрещены.

`command: "./scripts/launch-trelio-node"` сохраняется общим с pinned shell.
Native Codex Windows MCP launcher разрешает исполняемый файл через общий
`program_resolver`/`which` и `PATHEXT`, включая соседний `.cmd`; hook отдельно
использует свой `commandWindows`. Другой executable/OS selector в plugin не
добавляется. Наличие обоих exact pinned launcher files проверяется при сборке;
фактический запуск Windows MCP и tools остаётся отдельным read-back на устройстве.
[Официальный local MCP пример](https://developers.openai.com/plugins/deploy/desktop-only#configure-a-local-mcp-server)
использует тот же root placeholder.

Стабильный shell из `agent-workspaces` закреплён в `shared-shell.lock.json`.
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
Git source `url` этого же repository с immutable ref `plugin-v0.1.4`. В этом ref
native `.codex-plugin/plugin.json` находится рядом с готовыми hooks/skills и семью
неизменёнными shell файлами. Это generated installable tree, а не editable fork
shell. Source tag `v0.1.4` остаётся на проверенном source commit в main.
ZIP/artifact URL не используется как новый marketplace source.
Generated `.gitattributes` сохраняет exact payload bytes также при Windows
`core.autocrlf=true`; hashes не пересчитываются после локального преобразования.

После exact successful source package gate на Linux/macOS/Windows оператор
создаёт source tag `v0.1.4` и отправляет его guarded
`npm run git:push-main -- --tag v0.1.4`. Штатный `plugin-tests.yml` для tag:

1. Проверяет stable tag, достижимость source SHA из main и successful three-OS
   package jobs этого exact SHA. Source/codex/PR gates не повторяются на tag.
2. Берёт human shell только из exact `shared-shell.lock.json` Git revision и
   вызывает существующий builder. Native release helpers того же builder
   сверяют payload с tagged source и pinned shell. Нет credentials, runtime
   cache, installer, нового executor или изменённого human implementation.
3. Сохраняет installable files, `distribution.json` и `source-gate.json` одним
   hosted artifact. `distribution.json` связывает source SHA/tag, exact orphan
   commit/tree, pinned shell SHA и SHA-256 `package-integrity.json`; inventory
   связывает каждый payload file/mode/size/SHA. Artifact ID/digest входят в
   workflow summary вместе с exact source и Git ref.
4. Создаёт только `refs/tags/plugin-v0.1.4` одним native push и перечитывает
   exact remote commit. Existing equal ref означает уже опубликованный результат;
   mismatch не перезаписывается. Lost reply разрешает только read-back, без
   автоматического force/replay. Generated tag исключён из release triggers.

После workflow read-back обязан подтвердить remote `plugin-v0.1.4` commit,
`.codex-plugin/plugin.json` version, весь `package-integrity.json` и наличие declared MCP/hook
launchers в clone этого ref. Marketplace refresh должен разрешить ту же запись;
до этого нельзя объявлять distribution доступной. Следующая plugin version
получает новый source tag и новый generated ref; прежние tags остаются immutable.

Официальный source contract – [OpenAI marketplace metadata](https://developers.openai.com/plugins/build/plugins#marketplace-metadata).
Публикация не устанавливает plugin, не выполняет enrollment/login/Hook trust и не
поднимает runtime/plugin minimum. Shared shell component остаётся `3.2.3`, plugin
version – `0.1.4`; signed runtime `3.18.0` выпускается независимо в общем контуре.


Remote MCP reuses the common resolver/protected setup/vault/doctor/call engine
under the genuine pass and assistant/device namespace. A native exact skill read
selects the bounded `remote_mcp` presentation; status returns the task view. The
same session-fixed profile/notification seam also supports `skill_setup`; views
never grant authority. External writes consume a sealed full-argument owner
intent before one request; the receipt admits an attempt, not delivery or replay.
Encrypted declarations/arguments stay in the native-selected common payload flow.
PAT/OAuth enrollment needs a human in the existing protected local UI. These
runtime/DB/crypto checks do not assert Windows pilot or business readiness.
