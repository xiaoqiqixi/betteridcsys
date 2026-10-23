package networking

import (
	"context"
	"database/sql"
	"strconv"
)

// SchemaReader is implemented by both sql.DB and the migration's locked Conn.
// Inspection is read-only. Missing tables are permitted only during preflight of
// an unrecorded migration; present tables must already have the exact shape.
type SchemaReader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type columnSpec struct {
	name, kind, collation string
	length                int64
	precision             int64
}
type indexSpec struct {
	name    string
	unique  bool
	columns []string
}
type tableSpec struct {
	name    string
	columns []columnSpec
	indexes []indexSpec
}

func ascii(name, kind string, n int64) columnSpec { return columnSpec{name, kind, "ascii_bin", n, 0} }
func baseID(name string) columnSpec               { return ascii(name, "char", 32) }
func hashColumn() columnSpec                      { return ascii("request_sha256", "char", 64) }
func createdColumn() columnSpec                   { return columnSpec{"created_at", "datetime", "", 0, 6} }
func networkTables() []tableSpec {
	return []tableSpec{
		{"controller_network_vpcs", []columnSpec{baseID("id"), baseID("owner_ref"), ascii("node_id", "varchar", 64), {"name", "varchar", "utf8mb4_bin", 80, 0}, ascii("cidr", "varchar", 18), {"vlan_id", "int", "", 0, 0}, ascii("state", "varchar", 16), hashColumn(), baseID("actor_id"), createdColumn()}, []indexSpec{{"PRIMARY", true, []string{"id"}}, {"controller_network_vpc_vlan", true, []string{"node_id", "vlan_id"}}, {"controller_network_vpc_owner", false, []string{"owner_ref", "id"}}, {"controller_network_vpc_node", false, []string{"node_id", "id"}}}},
		{"controller_network_pools", []columnSpec{baseID("id"), ascii("node_id", "varchar", 64), baseID("vpc_id"), {"name", "varchar", "utf8mb4_bin", 80, 0}, ascii("cidr", "varchar", 18), ascii("gateway", "varchar", 15), {"addresses", "mediumblob", "", 0, 0}, {"enabled", "tinyint", "", 0, 0}, hashColumn(), baseID("actor_id"), createdColumn()}, []indexSpec{{"PRIMARY", true, []string{"id"}}, {"controller_network_pool_node", false, []string{"node_id", "id"}}, {"controller_network_pool_vpc", false, []string{"vpc_id", "id"}}}},
		{"controller_network_leases", []columnSpec{baseID("id"), baseID("pool_id"), baseID("vpc_id"), ascii("node_id", "varchar", 64), baseID("instance_id"), baseID("owner_ref"), ascii("address", "varchar", 15), ascii("state", "varchar", 16), hashColumn(), baseID("actor_id"), createdColumn()}, []indexSpec{{"PRIMARY", true, []string{"id"}}, {"controller_network_lease_pool_address", true, []string{"pool_id", "address"}}, {"controller_network_lease_node_address", true, []string{"node_id", "address"}}, {"controller_network_lease_instance", false, []string{"instance_id", "id"}}, {"controller_network_lease_owner", false, []string{"owner_ref", "id"}}}},
	}
}
func CheckMigration(ctx context.Context, db SchemaReader, allowMissing bool) error {
	if db == nil {
		return ErrUnavailable
	}
	for _, table := range networkTables() {
		var engine, collation, kind string
		e := db.QueryRowContext(ctx, "SELECT ENGINE,TABLE_COLLATION,TABLE_TYPE FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", table.name).Scan(&engine, &collation, &kind)
		if e == sql.ErrNoRows && allowMissing {
			continue
		}
		if e != nil {
			if e == sql.ErrNoRows {
				return ErrConflict
			}
			return ErrUnavailable
		}
		if engine != "InnoDB" || collation != "utf8mb4_bin" || kind != "BASE TABLE" {
			return ErrConflict
		}
		rows, e := db.QueryContext(ctx, "SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,CHARACTER_MAXIMUM_LENGTH,COLLATION_NAME,DATETIME_PRECISION,EXTRA FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION", table.name)
		if e != nil {
			return ErrUnavailable
		}
		count := 0
		for rows.Next() {
			var name, dataType, columnType, nullable, extra string
			var length, precision sql.NullInt64
			var collate sql.NullString
			if rows.Scan(&name, &dataType, &columnType, &nullable, &length, &collate, &precision, &extra) != nil {
				rows.Close()
				return ErrUnavailable
			}
			if count >= len(table.columns) {
				rows.Close()
				return ErrConflict
			}
			want := table.columns[count]
			wantType := want.kind
			if want.length > 0 {
				wantType += "(" + strconv.FormatInt(want.length, 10) + ")"
			}
			if want.precision > 0 {
				wantType += "(" + strconv.FormatInt(want.precision, 10) + ")"
			}
			if want.kind == "tinyint" {
				wantType = "tinyint(1)"
			}
			if name != want.name || dataType != want.kind || columnType != wantType || nullable != "NO" || extra != "" || want.length > 0 && (!length.Valid || length.Int64 != want.length) || want.collation != "" && (!collate.Valid || collate.String != want.collation) || want.collation == "" && collate.Valid || want.precision > 0 && (!precision.Valid || precision.Int64 != want.precision) {
				rows.Close()
				return ErrConflict
			}
			count++
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return ErrUnavailable
		}
		if count != len(table.columns) {
			return ErrConflict
		}
		for _, idx := range table.indexes {
			rows, e = db.QueryContext(ctx, "SELECT COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE,SUB_PART,INDEX_TYPE,IS_VISIBLE,EXPRESSION,COLLATION FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=? ORDER BY SEQ_IN_INDEX", table.name, idx.name)
			if e != nil {
				return ErrUnavailable
			}
			n := 0
			for rows.Next() {
				var col, expression, direction sql.NullString
				var seq, nonunique int
				var partial sql.NullInt64
				var indexType, visible string
				if rows.Scan(&col, &seq, &nonunique, &partial, &indexType, &visible, &expression, &direction) != nil {
					rows.Close()
					return ErrUnavailable
				}
				wantUnique := 0
				if !idx.unique {
					wantUnique = 1
				}
				if n >= len(idx.columns) || !col.Valid || col.String != idx.columns[n] || seq != n+1 || nonunique != wantUnique || partial.Valid || indexType != "BTREE" || visible != "YES" || expression.Valid || !direction.Valid || direction.String != "A" {
					rows.Close()
					return ErrConflict
				}
				n++
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return ErrUnavailable
			}
			if n != len(idx.columns) {
				return ErrConflict
			}
		}
	}
	return nil
}
func (s *Store) Check(ctx context.Context) error {
	if s == nil || s.DB == nil {
		return ErrUnavailable
	}
	return CheckMigration(ctx, s.DB, false)
}
