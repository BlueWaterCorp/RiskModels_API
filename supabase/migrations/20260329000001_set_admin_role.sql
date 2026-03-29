-- Add role column to profiles table and set admin user
-- This migration adds the role column if it doesn't exist and sets the specified user as admin

-- Add role column if it doesn't exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- Set conrad@bwmacro.com as admin
UPDATE profiles
SET role = 'admin'
WHERE email = 'conrad@bwmacro.com';

-- Verify it worked
SELECT id, email, full_name, role
FROM profiles
WHERE email = 'conrad@bwmacro.com';
