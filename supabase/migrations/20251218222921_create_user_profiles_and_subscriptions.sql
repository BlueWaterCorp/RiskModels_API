/*
  # User Profiles and Subscriptions Schema

  ## Overview
  Creates the database schema for user authentication and subscription management.

  ## New Tables
  
  ### `profiles`
  - `id` (uuid, primary key) - References auth.users(id)
  - `email` (text) - User email address
  - `full_name` (text) - User's full name
  - `company_name` (text, nullable) - Company/RIA name
  - `created_at` (timestamptz) - Account creation timestamp
  - `updated_at` (timestamptz) - Last profile update timestamp

  ### `subscriptions`
  - `id` (uuid, primary key) - Unique subscription identifier
  - `user_id` (uuid, foreign key) - References profiles(id)
  - `stripe_customer_id` (text) - Stripe customer identifier
  - `stripe_subscription_id` (text, nullable) - Stripe subscription identifier
  - `subscription_tier` (text) - Plan tier: 'professional' or 'enterprise'
  - `status` (text) - Subscription status: 'active', 'canceled', 'past_due', 'trialing'
  - `current_period_start` (timestamptz, nullable) - Current billing period start
  - `current_period_end` (timestamptz, nullable) - Current billing period end
  - `cancel_at_period_end` (boolean) - Whether subscription cancels at period end
  - `created_at` (timestamptz) - Subscription creation timestamp
  - `updated_at` (timestamptz) - Last subscription update timestamp

  ## Security
  
  ### Profiles Table
  - Enable RLS
  - Users can read their own profile
  - Users can update their own profile
  - Profile is created automatically when user signs up (via trigger)

  ### Subscriptions Table
  - Enable RLS
  - Users can read their own subscription
  - Only service role can write (via webhooks)

  ## Triggers
  - Auto-create profile when user signs up in auth.users
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  company_name text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text,
  subscription_tier text NOT NULL CHECK (subscription_tier IN ('professional', 'enterprise')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Subscriptions policies
CREATE POLICY "Users can read own subscription"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', '')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
