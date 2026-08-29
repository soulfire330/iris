package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
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

// newIPLimiter — per-IP токен-бакет для публичных эндпоинтов. rate <= 0 —
// лимитер выключен (блок не задан в конфиге). При превышении — 429 с
// Retry-After, тело в стиле проекта.
func newIPLimiter(cfg RateLimitBucket) func(http.Handler) http.Handler {
	if cfg.Rate <= 0 || cfg.Burst <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	b := &ipBuckets{limit: rate.Limit(cfg.Rate), burst: cfg.Burst, m: make(map[string]*bucket)}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !b.Allow(clientIPTrusted(r)) {
				w.Header().Set("Retry-After", "1")
				writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "слишком много запросов"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// bucket — лимитер одного IP; last — для ленивой чистки.
type bucket struct {
	lim  *rate.Limiter
	last time.Time
}

// ipBuckets — карта IP→лимитер с жёстким потолком: при переполнении
// выкидываем ключи, молчавшие дольше ipBucketTTL, а если всё свежее —
// один любой (счётчик сбросится, бакет наполнится заново).
// ponytail: линейный проход при переполнении, а не фоновый свипер —
// для офисного сервера достаточно; переезд на горутину-свип при
// миллионах уникальных IP.
type ipBuckets struct {
	mu    sync.Mutex
	limit rate.Limit
	burst int
	m     map[string]*bucket
}

const (
	ipBucketsMax = 1024
	ipBucketTTL  = 15 * time.Minute
)

func (b *ipBuckets) Allow(ip string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if e, ok := b.m[ip]; ok {
		e.last = time.Now()
		return e.lim.Allow()
	}
	if len(b.m) >= ipBucketsMax {
		for k, e := range b.m {
			if time.Since(e.last) > ipBucketTTL {
				delete(b.m, k)
			}
		}
		for k := range b.m {
			delete(b.m, k)
			break
		}
	}
	e := &bucket{lim: rate.NewLimiter(b.limit, b.burst), last: time.Now()}
	b.m[ip] = e
	return e.lim.Allow() // бакет стартует полным, первый запрос тратит токен
}

// clientIPTrusted — IP для лимитов. За Caddy (host network) RemoteAddr —
// loopback, реального клиента Caddy дописывает в конец X-Forwarded-For
// (первое значение клиент подделывает сам). Без прокси — RemoteAddr как есть.
func clientIPTrusted(r *http.Request) string {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = h
	}
	if !net.ParseIP(host).IsLoopback() {
		return host
	}
	xff := r.Header.Get("X-Forwarded-For")
	if i := strings.LastIndex(xff, ","); i >= 0 {
		xff = xff[i+1:]
	}
	if ip := strings.TrimSpace(xff); ip != "" {
		return ip
	}
	return host
}

func (l *LoginLimiter) Reset(key string) {
	delete(l.failures, key)
	delete(l.first, key)
}
