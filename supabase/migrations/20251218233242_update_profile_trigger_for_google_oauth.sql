/*
  # Update Profile Trigger for Google OAuth

  ## Changes
  - Updates the `handle_new_user()` trigger function to properly handle both email/password and Google OAuth users
  - Google OAuth users have different metadata structure (full_name vs name)
  - Ensures profile is created correctly for all authentication methods

  ## Details
  The function now:
  1. Checks for full_name in raw_user_meta_data (email/password signup)
  2. Falls back to name field for Google OAuth users
  3. Falls back to empty string if neither exists
  4. Uses COALESCE for safe fallback handling
*/

-- Drop existing function
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Recreate function with Google OAuth support
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    )
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
