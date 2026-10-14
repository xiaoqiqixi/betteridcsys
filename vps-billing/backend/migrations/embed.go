package migrations

import _ "embed"

//go:embed 001_initial.sql
var Initial string

//go:embed 002_site_settings.sql
var SiteSettings string

//go:embed 003_currencies.sql
var Currencies string

//go:embed 004_billing_snapshots.sql
var BillingSnapshots string

//go:embed 005_exact_currency_codes.sql
var ExactCurrencyCodes string
