package migrations

import _ "embed"

//go:embed 001_controller.sql
var SQL string
