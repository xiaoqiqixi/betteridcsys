package billing

import (
	"aster/billing/migrations"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"strings"
	"time"
)

type MySQL struct{ DB *sql.DB }

func OpenMySQL(ctx context.Context, dsn string, allowInsecure bool) (*MySQL, error) {
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil {
		return nil, errors.New("invalid MySQL configuration")
	}
	if !allowInsecure && cfg.TLSConfig != "true" {
		return nil, errors.New("MySQL TLS is required; use tls=true or explicitly allow an isolated private database")
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.MultiStatements = false
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 10 * time.Second
	cfg.WriteTimeout = 10 * time.Second
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if e = db.PingContext(ctx); e != nil {
		db.Close()
		return nil, errors.New("database connection failed")
	}
	return &MySQL{db}, nil
}
func (m *MySQL) Ping(ctx context.Context) error {
	var checksum string
	e := m.DB.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version=1").Scan(&checksum)
	if e != nil {
		return e
	}
	if checksum != digest(migrations.Initial) {
		return errors.New("schema version mismatch")
	}
	return nil
}
func (m *MySQL) Migrate(ctx context.Context) error {
	conn, e := m.DB.Conn(ctx)
	if e != nil {
		return e
	}
	defer conn.Close()
	var locked int
	if e = conn.QueryRowContext(ctx, "SELECT GET_LOCK('aster_schema_migration',30)").Scan(&locked); e != nil || locked != 1 {
		return errors.New("could not obtain migration lock")
	}
	defer conn.ExecContext(context.Background(), "SELECT RELEASE_LOCK('aster_schema_migration')")
	if _, e = conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version INT PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB"); e != nil {
		return e
	}
	var checksum string
	e = conn.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version=1").Scan(&checksum)
	if e == nil {
		if checksum != digest(migrations.Initial) {
			return errors.New("migration checksum mismatch; never edit applied migrations")
		}
		return nil
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	for _, q := range strings.Split(migrations.Initial, ";") {
		if strings.TrimSpace(q) != "" {
			if _, e = conn.ExecContext(ctx, q); e != nil {
				return fmt.Errorf("migration failed: %w", e)
			}
		}
	}
	for _, p := range Catalog() {
		_, e = conn.ExecContext(ctx, "INSERT IGNORE INTO plans(id,name,description,cpu,memory_gb,disk_gb,transfer_tb,region,price_minor,currency,available) VALUES(?,?,?,?,?,?,?,?,?,?,?)", p.ID, p.Name, p.Description, p.CPU, p.MemoryGB, p.DiskGB, p.TransferTB, p.Region, p.PriceMinor, p.Currency, false)
		if e != nil {
			return e
		}
	}
	_, e = conn.ExecContext(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES(1,?)", digest(migrations.Initial))
	return e
}
func scanUser(s interface{ Scan(...any) error }) (User, error) {
	var u User
	e := s.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PasswordHash)
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrNotFound
	}
	return u, e
}
func (m *MySQL) UserByEmail(c context.Context, e string) (User, error) {
	return scanUser(m.DB.QueryRowContext(c, "SELECT id,email,name,role,password_hash FROM users WHERE email=?", e))
}
func (m *MySQL) UserByID(c context.Context, id string) (User, error) {
	return scanUser(m.DB.QueryRowContext(c, "SELECT id,email,name,role,password_hash FROM users WHERE id=?", id))
}
func (m *MySQL) AddUser(c context.Context, u User) error {
	_, e := m.DB.ExecContext(c, "INSERT INTO users(id,email,name,role,password_hash) VALUES(?,?,?,?,?)", u.ID, u.Email, u.Name, u.Role, u.PasswordHash)
	return e
}
func (m *MySQL) Users(c context.Context) ([]User, error) {
	r, e := m.DB.QueryContext(c, "SELECT id,email,name,role,password_hash FROM users ORDER BY created_at DESC LIMIT 1000")
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []User{}
	for r.Next() {
		u, e := scanUser(r)
		if e != nil {
			return nil, e
		}
		out = append(out, u)
	}
	return out, r.Err()
}
func (m *MySQL) PutSession(c context.Context, s Session) error {
	_, e := m.DB.ExecContext(c, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", s.Hash, s.UserID, s.Expires)
	return e
}
func (m *MySQL) Session(c context.Context, k string) (Session, error) {
	var s Session
	e := m.DB.QueryRowContext(c, "SELECT token_hash,user_id,expires_at FROM sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP(6)", k).Scan(&s.Hash, &s.UserID, &s.Expires)
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrNotFound
	}
	return s, e
}
func (m *MySQL) DeleteSession(c context.Context, k string) error {
	_, e := m.DB.ExecContext(c, "DELETE FROM sessions WHERE token_hash=?", k)
	return e
}
func scanPlan(s interface{ Scan(...any) error }) (Plan, error) {
	var p Plan
	e := s.Scan(&p.ID, &p.Name, &p.Description, &p.CPU, &p.MemoryGB, &p.DiskGB, &p.TransferTB, &p.Region, &p.PriceMinor, &p.Currency, &p.Available)
	return p, e
}

const planColumns = "id,name,description,cpu,memory_gb,disk_gb,transfer_tb,region,price_minor,currency,available"

func (m *MySQL) Plans(c context.Context) ([]Plan, error) {
	r, e := m.DB.QueryContext(c, "SELECT "+planColumns+" FROM plans ORDER BY price_minor")
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Plan{}
	for r.Next() {
		p, e := scanPlan(r)
		if e != nil {
			return nil, e
		}
		out = append(out, p)
	}
	return out, r.Err()
}

const orderColumns = "id,number,user_id,plan_name,status,total_minor,currency,created_at,hostname"

func scanOrder(s interface{ Scan(...any) error }) (Order, error) {
	var o Order
	e := s.Scan(&o.ID, &o.Number, &o.UserID, &o.PlanName, &o.Status, &o.TotalMinor, &o.Currency, &o.CreatedAt, &o.Hostname)
	return o, e
}
func filter(uid string) (string, []any) {
	if uid == "" {
		return "", nil
	}
	return " WHERE user_id=?", []any{uid}
}
func (m *MySQL) Orders(c context.Context, uid string) ([]Order, error) {
	w, a := filter(uid)
	r, e := m.DB.QueryContext(c, "SELECT "+orderColumns+" FROM orders"+w+" ORDER BY created_at DESC LIMIT 1000", a...)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Order{}
	for r.Next() {
		o, e := scanOrder(r)
		if e != nil {
			return nil, e
		}
		out = append(out, o)
	}
	return out, r.Err()
}
func (m *MySQL) Invoices(c context.Context, uid string) ([]Invoice, error) {
	w, a := filter(uid)
	r, e := m.DB.QueryContext(c, "SELECT id,number,user_id,order_id,status,amount_minor,currency,issued_at,due_at,paid_at FROM invoices"+w+" ORDER BY issued_at DESC LIMIT 1000", a...)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Invoice{}
	for r.Next() {
		var i Invoice
		e = r.Scan(&i.ID, &i.Number, &i.UserID, &i.OrderID, &i.Status, &i.AmountMinor, &i.Currency, &i.IssuedAt, &i.DueAt, &i.PaidAt)
		if e != nil {
			return nil, e
		}
		out = append(out, i)
	}
	return out, r.Err()
}
func (m *MySQL) Services(c context.Context, uid string) ([]Service, error) {
	w, a := filter(uid)
	r, e := m.DB.QueryContext(c, "SELECT id,user_id,name,plan_name,region,ipv4,status,next_due_at,price_minor,currency,cpu,memory_gb,disk_gb FROM services"+w+" ORDER BY next_due_at LIMIT 1000", a...)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Service{}
	for r.Next() {
		var s Service
		e = r.Scan(&s.ID, &s.UserID, &s.Name, &s.PlanName, &s.Region, &s.IPv4, &s.Status, &s.NextDueAt, &s.PriceMinor, &s.Currency, &s.CPU, &s.MemoryGB, &s.DiskGB)
		if e != nil {
			return nil, e
		}
		out = append(out, s)
	}
	return out, r.Err()
}
func (m *MySQL) Audits(c context.Context, uid string) ([]Audit, error) {
	w, a := filter(uid)
	r, e := m.DB.QueryContext(c, "SELECT id,user_id,action,target,created_at,actor_email,detail FROM audit_events"+w+" ORDER BY created_at DESC LIMIT 1000", a...)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	out := []Audit{}
	for r.Next() {
		var v Audit
		e = r.Scan(&v.ID, &v.UserID, &v.Action, &v.Target, &v.CreatedAt, &v.ActorEmail, &v.Detail)
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, r.Err()
}
func (m *MySQL) createOrderOnce(c context.Context, u User, pid, host, key, fp string) (Order, bool, error) {
	tx, e := m.DB.BeginTx(c, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return Order{}, false, e
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(c, "INSERT INTO order_requests(user_id,request_key,fingerprint) VALUES(?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key", u.ID, key, fp)
	if e != nil {
		return Order{}, false, e
	}
	var oldFP string
	var oid sql.NullString
	e = tx.QueryRowContext(c, "SELECT fingerprint,order_id FROM order_requests WHERE user_id=? AND request_key=? FOR UPDATE", u.ID, key).Scan(&oldFP, &oid)
	if e != nil {
		return Order{}, false, e
	}
	if fp != oldFP {
		return Order{}, false, ErrConflict
	}
	if oid.Valid {
		o, e := scanOrder(tx.QueryRowContext(c, "SELECT "+orderColumns+" FROM orders WHERE id=? AND user_id=?", oid.String, u.ID))
		if e != nil {
			return o, false, e
		}
		e = tx.Commit()
		return o, true, e
	}
	p, e := scanPlan(tx.QueryRowContext(c, "SELECT "+planColumns+" FROM plans WHERE id=? FOR SHARE", pid))
	if errors.Is(e, sql.ErrNoRows) || e == nil && !p.Available {
		return Order{}, false, ErrUnavailable
	}
	if e != nil {
		return Order{}, false, e
	}
	o, i, a := newRecords(u, p, host)
	_, e = tx.ExecContext(c, "INSERT INTO orders(id,number,user_id,plan_id,plan_name,hostname,status,total_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", o.ID, o.Number, u.ID, pid, p.Name, host, o.Status, o.TotalMinor, o.Currency, o.CreatedAt)
	if e != nil {
		return Order{}, false, e
	}
	_, e = tx.ExecContext(c, "INSERT INTO invoices(id,number,user_id,order_id,status,amount_minor,currency,issued_at,due_at) VALUES(?,?,?,?,?,?,?,?,?)", i.ID, i.Number, u.ID, o.ID, i.Status, i.AmountMinor, i.Currency, i.IssuedAt, i.DueAt)
	if e != nil {
		return Order{}, false, e
	}
	_, e = tx.ExecContext(c, "INSERT INTO audit_events(id,user_id,action,target,created_at,actor_email,detail) VALUES(?,?,?,?,?,?,?)", a.ID, u.ID, a.Action, a.Target, a.CreatedAt, a.ActorEmail, a.Detail)
	if e != nil {
		return Order{}, false, e
	}
	payload, _ := json.Marshal(map[string]string{"order_id": o.ID, "invoice_id": i.ID, "status": "pending_payment"})
	_, e = tx.ExecContext(c, "INSERT INTO outbox_events(id,aggregate_id,event_type,payload,created_at) VALUES(?,?,?,?,?)", ID(), o.ID, "order.created", payload, o.CreatedAt)
	if e != nil {
		return Order{}, false, e
	}
	_, e = tx.ExecContext(c, "UPDATE order_requests SET order_id=? WHERE user_id=? AND request_key=?", o.ID, u.ID, key)
	if e != nil {
		return Order{}, false, e
	}
	e = tx.Commit()
	return o, false, e
}

func (m *MySQL) Invoice(c context.Context, uid, id string) (Invoice, error) {
	var i Invoice
	e := m.DB.QueryRowContext(c, "SELECT id,number,user_id,order_id,status,amount_minor,currency,issued_at,due_at,paid_at FROM invoices WHERE id=? AND user_id=?", id, uid).Scan(&i.ID, &i.Number, &i.UserID, &i.OrderID, &i.Status, &i.AmountMinor, &i.Currency, &i.IssuedAt, &i.DueAt, &i.PaidAt)
	if errors.Is(e, sql.ErrNoRows) {
		e = ErrNotFound
	}
	return i, e
}
func (m *MySQL) Summary(c context.Context, uid string) (Summary, error) {
	var s Summary
	tx, e := m.DB.BeginTx(c, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return s, e
	}
	defer tx.Rollback()
	w, a := filter(uid)
	e = tx.QueryRowContext(c, "SELECT COUNT(*),COALESCE(SUM(status='active'),0),COALESCE(SUM(CASE WHEN status='active' THEN price_minor ELSE 0 END),0) FROM services"+w, a...).Scan(&s.TotalServices, &s.ActiveServices, &s.MonthlyTotal)
	if e != nil {
		return s, e
	}
	e = tx.QueryRowContext(c, "SELECT COALESCE(SUM(status='unpaid'),0),COALESCE(SUM(CASE WHEN status='paid' THEN amount_minor ELSE 0 END),0) FROM invoices"+w, a...).Scan(&s.PendingInvoices, &s.Revenue)
	if e != nil {
		return s, e
	}
	if uid == "" {
		e = tx.QueryRowContext(c, "SELECT COUNT(*) FROM users WHERE role='customer'").Scan(&s.Customers)
		if e != nil {
			return s, e
		}
	}
	e = tx.Commit()
	return s, e
}

func (m *MySQL) CreateOrder(c context.Context, u User, pid, host, key, fp string) (Order, bool, error) {
	for n := 0; n < 3; n++ {
		o, replay, e := m.createOrderOnce(c, u, pid, host, key, fp)
		var me *mysql.MySQLError
		if !errors.As(e, &me) || (me.Number != 1213 && me.Number != 1205) {
			return o, replay, e
		}
		select {
		case <-c.Done():
			return Order{}, false, c.Err()
		case <-time.After(time.Duration(n+1) * 30 * time.Millisecond):
		}
	}
	return Order{}, false, errors.New("transaction retry exhausted")
}
