# Digital Assistant plugin

Канонический репозиторий устанавливаемого плагина «Цифровой ассистент».
Backend/domain/ACL остаются в `ivaschru/Trelio`, generic signed host runtime –
в `trelio-ru/agent-workspaces-runtime`, стабильный shell – read-only dependency
из `trelio-ru/agent-workspaces`. Не копировать сюда backend, providers, secrets
или изменённую копию human plugin/runtime. Shell при сборке берётся из exact Git
revision, одинаковая проверка подписи/Node/upgrade используется без fork.

- Перед правкой читать `docs/architecture.md`, если он уже создан, и current
  официальные OpenAI plugin docs для меняющихся native контрактов.
- Подробно комментировать nontrivial code и обновлять контракт с поведением.
- Структурные prompts не являются полномочиями. Только действующие server
  device/task/owner decisions и общий ACL разрешают business work.
- Никогда не импортировать human OAuth/cookies, автоматизировать hook trust,
  approval/sandbox override, хранить credential в prompts/argv/env/Git/logs
  или выдавать отсутствующий backend/runtime за работающий plugin.
- Плагины людей и ассистентов имеют разные identity/MCP surfaces, но используют
  общий runtime, Secret engine, company rules и native domain services.
- `main` после начального bootstrap остаётся clean. До правки fetch/status и
  divergence check; task worktree создаётся `npm run git:new-worktree -- codex/...`.
  Commit по-русски, targeted/full CI перед `npm run git:push-main`, затем exact
  remote read-back и `npm run git:finish-worktree -- <absolute-path>` из main.
  Raw/force main push после bootstrap запрещён. Не изменять чужие worktrees.
- Никаких product tags, marketplace publication, установки/включения или изменения
  локального Codex без отдельной применимой команды пользователя. Draft/CI packages
  остаются unsigned/неактивными. Синтетические tests не доказывают Windows pilot.

## Пакет и проверки

MCP/skills лежат в `plugins/trelio-digital-assistant`; определения hooks – только
в `plugins/trelio-digital-assistant-hooks`. Codex хэширует весь hook bundle, поэтому
его manifest/shell/inventory заморожены независимо от main instructions/version.
Нельзя переносить approvals, писать trust hashes или обходить native review.
Список payload ограничен builder; новый файл требует осознанного включения.
Иконки в `assets/` сохраняют знак человеческого плагина с добавленным курсором;
manifest paths и payload inventory меняются согласованно, без правки shared shell.
Typed Workspace flow – `docs/architecture.md`; model не выбирает directory/proof.
Setup skill разделяет paired/live-contact и background receipts от business
проверки в постоянном task chat. Six-present setup не запускает new-chat/reload/
reinstall loop ради task tools; task-pass/proof и observed hook даёт runtime.
Локальный Telegram login не требует task: после session_authorized setup называет
точный source suffix и owner UI автопроверки, сохраняя reservation; task body/ACK
не использовать как проверку подключения или повод создать дубли.
Codex 0.164 пропускает hooks формата root Agent Plugins, хотя видит его MCP/skills.
Builder генерирует совместимый `.codex-plugin/plugin.json`, как у human plugin,
из единственного source manifest/MCP; root `plugin.json`/`mcp.json` в artifact
не остаются. Source portable cwd `${PLUGIN_ROOT}` проверяется до перевода в
native inline cwd `.`. Hook/shell bytes неизменны; discovery не одобряет trust.
Native Windows CLI gate устанавливает только isolated fixture package, читает
`hooks/list` и требует ровно три untrusted hooks, без аккаунта/model/Trelio MCP.
Windows command resolution принадлежит общему Codex resolver/PATHEXT; shell
не форкать и OS executor в plugin не добавлять.
Task worker читает packaged work-state reference для долгих задач и нескольких
ассистентов. WORK.md остаётся обычным Workspace data с UUID identity, не AGENTS
или authority. Waiting goal не закрывается по native completed turn; файл не
заменяет подтверждённый server pass/outcome или фактическое расписание.
Own-error reference использует live dedicated repair, verified accepted files и
сохранение поздних правок; encrypted repair идёт через обычный correction Run,
source/correction не заменяют бизнес-результат цели.
Remote MCP reference uses SAME live native resolver/credential store/doctor/call, bounded presentation view and a one-use owner attempt receipt; human local setup remains explicit.
Private-credential reference использует live sealed owner intent и общий host;
encrypted neutral metadata не экспортирует company content; empty-card approval
не разрешает generation/signup, values не входят в state.
Task reference keeps nonexclusive conversation correlation and exact per-original batch routes, signed account login and
corporate Secret creation through the SAME host/owner ledger, not new executors.
First-send hints never permit send replay or replace a native route receipt.
Marketplace main ссылается только на self-contained generated `plugin-vX.Y.Z`,
не на неполную source-папку. С 0.1.5 main bundle не владеет hooks. `hooks-vX.Y.Z`
публикуется тем же native builder и фиксируется `hook-component.lock.json`;
следующий main release проверяет исходные bytes/provenance без новой публикации.
Lock берётся из проверенного публичного release receipt, никогда из VM cache.
Hook version/pin меняются только при изменении executable bytes или native source
contract; metadata-only bumps запрещены.
`hook-shell.lock.json` независим от main `shared-shell.lock.json`; release impact
общей оболочки проверяется для обоих, metadata-only pin bump hooks запрещён.
Первый переход требует личного одобрения нового компонента; будущие main-only
обновления сохраняют native hashes. С 0.1.1 hook ref содержит payload в plugin/,
marketplace использует exact git-subdir ./plugin; installed root не содержит .git.
Native Codex хэширует и checkout metadata старого URL-root 0.1.0: не удалять её
ради trust и не менять старые tags. Проверять реальным isolated hooks/list: main
update – прежние hashes, hook/loader change – новые, без fixture trust writes. Source tag `vX.Y.Z` после exact 3-OS CI использует
тот же builder/pin и существующий workflow; generated ref не запускает новый
release. Native Git создаёт immutable ref один раз и делает exact read-back;
mismatch/unknown не разрешают force/replay. Порядок – `docs/architecture.md`.
`scripts/build-plugin.mjs` читает только regular source и exact Git blobs общего
shell по lock, никогда dirty checkout или сеть. Shell modes/bytes сохраняются;
output – новая папка, существующая не перезаписывается. Integrity inventory не
является подписью или готовностью backend. Запуск только через явный signed
`bridge assistant` profile; human `mcp` fallback запрещён.
Перед интеграцией: `npm run check:dependencies`, `npm test`, validation обеих skills
и две byte-identical сборки с pinned настоящим shell. До готовности assistant
entry/backend не устанавливать и не объявлять unattended flow работающим.
