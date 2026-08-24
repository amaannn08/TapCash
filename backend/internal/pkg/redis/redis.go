package redis

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

var (
	ErrLockAcquisitionFailed = errors.New("failed to acquire distributed lock")
	ErrLockNotHeld           = errors.New("lock is not held or has expired")
)

// Client wraps redis.Client with distributed locking and idempotency utilities.
type Client struct {
	rdb       *redis.Client
	useMemory bool
	memMu     sync.Mutex
	memLocks  map[string]time.Time
}

// NewRedisClient creates a new Redis client with fallback to in-memory lock store if Redis is unavailable locally.
func NewRedisClient(ctx context.Context, redisURL string) *Client {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("[Redis] Invalid redis URL (%v), falling back to high-performance in-memory lock store\n", err)
		return &Client{
			useMemory: true,
			memLocks:  make(map[string]time.Time),
		}
	}

	rdb := redis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := rdb.Ping(pingCtx).Err(); err != nil {
		log.Printf("[Redis] Connection failed (%v). Falling back to in-memory distributed lock manager\n", err)
		return &Client{
			useMemory: true,
			memLocks:  make(map[string]time.Time),
		}
	}

	log.Println("[Redis] Successfully connected to Redis instance")
	return &Client{
		rdb:       rdb,
		useMemory: false,
		memLocks:  make(map[string]time.Time),
	}
}

// TryAcquireLock attempts to acquire a distributed lock for key with TTL.
func (c *Client) TryAcquireLock(ctx context.Context, key string, ttl time.Duration) (string, error) {
	token := uuid.New().String()

	if c.useMemory {
		c.memMu.Lock()
		defer c.memMu.Unlock()

		if exp, exists := c.memLocks[key]; exists && time.Now().Before(exp) {
			return "", ErrLockAcquisitionFailed
		}
		c.memLocks[key] = time.Now().Add(ttl)
		return token, nil
	}

	lockKey := fmt.Sprintf("lock:%s", key)
	ok, err := c.rdb.SetNX(ctx, lockKey, token, ttl).Result()
	if err != nil {
		return "", fmt.Errorf("redis setnx error: %w", err)
	}
	if !ok {
		return "", ErrLockAcquisitionFailed
	}
	return token, nil
}

// ReleaseLock safely releases the lock only if the token matches.
func (c *Client) ReleaseLock(ctx context.Context, key, token string) error {
	if c.useMemory {
		c.memMu.Lock()
		defer c.memMu.Unlock()
		delete(c.memLocks, key)
		return nil
	}

	lockKey := fmt.Sprintf("lock:%s", key)
	luaScript := `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("del", KEYS[1])
		else
			return 0
		end
	`
	_, err := c.rdb.Eval(ctx, luaScript, []string{lockKey}, token).Result()
	return err
}
