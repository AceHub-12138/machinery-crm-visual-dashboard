#!/bin/zsh
cd "$(dirname "$0")" || exit 1
node --experimental-strip-types scripts/voice-stack.mjs
if [[ $? -ne 0 ]]; then
  printf '\n启动失败，请把终端提示发给 Codex。按回车关闭。\n'
  read -r
fi
