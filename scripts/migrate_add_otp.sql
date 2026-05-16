-- Migration: add OTP reset columns to users table
-- Run via: npx wrangler d1 execute smarta-db --remote --file=scripts/migrate_add_otp.sql

ALTER TABLE users ADD COLUMN reset_otp TEXT;
ALTER TABLE users ADD COLUMN reset_otp_expires INTEGER;
