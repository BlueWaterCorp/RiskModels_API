-- Update user_agent_traces table comment: Polsia → SRA (Sovereign Risk Agent)
-- Polsia is now a vendor; internal agent renamed Mar 2026.
COMMENT ON TABLE public.user_agent_traces IS 'SRA (Sovereign Risk Agent) autonomous feedback traces for mandate drift (hedge, PRI, sector, drawdown)';
