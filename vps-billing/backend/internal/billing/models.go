package billing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("idempotency conflict")
var ErrUnavailable = errors.New("plan unavailable")
var ErrCurrency = errors.New("unsupported currency")

// JSON numbers must remain exact in browser clients. Both supported currencies use cents.
const MaxMinor int64 = 9007199254740991

type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	PasswordHash string `json:"-"`
}
type Plan struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CPU         int    `json:"cpu"`
	MemoryGB    int    `json:"memory_gb"`
	DiskGB      int    `json:"disk_gb"`
	TransferTB  int    `json:"transfer_tb"`
	Region      string `json:"region"`
	PriceMinor  int64  `json:"price_minor"`
	Currency    string `json:"currency"`
	Available   bool   `json:"available"`
}
type PlanPrice struct {
	AmountMinor int64
	Available   bool
}

type Order struct {
	Issuer     *InvoiceIdentity `json:"issuer,omitempty"`
	ID         string           `json:"id"`
	Number     string           `json:"number"`
	UserID     string           `json:"-"`
	PlanName   string           `json:"plan_name"`
	Status     string           `json:"status"`
	TotalMinor int64            `json:"total_minor"`
	Currency   string           `json:"currency"`
	CreatedAt  time.Time        `json:"created_at"`
	ServiceID  string           `json:"service_id,omitempty"`
	Hostname   string           `json:"hostname"`
}
type Invoice struct {
	Issuer      *InvoiceIdentity `json:"issuer,omitempty"`
	ID          string           `json:"id"`
	Number      string           `json:"number"`
	UserID      string           `json:"-"`
	OrderID     string           `json:"order_id"`
	Status      string           `json:"status"`
	AmountMinor int64            `json:"amount_minor"`
	Currency    string           `json:"currency"`
	IssuedAt    time.Time        `json:"issued_at"`
	DueAt       time.Time        `json:"due_at"`
	PaidAt      *time.Time       `json:"paid_at,omitempty"`
}
type Service struct {
	ID         string    `json:"id"`
	UserID     string    `json:"-"`
	Name       string    `json:"name"`
	PlanName   string    `json:"plan_name"`
	Region     string    `json:"region"`
	IPv4       string    `json:"ipv4"`
	Status     string    `json:"status"`
	NextDueAt  time.Time `json:"next_due_at"`
	PriceMinor int64     `json:"price_minor"`
	Currency   string    `json:"currency"`
	CPU        int       `json:"cpu"`
	MemoryGB   int       `json:"memory_gb"`
	DiskGB     int       `json:"disk_gb"`
}
type Audit struct {
	ID         string    `json:"id"`
	UserID     string    `json:"-"`
	Action     string    `json:"action"`
	Target     string    `json:"target"`
	CreatedAt  time.Time `json:"created_at"`
	ActorEmail string    `json:"actor_email"`
	Detail     string    `json:"detail"`
}
type Session struct {
	Hash    string
	UserID  string
	Expires time.Time
}
type Summary struct {
	ActiveServices  int
	TotalServices   int
	PendingInvoices int
	UnpaidTotal     int64
	MonthlyTotal    int64
	Revenue         int64
	Customers       int
}
type Store interface {
	EmailSettings(context.Context) (EmailSettingsRecord, error)
	UpdateEmailSettings(context.Context, User, EmailSettingsRecord) (EmailSettingsRecord, error)
	RecordEmailTest(context.Context, User, int64, string) error
	Settings(context.Context) (SiteSettings, error)
	UpdateSettings(context.Context, User, SiteSettings) (SiteSettings, error)
	Summary(context.Context, string, string) (Summary, error)
	Invoice(context.Context, string, string) (Invoice, error)
	Ping(context.Context) error
	UserByEmail(context.Context, string) (User, error)
	UserByID(context.Context, string) (User, error)
	AddUser(context.Context, User) error
	Users(context.Context) ([]User, error)
	PutSession(context.Context, Session) error
	Session(context.Context, string) (Session, error)
	DeleteSession(context.Context, string) error
	Plans(context.Context, string) ([]Plan, error)
	Orders(context.Context, string) ([]Order, error)
	Invoices(context.Context, string) ([]Invoice, error)
	Services(context.Context, string) ([]Service, error)
	Audits(context.Context, string) ([]Audit, error)
	CreateOrder(context.Context, User, string, string, string, string) (Order, bool, error)
}

func ID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func Catalog() []Plan {
	return []Plan{{"starter", "轻量云", "适合个人站点与开发测试", 1, 2, 40, 1, "香港 · HKG", 600, "USD", true}, {"standard", "标准云", "面向成长中的业务与应用", 2, 4, 80, 2, "香港 · HKG", 1200, "USD", true}, {"performance", "性能云", "更充裕的算力与高速存储", 4, 8, 160, 4, "东京 · NRT", 2400, "USD", true}}
}
func newRecords(u User, p Plan, host string) (Order, Invoice, Audit) {
	now := time.Now().UTC()
	id := ID()
	o := Order{ID: id, Number: "ORD-" + id[:12], UserID: u.ID, PlanName: p.Name, Status: "pending_payment", TotalMinor: p.PriceMinor, Currency: p.Currency, CreatedAt: now, Hostname: host}
	i := Invoice{ID: ID(), Number: "INV-" + id[:12], UserID: u.ID, OrderID: id, Status: "unpaid", AmountMinor: p.PriceMinor, Currency: p.Currency, IssuedAt: now, DueAt: now.Add(7 * 24 * time.Hour)}
	a := Audit{ID: ID(), UserID: u.ID, Action: "order.created", Target: id, CreatedAt: now, ActorEmail: u.Email, Detail: "订单与待支付账单已创建；未执行付款或资源开通"}
	return o, i, a
}
