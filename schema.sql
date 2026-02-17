-- ============================================================
-- FINANCETRACKER SaaS — Complete PostgreSQL Schema (Supabase)
-- Currency default: JMD (Jamaican Dollar)
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    first_name      VARCHAR(100) NOT NULL DEFAULT 'User',
    last_name       VARCHAR(100) DEFAULT '',
    currency        VARCHAR(3) NOT NULL DEFAULT 'JMD',
    timezone        VARCHAR(50) DEFAULT 'America/Jamaica',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- 2. ACCOUNTS (bank, cash, wallet, credit, custom)
-- ============================================================
CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    account_type    VARCHAR(20) NOT NULL DEFAULT 'cash'
                    CHECK (account_type IN ('cash','bank','credit','wallet','custom')),
    balance         NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    currency        VARCHAR(3) NOT NULL DEFAULT 'JMD',
    overdraft_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE UNIQUE INDEX idx_accounts_user_lower_name_unique ON accounts(user_id, LOWER(name));

-- ============================================================
-- 3. TRANSACTIONS
-- ============================================================
CREATE TABLE transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
    raw_message     TEXT,
    item            VARCHAR(255) NOT NULL,
    amount          NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
    currency        VARCHAR(3) NOT NULL DEFAULT 'JMD',
    category        VARCHAR(50) NOT NULL DEFAULT 'Miscellaneous',
    subcategory     VARCHAR(50) DEFAULT '',
    platform        VARCHAR(100) DEFAULT '',
    payment_method  VARCHAR(30) DEFAULT 'unknown'
                    CHECK (payment_method IN ('cash','upi','credit_card','debit_card','bank_transfer','wallet','unknown')),
    direction       VARCHAR(10) NOT NULL DEFAULT 'outflow'
                    CHECK (direction IN ('inflow','outflow')),
    recipient       VARCHAR(100) DEFAULT NULL,
    order_status    VARCHAR(20) DEFAULT NULL
                    CHECK (order_status IS NULL OR order_status IN ('ordered','shipped','delivered','returned')),
    notes           TEXT DEFAULT NULL,
    confidence      NUMERIC(3,2) DEFAULT 0.50,
    transaction_type VARCHAR(20) DEFAULT 'daily'
                    CHECK (transaction_type IN ('daily','online','income','expense','transfer')),
    week_number     INT,
    month           VARCHAR(7),
    is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, created_at DESC);
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category);
CREATE INDEX idx_transactions_user_month ON transactions(user_id, month);
CREATE INDEX idx_transactions_user_direction ON transactions(user_id, direction);

-- ============================================================
-- 4. TRANSACTION EDITS (audit trail)
-- ============================================================
CREATE TABLE transaction_edits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edit_type       VARCHAR(20) NOT NULL
                    CHECK (edit_type IN ('update','delete','restore')),
    field_changed   VARCHAR(50),
    old_value       TEXT,
    new_value       TEXT,
    edit_reason     TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_edits_transaction ON transaction_edits(transaction_id);
CREATE INDEX idx_tx_edits_user ON transaction_edits(user_id);

-- ============================================================
-- 5. SESSION MEMORY (chat context)
-- ============================================================
CREATE TABLE session_memory (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_session_user ON session_memory(user_id, created_at DESC);

-- ============================================================
-- 6. BUDGETS
-- ============================================================
CREATE TABLE budgets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category        VARCHAR(50) NOT NULL,
    monthly_limit   NUMERIC(15,2) NOT NULL CHECK (monthly_limit > 0),
    currency        VARCHAR(3) NOT NULL DEFAULT 'JMD',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_budgets_user ON budgets(user_id);
CREATE UNIQUE INDEX idx_budgets_user_lower_category_unique ON budgets(user_id, LOWER(category));

-- ============================================================
-- 7. SUBSCRIPTIONS (PayPal-based tiers)
-- ============================================================
CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paypal_subscription_id  VARCHAR(100) UNIQUE,
    plan_name               VARCHAR(20) NOT NULL DEFAULT 'free'
                            CHECK (plan_name IN ('free','pro_monthly','pro_yearly')),
    status                  VARCHAR(20) NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','cancelled','past_due','suspended','pending')),
    current_period_end      TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_paypal ON subscriptions(paypal_subscription_id);

-- ============================================================
-- 8. USAGE LOGS (metering for free tier limits)
-- ============================================================
CREATE TABLE usage_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type     VARCHAR(30) NOT NULL
                    CHECK (action_type IN ('transaction','ocr_upload','query','report','export','login')),
    billing_period  VARCHAR(7) NOT NULL, -- e.g. '2026-02'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_user_period ON usage_logs(user_id, billing_period);
CREATE INDEX idx_usage_user_action ON usage_logs(user_id, action_type, billing_period);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function: count user actions in current billing period
CREATE OR REPLACE FUNCTION get_usage_count(p_user_id UUID, p_action_type VARCHAR)
RETURNS INT AS $$
DECLARE
    cnt INT;
BEGIN
    SELECT COUNT(*) INTO cnt
    FROM usage_logs
    WHERE user_id = p_user_id
      AND action_type = p_action_type
      AND billing_period = TO_CHAR(NOW(), 'YYYY-MM');
    RETURN cnt;
END;
$$ LANGUAGE plpgsql;

-- Function: get user subscription status
CREATE OR REPLACE FUNCTION get_subscription_status(p_user_id UUID)
RETURNS TABLE(plan_name VARCHAR, status VARCHAR) AS $$
BEGIN
    RETURN QUERY
    SELECT s.plan_name, s.status
    FROM subscriptions s
    WHERE s.user_id = p_user_id
    ORDER BY s.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function: weekly summary aggregation
CREATE OR REPLACE FUNCTION get_weekly_summary(
    p_user_id UUID,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ
)
RETURNS TABLE(
    total_income NUMERIC,
    total_expense NUMERIC,
    net_savings NUMERIC,
    transaction_count BIGINT,
    top_category VARCHAR,
    top_category_amount NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH stats AS (
        SELECT
            COALESCE(SUM(CASE WHEN direction = 'inflow' THEN amount ELSE 0 END), 0) AS ti,
            COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0) AS te,
            COUNT(*) AS tc
        FROM transactions
        WHERE user_id = p_user_id
          AND is_deleted = FALSE
          AND created_at >= p_start
          AND created_at <= p_end
    ),
    top_cat AS (
        SELECT category AS cat, SUM(amount) AS cat_amt
        FROM transactions
        WHERE user_id = p_user_id
          AND is_deleted = FALSE
          AND direction = 'outflow'
          AND created_at >= p_start
          AND created_at <= p_end
        GROUP BY category
        ORDER BY cat_amt DESC
        LIMIT 1
    )
    SELECT
        s.ti,
        s.te,
        s.ti - s.te,
        s.tc,
        COALESCE(tc.cat, 'N/A'::VARCHAR),
        COALESCE(tc.cat_amt, 0)
    FROM stats s
    LEFT JOIN top_cat tc ON TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: category breakdown
CREATE OR REPLACE FUNCTION get_category_breakdown(
    p_user_id UUID,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ
)
RETURNS TABLE(
    category VARCHAR,
    total_amount NUMERIC,
    transaction_count BIGINT,
    percentage NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH totals AS (
        SELECT SUM(amount) AS grand_total
        FROM transactions
        WHERE user_id = p_user_id
          AND is_deleted = FALSE
          AND direction = 'outflow'
          AND created_at >= p_start
          AND created_at <= p_end
    )
    SELECT
        t.category,
        SUM(t.amount) AS total_amount,
        COUNT(*) AS transaction_count,
        ROUND(SUM(t.amount) / GREATEST(totals.grand_total, 1) * 100, 1) AS percentage
    FROM transactions t, totals
    WHERE t.user_id = p_user_id
      AND t.is_deleted = FALSE
      AND t.direction = 'outflow'
      AND t.created_at >= p_start
      AND t.created_at <= p_end
    GROUP BY t.category, totals.grand_total
    ORDER BY total_amount DESC;
END;
$$ LANGUAGE plpgsql;

-- Function: account balances
CREATE OR REPLACE FUNCTION get_account_balances(p_user_id UUID)
RETURNS TABLE(
    account_name VARCHAR,
    account_type VARCHAR,
    balance NUMERIC,
    currency VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT a.name, a.account_type, a.balance, a.currency
    FROM accounts a
    WHERE a.user_id = p_user_id
    ORDER BY a.balance DESC;
END;
$$ LANGUAGE plpgsql;

-- Insert default 'cash' account for new users
CREATE OR REPLACE FUNCTION create_default_account()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO accounts (user_id, name, account_type, is_default)
    VALUES (NEW.id, 'Cash', 'cash', TRUE);

    INSERT INTO subscriptions (user_id, plan_name, status)
    VALUES (NEW.id, 'free', 'active');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_default_account
    AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION create_default_account();

-- ============================================================
-- ROW LEVEL SECURITY (Supabase)
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies — service_role bypasses these; n8n uses service_role key
-- These policies are for direct Supabase client access if ever needed
CREATE POLICY users_own ON users FOR ALL USING (id = auth.uid());
CREATE POLICY accounts_own ON accounts FOR ALL USING (user_id = auth.uid());
CREATE POLICY transactions_own ON transactions FOR ALL USING (user_id = auth.uid());
CREATE POLICY tx_edits_own ON transaction_edits FOR ALL USING (user_id = auth.uid());
CREATE POLICY session_own ON session_memory FOR ALL USING (user_id = auth.uid());
CREATE POLICY budgets_own ON budgets FOR ALL USING (user_id = auth.uid());
CREATE POLICY subscriptions_own ON subscriptions FOR ALL USING (user_id = auth.uid());
CREATE POLICY usage_own ON usage_logs FOR ALL USING (user_id = auth.uid());
