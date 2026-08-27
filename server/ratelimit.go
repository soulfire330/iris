package main

import (
	"time"
)

// LoginLimiter ограничивает попытки пароля в памяти: 5 неудач за 5 минут на логин.
// Сбрасывается рестартом бэкенда — для MVP достаточно (ADR-0001).
type LoginLimiter struct {
	failures map[string]int
	first    map[string]time.Time
}

func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{failures: map[string]int{}, first: map[string]time.Time{}}
}

func (l *LoginLimiter) Blocked(key string) bool {
	f, ok := l.failures[key]
	if !ok || f < 5 {
		return false
	}
	if time.Since(l.first[key]) > 5*time.Minute {
		delete(l.failures, key)
		delete(l.first, key)
		return false
	}
	return true
}

func (l *LoginLimiter) Failure(key string) {
	if _, ok := l.failures[key]; !ok {
		l.first[key] = time.Now()
	}
	l.failures[key]++
}

func (l *LoginLimiter) Reset(key string) {
	delete(l.failures, key)
	delete(l.first, key)
}
