# Пакет цифрового ассистента

## Границы

`ivaschru/Trelio` владеет identity, company/task ACL, устройствами, enrollment,
делегированными MCP grants, вопросами владельцу и domain mutations.
`trelio-ru/agent-workspaces-runtime` владеет общим подписанным runtime, private
storage, hooks/admission, очередью, scheduler, native Codex и OS-service.
Этот репозиторий содержит устанавливаемую композицию и короткие инструкции.
Исправления обычных ACL, Workspace, Secret engine и runtime сохраняются общими.

## Формат и shared shell

Используется portable `plugin.json` + `mcp.json` и OpenAI extension по
[официальному контракту](https://developers.openai.com/plugins/build/plugins).
Подключение – только локальный `trelio-assistant` stdio server, который использует
защищённый device credential и отдельную server audience `/mcp/assistant`.
В пакет не включается human OAuth server или его настройки.

Стабильный shell из `agent-workspaces` закреплён в `shared-shell.lock.json`.
Builder читает exact Git blobs, а не потенциально dirty checkout. Семь shell
файлов копируются без изменения в generated output; source shell не форкается.
Версия shell 3.2.3 обозначает совместимость общей проверки подписи и не является
версией нового плагина. Runtime packages, токены и локальные caches не включаются.

MCP и hooks запускают общий loader с `bridge assistant mcp|hook`. Явный `assistant`
profile должен поддерживаться signed runtime. Старый runtime обязан отвергать
неизвестную команду, без перехода к human MCP. Hooks требуют самостоятельного
review/trust пользователем; пакет не меняет config или доверие за него.

## Сборка и проверка

`npm run build -- --shell-repo /absolute/agent-workspaces --output /new/directory`
собирает standalone plugin folder. Выходной путь должен отсутствовать. В нём
`package-integrity.json` фиксирует точные источники и SHA-256 каждого payload file.
Две сборки одного source и lock дают одинаковые bytes/modes, независимо от dirty
рабочего дерева shell. Builder не обращается к сети и не запускает source shell.
Tests используют отдельный fixture Git repository: изменение checkout, symlink,
недостающий blob и попытка подменить shell выявляются до создания пакета.

## Готовность

Сборка – проверка устанавливаемой структуры, а не свидетельство работающего
assistant MCP/daemon. До активации нужны реализованный signed assistant entry,
server pass/task policy, реальный enrollment, source → очередь → тот же native chat
→ business receipt и фактическое следующее пробуждение. Сейчас product release,
marketplace publication и изменение существующего Windows-пилота не выполняются.
