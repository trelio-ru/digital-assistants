# Координация интеграции и версий

## Фоновое ожидание

В macOS Codex обычная задача использует
`npm run git:integrate -- --finish-worktree`. После сохранённого ticket и
`chatFollowUp` завершить ход. Воркер выполняет интеграцию и штатную уборку,
а общий LaunchAgent передаёт terminal result в исходный чат через native
`codex queue`. В callback проверить exact ticket и фактический `origin/main`,
подтвердить получение через `--ack`. Повторный enqueue получает отдельное
сопровождение. Без native context автоматического возврата нет. Для уже
разрешённого релиза используется синхронный `--wait --tag <exact-tag>`.

Порядок восстановления и доставки описан в [общем закреплённом контракте](https://github.com/trelio-ru/agent-workspaces-runtime/blob/8952a72a176893254311d9b141f9870d03a39021/docs/git-coordination.md#background-integration-and-chat-follow-up).

## Инварианты интеграции

После commit запустить `npm run git:integrate`. Очередь общая для linked
worktree. Владелец держит место от fresh fetch/rebase до публикации task
branch/PR, exact hosted CI и guarded main push/read-back. Не менять ожидающие
HEAD/files.
Обычные вливания идут FIFO перед ожидающим релизом. После захвата места
новые вливания ждут за ним. Повтор с тем же тегом и исходным SHA может
присоединиться к ожидающему тикету. `releaseRole=observer` и exit 3 сообщают
результат интеграции, а публикацию продолжает исходный запуск.
Для разрешённого релиза: `npm run git:integrate -- --tag <exact-tag>`.
Версия проверяется до CI; занятая версия останавливает кандидата без перезаписи.
Подготовить source/manifest version до enqueue. Артефакт, подпись, activation/CAS
и production read-back сохраняют отдельные правила владельца репозитория.

`--status` показывает очередь; `--recover <ticket>` снимает только exact ticket
своего host после смерти owner и всей isolated process group. Возраст не даёт
права забрать очередь; живые grandchildren после SIGKILL остаются блокировкой.
Failed CI/rebase сохраняет работу. Внешний clone не входит в локальную очередь:
remote advance останавливает push, без автоматического rebase/retest.
Canonical hook проверяет live ancestry, exact worktree/branch/SHA/tag и verified
state; boolean, raw push и старый wrapper допуска не дают.

Единственная реализация – maintainer devDependency `@trelio/git-coordinator`
из exact Git commit `trelio-ru/agent-workspaces-runtime`, закреплённого lockfile.
После checkout выполнить `npm ci --ignore-scripts`; node_modules не делить.
Репозиторий владеет своими policy, CI adapter, hooks и transport. Общий код не
копируется, пакет не включается в plugin/runtime/provider artifacts и не меняет
их version/minimum policy. Обновление infrastructure не означает выпуск продукта.

Обычный FF main использует exact PR evidence и не запускает тот же gate заново.
Канонический pre-push продолжает проверять каждый protected push. Tag jobs
сохраняют собственные прежние release-проверки и publication/read-back.
