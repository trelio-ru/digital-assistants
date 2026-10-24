# Trelio Digital Assistant

Отдельный плагин для цифрового ассистента с владельцем-человеком. Несколько компаний,
один постоянный native Codex chat на принятую задачу, model-free источник/очередь
и циклы в общем host runtime. Владелец подтверждает привязку на своём устройстве;
его Trelio browser-session не переносится на компьютер ассистента.

Пакет: `plugins/trelio-digital-assistant`, portable manifest/MCP/hooks и две skills.
Общий stable shell добавляется только при сборке из exact Git revision:

```sh
npm ci
npm test
npm run build -- --shell-repo /absolute/agent-workspaces --output /new/absolute/plugin
```

В выходной папке находится standalone plugin и `package-integrity.json`.
Сборка не устанавливает пакет, не меняет Codex config/hook trust, не входит в Trelio
как человек и не выпускает signed runtime. Установка, paired contact, фоновый
supervisor и реальная доставка задачи проверяются отдельно. Подробности –
[архитектура](docs/architecture.md).

Setup chat подтверждает привязку и requested background install/start/status.
Если шесть этих tools уже доступны и pairing успешен, отсутствие дополнительных
business methods в этом чате не исправляется новым чатом, reload или reinstall.
`get_assistant_setup_status` не выдаёт task pass/nextAction/workflow. Реально
доступный `get_assistant_status` даёт только structural capabilities. Компания,
модель и task admission проверяются фоновым runtime; рабочий проход и observed
hook принадлежат постоянному чату принятой задачи. Владелец отдельно настраивает
разрешения/модель/аккаунты и лично подтверждает вход и Hook trust. Реальная
сквозная проверка следует после этих условий; local setup не объявляет её успех.

Собственный marketplace публикуется из этого репозитория:

```sh
codex plugin marketplace add trelio-ru/digital-assistants --ref main
```

Каталог `trelio-digital-assistants` предлагает `trelio-digital-assistant`.
Его source – immutable `plugin-v0.1.2` с готовым плагином в корне Git tree.
Source tag `v0.1.2` и generated tag различаются: папка `plugins/` на main
остаётся исходниками, а семь shared shell файлов добавляет прежний builder.
До успешного tagged workflow и read-back generated ref установка из каталога
ещё недоступна. Marketplace registration не устанавливает плагин и не включает
его Hooks. Выпуск и проверка bytes – [контракт](docs/architecture.md#marketplace-release).
