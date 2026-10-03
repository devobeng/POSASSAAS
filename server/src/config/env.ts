import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// A 32+ character string still passes as a "secret" even when it's an
// unchanged placeholder or a short hand-typed string padded out with
// repetition — either way, guessable. Two checks catch that without being
// so strict a genuine random secret could ever fail them:
//  - known placeholder wording (the .env.example / doc-comment patterns)
//  - character diversity: a real random hex/base64 secret has high unique-
//    character variety; a hand-typed or keyboard-mashed one usually doesn't.
const PLACEHOLDER_PATTERN = /your[-_ ]?(access|refresh)?[-_ ]?secret|changeme|change[-_ ]me|placeholder|secret[-_ ]?here|example\.com/i;
const MIN_UNIQUE_CHARS = 12;

function weakSecretReason(value: string): string | null {
  if (PLACEHOLDER_PATTERN.test(value)) return 'looks like an unchanged placeholder value';
  if (new Set(value).size < MIN_UNIQUE_CHARS) {
    return 'has too little character variety to be a real random secret';
  }
  return null;
}

const GENERATE_HINT =
  'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"';

const jwtSecretSchema = z
  .string()
  .min(32, 'must be at least 32 characters')
  .superRefine((value, ctx) => {
    const reason = weakSecretReason(value);
    if (reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Insecure secret — ${reason}. ${GENERATE_HINT}` });
    }
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z
      .string()
      .default('5000')
      .transform((v) => parseInt(v, 10)),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_ACCESS_SECRET: jwtSecretSchema,
    JWT_REFRESH_SECRET: jwtSecretSchema,
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    CLIENT_URL: z.string().url().default('http://localhost:3000'),
    // Required, not defaulted to '' — Paystack underpins both POS payments
    // and subscription billing; booting with no key means payments silently
    // fail at call time instead of the misconfiguration being caught here.
    PAYSTACK_SECRET_KEY: z.string().min(1, 'PAYSTACK_SECRET_KEY is required'),
    CLOUDINARY_CLOUD_NAME: z.string().default(''),
    CLOUDINARY_API_KEY: z.string().default(''),
    CLOUDINARY_API_SECRET: z.string().default(''),
    REDIS_URL: z.string().optional(),
    LOG_LEVEL: z.string().default('info'),
    HUBTEL_CLIENT_ID: z.string().default(''),
    HUBTEL_CLIENT_SECRET: z.string().default(''),
    HUBTEL_SENDER_ID: z.string().default(''),
    HUBTEL_OTP_BASE_URL: z.string().default('https://api-otp.hubtel.com/v1/otp'),
    DEFAULT_COUNTRY_CODE: z.string().default('233'),
  })
  .superRefine((data, ctx) => {
    if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: `Must be different from JWT_ACCESS_SECRET. ${GENERATE_HINT}`,
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
