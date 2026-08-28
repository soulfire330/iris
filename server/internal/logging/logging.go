// Пакет logging — общая настройка slog для обоих бинарников (бэкенд и
// секретарь): текстовый вывод в stderr, уровень из LOG_LEVEL (debug|info|
// warn|error), по умолчанию info. Неизвестное значение — предупреждение в
// stderr и дефолт, чтобы опечатка в LOG_LEVEL не гасила логи молча.
package logging

import (
	"fmt"
	"log/slog"
	"os"
)

func Setup() {
	lvl := slog.LevelInfo
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		var l slog.Level
		if err := l.UnmarshalText([]byte(v)); err != nil {
			fmt.Fprintf(os.Stderr, "LOG_LEVEL=%q not recognized, using info: %v\n", v, err)
		} else {
			lvl = l
		}
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: lvl})))
}
