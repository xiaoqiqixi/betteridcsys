package billing

import (
	"context"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Uses a dedicated disposable database whose name contains _test. Never point at a real database.
func TestMySQLTransactionalOrders(t *testing.T) {
	dsn := os.Getenv("ASTER_MYSQL_TEST_DSN")
	if dsn == "" {
		t.Skip("ASTER_MYSQL_TEST_DSN not set; real MySQL integration not run")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.Contains(cfg.DBName, "_test") {
		t.Fatal("integration database name must contain _test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	m, e := OpenMySQL(ctx, dsn, true)
	if e != nil {
		t.Fatal(e)
	}
	defer m.DB.Close()
	if e = m.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = m.Migrate(ctx); e != nil {
		t.Fatal("repeat migration", e)
	}
	if e = m.Ping(ctx); e != nil {
		t.Fatal(e)
	}
	u := User{ID: ID(), Email: ID() + "@integration.invalid", Name: "Integration", Role: "customer", PasswordHash: "unused"}
	if e = m.AddUser(ctx, u); e != nil {
		t.Fatal(e)
	}
	p := Catalog()[0]
	p.ID = "test-" + ID()
	_, e = m.DB.ExecContext(ctx, "INSERT INTO plans(id,name,description,cpu,memory_gb,disk_gb,transfer_tb,region,price_minor,currency,available) VALUES(?,?,?,?,?,?,?,?,?,?,?)", p.ID, p.Name, p.Description, p.CPU, p.MemoryGB, p.DiskGB, p.TransferTB, p.Region, p.PriceMinor, p.Currency, true)
	if e != nil {
		t.Fatal(e)
	}
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for _, q := range []string{"DELETE FROM outbox_events WHERE aggregate_id IN(SELECT id FROM orders WHERE user_id=?)", "DELETE FROM order_requests WHERE user_id=?", "DELETE FROM audit_events WHERE user_id=?", "DELETE FROM invoices WHERE user_id=?", "DELETE FROM orders WHERE user_id=?", "DELETE FROM users WHERE id=?"} {
			if _, e := m.DB.ExecContext(c, q, u.ID); e != nil {
				t.Error("fixture cleanup", e)
			}
		}
		_, _ = m.DB.ExecContext(c, "DELETE FROM plans WHERE id=?", p.ID)
	}()
	var wg sync.WaitGroup
	ids := make(chan string, 16)
	for n := 0; n < 16; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o, _, e := m.CreateOrder(ctx, u, p.ID, "web-1", "same-key", "same-fp")
			if e != nil {
				t.Error(e)
				return
			}
			ids <- o.ID
		}()
	}
	wg.Wait()
	close(ids)
	id := ""
	for v := range ids {
		if id == "" {
			id = v
		}
		if v != id {
			t.Fatal("duplicate order")
		}
	}
	if id == "" {
		t.Fatal("no order created")
	}
	for _, table := range []string{"orders", "invoices", "audit_events", "order_requests"} {
		var n int
		e = m.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE user_id=?", u.ID).Scan(&n)
		if e != nil || n != 1 {
			t.Fatal(table, n, e)
		}
	}
	var n int
	e = m.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id=?", id).Scan(&n)
	if e != nil || n != 1 {
		t.Fatal(n, e)
	}
	if _, _, e = m.CreateOrder(ctx, u, p.ID, "web-2", "same-key", "different-fp"); e != ErrConflict {
		t.Fatal(e)
	}
	if _, _, e = m.CreateOrder(ctx, u, "missing-plan", "web-1", "unavailable-key", "fp"); e != ErrUnavailable {
		t.Fatal(e)
	}
	e = m.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM order_requests WHERE user_id=? AND request_key='unavailable-key'", u.ID).Scan(&n)
	if e != nil || n != 0 {
		t.Fatal("rolled back reservation", n, e)
	}
	is, e := m.Invoices(ctx, u.ID)
	if e != nil || len(is) != 1 || is[0].AmountMinor != 600 {
		t.Fatal(fmt.Sprint(is), e)
	}
	if _, e = m.Invoice(ctx, ID(), is[0].ID); e != ErrNotFound {
		t.Fatal("owner filter", e)
	}
	summary, e := m.Summary(ctx, u.ID)
	if e != nil || summary.PendingInvoices != 1 || summary.Revenue != 0 {
		t.Fatal(summary, e)
	}
}
