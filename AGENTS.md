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

Portable manifest/MCP/hooks и две skills лежат в `plugins/trelio-digital-assistant`.
Список payload ограничен builder; новый файл требует осознанного включения.
Typed Workspace flow – `docs/architecture.md`; model не выбирает directory/proof.
Portable MCP cwd фиксирован как `${PLUGIN_ROOT}`: legacy inline `"."` native parser
не принимает, хотя skills остаются видимыми. Builder обязан отвергнуть такой
package до output/publication; regression не заменять file-existence assertion.
Windows resolution extensionless command → SAME pinned `.cmd` принадлежит native
Codex resolver/PATHEXT; shell не форкать и OS executor в plugin не добавлять.
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
Task reference covers exact conversation binding, signed account login and
corporate Secret creation through the SAME host/owner ledger, not new executors.
First-send hints never permit send replay or replace a native route receipt.
Marketplace main ссылается только на self-contained generated `plugin-vX.Y.Z`,
не на неполную source-папку. Source tag `vX.Y.Z` после exact 3-OS CI использует
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
