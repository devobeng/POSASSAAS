// Express.Request augmentation is declared in src/middleware/auth.ts via
// `declare global { namespace Express { ... } }` so that ts-node picks it up
// at runtime (ts-node only loads files in the import chain, not tsconfig include globs).
//
// This file is intentionally empty — kept so the /types directory remains valid.
export {};
