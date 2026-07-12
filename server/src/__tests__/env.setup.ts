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
