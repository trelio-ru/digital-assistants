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
как человек и не выпускает signed runtime. Готовность assistant MCP, daemon и
сквозной доставки проверяется до первой активации. Подробности и текущие границы –
[архитектура](docs/architecture.md).
