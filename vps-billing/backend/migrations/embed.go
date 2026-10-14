package migrations

import _ "embed"

//go:embed 001_initial.sql
var Initial string

//go:embed 002_site_settings.sql
var SiteSettings string

//go:embed 003_currencies.sql
var Currencies string
