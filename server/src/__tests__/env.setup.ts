// Set required env vars before any module is loaded.
// Must run before the env.ts validation executes.
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.DATABASE_URL = 'postgresql://localhost/pos_test';
process.env.DIRECT_URL = 'postgresql://localhost/pos_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-min-32-chars-long!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-long!!';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.CLIENT_URL = 'http://localhost:3000';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_dummy';
process.env.CLOUDINARY_CLOUD_NAME = 'test';
process.env.CLOUDINARY_API_KEY = 'test';
process.env.CLOUDINARY_API_SECRET = 'test';
// Explicitly empty (not just omitted) — env.ts calls dotenv.config() after
// this file runs, and dotenv only fills in variables that are still
// undefined. Without this, the real .env's REDIS_URL leaks into the test
// process, and since ioredis is now an actual dependency, config/redis.ts
// attempts a real connection to it — every test touching caching or rate
// limiting then blocks on real connection retries instead of running mocked
// and instant.
process.env.REDIS_URL = '';
